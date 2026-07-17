import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "@afrohit/db";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import { downloadToBuffer, uploadBytes } from "../lib/storage";
import {
  assembleMusicVideoTimeline,
  ensureDisplayFont,
  ffmpegAvailable,
  overlayVideoCredits,
  ASSEMBLY_FPS,
  type AssemblyTimelineClip,
} from "../lib/ffmpeg";
import { inspectVideoBytes } from "../lib/video-inspection";

/**
 * FULL MUSIC-VIDEO ASSEMBLY (Wave 9) — turn the already-rendered, already-
 * billed shots + the song's current master into ONE release-ready file
 * ('full' 1920x1080 for YouTube/TV, 'teaser' 1080x1920 for socials).
 *
 * 100% local ffmpeg — NO provider call, NO charge: the shots were billed
 * per-shot when they rendered and the master was billed when it was made;
 * gluing them together is CPU the worker already owns.
 *
 * The API route resolved everything that needs auth/workspace scope (the
 * edit decision list from the treatment via planVideoAssembly, the newest
 * render per shot, the song's current master via currentPlayableAsset) and
 * passed plain URLs — the worker adds no new DB read paths for gathering;
 * it only downloads, assembles, uploads, and writes the result row.
 */
interface AssembleVideoPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  conceptId: string;
  kind: "full" | "teaser";
  /** The EDL, in play order (sequence order; shots in order within each). */
  clips: Array<{
    shotIndex: number;
    sequenceIndex: number;
    /** Treatment-claimed duration — the trim law's slot. */
    slotS: number;
    url: string;
    renderId: string;
  }>;
  /** Sum of the slots — what the treatment claims the timeline covers. */
  plannedS: number;
  /** Teaser cap (teaserCut.durationS); null for the full cut. */
  maxDurationS: number | null;
  audio: {
    url: string;
    sourceId: string;
    sourceType: "beat" | "mix" | "master";
    /** Master offset — the teaser hook law; 0 for the full cut. */
    startS: number;
    songId: string | null;
    songDurationS: number | null;
  };
}

/** Per-shot render ceiling (mirrors processors/video.ts MAX_VIDEO_BYTES). */
const MAX_CLIP_BYTES = 256 * 1024 * 1024;
/** The mastered song — WAV masters of long records are big. */
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
/** Assembled release file ceiling — a full 1080p video of a whole song. */
const MAX_ASSEMBLY_BYTES = 1024 * 1024 * 1024;

type AssemblyStage =
  | "downloading"
  | "normalizing"
  | "concatenating"
  | "muxing"
  | "uploading";

