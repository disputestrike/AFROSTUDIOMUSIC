import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { prisma } from "@afrohit/db";
import { isReleaseKit } from "@afrohit/ai";

import { downloadToBuffer, uploadBytes } from "../lib/storage";
import {
  cutClips,
  ensureDisplayFont,
  ffmpegAvailable,
  probeMediaDurationPreciseS,
  ASSEMBLY_FPS,
  CLIP_HEIGHT,
  CLIP_WIDTH,
  SPLASH_DURATION_S,
  type CutClipRequest,
} from "../lib/ffmpeg";
import {
  extractSongSections,
  parseClipCounts,
  planClips,
  wrapCaption,
  type ClipSection,
} from "../lib/clip-plan";
import type { GenerateClipsJobPayload } from "../lib/clips";

/**
 * AUTO-CLIP PROCESSOR (Phase 2) — cut the ONE assembled master music video into
 * ~10 vertical shorts for TikTok / Reels / Shorts, entirely by ffmpeg EDIT
 * (trim + 9:16 crop + scale + caption + watermark), NEVER a re-render.
 *
 * HARD ECONOMIC RULE: no new video generation, no provider call, no charge — the
 * master was billed when it was assembled; slicing it is CPU the worker already
 * owns ("generate once, repurpose many"). Users are charged $0.
 *
 * FAIL-SOFT everywhere: this NEVER throws (a clip problem must not fail the
 * clips lane job), a single clip that errors never kills the batch (cutClips
 * collects successes + failures), and ffmpeg/master problems degrade to
 * clipsStatus 'unavailable' with an honest log. Idempotent: it skips a master
 * that already has clips unless the payload forces a recut.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** The assembled master is a full 1080p (or vertical) video of a whole song. */
const MAX_MASTER_BYTES = 1024 * 1024 * 1024;

