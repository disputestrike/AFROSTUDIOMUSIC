// Load .env first — Railway sets env vars directly, so this is a no-op there.
import 'dotenv/config';

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import * as Sentry from '@sentry/node';

import { processMusic } from './processors/music';
import { processForgeMaterial, processAssembleBeat } from './processors/material';
import { processAnalyze } from './processors/analyze';
import { processSnippet } from './processors/snippet';
import { processStems } from './processors/stems';
import { processVoice } from './processors/voice';
import { processVoiceProfile } from './processors/voice-profile';
import { processImage } from './processors/image';
import { processVideo } from './processors/video';
import { processMix } from './processors/mix';
import { processMaster } from './processors/master';
import { processExport } from './processors/export';
import { notifyJobDone, processMorningDrop, processReleaseRadar } from './processors/cron';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    initialScope: { tags: { service: 'worker' } },
  });
}

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

/** Job kinds whose completion the user cares about → email notification. */
const NOTIFY_QUEUES = new Set(['music', 'voice', 'video', 'export']);

function makeWorker(queue: string, handler: (job: never) => Promise<void>) {
  const w = new Worker(queue, handler as never, {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  });
  w.on('completed', (job) => {
    log.info({ queue, jobId: job.id }, 'job ok');
    const dbJobId = (job.data as { jobId?: string })?.jobId;
    if (dbJobId && NOTIFY_QUEUES.has(queue)) void notifyJobDone(dbJobId);
  });
  w.on('failed', (job, err) => {
    log.error({ queue, jobId: job?.id, err }, 'job failed');
    if (process.env.SENTRY_DSN) Sentry.captureException(err, { tags: { queue } });
  });
  return w;
}

const workers = [
  makeWorker('music', async (job: { data: never; name: string }) => {
    if (job.name === 'analyze-audio') await processAnalyze(job.data as never);
    else if (job.name === 'snippet') await processSnippet(job.data as never);
    else if (job.name === 'stems') await processStems(job.data as never);
    else if (job.name === 'forge-material') await processForgeMaterial(job.data as never);
    else if (job.name === 'assemble-beat') await processAssembleBeat(job.data as never);
    else await processMusic(job.data as never);
  }),
  makeWorker('voice', async (job: { data: never; name: string }) => {
    if (job.name === 'setup-voice-profile') await processVoiceProfile(job.data as never);
    else await processVoice(job.data as never);
  }),
  makeWorker('image', async (job: { data: never }) => {
    await processImage(job.data as never);
  }),
  makeWorker('video', async (job: { data: never }) => {
    await processVideo(job.data as never);
  }),
  makeWorker('mix', async (job: { data: never }) => {
    await processMix(job.data as never);
  }),
  makeWorker('master', async (job: { data: never }) => {
    await processMaster(job.data as never);
  }),
  makeWorker('export', async (job: { data: never }) => {
    await processExport(job.data as never);
  }),
  makeWorker('cron', async (job: { data: never; name: string }) => {
    if (job.name === 'morning-drop') await processMorningDrop();
    else if (job.name === 'release-radar') await processReleaseRadar();
  }),
];

/**
 * Register repeatable cron jobs. Upserts are idempotent — safe on every boot.
 *  - morning-drop: daily 05:00 UTC (early-morning WAT)
 *  - release-radar: Mondays 07:00 UTC
 */
async function registerCron() {
  const cronQueue = new Queue('cron', { connection });
  await cronQueue.add('morning-drop', {}, {
    repeat: { pattern: '0 5 * * *' },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  });
  await cronQueue.add('release-radar', {}, {
    repeat: { pattern: '0 7 * * 1' },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  });
  log.info('cron registered: morning-drop daily 05:00 UTC, release-radar Mon 07:00 UTC');
}

registerCron().catch((err) => log.error({ err }, 'cron registration failed'));

/**
 * Graceful shutdown with a bounded drain. close() waits for active jobs, but
 * the platform hard-kills after ~30s — so we drain for 25s, then force-close.
 * Force-closed jobs are left "active" and BullMQ's stalled-checker re-queues
 * them, so nothing is silently lost — worst case a render re-runs.
 */
async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down — draining active jobs (max 25s)');
  const drained = Promise.all(workers.map((w) => w.close()));
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 25_000));
  const result = await Promise.race([drained.then(() => 'drained' as const), timeout]);
  if (result === 'timeout') {
    log.warn('drain timed out — force-closing (stalled jobs will be re-queued by BullMQ)');
    await Promise.allSettled(workers.map((w) => w.close(true)));
  }
  await connection.quit().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

log.info('worker up, listening on queues: music, voice, image, video, mix, master, export, cron');
