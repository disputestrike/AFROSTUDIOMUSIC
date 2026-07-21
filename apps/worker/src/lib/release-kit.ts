/**
 * RELEASE KIT — the AUTO-TRIGGER (owner, 2026-07-21: "the hashtags don't show
 * until I click Generate — we did not see it"). The kit must build ITSELF the
 * moment a song finishes rendering, so opening the song shows it already there.
 *
 * Two halves, both fail-soft by design:
 *   - enqueueReleaseKit(): called from EVERY render-completion path (music/master
 *     mastered, produce demo, assemble-video done). It flips the song to
 *     "pending" so the tab can say "building your kit…", then queues the job. A
 *     kit that can't be queued must NEVER fail the render that just finished.
 *   - processReleaseKit(): the 'generate-release-kit' job. It calls the shared
 *     writeReleaseKit (which is Cerebras-bulk only, idempotent, and fail-soft),
 *     storing the kit on the song with NO user action.
 *
 * The generation + storage live in @afrohit/ai (writeReleaseKit) so the API
 * Regenerate button and the unit test run the EXACT same code path.
 */
import pino from 'pino';
import { prisma } from '@afrohit/db';
import { writeReleaseKit, type ReleaseKitDb } from '@afrohit/ai';
// NOTE: ./enqueue opens an EAGER IORedis connection at module load. It is
// imported LAZILY (inside enqueueReleaseKit) so that a processor importing this
// module for its trigger (master.ts -> enqueueReleaseKit) does NOT open a Redis
// handle just by being imported — otherwise pure unit tests that import those
// processors (e.g. test-master-report importing buildMasterReport) would hang on
// exit waiting for the socket. The running worker opens it on first enqueue.

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const RELEASE_KIT_QUEUE = 'releasekit';
export const RELEASE_KIT_JOB = 'generate-release-kit';

export interface ReleaseKitJobPayload {
  songId: string;
  /** Carried so the worker LLM-usage context can attribute the bulk call. */
  workspaceId?: string;
  /** Regenerate even if a fresh kit exists (video refresh uses this). */
  force?: boolean;
  /** A music video now exists — the calendar should lead with it. */
  hasVideo?: boolean;
  /** Which completion fired this (song-mastered | song-demo | video-done) — logs only. */
  reason?: string;
}

/**
 * Fire the kit build after a render completes. FAIL-SOFT: every failure is
 * swallowed and logged — a song render is NEVER failed by a kit problem.
 */
export async function enqueueReleaseKit(payload: ReleaseKitJobPayload): Promise<void> {
  try {
    // Show "building your kit…" instantly — but only when there's no ready kit
    // yet, so a background video-refresh never hides an already-shown kit.
    await prisma.song
      .updateMany({
        where: { id: payload.songId, releaseKitStatus: { not: 'ready' } },
        data: { releaseKitStatus: 'pending' },
      })
      .catch(() => undefined);
    const { enqueueJob } = await import('./enqueue');
    await enqueueJob(RELEASE_KIT_QUEUE, RELEASE_KIT_JOB, payload, {
      // Dedupe concurrent completions for the same song (music then master, or a
      // retry) into one queued build; the processor's own idempotency handles
      // the rest. A distinct id per force-refresh lets a video-done refresh land
      // even while a plain build is queued.
      jobId: `${RELEASE_KIT_JOB}-${payload.songId}${payload.force ? '-force' : ''}`,
    });
  } catch (err) {
    log.warn({ err, songId: payload.songId, reason: payload.reason }, 'release kit could not be enqueued (render unaffected)');
  }
}

/**
 * The 'generate-release-kit' job. Delegates to the shared, tested writer — which
 * is Cerebras-bulk only, idempotent (skips a fresh kit unless forced), and
 * fail-soft (a bulk outage stores status 'unavailable' and returns). Never
 * throws, so the releasekit lane job always completes cleanly.
 */
export async function processReleaseKit(payload: ReleaseKitJobPayload): Promise<void> {
  const res = await writeReleaseKit(prisma as unknown as ReleaseKitDb, {
    songId: payload.songId,
    workspaceId: payload.workspaceId,
    force: payload.force,
    hasVideo: payload.hasVideo,
    log: (msg, err) => log.warn({ err, songId: payload.songId }, msg),
  });
  log.info({ songId: payload.songId, reason: payload.reason, status: res.status }, 'release kit build finished');
}
