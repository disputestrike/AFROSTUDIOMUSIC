// Load .env first — Railway sets env vars directly, so this is a no-op there.
import "dotenv/config";

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import * as Sentry from "@sentry/node";

import {
  runWithBrainContext,
  runWithLlmUsageContext,
  setLlmUsageSink,
} from "@afrohit/ai";
import {
  assertSecretConfiguration,
  migratePlaintextWorkspaceSecrets,
  prisma,
  Prisma,
} from "@afrohit/db";
import {
  assertProductionRuntimeSafety,
  redactSensitiveText,
} from "@afrohit/shared";
import { processMusic } from "./processors/music";
import {
  processForgeMaterial,
  processAssembleBeat,
} from "./processors/material";
import { processAnalyze } from "./processors/analyze";
import { processSnippet } from "./processors/snippet";
import { processStems } from "./processors/stems";
import { processVoice } from "./processors/voice";
import { processVoiceProfile } from "./processors/voice-profile";
import {
  processVoiceDataset,
  processVoiceDatasetPurgeBackfill,
} from "./processors/voice-dataset";
import { processSingConvert } from "./processors/voice-sing";
import { processVoiceCleanup } from "./processors/voice-cleanup";
import { processVoiceRehost } from "./processors/voice-rehost";
import {
  processVocalInspect,
  processVocalQcBackfill,
} from "./processors/vocal-inspect";
import {
  processBeatInspect,
  processBeatQcBackfill,
} from "./processors/beat-inspect";
import { processImage } from "./processors/image";
import { processVideo } from "./processors/video";
import { processMix } from "./processors/mix";
import { processMaster } from "./processors/master";
import { processExport } from "./processors/export";
import { processRights } from "./processors/rights";
import {
  notifyJobDone,
  processMorningDrop,
  processReleaseRadar,
  processZapRadar,
} from "./processors/cron";
import { processDeepMeasure } from "./processors/deep-measure";
import { processTransform } from "./processors/transform";
import { processOwnEngine } from "./processors/own-engine";
import { processProduce } from "./processors/produce";
import { processSongEdit } from "./processors/song-edit";
import { processSynthMaterial } from "./processors/synth-material";
import { processAssetCleanup } from "./processors/asset-cleanup";
import { enqueueJob } from "./lib/enqueue";
import { assertStorageConfiguration } from "./lib/storage";
import {
  processNightlyCompound,
  processMeasureBackfill,
  processLearnBackfill,
  processListenBack,
  processRefileReferences,
  processMineLexicon,
  processLexiconResearch,
  processWiktionaryHarvest,
  processGlossPass,
  processVerifyLexicon,
} from "./processors/compound";
import {
  isTerminalProviderJobStatus,
  markFailed,
  markRunning,
  markSucceeded,
  refundFailedJob,
  retryPendingFailedJobRefunds,
  runWithJobAttemptContext,
} from "./lib/jobs";

const safeError = (error: unknown) => {
  const serialized = pino.stdSerializers.err(error as Error);
  return {
    ...serialized,
    message: redactSensitiveText(serialized.message, 1_000),
    ...(serialized.stack
      ? { stack: redactSensitiveText(serialized.stack, 4_000) }
      : {}),
  };
};
const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: safeError, error: safeError },
});
setLlmUsageSink(record => {
  const { workspaceId, userId, ...properties } = record;
  void prisma.analyticsEvent
    .create({
      data: {
        workspaceId: workspaceId ?? null,
        userId: userId ?? null,
        name: "llm.call",
        properties: properties as never,
      },
    })
    .catch((error: unknown) =>
      log.warn({ err: error }, "llm usage event could not be persisted")
    );
});
assertProductionRuntimeSafety(process.env);
assertSecretConfiguration();
assertStorageConfiguration();
const secretsReady = process.env.ENCRYPTION_KEY
  ? migratePlaintextWorkspaceSecrets().then(migrated => {
      if (migrated)
        log.info(
          { migrated },
          "encrypted legacy workspace provider credentials"
        );
    })
  : Promise.resolve();

