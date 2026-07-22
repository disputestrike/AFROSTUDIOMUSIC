import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { prisma } from "@afrohit/db";
import { isReleaseKit } from "@afrohit/ai";

import { downloadToBuffer, uploadBytes } from "../lib/storage";
import {
  ensureDisplayFont,
  ffmpegAvailable,
  probeDurationS,
  renderLyricVideo,
  renderVisualizer,
  renderThumbnails,
  resolveVisualGradient,
  VISUAL_HEIGHT,
  VISUAL_WIDTH,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  type ThumbnailRenderRequest,
} from "../lib/ffmpeg";
import { planLyricPages, planThumbnailVariants } from "../lib/visuals-plan";
import type { GenerateVisualsJobPayload } from "../lib/visuals";

/**
 * AUTO-VISUALS PROCESSOR (Phase 3) — the moment a SONG finishes, generate a
 * lyric video, an audio-reactive visualizer, and 3-5 thumbnails, ALL by cheap
 * ffmpeg/image EDITS off the EXISTING master audio + lyrics + cover. NO new
 * song/video render, no provider call, no charge — "generate once, repurpose
 * many", users charged $0.
 *
 *   1) LYRIC VIDEO   — 1080x1920: master audio + ken-burns cover (or gradient) +
 *      the lyrics EVENLY PAGED (honest timing — NOT karaoke sync; true per-line
 *      sync needs a forced-alignment pass, owner follow-up) + "afro" watermark.
 *      Skipped for an instrumental (no lyrics) — the visualizer carries it.
 *   2) VISUALIZER    — 1080x1920: an audio-reactive showwaves waveform over the
 *      cover + watermark. The shareable for instrumentals, an alt for any song.
 *   3) THUMBNAILS    — 3-5 CTR stills: the cover + a bold title/hook overlay in
 *      a few crops/placements (and, when the operator opts in, 1-2 AI cover
 *      variants — cost-logged like cover-generate; OFF by default).
 *
 * FAIL-SOFT everywhere: this NEVER throws (a visuals problem must not fail the
 * visuals lane job), a single asset that errors never kills the batch, and
 * ffmpeg/font/audio problems degrade to visualsStatus 'unavailable' with an
 * honest log — the song render is NEVER affected. Idempotent: it skips a song
 * that already has visuals unless the payload forces a regenerate.
 */

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** A master WAV of a 3-minute song is ~30MB; cap generously. */
const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
const MAX_COVER_BYTES = 40 * 1024 * 1024;
/** Cap the visual length so a pathological input can't blow the render timeout;
 *  songs are ~3min so this rarely bites. */
const VISUAL_MAX_DURATION_S = 600;

async function markStatus(
  songId: string,
  status: "creating" | "ready" | "unavailable"
): Promise<void> {
  await prisma.song
    .updateMany({ where: { id: songId }, data: { visualsStatus: status } })
    .catch(() => undefined);
}

/** Resolve the best MASTER AUDIO ref for a song: newest mastered → mix →
 *  finished-song instrumental → newest beat. Honest fallback ladder — an
 *  instrumental (kind='instrumental') still has a beat/instrumental to visualize. */
async function resolveSongAudioUrl(songId: string): Promise<string | null> {
  const song = await prisma.song.findFirst({
    where: { id: songId },
    select: { instrumentalUrl: true },
  });
  const master = await prisma.master.findFirst({
    where: { songId },
    orderBy: { createdAt: "desc" },
    select: { url: true },
  });
  if (master?.url) return master.url;
  const mix = await prisma.mix.findFirst({
    where: { songId },
    orderBy: { createdAt: "desc" },
    select: { url: true },
  });
  if (mix?.url) return mix.url;
  if (song?.instrumentalUrl) return song.instrumentalUrl;
  const beat = await prisma.beatAsset.findFirst({
    where: { songId },
    orderBy: { createdAt: "desc" },
    select: { url: true },
  });
  return beat?.url ?? null;
}

/** Resolve the cover ref: the per-song cover, else the newest project cover
 *  ImageAsset, else null (→ the genre gradient backdrop). */
async function resolveCoverUrl(
  songCoverUrl: string | null,
  projectId: string
): Promise<string | null> {
  if (songCoverUrl) return songCoverUrl;
  const cover = await prisma.imageAsset.findFirst({
    where: { projectId, kind: "cover" },
    orderBy: { createdAt: "desc" },
    select: { url: true },
  });
  return cover?.url ?? null;
}

