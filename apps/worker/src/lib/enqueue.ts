/** Minimal worker-side enqueue — lets a processor queue a follow-up job (e.g. the
 *  interactive analyze hands the slow Demucs pass to a background deep-measure). */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const cache = new Map<string, Queue>();

export async function enqueueJob(queue: string, name: string, payload: unknown, opts?: { delayMs?: number }): Promise<void> {
  let q = cache.get(queue);
  if (!q) { q = new Queue(queue, { connection }); cache.set(queue, q); }
  // delayMs staggers Replicate-bound jobs — this account creates predictions at
  // BURST 1, so batch enqueues must space out or all but the first 429.
  await q.add(name, payload, { removeOnComplete: 200, removeOnFail: 500, ...(opts?.delayMs ? { delay: opts.delayMs } : {}) });
}