// Job names that belong to the background LAKE lane (never the render lane).
const LAKE_JOBS = new Set([
  "deep-measure",
  "nightly-compound",
  "measure-backfill",
  "learn-backfill",
  "listen-back",
  "refile-references",
  "mine-lexicon",
  "lexicon-research",
  "wiktionary-harvest",
  "wiktionary-burst",
  "lexicon-gloss",
  "lexicon-verify",
  "vocal-qc-backfill",
  "beat-qc-backfill",
  "voice-dataset-purge-backfill",
]);

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    initialScope: { tags: { service: "worker" } },
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.message)
        event.message = redactSensitiveText(event.message, 1_000);
      for (const value of event.exception?.values ?? []) {
        if (value.value) value.value = redactSensitiveText(value.value, 1_000);
      }
      return event;
    },
  });
}

const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  }
);

/** Job kinds whose completion the user cares about → email notification. */
const NOTIFY_QUEUES = new Set(["music", "voice", "video", "export", "rights"]);

async function withWorkerUsageContext<T>(
  job: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const typed = job as {
    id?: string | number;
    data?: { jobId?: string; workspaceId?: string };
  };
  const data = typed.data ?? {};
  let workspaceId = data.workspaceId;
  if (!workspaceId && data.jobId) {
    workspaceId = (
      await prisma.providerJob.findUnique({
        where: { id: data.jobId },
        select: { workspaceId: true },
      })
    )?.workspaceId;
  }
  return runWithLlmUsageContext(
    {
      ...(workspaceId ? { workspaceId } : {}),
      jobId: data.jobId ?? String(typed.id ?? "unknown"),
    },
    fn
  );
}

type ManagedWorkerJob = {
  id?: string | number;
  data?: { jobId?: string; workspaceId?: string };
  attemptsMade?: number;
  opts?: { attempts?: number };
};

async function runManagedAttempt(
  job: ManagedWorkerJob,
  handler: () => Promise<void>
): Promise<void> {
  const dbJobId = job.data?.jobId;
  const finalAttempt = (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);

  if (dbJobId) {
    const initialState = await prisma.providerJob.findUnique({
      where: { id: dbJobId },
      select: { status: true },
    });
    if (!initialState) {
      throw new Error(`managed provider job ${dbJobId} is missing`);
    }
    if (isTerminalProviderJobStatus(initialState.status)) {
      // FAILED also short-circuits: non-final failures are persisted as QUEUED,
      // so a stored FAILED state can only represent exhausted work.
      if (initialState.status === "FAILED") {
        await refundFailedJob(dbJobId);
      }
      return;
    }
  }

  await runWithJobAttemptContext(finalAttempt, async () => {
    let thrown: unknown;
    try {
      await handler();
    } catch (error) {
      thrown = error;
    }

    if (!dbJobId) {
      if (thrown) throw thrown;
      return;
    }

    let state = await prisma.providerJob.findUnique({
      where: { id: dbJobId },
      select: { status: true, errorJson: true },
    });
    if (!state) {
      if (thrown) throw thrown;
      throw new Error(`managed provider job ${dbJobId} is missing`);
    }
    if (state.status === "SUCCEEDED" || state.status === "CANCELED") {
      return;
    }

    if (state.status !== "FAILED") {
      await markFailed(
        dbJobId,
        thrown ?? new Error(`processor exited with ${state.status} status`)
      );
      state = await prisma.providerJob.findUnique({
        where: { id: dbJobId },
        select: { status: true, errorJson: true },
      });
    }

    const recordedMessage = (state?.errorJson as { message?: string } | null)
      ?.message;
    const failure =
      thrown instanceof Error
        ? thrown
        : new Error(recordedMessage || "managed provider job failed");

    if (!finalAttempt) {
      await prisma.providerJob.updateMany({
        where: { id: dbJobId, status: { in: ["FAILED", "QUEUED"] } },
        data: {
          status: "QUEUED",
          startedAt: null,
          finishedAt: null,
          errorJson: Prisma.DbNull,
        },
      });
    } else {
      // A transient refund failure remains durable in PostgreSQL; the
      // independent sweeper retries the idempotent reversal.
      await refundFailedJob(dbJobId);
    }
    throw failure;
  });
}

