import fp from 'fastify-plugin';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUES = {
  music: 'music',
  voice: 'voice',
  mix: 'mix',
  master: 'master',
  image: 'image',
  video: 'video',
  exportBundle: 'export',
  rightsStamp: 'rights',
  embed: 'embed',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

declare module 'fastify' {
  interface FastifyInstance {
    queues: Record<QueueName, Queue>;
    redis: IORedis;
  }
}

export const queuePlugin = fp(async function (app) {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new IORedis(url, { maxRetriesPerRequest: null });

  const queues = Object.fromEntries(
    Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })])
  ) as Record<QueueName, Queue>;

  app.decorate('redis', connection);
  app.decorate('queues', queues);

  app.addHook('onClose', async () => {
    for (const q of Object.values(queues)) await q.close();
    await connection.quit();
  });
});

/** Quick helper used by routes to enqueue a job and record it in ProviderJob. */
export async function enqueue<T>(opts: {
  queue: Queue;
  name: string;
  payload: T;
  /** Delay before the job runs (ms) — used to STAGGER provider-rate-limited work. */
  delayMs?: number;
}) {
  return opts.queue.add(opts.name, opts.payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
}

export { QueueEvents };
