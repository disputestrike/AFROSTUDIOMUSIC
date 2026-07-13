// Load .env first — Railway sets env vars directly, so this is a no-op there.
import 'dotenv/config';

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import * as Sentry from '@sentry/node';

import { runWithBrainContext } from '@afrohit/ai';
import { assertSecretConfiguration, migratePlaintextWorkspaceSecrets } from '@afrohit/db';
import { redactSensitiveText } from '@afrohit/shared';
import { processMusic } from './processors/music';
import { processForgeMaterial, processAssembleBeat } from './processors/material';
import { processAnalyze } from './processors/analyze';
import { processSnippet } from './processors/snippet';
import { processStems } from './processors/stems';
import { processVoice } from './processors/voice';
import { processVoiceProfile } from './processors/voice-profile';
import { processVoiceDataset } from './processors/voice-dataset';
import { processSingConvert } from './processors/voice-sing';
import { processVoiceCleanup } from './processors/voice-cleanup';
import { processVoiceRehost } from './processors/voice-rehost';
import { processImage } from './processors/image';
import { processVideo } from './processors/video';
import { processMix } from './processors/mix';
import { processMaster } from './processors/master';
import { processExport } from './processors/export';
import { notifyJobDone, processMorningDrop, processReleaseRadar, processZapRadar } from './processors/cron';
import { processDeepMeasure } from './processors/deep-measure';
import { processTransform } from './processors/transform';
import { processOwnEngine } from './processors/own-engine';
import { processProduce } from './processors/produce';
import { processSongEdit } from './processors/song-edit';
import { processSynthMaterial } from './processors/synth-material';
import { enqueueJob } from './lib/enqueue';
import { assertStorageConfiguration } from './lib/storage';
import { processNightlyCompound, processMeasureBackfill, processLearnBackfill, processListenBack, processRefileReferences, processMineLexicon, processLexiconResearch, processWiktionaryHarvest, processGlossPass, processVerifyLexicon } from './processors/compound';

const safeError = (error: unknown) => {
  const serialized = pino.stdSerializers.err(error as Error);
  return {
    ...serialized,
    message: redactSensitiveText(serialized.message, 1_000),
    ...(serialized.stack ? { stack: redactSensitiveText(serialized.stack, 4_000) } : {}),
  };
};
const log = pino({ level: process.env.LOG_LEVEL ?? 'info', serializers: { err: safeError, error: safeError } });
assertSecretConfiguration();
assertStorageConfiguration();
const secretsReady = process.env.ENCRYPTION_KEY
  ? migratePlaintextWorkspaceSecrets().then((migrated) => {
      if (migrated) log.info({ migrated }, 'encrypted legacy workspace provider credentials');
    })
  : Promise.resolve();

// Job names that belong to the background LAKE lane (never the render lane).
const LAKE_JOBS = new Set(['deep-measure', 'nightly-compound', 'measure-backfill', 'learn-backfill', 'listen-back', 'refile-references', 'mine-lexicon', 'lexicon-research', 'wiktionary-harvest', 'wiktionary-burst', 'lexicon-gloss', 'lexicon-verify']);

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    initialScope: { tags: { service: 'worker' } },
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.message) event.message = redactSensitiveText(event.message, 1_000);
      for (const value of event.exception?.values ?? []) {
        if (value.value) value.value = redactSensitiveText(value.value, 1_000);
      }
      return event;
    },
  });
}

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

/** Job kinds whose completion the user cares about → email notification. */
const NOTIFY_QUEUES = new Set(['music', 'voice', 'video', 'export']);