export async function processGenerateVisuals(
  p: GenerateVisualsJobPayload
): Promise<void> {
  let workDir: string | null = null;
  try {
    // IDEMPOTENT: a completion hook that fires twice (render then master, or a
    // retry) must not rebuild visuals a song already has. A Regenerate forces
    // past this and replaces the old set below.
    if (!p.force) {
      const existing = await prisma.songVisual.count({ where: { songId: p.songId } });
      if (existing > 0) {
        await markStatus(p.songId, "ready");
        log.info(
          { songId: p.songId, existing },
          "visuals already exist — skipping (idempotent)"
        );
        return;
      }
    }

    if (!(await ffmpegAvailable())) {
      await markStatus(p.songId, "unavailable");
      log.warn(
        { songId: p.songId },
        "ffmpeg not found on worker host — visuals unavailable (song render unaffected)"
      );
      return;
    }

    const song = await prisma.song.findFirst({
      where: { id: p.songId },
      select: {
        id: true,
        title: true,
        projectId: true,
        coverUrl: true,
        socialsJson: true,
        project: { select: { genre: true } },
        lyric: { select: { title: true, body: true } },
      },
    });
    if (!song) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "song row missing — no visuals");
      return;
    }

    const audioUrl = await resolveSongAudioUrl(p.songId);
    if (!audioUrl) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "no master audio yet — visuals deferred (song render unaffected)");
      return;
    }

    const fontPath = await ensureDisplayFont();
    if (!fontPath) {
      // No font → the lyrics/title/watermark can't be burned. Degrade honestly
      // rather than ship unbranded, textless visuals (mirrors the clip cutter).
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "display font unavailable — visuals deferred (song render unaffected)");
      return;
    }

    workDir = await mkdtemp(join(tmpdir(), "afrohit-visuals-"));

    // Download the master audio + probe its true length.
    const audioBytes = await downloadToBuffer(audioUrl, {
      maxBytes: MAX_AUDIO_BYTES,
      timeoutMs: 5 * 60_000,
    });
    if (!audioBytes.length) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId }, "master audio is empty — no visuals");
      return;
    }
    const audioPath = join(workDir, "audio.bin");
    await writeFile(audioPath, audioBytes);
    const probed = await probeDurationS(audioPath);
    const durationS = Math.min(VISUAL_MAX_DURATION_S, probed || 0);
    if (!durationS || durationS < 2) {
      await markStatus(p.songId, "unavailable");
      log.warn({ songId: p.songId, durationS }, "audio too short to visualize — no visuals");
      return;
    }

    // Cover (or the genre gradient fallback). A missing/failed cover download is
    // NOT fatal — the gradient backdrop carries every asset.
    const coverUrl = await resolveCoverUrl(song.coverUrl, song.projectId);
    let coverPath: string | null = null;
    if (coverUrl) {
      try {
        const coverBytes = await downloadToBuffer(coverUrl, {
          maxBytes: MAX_COVER_BYTES,
          timeoutMs: 60_000,
        });
        if (coverBytes.length) {
          coverPath = join(workDir, "cover.png");
          await writeFile(coverPath, coverBytes);
        }
      } catch (err) {
        log.warn({ err, songId: p.songId }, "cover download failed — falling back to gradient backdrop");
      }
    }
    const gradient = resolveVisualGradient(song.project.genre);

    // The release-kit HOOK line is the best short thumbnail line we have; fall
    // back to the first lyric line, then the title.
    const kit = isReleaseKit(song.socialsJson) ? song.socialsJson : null;
    const hook = (kit?.hook && String(kit.hook).trim()) || null;

    // Plan the lyric pages (VERBATIM, EVENLY PACED — see visuals-plan) and the
    // thumbnail variants. An instrumental yields 0 pages → no lyric video.
    const lyricPlan = planLyricPages({
      body: song.lyric?.body ?? null,
      totalDurationS: durationS,
    });
    const thumbVariants = planThumbnailVariants({
      title: song.lyric?.title || song.title,
      hook,
    });

    // A Regenerate replaces the old set for this song (idempotency deleted
    // nothing on the first build, so this is a no-op there).
    if (p.force) {
      await prisma.songVisual.deleteMany({ where: { songId: p.songId } }).catch(() => undefined);
    }

    let stored = 0;
    const failures: string[] = [];

    // --- 1) LYRIC VIDEO (skipped for an instrumental — no lyrics) ---
    if (lyricPlan.pages.length > 0) {
      try {
        const out = join(workDir, "lyric-video.mp4");
        await renderLyricVideo({
          output: out,
          audioPath,
          fontPath,
          coverPath,
          gradient,
          pages: lyricPlan.pages,
          durationS,
          width: VISUAL_WIDTH,
          height: VISUAL_HEIGHT,
        });
        await storeVisual({
          songId: p.songId,
          workspaceId: p.workspaceId,
          kind: "lyric_video",
          path: out,
          contentType: "video/mp4",
          ext: "mp4",
          aspect: "9:16",
          meta: {
            width: VISUAL_WIDTH,
            height: VISUAL_HEIGHT,
            durationS,
            pages: lyricPlan.pages.length,
            lyricLines: lyricPlan.lineCount,
            timing: lyricPlan.timing,
            // HONEST: the pages tile the song on a fixed cadence — NOT karaoke
            // sync. True per-line sync needs a forced-alignment timing pass.
            timingCaveat: "even-paced pages, not per-line karaoke sync (needs a timing pass)",
            edit: "ffmpeg-kenburns-drawtext",
            hasCover: !!coverPath,
            costUsd: 0,
          },
        });
        stored += 1;
      } catch (err) {
        failures.push("lyric_video");
        log.warn({ err, songId: p.songId }, "lyric video failed (batch continues)");
      }
    }

    // --- 2) VISUALIZER (always — the instrumental's shareable) ---
    try {
      const out = join(workDir, "visualizer.mp4");
      await renderVisualizer({
        output: out,
        audioPath,
        fontPath,
        coverPath,
        gradient,
        durationS,
        width: VISUAL_WIDTH,
        height: VISUAL_HEIGHT,
      });
      await storeVisual({
        songId: p.songId,
        workspaceId: p.workspaceId,
        kind: "visualizer",
        path: out,
        contentType: "video/mp4",
        ext: "mp4",
        aspect: "9:16",
        meta: {
          width: VISUAL_WIDTH,
          height: VISUAL_HEIGHT,
          durationS,
          reactive: "showwaves",
          edit: "ffmpeg-showwaves-overlay",
          hasCover: !!coverPath,
          costUsd: 0,
        },
      });
      stored += 1;
    } catch (err) {
      failures.push("visualizer");
      log.warn({ err, songId: p.songId }, "visualizer failed (batch continues)");
    }

    // --- 3) THUMBNAILS (3-5 CTR stills off the cover, incl. the branded POSTER) ---
    const requests: ThumbnailRenderRequest[] = thumbVariants.map((v) => ({
      id: v.id,
      text: v.text,
      crop: v.crop,
      textPos: v.textPos,
      accent: v.accent,
      poster: v.poster,
    }));
    const { ok: thumbOk, failed: thumbFailed } = await renderThumbnails({
      workDir,
      coverPath,
      gradient,
      fontPath,
      requests,
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    });
    // The canonical branded poster — the clean cover + the big "AFRO" mark —
    // resolved as the thumbnails store, then pinned to Song.posterUrl below so
    // the OG image, the video's poster attribute, and every social post share
    // one branded identity. Fail-soft: no poster row → the release falls back to
    // the bare cover (never a failed render).
    let posterUrl: string | null = null;
    for (const thumb of thumbOk) {
      try {
        const url = await storeVisual({
          songId: p.songId,
          workspaceId: p.workspaceId,
          kind: "thumbnail",
          path: thumb.path,
          contentType: "image/jpeg",
          ext: "jpg",
          aspect: "16:9",
          meta: {
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            variant: thumb.id,
            crop: thumb.request.crop,
            textPos: thumb.request.textPos,
            // The canonical branded poster carries meta.poster so the visuals UI
            // (and any query) can find the before-play still directly.
            poster: !!thumb.request.poster,
            edit: thumb.request.poster ? "ffmpeg-cover-poster-mark" : "ffmpeg-cover-drawtext",
            costUsd: 0,
          },
        });
        stored += 1;
        if (thumb.request.poster) posterUrl = url;
      } catch (err) {
        log.warn({ err, songId: p.songId, variant: thumb.id }, "a thumbnail could not be stored (batch continues)");
      }
    }
    if (thumbFailed.length) failures.push(`thumbnails:${thumbFailed.length}`);

    // Pin the branded poster as the song's canonical before-play identity (used
    // by the release-page OG image, the video poster, and social posts). Never
    // fatal — a missing poster just leaves the cover as the fallback.
    if (posterUrl) {
      await prisma.song
        .updateMany({ where: { id: p.songId }, data: { posterUrl } })
        .catch(() => undefined);
    }

    // OPTIONAL AI COVER VARIANTS — reuse the existing image provider + the
    // identity-safe cover prompt (celebrity names stripped, no real likeness).
    // Uses the OPERATOR key, so it is OFF by default (a background job on every
    // song must never spend money silently) and cost-logged when enabled.
    if ((process.env.VISUALS_AI_THUMBS ?? "0") === "1") {
      stored += await tryAiThumbnails({
        songId: p.songId,
        workspaceId: p.workspaceId,
        title: song.lyric?.title || song.title,
        genre: song.project.genre,
      });
    }

    await markStatus(p.songId, stored > 0 ? "ready" : "unavailable");
    log.info(
      {
        songId: p.songId,
        stored,
        lyricPages: lyricPlan.pages.length,
        thumbs: thumbOk.length,
        failures,
        durationS: Math.round(durationS),
        hasCover: !!coverPath,
        reason: p.reason,
      },
      "auto-visuals build finished (ffmpeg/image edits, no re-render, $0)"
    );
  } catch (err) {
    // FAIL-SOFT: never throw. Mark unavailable so the tab can retry; the song
    // render this fired from is never affected.
    log.warn({ err, songId: p.songId }, "auto-visuals build failed (song render unaffected)");
    await markStatus(p.songId, "unavailable").catch(() => undefined);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Upload one rendered asset + file a SongVisual row. Returns the canonical
 *  storage ref of the stored visual (so the caller can pin a poster); throws on
 *  an empty/failed file (the caller's try/catch keeps the batch alive). */
async function storeVisual(opts: {
  songId: string;
  workspaceId: string;
  kind: "lyric_video" | "visualizer" | "thumbnail";
  path: string;
  contentType: string;
  ext: string;
  aspect: string;
  meta: Record<string, unknown>;
}): Promise<string> {
  const bytes = await readFile(opts.path);
  if (!bytes.length) throw new Error("empty visual file");
  const url = await uploadBytes({
    workspaceId: opts.workspaceId,
    kind: "visuals",
    bytes,
    contentType: opts.contentType,
    ext: opts.ext,
  });
  await prisma.songVisual.create({
    data: {
      songId: opts.songId,
      workspaceId: opts.workspaceId,
      kind: opts.kind,
      url,
      aspect: opts.aspect,
      meta: { ...opts.meta, sizeBytes: bytes.length } as never,
    },
  });
  return url;
}

/**
 * OPTIONAL AI cover-variant thumbnails (operator opt-in, VISUALS_AI_THUMBS=1).
 * Reuses the EXISTING image provider + the identity-safe cover prompt, and
 * cost-logs each generation like cover-generate (an AnalyticsEvent, since this
 * background build charges the user $0). Fully fail-soft — never throws.
 */
async function tryAiThumbnails(opts: {
  songId: string;
  workspaceId: string;
  title: string;
  genre: string;
}): Promise<number> {
  let stored = 0;
  try {
    const { imageAdapter } = await import("@afrohit/ai");
    const { buildPhotorealisticCoverPrompt } = await import("@afrohit/shared");
    const adapter = imageAdapter();
    if (adapter.name === "unavailable") return 0;
    const count = Math.max(1, Math.min(2, Number(process.env.VISUALS_AI_THUMBS_COUNT ?? 1) || 1));
    const { prompt, stripped } = buildPhotorealisticCoverPrompt({
      title: opts.title,
      genre: opts.genre,
      mood: null,
    });
    for (let i = 0; i < count; i++) {
      try {
        const result = await adapter.generate({ prompt, size: "1024x1024", quality: "low" });
        if (result.status !== "succeeded" || !result.output) continue;
        let bytes: Buffer | null = null;
        if (result.output.imageBase64) {
          bytes = Buffer.from(result.output.imageBase64, "base64");
        } else if (result.output.imageUrl) {
          bytes = await downloadToBuffer(result.output.imageUrl, { maxBytes: MAX_COVER_BYTES });
        }
        if (!bytes?.length) continue;
        const url = await uploadBytes({
          workspaceId: opts.workspaceId,
          kind: "visuals",
          bytes,
          contentType: "image/png",
          ext: "png",
        });
        await prisma.songVisual.create({
          data: {
            songId: opts.songId,
            workspaceId: opts.workspaceId,
            kind: "thumbnail",
            url,
            aspect: "1:1",
            meta: {
              width: 1024,
              height: 1024,
              variant: `ai-cover-${i}`,
              ai: true,
              provider: adapter.name,
              strippedNames: stripped,
              costUsd: result.estimatedCostUsd ?? 0,
              sizeBytes: bytes.length,
            } as never,
          },
        });
        stored += 1;
        // Cost-log the operator spend (like cover-generate) — the user is $0.
        await prisma.analyticsEvent
          .create({
            data: {
              workspaceId: opts.workspaceId,
              name: "image.thumbnail",
              properties: {
                songId: opts.songId,
                provider: adapter.name,
                costUsd: result.estimatedCostUsd ?? 0,
                variant: `ai-cover-${i}`,
              } as never,
            },
          })
          .catch(() => undefined);
      } catch (err) {
        log.warn({ err, songId: opts.songId }, "an AI thumbnail variant failed (batch continues)");
      }
    }
  } catch (err) {
    log.warn({ err, songId: opts.songId }, "AI thumbnail path unavailable (batch continues)");
  }
  return stored;
}