function makeWorker(queue: string, handler: (job: never) => Promise<void>) {
  const guarded = async (job: never) => {
    await secretsReady;
    await withWorkerUsageContext(job, () =>
      runManagedAttempt(job as ManagedWorkerJob, () => handler(job))
    );
  };
  const w = new Worker(queue, guarded as never, {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  });
  w.on("completed", job => {
    log.info({ queue, jobId: job.id }, "job ok");
    const dbJobId = (job.data as { jobId?: string })?.jobId;
    if (dbJobId && NOTIFY_QUEUES.has(queue)) void notifyJobDone(dbJobId);
  });
  w.on("failed", (job, err) => {
    log.error({ queue, jobId: job?.id, err }, "job failed");
    if (process.env.SENTRY_DSN)
      Sentry.captureException(err, { tags: { queue } });
  });
  return w;
}

const workers = [
  makeWorker("music", async (job: { data: never; name: string }) => {
    if (job.name === "analyze-audio") await processAnalyze(job.data as never);
    else if (job.name === "snippet") await processSnippet(job.data as never);
    else if (job.name === "stems") await processStems(job.data as never);
    else if (job.name === "forge-material")
      await processForgeMaterial(job.data as never);
    else if (job.name === "assemble-beat")
      await processAssembleBeat(job.data as never);
    else if (job.name === "transform")
      await processTransform(job.data as never);
    else if (job.name === "own-engine")
      await processOwnEngine(job.data as never);
    else if (job.name === "produce") await processProduce(job.data as never);
    else if (job.name === "song-edit") await processSongEdit(job.data as never);
    else if (job.name === "synth-material")
      await processSynthMaterial(job.data as never);
    else if (job.name === "inspect-beat")
      await processBeatInspect(job.data as never);
    // BACKGROUND work found on the render queue (legacy enqueues) migrates to
    // the LAKE queue — the render lane is for the user ("the 10-minute song").
    else if (LAKE_JOBS.has(job.name))
      await enqueueJob("lake", job.name, job.data);
    else await processMusic(job.data as never);
  }),
  // THE LAKE — background learning/measurement lane. CONCURRENCY 1 by design:
  // local Demucs/librosa are CPU-heavy on this shared container; one at a time
  // keeps renders fast. Nothing user-facing ever waits on this queue.
  new Worker(
    "lake",
    (async (job: { id?: string | number; data: never; name: string }) => {
      await secretsReady;
      await withWorkerUsageContext(job, async () => {
        await runManagedAttempt(job as ManagedWorkerJob, async () => {
          const data = job.data as { jobId?: string };
          const managed = data.jobId
            ? await prisma.providerJob.findFirst({
                where: { id: data.jobId, kind: "lake" },
                select: { id: true },
              })
            : null;
          if (managed) await markRunning(managed.id);
          // OWNER LAW: EVERYTHING on the lake queue is background text/analysis work
          // — Cerebras-first for every LLM call, whether the nightly cron fired it or
          // the owner clicked a Data-lake button in Admin. Claude never bills for
          // lake work; the ladder stays as the failure safety only.
          try {
            await runWithBrainContext(
              { forceTier: "bulk", runId: managed?.id ?? `lake:${job.name}` },
              async () => {
                if (job.name === "deep-measure")
                  await processDeepMeasure(job.data as never);
                else if (job.name === "analyze-audio")
                  await processAnalyze(job.data as never);
                else if (job.name === "nightly-compound")
                  await processNightlyCompound();
                else if (job.name === "measure-backfill")
                  await processMeasureBackfill();
                else if (job.name === "learn-backfill")
                  await processLearnBackfill();
                else if (job.name === "listen-back") await processListenBack();
                else if (job.name === "refile-references")
                  await processRefileReferences();
                else if (job.name === "mine-lexicon")
                  await processMineLexicon();
                else if (job.name === "lexicon-research")
                  await processLexiconResearch();
                else if (job.name === "wiktionary-harvest")
                  await processWiktionaryHarvest();
                else if (job.name === "wiktionary-burst")
                  await processWiktionaryHarvest({ all: true });
                else if (job.name === "lexicon-gloss") await processGlossPass();
                else if (job.name === "lexicon-verify")
                  await processVerifyLexicon();
                else if (job.name === "vocal-qc-backfill")
                  await processVocalQcBackfill();
                else if (job.name === "beat-qc-backfill")
                  await processBeatQcBackfill();
                else if (job.name === "voice-dataset-purge-backfill")
                  await processVoiceDatasetPurgeBackfill();
                // Voice DATASET BUILDER: local ffmpeg convert/split/zip — background lane
                // by design (CPU work, never blocks a render; no LLM, so the bulk brain
                // context wrapper is a no-op for it).
                else if (job.name === "voice-dataset")
                  await processVoiceDataset(job.data as never);
              }
            );
            if (managed)
              await markSucceeded(managed.id, {
                task: job.name,
                completed: true,
              });
          } catch (error) {
            if (managed) await markFailed(managed.id, error);
            throw error;
          }
        });
      });
    }) as never,
    { connection, concurrency: 1 }
  ),
  makeWorker("voice", async (job: { data: never; name: string }) => {
    if (job.name === "setup-voice-profile")
      await processVoiceProfile(job.data as never);
    else if (job.name === "sing-convert")
      await processSingConvert(job.data as never);
    else if (job.name === "inspect-vocal")
      await processVocalInspect(job.data as never);
    else if (job.name === "rehost-voice-model")
      await processVoiceRehost(job.data as never);
    else if (job.name === "voice-cleanup")
      await processVoiceCleanup(job.data as never);
    else await processVoice(job.data as never);
  }),
  makeWorker("image", async (job: { data: never }) => {
    await processImage(job.data as never);
  }),
  makeWorker("video", async (job: { data: never }) => {
    await processVideo(job.data as never);
  }),
  makeWorker("mix", async (job: { data: never }) => {
    await processMix(job.data as never);
  }),
  makeWorker("master", async (job: { data: never }) => {
    await processMaster(job.data as never);
  }),
  makeWorker("export", async (job: { data: never }) => {
    await processExport(job.data as never);
  }),
  makeWorker("rights", async (job: { data: never }) => {
    await processRights(job.data as never);
  }),
  makeWorker("cleanup", async (job: { data: never; name: string }) => {
    if (job.name !== "delete-assets")
      throw new Error(`unknown cleanup job: ${job.name}`);
    await processAssetCleanup(job.data as never);
  }),
  makeWorker("cron", async (job: { data: never; name: string }) => {
    if (job.name === "morning-drop") await processMorningDrop();
    else if (job.name === "release-radar") await processReleaseRadar();
    else if (job.name === "zap-radar") await processZapRadar();
    // All compound/backfill work runs on the LAKE lane (concurrency 1) so cron
    // ticks never CPU-contend with renders.
    else if (LAKE_JOBS.has(job.name))
      await enqueueJob("lake", job.name, job.data);
  }),
];