function makeWorker(queue: string, handler: (job: never) => Promise<void>) {
  const guarded = async (job: never) => {
    await secretsReady;
    await handler(job);
  };
  const w = new Worker(queue, guarded as never, {
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
    else if (job.name === 'transform') await processTransform(job.data as never);
    else if (job.name === 'own-engine') await processOwnEngine(job.data as never);
    else if (job.name === 'produce') await processProduce(job.data as never);
    else if (job.name === 'song-edit') await processSongEdit(job.data as never);
    else if (job.name === 'synth-material') await processSynthMaterial(job.data as never);
    // BACKGROUND work found on the render queue (legacy enqueues) migrates to
    // the LAKE queue — the render lane is for the user ("the 10-minute song").
    else if (LAKE_JOBS.has(job.name)) await enqueueJob('lake', job.name, job.data);
    else await processMusic(job.data as never);
  }),
  // THE LAKE — background learning/measurement lane. CONCURRENCY 1 by design:
  // local Demucs/librosa are CPU-heavy on this shared container; one at a time
  // keeps renders fast. Nothing user-facing ever waits on this queue.
  new Worker('lake', (async (job: { data: never; name: string }) => {
    await secretsReady;
    // OWNER LAW: EVERYTHING on the lake queue is background text/analysis work
    // — Cerebras-first for every LLM call, whether the nightly cron fired it or
    // the owner clicked a Data-lake button in Admin. Claude never bills for
    // lake work; the ladder stays as the failure safety only.
    await runWithBrainContext({ forceTier: 'bulk', runId: `lake:${job.name}` }, async () => {
      if (job.name === 'deep-measure') await processDeepMeasure(job.data as never);
      else if (job.name === 'analyze-audio') await processAnalyze(job.data as never);
      else if (job.name === 'nightly-compound') await processNightlyCompound();
      else if (job.name === 'measure-backfill') await processMeasureBackfill();
      else if (job.name === 'learn-backfill') await processLearnBackfill();
      else if (job.name === 'listen-back') await processListenBack();
      else if (job.name === 'refile-references') await processRefileReferences();
      else if (job.name === 'mine-lexicon') await processMineLexicon();
      else if (job.name === 'lexicon-research') await processLexiconResearch();
      else if (job.name === 'wiktionary-harvest') await processWiktionaryHarvest();
      else if (job.name === 'wiktionary-burst') await processWiktionaryHarvest({ all: true });
      else if (job.name === 'lexicon-gloss') await processGlossPass();
      else if (job.name === 'lexicon-verify') await processVerifyLexicon();
      // Voice DATASET BUILDER: local ffmpeg convert/split/zip — background lane
      // by design (CPU work, never blocks a render; no LLM, so the bulk brain
      // context wrapper is a no-op for it).
      else if (job.name === 'voice-dataset') await processVoiceDataset(job.data as never);
    });
  }) as never, { connection, concurrency: 1 }),
  makeWorker('voice', async (job: { data: never; name: string }) => {
    if (job.name === 'setup-voice-profile') await processVoiceProfile(job.data as never);
    else if (job.name === 'sing-convert') await processSingConvert(job.data as never);
    else if (job.name === 'rehost-voice-model') await processVoiceRehost(job.data as never);
    else if (job.name === 'voice-cleanup') await processVoiceCleanup(job.data as never);
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
    // All compound/backfill work runs on the LAKE lane (concurrency 1) so cron
    // ticks never CPU-contend with renders.
    else if (LAKE_JOBS.has(job.name)) await enqueueJob('lake', job.name, job.data);
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
  // Default 1×/day (was 4× — a big overnight cost with marginal value). Raise via
  // ZAP_RUNS_PER_DAY only if trend-chasing proves worth it on /admin/autonomy.
  const zapRuns = Math.max(1, Math.min(12, parseInt(process.env.ZAP_RUNS_PER_DAY ?? '1', 10) || 1));
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

if (process.env.ENABLE_AUTONOMY_CRON === '1') {
  registerCron().catch((err) => log.error({ err }, 'cron registration failed'));
} else {
  log.warn('autonomy cron disabled; set ENABLE_AUTONOMY_CRON=1 and enable each admin autonomy flag to schedule background work');
}

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
      `capabilities: eleven=${!!process.env.ELEVENLABS_API_KEY} replicate=${!!process.env.REPLICATE_API_TOKEN} tavily=${!!process.env.TAVILY_API_KEY} suno=${!!process.env.SUNO_API_KEY} anthropic=${!!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)} cerebras=${!!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS)} brainModel=${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'}`
    );
    // ADDENDUM C-1 — provenance stated explicitly, every boot:
    if (cal.calibrated) log.info(`logdrum: REAL calibration (margin ${cal.separationMargin}) — measured`);
    else if (cal.reason === 'synthetic-calibration') log.warn('logdrum: SYNTHETIC calibration — inferred only, excluded from scoring (drop 9 real rights-clean tracks + run eval-ear.ts to earn measured)');
    else log.warn(`logdrum: UNCALIBRATED (${cal.reason}) — excluded from lane scoring until eval-ear.ts passes on real reference tracks`);
  } catch (err) {
    log.warn({ err }, 'logdrum: could not read calibration status');
  }
})();

// A3-6 — LLM usage sink (worker side): radar/gloss/verify calls log tier + task
// + brain + est cost as AnalyticsEvent 'llm.call' for /admin/economics.
void (async () => {
  try {
    const { setLlmUsageSink } = await import('@afrohit/ai');
    const { prisma } = await import('@afrohit/db');
    let wsId: string | null = null;
    setLlmUsageSink((rec) => {
      void (async () => {
        wsId ??= (await prisma.workspace.findFirst({ select: { id: true } }))?.id ?? null;
        if (!wsId) return;
        await prisma.analyticsEvent.create({ data: { workspaceId: wsId, name: 'llm.call', properties: rec as never } }).catch(() => undefined);
      })();
    });
  } catch { /* telemetry never blocks boot */ }
})();
