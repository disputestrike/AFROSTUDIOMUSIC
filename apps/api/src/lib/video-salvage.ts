import type { FastifyInstance } from "fastify";
import { Prisma, prisma } from "@afrohit/db";

// ============================================================================
// POST-RENDER SALVAGE LAW — the API side (2026-07-16).
//
// A render job can fail AFTER the engine finished and was paid: the per-shot
// prediction id (and sometimes a committed url) survives in the failed job's
// outputJson.videoProgress. Those scenes are paid-but-undelivered. Before a
// render route bills a scene, it consults this law: if a failed job still
// holds a live claim on that scene, the route requeues THAT job in
// recover-only mode — the worker re-polls the finished prediction and
// downloads it. NO new engine spend, NO new charge. Entries a recovery run
// proved dead (link expired, engine-side failure) carry `unrecoverable` and
// are excluded, so a dead prediction can never trap a scene in a
// recover-forever loop.
// ============================================================================

export type SalvageJob = {
  jobId: string;
  /** null = a whole-storyboard job; a number = single-scene job. */
  shotIndex: number | null;
  engineClass: string | null;
  /** Scenes this job can still deliver without new spend. */
  salvageableShotIndexes: number[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export type SalvageJobRow = {
  id: string;
  inputJson: unknown;
  outputJson: unknown;
};

/** PURE claims law (unit-tested): rows must arrive NEWEST-FIRST; the newest
 *  failed job wins each scene. */
export function salvageClaims(rows: SalvageJobRow[]): Map<number, SalvageJob> {
  const byShot = new Map<number, SalvageJob>();
  for (const job of rows) {
    const input = record(job.inputJson);
    const output = record(job.outputJson);
    const progress = Array.isArray(output?.videoProgress)
      ? output.videoProgress
      : [];
    const salvageable: number[] = [];
    for (const row of progress) {
      const entry = record(row);
      if (!entry || !Number.isInteger(entry.shotIndex)) continue;
      if (typeof entry.unrecoverable === "string" && entry.unrecoverable) {
        continue;
      }
      const committed =
        entry.state === "succeeded" &&
        typeof entry.url === "string" &&
        entry.url.length > 0;
      const submitted =
        typeof entry.externalId === "string" && entry.externalId.length > 0;
      if (committed || submitted) salvageable.push(entry.shotIndex as number);
    }
    if (!salvageable.length) continue;
    const jobShotIndex = Number.isInteger(input?.shotIndex)
      ? (input!.shotIndex as number)
      : null;
    const covered =
      jobShotIndex == null
        ? salvageable
        : salvageable.includes(jobShotIndex)
          ? [jobShotIndex]
          : [];
    if (!covered.length) continue;
    const claim: SalvageJob = {
      jobId: job.id,
      shotIndex: jobShotIndex,
      engineClass:
        typeof input?.engineClass === "string" ? input.engineClass : null,
      salvageableShotIndexes: covered,
    };
    for (const index of covered) {
      if (!byShot.has(index)) byShot.set(index, claim);
    }
  }
  return byShot;
}

/** Newest failed job wins each scene; older claims stay as fallback history. */
export async function salvageableVideoShots(
  workspaceId: string,
  conceptId: string
): Promise<Map<number, SalvageJob>> {
  const failed = await prisma.providerJob.findMany({
    where: {
      workspaceId,
      kind: "video",
      status: "FAILED",
      NOT: { provider: "assembler" },
      inputJson: { path: ["conceptId"], equals: conceptId },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, inputJson: true, outputJson: true },
  });
  return salvageClaims(failed);
}

/**
 * Requeue a failed job in recover-only mode: flip it back to QUEUED and put a
 * fresh payload through the durable outbox (the API's own dispatch pattern).
 * BullMQ retains FAILED jobs under their stable id — the ghost must be
 * removed first or the re-publish is silently deduped and nothing ever runs.
 */
export async function requeueVideoRecovery(
  app: FastifyInstance,
  options: {
    job: SalvageJob;
    workspaceId: string;
    projectId: string;
    conceptId: string;
    shots: unknown[];
    format: string;
  }
): Promise<void> {
  const payload = {
    jobId: options.job.jobId,
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    conceptId: options.conceptId,
    ...(options.job.shotIndex == null
      ? {}
      : { shotIndex: options.job.shotIndex }),
    shots: options.shots,
    format: options.format,
    engineClass: options.job.engineClass ?? "standard",
    recoverOnly: true,
  };
  await app.queues.video
    .remove(`provider-${options.job.jobId}`)
    .catch(() => undefined);
  await prisma.$transaction([
    prisma.providerJob.update({
      where: { id: options.job.jobId },
      data: {
        status: "QUEUED",
        errorJson: Prisma.DbNull,
        finishedAt: null,
      },
    }),
    prisma.jobOutbox.upsert({
      where: { providerJobId: options.job.jobId },
      create: {
        workspaceId: options.workspaceId,
        providerJobId: options.job.jobId,
        queueName: "video",
        jobName: "render-video",
        payload: payload as never,
      },
      update: {
        queueName: "video",
        jobName: "render-video",
        payload: payload as never,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
        dispatchedAt: null,
        lastError: null,
      },
    }),
  ]);
  // Fire the dispatcher now instead of waiting for its 15s tick — delivery
  // links expire by the minute. Failure is fine: the tick will republish.
  await app.dispatchPendingJobs().catch(() => undefined);
}
