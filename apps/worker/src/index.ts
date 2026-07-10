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
import { notifyJobDone, processMorningDrop, processReleaseRadar, processZapRadar } from './processors/cron';
import { processDeepMeasure } from './processors/deep-measure';
import { processTransform } from './processors/transform';
import { processOwnEngine } from './processors/own-engine';
import { processSongEdit } from './processors/song-edit';
import { processSynthMaterial } from './processors/synth-material';
import { processNightlyCompound, processMeasureBackfill, processLearnBackfill, processListenBack, processMineLexicon, processLexiconResearch, processWiktionaryHarvest, processGlossPass } from './processors/compound';

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
    else if (job.name === 'deep-measure') await processDeepMeasure(job.data as never);
    else if (job.name === 'transform') await processTransform(job.data as never);
    else if (job.name === 'own-engine') await processOwnEngine(job.data as never);
    else if (job.name === 'song-edit') await processSongEdit(job.data as never);
    else if (job.name === 'synth-material') await processSynthMaterial(job.data as never);
    else if (job.name === 'nightly-compound') await processNightlyCompound();
    else if (job.name === 'measure-backfill') await processMeasureBackfill();
    else if (job.name === 'learn-backfill') await processLearnBackfill();
    else if (job.name === 'listen-back') await processListenBack();
    else if (job.name === 'mine-lexicon') await processMineLexicon();
    else if (job.name === 'lexicon-research') await processLexiconResearch();
    else if (job.name === 'wiktionary-harvest') await processWiktionaryHarvest();
    else if (job.name === 'wiktionary-burst') await processWiktionaryHarvest({ all: true });
    else if (job.name === 'lexicon-gloss') await processGlossPass();
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
    else if (job.name === 'zap-radar') await processZapRadar();
    else if (job.name === 'nightly-compound') await processNightlyCompound();
    else if (job.name === 'measure-backfill') await processMeasureBackfill();
    else if (job.name === 'learn-backfill') await processLearnBackfill();
    else if (job.name === 'listen-back') await processListenBack();
    else if (job.name === 'mine-lexicon') await processMineLexicon();
    else if (job.name === 'lexicon-research') await processLexiconResearch();
    else if (job.name === 'wiktionary-harvest') await processWiktionaryHarvest();
    else if (job.name === 'wiktionary-burst') await processWiktionaryHarvest({ all: true });
    else if (job.name === 'lexicon-gloss') await processGlossPass();
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
  // Zap Radar — daily 03:00 UTC (off-peak, before the morning drop): pull the
  // charts and learn the craft of new trending songs into the lake. Autonomous,
  // capped, keyless, non-interfering.
  // zap-radar now runs ZAP_RUNS_PER_DAY times (default 4), rotating genre slices.
  const zapRuns = Math.max(1, Math.min(12, parseInt(process.env.ZAP_RUNS_PER_DAY ?? '4', 10) || 4));
  const zapPattern = `0 */${Math.max(1, Math.floor(24 / zapRuns))} * * *`;
  await cronQueue.removeRepeatable('zap-radar', { pattern: '0 3 * * *' }).catch(() => undefined);
  await cronQueue.add('nightly-compound', {}, { repeat: { pattern: '45 2 * * *' } });
  // ZERO-TAP: run the compound suite ~90s after EVERY deploy too (once per day —
  // the dated jobId dedupes). Uploads get measured, the bank grows, profiles
  // count themselves. Nobody presses anything, ever.
  await cronQueue
    .add('nightly-compound', {}, { jobId: `boot-compound-${new Date().toISOString().slice(0, 10)}`, delay: 90_000, removeOnComplete: true, removeOnFail: true })
    .catch(() => undefined);
  await cronQueue.add('zap-radar', {}, {
    repeat: { pattern: zapPattern },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
  });
  log.info('cron registered: zap-radar 03:00 UTC, morning-drop 05:00 UTC, release-radar Mon 07:00 UTC');
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

// PATCH 2 — announce the log-drum TRUTH-GATE status once at boot. Never silent: the
// operator must always know whether the log drum is calibrated (voting in lane scores)
// or excluded (uncalibrated) — no fabricated measurements slip in unnoticed.
void (async () => {
  try {
    const { dspAvailable, logdrumCalibrationStatus } = await import('./lib/dsp');
    if (!(await dspAvailable())) { log.warn('logdrum: DSP engine unavailable — the ear cannot run (lane scoring disabled)'); return; }
    const cal = await logdrumCalibrationStatus();
    log.info(
      `capabilities: eleven=${!!process.env.ELEVENLABS_API_KEY} replicate=${!!process.env.REPLICATE_API_TOKEN} tavily=${!!process.env.TAVILY_API_KEY} suno=${!!process.env.SUNO_API_KEY} anthropic=${!!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)}`
    );
    if (cal.calibrated) log.info(`logdrum: CALIBRATED (margin ${cal.separationMargin}, on ${cal.calibratedOn ?? 'reference-tracks'}) — included in lane scoring${cal.calibratedOn === 'synthetic-archetypes' ? '; drop 9 real rights-clean tracks + run eval-ear.ts to upgrade to real-audio calibration' : ''}`);
    else log.warn(`logdrum: UNCALIBRATED (${cal.reason}) — excluded from lane scoring until eval-ear.ts passes on real reference tracks`);
  } catch (err) {
    log.warn({ err }, 'logdrum: could not read calibration status');
  }
})();