/**
 * Register repeatable cron jobs. Upserts are idempotent — safe on every boot.
 *  - morning-drop: daily 05:00 UTC (early-morning WAT)
 *  - release-radar: Mondays 07:00 UTC
 */
async function registerCron() {
  const cronQueue = new Queue("cron", { connection });
  await cronQueue.add(
    "morning-drop",
    {},
    {
      repeat: { pattern: "0 5 * * *" },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    }
  );
  await cronQueue.add(
    "release-radar",
    {},
    {
      repeat: { pattern: "0 7 * * 1" },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    }
  );
  // Zap Radar — daily 03:00 UTC (off-peak, before the morning drop): pull the
  // charts and learn the craft of new trending songs into the lake. Autonomous,
  // capped, keyless, non-interfering.
  // zap-radar now runs ZAP_RUNS_PER_DAY times (default 4), rotating genre slices.
  // Default 1×/day (was 4× — a big overnight cost with marginal value). Raise via
  // ZAP_RUNS_PER_DAY only if trend-chasing proves worth it on /admin/autonomy.
  const zapRuns = Math.max(
    1,
    Math.min(12, parseInt(process.env.ZAP_RUNS_PER_DAY ?? "1", 10) || 1)
  );
  const zapPattern = `0 */${Math.max(1, Math.floor(24 / zapRuns))} * * *`;
  await cronQueue
    .removeRepeatable("zap-radar", { pattern: "0 3 * * *" })
    .catch(() => undefined);
  await cronQueue.add(
    "nightly-compound",
    {},
    { repeat: { pattern: "45 2 * * *" } }
  );
  // ZERO-TAP: run the compound suite ~90s after EVERY deploy too (once per day —
  // the dated jobId dedupes). Uploads get measured, the bank grows, profiles
  // count themselves. Nobody presses anything, ever.
  await cronQueue
    .add(
      "nightly-compound",
      {},
      {
        jobId: `boot-compound-${new Date().toISOString().slice(0, 10)}`,
        delay: 90_000,
        removeOnComplete: true,
        removeOnFail: true,
      }
    )
    .catch(() => undefined);
  await cronQueue.add(
    "zap-radar",
    {},
    {
      repeat: { pattern: zapPattern },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    }
  );
  log.info(
    "cron registered: zap-radar 03:00 UTC, morning-drop 05:00 UTC, release-radar Mon 07:00 UTC"
  );
}

