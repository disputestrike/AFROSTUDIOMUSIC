import { prisma } from '@afrohit/db';
import { redactSensitiveText } from '@afrohit/shared';

/**
 * STREAMING PRIMITIVE (API side) — the append-only job-event channel.
 *
 * The worker owns its own copy in apps/worker/src/lib/jobs.ts (used by
 * markRunning/markSucceeded); this is the identical fail-soft helper for the
 * API process, which can't import from the worker package. Duplicating a
 * ~10-line prisma insert matches how this repo already duplicates small job
 * helpers across the two processes (refundRetryDelayMs, REFUND_OUTBOX_MARKER).
 *
 * FAIL-SOFT BY LAW: emitting a progress breadcrumb must NEVER throw into a
 * create — a lost event is invisible, a thrown one would kill a paid drop.
 */
export async function emitJobEvent(
  jobId: string,
  phase: string,
  payload?: unknown
): Promise<void> {
  try {
    await prisma.jobEvent.create({
      data: {
        jobId,
        phase,
        payloadJson: (payload ?? undefined) as never,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[job ${jobId}] emitJobEvent(${phase}) skipped: ${redactSensitiveText(
        (err as Error)?.message ?? err,
        200
      )}`
    );
  }
}

export type JobEventRow = {
  seq: number;
  phase: string;
  payload: unknown;
  createdAt: Date;
};

/** The event tail for a job, strictly after `sinceSeq`, oldest → newest. */
export async function readJobEvents(
  jobId: string,
  sinceSeq = 0,
  limit = 100
): Promise<JobEventRow[]> {
  const take = Math.max(1, Math.min(500, Math.floor(limit) || 100));
  const since = Number.isFinite(sinceSeq) ? Math.max(0, Math.trunc(sinceSeq)) : 0;
  const rows = await prisma.jobEvent.findMany({
    where: { jobId, seq: { gt: since } },
    orderBy: { seq: 'asc' },
    take,
    select: { seq: true, phase: true, payloadJson: true, createdAt: true },
  });
  return rows.map(row => ({
    seq: row.seq,
    phase: row.phase,
    payload: row.payloadJson ?? null,
    createdAt: row.createdAt,
  }));
}

/** The single newest event for a job (folded into GET /jobs/:id as {phase, partial}). */
export async function latestJobEvent(jobId: string): Promise<JobEventRow | null> {
  const row = await prisma.jobEvent.findFirst({
    where: { jobId },
    orderBy: { seq: 'desc' },
    select: { seq: true, phase: true, payloadJson: true, createdAt: true },
  });
  return row
    ? { seq: row.seq, phase: row.phase, payload: row.payloadJson ?? null, createdAt: row.createdAt }
    : null;
}
