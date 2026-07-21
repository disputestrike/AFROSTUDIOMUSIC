import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "@afrohit/db";
import { lipSyncClip } from "@afrohit/ai";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import { downloadToBuffer, resolveAssetForProvider, uploadBytes } from "../lib/storage";
import {
  assembleMusicVideoTimeline,
  computeClipAudioOffsets,
  ensureDisplayFont,
  ffmpegAvailable,
  overlayCreditsAndWatermark,
  prependLogoSplash,
  resolveBrandLogoPath,
  sliceAudioWav,
  ASSEMBLY_FPS,
  ASSEMBLY_XFADE_S,
  SPLASH_DURATION_S,
  type AssemblyTimelineClip,
} from "../lib/ffmpeg";
import { inspectVideoBytes } from "../lib/video-inspection";
import {
  assertAssemblyEvidenceComplete,
  assertSceneEvidenceComplete,
  VIDEO_EVIDENCE_VERSION,
} from "../lib/video-evidence";

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

    const sourceRows = await prisma.videoRender.findMany({
      where: { id: { in: [...new Set(p.clips.map(clip => clip.renderId))] } },
      select: {
        id: true,
        url: true,
        durationS: true,
        provider: true,
        meta: true,
      },
    });
    const sourceById = new Map(sourceRows.map(row => [row.id, row]));
    const sourceSceneHashes = p.clips.map(clip => {
      const source = sourceById.get(clip.renderId);
      if (!source) {
        throw new Error(
          `video_scene_evidence_incomplete: source render ${clip.renderId} is missing`
        );
      }
      assertSceneEvidenceComplete(source);
      const meta = source.meta as Record<string, unknown>;
      return {
        renderId: source.id,
        contentHash: String(meta.contentHash),
      };
    });

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

    // 1b) LIP-SYNC PASS (owner: "the big issue is lip syncing"). Flag-gated
    //     (LIPSYNC_ENABLED=1) so it never spends until the operator arms it.
    //     Each clip is synced to the EXACT slice of the record that plays
    //     under it (offset math mirrors the assembler's timeline and is
    //     test-pinned against it). Per-clip BEST EFFORT: a failed sync keeps
    //     the original clip — a mouth is never worth failing a paid cut.
    //     First cycle only under the full-song loop law (hooks repeat their
    //     words, so looped hook clips still roughly match).
    let lipSync: { synced: number; failed: number; estimatedUsd: number } | null =
      null;
    if (process.env.LIPSYNC_ENABLED === "1" && p.kind === "full" && workDir) {
      const syncDir = workDir;
      lipSync = { synced: 0, failed: 0, estimatedUsd: 0 };
      const offsets = computeClipAudioOffsets(
        p.clips.map(clip => ({
          slotS: clip.slotS,
          sequenceIndex: clip.sequenceIndex,
        })),
        ASSEMBLY_XFADE_S
      );
      await Promise.all(
        localClips.map(async (clip, index) => {
          try {
            const sliceOut = join(syncDir, `sync-slice-${index}.wav`);
            await sliceAudioWav(
              audioPath,
              p.audio.startS + offsets[index]!,
              clip.slotS,
              sliceOut
            );
            const sliceRef = await uploadBytes({
              workspaceId: p.workspaceId,
              kind: "videos/sync-slices",
              bytes: await readFile(sliceOut),
              contentType: "audio/wav",
              ext: "wav",
            });
            const result = await lipSyncClip({
              videoUrl: await resolveAssetForProvider(p.clips[index]!.url, 3600),
              audioUrl: await resolveAssetForProvider(sliceRef, 3600),
            });
            if (result.status !== "succeeded" || !result.videoUrl) {
              throw new Error(result.error ?? "lip-sync failed");
            }
            const syncedBytes = await downloadToBuffer(result.videoUrl, {
              maxBytes: MAX_CLIP_BYTES,
              timeoutMs: 10 * 60_000,
            });
            if (!syncedBytes.length) throw new Error("empty synced clip");
            await writeFile(clip.path, syncedBytes);
            lipSync!.synced += 1;
            lipSync!.estimatedUsd += clip.slotS * 0.014;
          } catch (syncError) {
            lipSync!.failed += 1;
            console.warn(
              `[assemble ${p.jobId}] lip-sync kept the original for clip ${index}:`,
              (syncError as Error).message
            );
          }
        })
      );
      lipSync.estimatedUsd = Math.round(lipSync.estimatedUsd * 1000) / 1000;
    }

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
    //     resolve the opening credit — TITLE / artist / producer. Best-effort:
    //     no bound song → the cut ships uncredited (the folded brand pass below
    //     still burns the watermark); meta.credits records which. The BURN
    //     itself is deferred to 2d so it shares ONE re-encode with the
    //     watermark instead of taking a full-length pass of its own.
    let credit: { title: string; artist: string; producer: string } | null =
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
        credit = {
          title: (song.lyric?.title || song.title || "Untitled").trim(),
          artist: song.project.artist.stageName?.trim() || "AfroHits Artist",
          producer: "AfroHits Studio",
        };
      }
    } catch (creditError) {
      console.warn(
        `[assemble ${p.jobId}] credit lookup skipped:`,
        (creditError as Error).message
      );
    }

    // 2c) LOGO SPLASH ("show our logo at the start of the video — then it
    //     disappears after a splash" — owner): prepend ~1.8s of the AfroHits
    //     mark FIRST, so the splash is the very first thing seen. A structural
    //     concat (different frames) kept as its OWN pass — independent of the
    //     drawtext fold below — so its fail-soft receipt stays isolated: a
    //     missing logo or a failed encode ships the un-splashed cut and the
    //     receipt says so. The credit is burned AFTER the splash now (2d) with
    //     its cue window shifted by the splash length, so it still cues 0.8s
    //     into the first scene exactly as before.
    let splashedPath = result.path;
    let splash: { applied: boolean; durationS: number; error?: string };
    try {
      const logoPath = resolveBrandLogoPath();
      if (!logoPath) throw new Error("brand logo asset not found");
      const withSplash = join(workDir, `splashed-${p.kind}.mp4`);
      await prependLogoSplash({
        input: result.path,
        output: withSplash,
        logoPath,
        width: result.width,
        height: result.height,
      });
      splashedPath = withSplash;
      splash = { applied: true, durationS: SPLASH_DURATION_S };
    } catch (splashError) {
      splash = {
        applied: false,
        durationS: 0,
        error: (splashError as Error).message,
      };
      console.warn(
        `[assemble ${p.jobId}] logo splash skipped:`,
        (splashError as Error).message
      );
    }

    // 2d) FOLDED BRAND PASS (vidspeed 2026-07-20): the opening credit AND the
    //     persistent "afro" watermark (owner, VEVO reference) are BOTH drawtext
    //     on the identical frame, so ONE re-encode burns both — where the
    //     pipeline used to spend two full-length passes. Watermark rides the
    //     whole runtime (splash + credit included) plus the first-3s bottom-left
    //     thumbnail mark; the credit cue is shifted by SPLASH_DURATION_S only
    //     when the splash actually shipped, landing it on the first scene as
    //     before. Same fail-soft doctrine: a failure (no font, bad encode)
    //     ships the splashed cut untouched and the receipts report each
    //     feature's applied/skip honestly — branding never fails paid work.
    let finalPath = splashedPath;
    let credits: { title: string; artist: string; producer: string } | null =
      null;
    let watermark: { applied: boolean; error?: string };
    try {
      const fontPath = await ensureDisplayFont();
      if (!fontPath) throw new Error("display font unavailable");
      const branded = join(workDir, `branded-${p.kind}.mp4`);
      await overlayCreditsAndWatermark({
        input: splashedPath,
        output: branded,
        width: result.width,
        height: result.height,
        fontPath,
        credit,
        creditOffsetS: splash.applied ? SPLASH_DURATION_S : 0,
      });
      finalPath = branded;
      credits = credit;
      watermark = { applied: true };
    } catch (brandError) {
      credits = null;
      watermark = {
        applied: false,
        error: (brandError as Error).message,
      };
      console.warn(
        `[assemble ${p.jobId}] brand overlays skipped:`,
        (brandError as Error).message
      );
    }

    // The delivered file's honest duration: the cut plus the splash (if it
    // actually shipped) — QC and the receipt both measure the same truth.
    const finalDurationS =
      result.durationS + (splash.applied ? SPLASH_DURATION_S : 0);

    // 3) UPLOAD to owned storage + honest measured metadata. inspectVideoBytes
    //    is the same QC every provider render passes: h264/mp4/aspect/decode.
    await stage("uploading");
    const bytes = await readFile(finalPath);
    const inspection = await inspectVideoBytes(bytes, {
      format: p.kind === "full" ? "landscape" : "vertical",
      expectedDurationS: finalDurationS,
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
      evidenceVersion: VIDEO_EVIDENCE_VERSION,
      providerJobId: p.jobId,
      kind: p.kind,
      url,
      durationS: finalDurationS,
      coveredS: result.coveredS,
      plannedS: p.plannedS,
      songDurationS: p.audio.songDurationS,
      shotsUsed: p.clips.map(clip => clip.shotIndex),
      renderIdsUsed: p.clips.map(clip => clip.renderId),
      sourceSceneHashes,
      sequenceCount: new Set(p.clips.map(clip => clip.sequenceIndex)).size,
      crossfades: result.crossfadeCount,
      // HONEST LOOP PROVENANCE — 1 means every frame is unique; >1 means the
      // rendered scenes cycle to carry the whole record.
      loopedCycles: result.loopedCycles,
      // VIDEO NAMING provenance — what the opening credit says (null = the
      // cut shipped uncredited: no font or no bound song).
      credits,
      // BRAND SPLASH receipt — applied:true means the cut opens on the
      // AfroHits logo splash (durationS seconds prepended); applied:false
      // carries the honest reason it was skipped.
      splash,
      // WATERMARK receipt — applied:true means the persistent bottom-right
      // "afro" mark (plus the first-3s bottom-left thumbnail mark) is burned
      // in; applied:false carries the reason.
      watermark,
      // LIP-SYNC receipt (null = pass disabled): clips synced vs kept, and
      // the honest engine spend estimate.
      lipSync,
      width: inspection.width,
      height: inspection.height,
      fps: ASSEMBLY_FPS,
      contentHash: inspection.contentHash,
      sizeBytes: inspection.sizeBytes,
      codec: inspection.codec,
      container: inspection.container,
      qualityState: inspection.qualityState,
      renderedAt: new Date().toISOString(),
      audioSource: {
        id: p.audio.sourceId,
        type: p.audio.sourceType,
        startS: p.audio.startS,
        songId: p.audio.songId,
      },
    };

    assertAssemblyEvidenceComplete({
      url,
      durationS: finalDurationS,
      provider: "assembler",
      meta: { assembly },
    });

    const row = await prisma.videoRender.create({
      data: {
        projectId: p.projectId,
        conceptId: p.conceptId,
        url,
        durationS: finalDurationS,
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