export async function processAssembleVideo(p: AssembleVideoPayload) {
  await markRunning(p.jobId);

  // REAL progress stages — the UI polls /jobs/:id and reads outputJson, so
  // each stage is written when it actually starts. Best-effort by contract:
  // a progress write must never kill the assembly it narrates.
  const stage = async (name: AssemblyStage) => {
    await prisma.providerJob
      .update({
        where: { id: p.jobId },
        data: {
          outputJson: {
            assemblyStage: name,
            kind: p.kind,
            at: new Date().toISOString(),
          } as never,
        },
      })
      .catch(() => undefined);
  };

  let workDir: string | null = null;
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error("ffmpeg not found on worker host");
    }
    if (!p.clips.length) throw new Error("assembly payload has no clips");

    workDir = await mkdtemp(join(tmpdir(), "afrohit-assemble-"));

    // 1) DOWNLOAD the rendered shots (in EDL order) + the current master.
    await stage("downloading");
    const localClips: AssemblyTimelineClip[] = [];
    for (let i = 0; i < p.clips.length; i++) {
      const clip = p.clips[i]!;
      const bytes = await downloadToBuffer(clip.url, {
        maxBytes: MAX_CLIP_BYTES,
        timeoutMs: 10 * 60_000,
      });
      if (!bytes.length) {
        throw new Error(`rendered shot ${clip.shotIndex + 1} is empty`);
      }
      const path = join(workDir, `clip-${i}.mp4`);
      await writeFile(path, bytes);
      localClips.push({
        path,
        slotS: clip.slotS,
        sequenceIndex: clip.sequenceIndex,
        shotIndex: clip.shotIndex,
      });
    }
    const audioBytes = await downloadToBuffer(p.audio.url, {
      maxBytes: MAX_AUDIO_BYTES,
      timeoutMs: 10 * 60_000,
    });
    if (!audioBytes.length) throw new Error("the song audio is empty");
    const audioPath = join(workDir, "song-audio.bin");
    await writeFile(audioPath, audioBytes);

    // 2) ASSEMBLE — the exact function the proof harness measures.
    const result = await assembleMusicVideoTimeline({
      workDir,
      kind: p.kind,
      clips: localClips,
      audioPath,
      audioStartS: p.audio.startS,
      maxDurationS: p.maxDurationS,
      // FULL-SONG COVERAGE LAW: the full cut runs the WHOLE record — "the
      // song and the video go together" (owner). Scenes cycle to fill the
      // song; the teaser keeps its exact social cut length.
      coverAudio: p.kind === "full",
      onStage: name => stage(name),
    });

    // 2b) VIDEO NAMING LAW ("name the video — name and producer" — owner):
    //     burn the opening credit — TITLE / artist / producer — into the cut.
    //     Best-effort by design: no font or no song row → the cut ships
    //     uncredited rather than failing paid work; meta.credits says which.
    let creditedPath = result.path;
    let credits: { title: string; artist: string; producer: string } | null =
      null;
    try {
      const song = p.audio.songId
        ? await prisma.song.findFirst({
            where: { id: p.audio.songId },
            select: {
              title: true,
              lyric: { select: { title: true } },
              project: { select: { artist: { select: { stageName: true } } } },
            },
          })
        : null;
      if (song) {
        const credit = {
          title: (song.lyric?.title || song.title || "Untitled").trim(),
          artist: song.project.artist.stageName?.trim() || "AfroHit Artist",
          producer: "AfroHit Studio",
        };
        const fontPath = await ensureDisplayFont();
        if (fontPath) {
          const withCredits = join(workDir, `credited-${p.kind}.mp4`);
          await overlayVideoCredits({
            input: result.path,
            output: withCredits,
            ...credit,
            fontPath,
            width: result.width,
            height: result.height,
          });
          creditedPath = withCredits;
          credits = credit;
        }
      }
    } catch (creditError) {
      console.warn(
        `[assemble ${p.jobId}] credits overlay skipped:`,
        (creditError as Error).message
      );
    }

    // 3) UPLOAD to owned storage + honest measured metadata. inspectVideoBytes
    //    is the same QC every provider render passes: h264/mp4/aspect/decode.
    await stage("uploading");
    const bytes = await readFile(creditedPath);
    const inspection = await inspectVideoBytes(bytes, {
      format: p.kind === "full" ? "landscape" : "vertical",
      expectedDurationS: result.durationS,
      maxBytes: MAX_ASSEMBLY_BYTES,
    });
    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: "videos",
      bytes,
      contentType: "video/mp4",
      ext: "mp4",
    });

    // HONEST METADATA — coveredS vs songDurationS states exactly how much of
    // the record the timeline reaches; nothing was looped or faked to close
    // the gap ("Video covers 2:10 of 3:25 — render more scenes to extend").
    const assembly = {
      kind: p.kind,
      url,
      durationS: result.durationS,
      coveredS: result.coveredS,
      plannedS: p.plannedS,
      songDurationS: p.audio.songDurationS,
      shotsUsed: p.clips.map(clip => clip.shotIndex),
      renderIdsUsed: p.clips.map(clip => clip.renderId),
      sequenceCount: new Set(p.clips.map(clip => clip.sequenceIndex)).size,
      crossfades: result.crossfadeCount,
      // HONEST LOOP PROVENANCE — 1 means every frame is unique; >1 means the
      // rendered scenes cycle to carry the whole record.
      loopedCycles: result.loopedCycles,
      // VIDEO NAMING provenance — what the opening credit says (null = the
      // cut shipped uncredited: no font or no bound song).
      credits,
      width: inspection.width,
      height: inspection.height,
      fps: ASSEMBLY_FPS,
      contentHash: inspection.contentHash,
      sizeBytes: inspection.sizeBytes,
      renderedAt: new Date().toISOString(),
      audioSource: {
        id: p.audio.sourceId,
        type: p.audio.sourceType,
        startS: p.audio.startS,
        songId: p.audio.songId,
      },
    };

    const row = await prisma.videoRender.create({
      data: {
        projectId: p.projectId,
        conceptId: p.conceptId,
        url,
        durationS: result.durationS,
        provider: "assembler",
        meta: { assembly } as never,
      },
    });

    // NO COST: local CPU assembly spends nothing — no provider was called,
    // and the inputs (shots, master) were each billed when they were made.
    await markSucceeded(p.jobId, {
      kind: "video_assembly",
      videoRenderId: row.id,
      url,
      assembly,
    });
  } catch (error) {
    await markFailed(p.jobId, error);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