if (process.env.ENABLE_AUTONOMY_CRON === "1") {
  registerCron().catch(err => log.error({ err }, "cron registration failed"));
} else {
  log.warn(
    "autonomy cron disabled; set ENABLE_AUTONOMY_CRON=1 and enable each admin autonomy flag to schedule background work"
  );
}

const workerInstance = String(
  process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? process.pid
)
  .replace(/[^a-zA-Z0-9_-]/g, "-")
  .slice(0, 80);
const workerHeartbeatKey = `worker:heartbeat:${workerInstance}`;
const workerStartedAt = new Date().toISOString();
async function writeWorkerHeartbeat(): Promise<void> {
  const value = JSON.stringify({
    at: new Date().toISOString(),
    startedAt: workerStartedAt,
    pid: process.pid,
  });
  await prisma.systemSetting.upsert({
    where: { key: workerHeartbeatKey },
    create: { key: workerHeartbeatKey, value },
    update: { value },
  });
}
void writeWorkerHeartbeat().catch(err =>
  log.warn({ err }, "worker heartbeat write failed")
);
const workerHeartbeatTimer = setInterval(() => {
  void writeWorkerHeartbeat().catch(err =>
    log.warn({ err }, "worker heartbeat write failed")
  );
}, 15_000);
workerHeartbeatTimer.unref();
const refundRetryIntervalMs = Math.max(
  5_000,
  Math.min(
    15 * 60_000,
    Number(process.env.FAILED_JOB_REFUND_INTERVAL_MS ?? 30_000) || 30_000
  )
);
let refundSweepInFlight = false;
async function sweepFailedJobRefunds(): Promise<void> {
  if (refundSweepInFlight) return;
  refundSweepInFlight = true;
  try {
    const result = await retryPendingFailedJobRefunds();
    if (result.attempted) {
      log.info(result, "failed job refund sweep completed");
    }
  } finally {
    refundSweepInFlight = false;
  }
}
void sweepFailedJobRefunds().catch(err =>
  log.error({ err }, "failed job refund startup sweep failed")
);
const refundRetryTimer = setInterval(() => {
  void sweepFailedJobRefunds().catch(err =>
    log.error({ err }, "failed job refund sweep failed")
  );
}, refundRetryIntervalMs);
refundRetryTimer.unref();


/**
 * Graceful shutdown with a bounded drain. close() waits for active jobs, but
 * the platform hard-kills after ~30s — so we drain for 25s, then force-close.
 * Force-closed jobs are left "active" and BullMQ's stalled-checker re-queues
 * them, so nothing is silently lost — worst case a render re-runs.
 */
