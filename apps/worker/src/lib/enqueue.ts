/** Minimal worker-side enqueue — lets a processor queue a follow-up job (e.g. the
 *  interactive analyze hands the slow Demucs pass to a background deep-measure). */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const cache = new Map<string, Queue>();

export async function enqueueJob(queue: string, name: string, payload: unknown, opts?: { delayMs?: number; jobId?: string }): Promise<void> {
  let q = cache.get(queue);
  if (!q) { q = new Queue(queue, { connection }); cache.set(queue, q); }
  const referenceId = name === 'deep-measure' && payload && typeof payload === 'object'
    ? String((payload as { referenceId?: unknown }).referenceId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100)
    : '';
  const jobId = opts?.jobId ?? (referenceId ? `deep-measure-${referenceId}` : undefined);
  // delayMs staggers Replicate-bound jobs — this account creates predictions at
  // BURST 1, so batch enqueues must space out or all but the first 429.
  await q.add(name, payload, {
    // Deep reads dedupe while queued/running, then remove immediately. A genuine
    // failed read may be retried by nightly backfill; recipe state prevents a
    // successful reference from being measured twice.
    removeOnComplete: name === 'deep-measure' ? true : 200,
    removeOnFail: 500,
    ...(opts?.delayMs ? { delay: opts.delayMs } : {}),
    ...(jobId ? { jobId } : {}),
  });
}
