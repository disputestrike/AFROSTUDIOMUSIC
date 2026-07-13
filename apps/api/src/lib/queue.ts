import fp from 'fastify-plugin';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@afrohit/db';
import { redactSensitiveText } from '@afrohit/shared';

export const QUEUES = {
  music: 'music',
  // LAKE — background learning/measurement (deep-measure, listen-back,
  // backfills, lexicon). Its worker runs CONCURRENCY 1 so heavy local DSP can
  // never queue-block or CPU-starve a user's render (the "10-minute song" bug).
  lake: 'lake',
  voice: 'voice',
  mix: 'mix',
  master: 'master',
  image: 'image',
  video: 'video',
  exportBundle: 'export',
  rightsStamp: 'rights',
  embed: 'embed',
  orchestration: 'orchestration',
  cleanup: 'cleanup',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

declare module 'fastify' {
  interface FastifyInstance {
    queues: Record<QueueName, Queue>;
    redis: IORedis;
    dispatchPendingJobs(): Promise<number>;
  }
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

type OutboxRow = {
  id: string;
  providerJobId: string;
  queueName: string;
  jobName: string;
  payload: unknown;
  attempts: number;
};

async function dispatchRow(queues: Record<QueueName, Queue>, row: OutboxRow): Promise<boolean> {
  const queue = queues[row.queueName as QueueName];
  if (!queue) {
    await prisma.jobOutbox.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + 15 * 60_000),
        lastError: `unknown queue: ${row.queueName}`,
      },
    });
    return false;
  }

  try {
    await queue.add(row.jobName, row.payload, {
      ...DEFAULT_JOB_OPTIONS,
      // BullMQ deduplicates concurrent/replayed publication by this stable ID.
      jobId: `provider-${row.providerJobId}`,
    });
    await prisma.jobOutbox.update({
      where: { id: row.id },
      data: { status: 'DISPATCHED', dispatchedAt: new Date(), lastError: null },
    });
    return true;
  } catch (error) {
    const attempt = row.attempts + 1;
    const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempt, 8));
    await prisma.jobOutbox.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: redactSensitiveText((error as Error)?.message ?? error, 500),
      },
    });
    return false;
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

  const dispatchPendingJobs = async () => {
    const rows = await prisma.jobOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: new Date() },
        providerJob: { status: 'QUEUED' },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let dispatched = 0;
    for (const row of rows) {
      if (await dispatchRow(queues, row)) dispatched += 1;
    }
    return dispatched;
  };
  app.decorate('dispatchPendingJobs', dispatchPendingJobs);

  // Redis can be unavailable while Postgres remains healthy. Persisted outbox
  // rows are replayed on boot and periodically; stable BullMQ IDs make races
  // between multiple API instances harmless.
  void dispatchPendingJobs().catch((error) => app.log.error({ err: error }, 'job outbox startup dispatch failed'));
  const dispatchTimer = setInterval(() => {
    void dispatchPendingJobs().catch((error) => app.log.error({ err: error }, 'job outbox dispatch failed'));
  }, 15_000);
  dispatchTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(dispatchTimer);
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
}): Promise<void> {
  const providerJobId = (opts.payload as { jobId?: unknown } | null)?.jobId;
  if (typeof providerJobId !== 'string' || !providerJobId) {
    await opts.queue.add(opts.name, opts.payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    });
    return;
  }

  const providerJob = await prisma.providerJob.findUniqueOrThrow({
    where: { id: providerJobId },
    select: { workspaceId: true },
  });

  const row = await prisma.jobOutbox.upsert({
    where: { providerJobId },
    create: {
      providerJobId,
      workspaceId: providerJob.workspaceId,
      queueName: opts.queue.name,
      jobName: opts.name,
      payload: opts.payload as never,
      ...(opts.delayMs ? { nextAttemptAt: new Date(Date.now() + opts.delayMs) } : {}),
    },
    update: {
      queueName: opts.queue.name,
      jobName: opts.name,
      payload: opts.payload as never,
    },
  });

  if (opts.delayMs && row.nextAttemptAt.getTime() > Date.now()) return;

  // A failed Redis publish is no longer an HTTP failure: the durable row stays
  // FAILED and the dispatcher retries it. The caller can safely return 202.
  await dispatchRow(
    { [opts.queue.name]: opts.queue } as Record<QueueName, Queue>,
    row
  );
}

export { QueueEvents };
