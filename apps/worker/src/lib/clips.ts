/**
 * AUTO-CLIP — the AUTO-TRIGGER (Phase 2, owner 2026-07-21). Mirrors
 * enqueueReleaseKit EXACTLY: fired from the music-video completion path
 * (assemble-video's 'full' master cut), it flips the song to clipsStatus
 * 'cutting' so the tab can say "cutting clips…", then queues the fail-soft
 * 'generate-clips' job on its own dedicated 'clips' lane. A clip cut that can't
 * be queued must NEVER fail the video render that just finished.
 *
 * ./enqueue opens an EAGER IORedis connection at module load, so it is imported
 * LAZILY (inside enqueueGenerateClips) — importing this trigger from
 * assemble-video.ts must not open a Redis handle by itself. Same discipline as
 * lib/release-kit.ts.
 *
 * The heavy ffmpeg work lives in processors/generate-clips.ts (processGenerateClips)
 * so this trigger module stays import-light (no storage/ffmpeg pulled in just to
 * enqueue), exactly like release-kit splits enqueue from the writer.
 */
import pino from 'pino';
import { prisma } from '@afrohit/db';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const CLIPS_QUEUE = 'clips';
export const CLIPS_JOB = 'generate-clips';

export interface GenerateClipsJobPayload {
  songId: string;
  workspaceId: string;
  /** The assembled master VideoRender the clips are cut from. */
  sourceVideoId: string;
  /** Recut even if clips already exist for this source (the Recut button). */
  force?: boolean;
  /** Which completion fired this (video-done | recut) — logs only. */
  reason?: string;
}

/**
 * Fire the clip cut after the master video is finalized. FAIL-SOFT: every
 * failure is swallowed and logged — a video render is NEVER failed by a clip
 * problem.
 */
export async function enqueueGenerateClips(payload: GenerateClipsJobPayload): Promise<void> {
  try {
    // Show "cutting clips…" instantly. A plain (non-force) trigger only flips a
    // song that is not already 'ready', so a background refresh never hides a
    // finished grid; a Recut forces the status so the user sees it working.
    await prisma.song
      .updateMany({
        where: {
          id: payload.songId,
          ...(payload.force ? {} : { clipsStatus: { not: 'ready' } }),
        },
        data: { clipsStatus: 'cutting' },
      })
      .catch(() => undefined);
    const { enqueueJob } = await import('./enqueue');
    await enqueueJob(CLIPS_QUEUE, CLIPS_JOB, payload, {
      // Dedupe concurrent completions for the SAME master into one queued cut;
      // the processor's own idempotency handles the rest. A distinct id per
      // force-recut lets a Recut land even while a plain cut is queued.
      jobId: `${CLIPS_JOB}-${payload.sourceVideoId}${payload.force ? '-force' : ''}`,
    });
  } catch (err) {
    log.warn(
      { err, songId: payload.songId, reason: payload.reason },
      'clip cut could not be enqueued (render unaffected)'
    );
  }
}