export async function processGenerateClips(
  p: GenerateClipsJobPayload
): Promise<void> {
  let workDir: string | null = null;
  try {
    // IDEMPOTENT: a completion hook that fires twice (retry, or a kit refresh)
    // must not re-cut a master that already has its clips. A Recut forces past
    // this and replaces the old set below.
    if (!p.force) {
      const existing = await prisma.songClip.count({
        where: { songId: p.songId, sourceVideoId: p.sourceVideoId },
      });
      if (existing > 0) {
        await markStatus(p.songId, "ready");
        log.info(
          { songId: p.songId, sourceVideoId: p.sourceVideoId, existing },
          "clips already exist for this master — skipping (idempotent)"
        );
        return;
      }
    }

    if (!(await ffmpegAvailable())) {
      await markStatus(p.songId, "unavailable");
      log.warn(
        { songId: p.songId },
        "ffmpeg not found on worker host — clips unavailable (video render unaffected)"
      );
      return;
    }

    const source = await prisma.videoRender.findFirst({
      where: { id: p.sourceVideoId },
      select: { id: true, url: true, meta: true, durationS: true },
    });
    if (!source?.url) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId, sourceVideoId: p.sourceVideoId }, "master video row missing — no clips");
      return;
    }

    const song = await prisma.song.findFirst({
      where: { id: p.songId },
      select: {
        id: true,
        title: true,
        socialsJson: true,
        storyboard: true,
        lyric: { select: { title: true, body: true } },
        beats: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { bpm: true },
        },
      },
    });

    // CAPTION (sound-off viewing): the release-kit HOOK line is the best static
    // caption we have — there is NO reliable per-line lyric timing in the repo
    // (the alignment score is an identity gate, not timestamps; melody-score
    // syllable timing is a compose-time artifact, not persisted per-song audio
    // timing), so we burn the hook line rather than pretend to sync captions we
    // can't. Fall back to the first lyric line, then the song title.
    const kit = isReleaseKit(song?.socialsJson) ? song!.socialsJson : null;
    const firstLyricLine =
      song?.lyric?.body
        ?.split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !/^\[/.test(l)) ?? null;
    const captionSource =
      (kit?.hook && kit.hook.trim()) ||
      firstLyricLine ||
      song?.lyric?.title ||
      song?.title ||
      "";
    const caption = wrapCaption(captionSource);

    // SPLASH LEAD-IN: the assembled cut opens on ~1.8s of the logo splash. Skip
    // it so no clip opens on the splash, and shift any audio-time section map
    // onto the video timeline by the same amount.
    const splashApplied =
      (source.meta as { assembly?: { splash?: { applied?: boolean } } } | null)
        ?.assembly?.splash?.applied === true;
    const leadInS = splashApplied ? SPLASH_DURATION_S : 0;

    // Best-effort section map (usually null → the honest heuristic path). When a
    // real arrangement with timings exists, its audio-time sections are shifted
    // onto the video timeline by the splash lead-in.
    const bpm = song?.beats?.[0]?.bpm ?? null;
    const audioSections = extractSongSections(song?.storyboard, bpm);
    const sections: ClipSection[] | null = audioSections
      ? audioSections.map((s) => ({ name: s.name, startS: s.startS + leadInS }))
      : null;

    // Download the master, probe its true length, plan the hook-first cut.
    workDir = await mkdtemp(join(tmpdir(), "afrohit-clips-"));
    const bytes = await downloadToBuffer(source.url, {
      maxBytes: MAX_MASTER_BYTES,
      timeoutMs: 10 * 60_000,
    });
    if (!bytes.length) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "master video is empty — no clips");
      return;
    }
    const masterPath = join(workDir, "master.mp4");
    await writeFile(masterPath, bytes);
    const totalDurationS =
      (await probeMediaDurationPreciseS(masterPath)) || source.durationS || 0;
    if (!totalDurationS || totalDurationS < 2) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId, totalDurationS }, "master too short to clip — no clips");
      return;
    }

    const counts = parseClipCounts(process.env.CLIP_COUNTS);
    const plan = planClips({ totalDurationS, counts, sections, leadInS });
    if (!plan.length) {
      await markStatus(p.songId, "unavailable");
      return;
    }

    const fontPath = await ensureDisplayFont();
    if (!fontPath) {
      // No font → the caption cannot be burned. Rather than ship uncaptioned
      // shorts (the sound-off caption is the point), degrade honestly.
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "display font unavailable — clips deferred (video render unaffected)");
      return;
    }

    // Cut every clip off the master — ONE cheap pass each, fail-soft as a batch.
    const requests: CutClipRequest[] = plan.map((c) => ({
      spec: {
        startS: c.startS,
        durationS: c.durationS,
        width: CLIP_WIDTH,
        height: CLIP_HEIGHT,
      },
      caption,
    }));
    const { ok, failed } = await cutClips({
      input: masterPath,
      workDir,
      fontPath,
      clips: requests,
    });

    // A Recut replaces the old set for this master (idempotency deleted nothing
    // on the first cut, so this is a no-op there).
    if (p.force) {
      await prisma.songClip
        .deleteMany({ where: { songId: p.songId, sourceVideoId: p.sourceVideoId } })
        .catch(() => undefined);
    }

    let stored = 0;
    for (const clip of ok) {
      const planned = plan[clip.index]!;
      try {
        const fileBytes = await readFile(clip.path);
        if (!fileBytes.length) throw new Error("empty clip file");
        const url = await uploadBytes({
          workspaceId: p.workspaceId,
          kind: "clips",
          bytes: fileBytes,
          contentType: "video/mp4",
          ext: "mp4",
        });
        await prisma.songClip.create({
          data: {
            songId: p.songId,
            workspaceId: p.workspaceId,
            sourceVideoId: source.id,
            url,
            durationS: planned.durationS,
            startS: planned.startS,
            aspect: "9:16",
            kind: planned.kind,
            captionText: caption || null,
            sectionLabel: planned.sectionLabel,
            // Honest receipt: an EDIT off the master, not a render. $0 — the
            // master was billed when it was assembled.
            meta: {
              width: clip.width,
              height: clip.height,
              fps: ASSEMBLY_FPS,
              splashLeadInS: leadInS,
              sizeBytes: fileBytes.length,
              codec: "h264",
              container: "mp4",
              edit: "ffmpeg-crop-trim-drawtext",
              regenerated: false,
              costUsd: 0,
              hookFirst: /hook|chorus|drop/i.test(planned.sectionLabel),
            } as never,
          },
        });
        stored += 1;
      } catch (err) {
        log.warn(
          { err, songId: p.songId, index: clip.index },
          "a cut clip could not be stored (batch continues)"
        );
      }
    }

    await markStatus(p.songId, stored > 0 ? "ready" : "unavailable");
    log.info(
      {
        songId: p.songId,
        sourceVideoId: source.id,
        planned: plan.length,
        stored,
        cutFailed: failed.length,
        totalDurationS: Math.round(totalDurationS),
        sectioned: !!sections,
        reason: p.reason,
      },
      "auto-clip cut finished (ffmpeg edits, no re-render, $0)"
    );
  } catch (err) {
    // FAIL-SOFT: never throw. Mark unavailable so the tab can retry; the video
    // render this fired from is never affected.
    log.warn({ err, songId: p.songId }, "auto-clip cut failed (video render unaffected)");
    await markStatus(p.songId, "unavailable").catch(() => undefined);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function markStatus(
  songId: string,
  status: "cutting" | "ready" | "unavailable"
): Promise<void> {
  await prisma.song
    .updateMany({ where: { id: songId }, data: { clipsStatus: status } })
    .catch(() => undefined);
}
