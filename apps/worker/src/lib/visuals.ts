/**
 * AUTO-VISUALS — the AUTO-TRIGGER (Phase 3, owner 2026-07-21). Mirrors
 * enqueueGenerateClips / enqueueReleaseKit EXACTLY: fired from EVERY song-
 * completion path (own-engine render, music/master mastered, produce demo), it
 * flips the song to visualsStatus 'creating' so the tab can say "creating
 * visuals…", then queues the fail-soft 'generate-visuals' job on its own
 * dedicated 'visuals' lane. A visual build that can't be queued must NEVER fail
 * the song render that just finished.
 *
 * Unlike the clips trigger, this needs NO video — a lyric video, an audio-
 * reactive visualizer and thumbnails need only the master audio + lyrics +
 * cover, all of which exist the moment the song is mastered.
 *
 * ./enqueue opens an EAGER IORedis connection at module load, so it is imported
 * LAZILY (inside enqueueGenerateVisuals) — importing this trigger from a
 * processor must not open a Redis handle by itself. Same discipline as
 * lib/clips.ts and lib/release-kit.ts.
 *
 * The heavy ffmpeg/image work lives in processors/generate-visuals.ts
 * (processGenerateVisuals) so this trigger module stays import-light.
 */
import pino from 'pino';
import { prisma } from '@afrohit/db';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const VISUALS_QUEUE = 'visuals';
export const VISUALS_JOB = 'generate-visuals';

export interface GenerateVisualsJobPayload {
  songId: string;
  workspaceId: string;
  /** Regenerate even if visuals already exist for this song (the Regenerate button). */
  force?: boolean;
  /** Which completion fired this (song-rendered | song-mastered | song-demo | regenerate) — logs only. */
  reason?: string;
}

/**
 * Fire the visuals build after a song render completes. FAIL-SOFT: every failure
 * is swallowed and logged — a song render is NEVER failed by a visuals problem.
 */
export async function enqueueGenerateVisuals(payload: GenerateVisualsJobPayload): Promise<void> {
  try {
    // Show "creating visuals…" instantly. A plain (non-force) trigger only flips
    // a song that is not already 'ready', so a background refresh never hides a
    // finished set; a Regenerate forces the status so the user sees it working.
    await prisma.song
      .updateMany({
        where: {
          id: payload.songId,
          ...(payload.force ? {} : { visualsStatus: { not: 'ready' } }),
        },
        data: { visualsStatus: 'creating' },
      })
      .catch(() => undefined);
    const { enqueueJob } = await import('./enqueue');
    await enqueueJob(VISUALS_QUEUE, VISUALS_JOB, payload, {
      // Dedupe concurrent completions for the SAME song (render then master, or
      // a retry) into one queued build; the processor's own idempotency handles
      // the rest. A distinct id per force-regenerate lets a Regenerate land even
      // while a plain build is queued.
      jobId: `${VISUALS_JOB}-${payload.songId}${payload.force ? '-force' : ''}`,
    });
  } catch (err) {
    log.warn(
      { err, songId: payload.songId, reason: payload.reason },
      'visuals build could not be enqueued (render unaffected)'
    );
  }
}