async function shutdown(signal: string) {
  clearInterval(workerHeartbeatTimer);
  clearInterval(refundRetryTimer);
  await prisma.systemSetting
    .delete({ where: { key: workerHeartbeatKey } })
    .catch(() => undefined);
  log.info({ signal }, "shutting down — draining active jobs (max 25s)");
  const drained = Promise.all(workers.map(w => w.close()));
  const timeout = new Promise<"timeout">(r =>
    setTimeout(() => r("timeout"), 25_000)
  );
  const result = await Promise.race([
    drained.then(() => "drained" as const),
    timeout,
  ]);
  if (result === "timeout") {
    log.warn(
      "drain timed out — force-closing (stalled jobs will be re-queued by BullMQ)"
    );
    await Promise.allSettled(workers.map(w => w.close(true)));
  }
  await connection.quit().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

log.info(
  "worker up, listening on queues: music, voice, image, video, mix, master, rights, export, cron"
);

// Deploy maintenance is not an autonomy feature: historical vocal rows must be
// measured before any of them can re-enter a mix. The dated id makes this once
// per day across replicas while leaving failed work retryable the next day.
void enqueueJob(
  "lake",
  "vocal-qc-backfill",
  {},
  {
    delayMs: 60_000,
    jobId: `vocal-qc-backfill-${new Date().toISOString().slice(0, 10)}`,
  }
).catch(err => log.warn({ err }, "vocal QC backfill could not be queued"));
void enqueueJob(
  "lake",
  "beat-qc-backfill",
  {},
  {
    delayMs: 75_000,
    jobId: `beat-qc-backfill-${new Date().toISOString().slice(0, 10)}`,
  }
).catch(err => log.warn({ err }, "beat QC backfill could not be queued"));
void enqueueJob(
  "lake",
  "voice-dataset-purge-backfill",
  {},
  {
    delayMs: 90_000,
    jobId: `voice-dataset-purge-${new Date().toISOString().slice(0, 10)}`,
  }
).catch(err =>
  log.warn({ err }, "voice dataset purge backfill could not be queued")
);

// PATCH 2 — announce the log-drum TRUTH-GATE status once at boot. Never silent: the
// operator must always know whether the log drum is calibrated (voting in lane scores)
// or excluded (uncalibrated) — no fabricated measurements slip in unnoticed.
void (async () => {
  try {
    const { dspAvailable, logdrumCalibrationStatus } =
      await import("./lib/dsp");
    if (!(await dspAvailable())) {
      log.warn(
        "logdrum: DSP engine unavailable — the ear cannot run (lane scoring disabled)"
      );
      return;
    }
    const cal = await logdrumCalibrationStatus();
    log.info(
      `capabilities: eleven=${!!process.env.ELEVENLABS_API_KEY} replicate=${!!process.env.REPLICATE_API_TOKEN} tavily=${!!process.env.TAVILY_API_KEY} suno=${!!process.env.SUNO_API_KEY} anthropic=${!!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY)} cerebras=${!!(process.env.CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEYS)} brainModel=${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5"}`
    );
    // ADDENDUM C-1 — provenance stated explicitly, every boot:
    if (cal.calibrated)
      log.info(
        `logdrum: REAL calibration (margin ${cal.separationMargin}) — measured`
      );
    else if (cal.reason === "synthetic-calibration")
      log.warn(
        "logdrum: SYNTHETIC calibration — inferred only, excluded from scoring (drop 9 real rights-clean tracks + run eval-ear.ts to earn measured)"
      );
    else
      log.warn(
        `logdrum: UNCALIBRATED (${cal.reason}) — excluded from lane scoring until eval-ear.ts passes on real reference tracks`
      );
  } catch (err) {
    log.warn({ err }, "logdrum: could not read calibration status");
  }
})();

// A3-6 — LLM usage sink (worker side): radar/gloss/verify calls log tier + task
// + brain + est cost as AnalyticsEvent 'llm.call' for /admin/economics.
