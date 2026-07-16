import { prisma, JobStatus, refundWorkspaceCharge } from "@afrohit/db";
import { costOf, redactSensitiveText } from "@afrohit/shared";
import { AsyncLocalStorage } from "node:async_hooks";

const attemptContext = new AsyncLocalStorage<{ finalAttempt: boolean }>();
export const REFUND_OUTBOX_MARKER = "refund_pending:";

export function isTerminalProviderJobStatus(status: string): boolean {
  return (
    status === JobStatus.SUCCEEDED ||
    status === JobStatus.FAILED ||
    status === JobStatus.CANCELED
  );
}

export function refundRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt) || 1);
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.min(safeAttempt, 8));
}

export function runWithJobAttemptContext<T>(
  finalAttempt: boolean,
  fn: () => Promise<T>
): Promise<T> {
  return attemptContext.run({ finalAttempt }, fn);
}

export async function markRunning(jobId: string) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
}

export async function markSucceeded(
  jobId: string,
  output: unknown,
  cost?: number
) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputJson: output as never,
      cost: cost == null ? undefined : (cost.toFixed(6) as unknown as never),
    },
  });
}

/** §1.11 THE WALL, at the ONE chokepoint every job error flows through:
 *  errorJson reaches user screens (Create page, SongChat, catalog), so vendor
 *  and route names are scrubbed to class language here. The REAL reason is
 *  logged internally first — diagnosis never loses information. */
function wallSafe(message: string): string {
  return message
    .replace(/\bfal\b/gi, "engine route")
    .replace(
      /suno|minimax|ace[-_ ]?step|replicate|eleven(labs)?|stable[_ ]?audio|musicgen|demucs|cerebras/gi,
      "engine"
    );
}

export async function markFailed(jobId: string, err: unknown) {
  const real =
    redactSensitiveText((err as Error)?.message ?? err ?? "", 800).trim() ||
    "unknown failure (no message)";
  console.warn(
    `[job ${jobId}] failed — internal reason: ${real.slice(0, 300)}`
  );
  const finalAttempt = attemptContext.getStore()?.finalAttempt !== false;
  const failedAt = new Date();
  const job = await prisma.$transaction(async tx => {
    const updated = await tx.providerJob.update({
      where: { id: jobId },
      data: {
        // Non-final BullMQ failures are still executable. Reserving FAILED for
        // terminal work lets redelivery safely stop before provider side effects.
        status: finalAttempt ? JobStatus.FAILED : JobStatus.QUEUED,
        startedAt: finalAttempt ? undefined : null,
        finishedAt: finalAttempt ? failedAt : null,
        errorJson: { message: wallSafe(real).slice(0, 800) } as never,
      },
      select: {
        id: true,
        workspaceId: true,
        inputJson: true,
        chargeLedgerId: true,
      },
    });

    if (finalAttempt && hasRefundableCharge(updated)) {
      // Preserve queue name, job name, and payload for a later admin replay.
      // The failed job prevents the normal dispatcher from republishing this row.
      await tx.jobOutbox.updateMany({
        where: { providerJobId: jobId },
        data: {
          status: "FAILED",
          nextAttemptAt: failedAt,
          lastError: `${REFUND_OUTBOX_MARKER}scheduled`,
        },
      });
    }
    return updated;
  });
  // REFUND ON FAILURE (audit DEAD: charge-before-enqueue never refunded). If the
  // route stamped a `_charge` on the job, credit it back — atomically and once
  // using the same lock as charging. Owner mode restores cap units without changing balance.
  if (finalAttempt && hasRefundableCharge(job)) {
    await refundFailedJob(job.id);
  }
}

export async function refundFailedJob(jobId: string): Promise<boolean> {
  const job = await prisma.providerJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      workspaceId: true,
      inputJson: true,
      chargeLedgerId: true,
    },
  });
  if (!job) throw new Error(`failed job ${jobId} no longer exists`);
  if (!hasRefundableCharge(job)) {
    await completeRefundObligation(job.id);
    return true;
  }

  try {
    await refundJobCharge(job);
    await completeRefundObligation(job.id);
    return true;
  } catch (error) {
    await deferRefundObligation(job.id, error).catch(markerError => {
      console.error(
        `[job ${job.id}] could not update durable refund retry: ${redactSensitiveText(
          (markerError as Error)?.message ?? markerError,
          300
        )}`
      );
    });
    console.error(
      `[job ${job.id}] refund deferred for durable retry: ${redactSensitiveText(
        (error as Error)?.message ?? error,
        300
      )}`
    );
    return false;
  }
}

export async function retryPendingFailedJobRefunds(
  limit = 50
): Promise<{ attempted: number; completed: number; deferred: number }> {
  const take = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const dueAt = new Date();
  const marked = await prisma.providerJob.findMany({
    where: {
      status: JobStatus.FAILED,
      outbox: {
        is: {
          lastError: { startsWith: REFUND_OUTBOX_MARKER },
          nextAttemptAt: { lte: dueAt },
        },
      },
    },
    orderBy: { finishedAt: "asc" },
    select: { id: true },
    take,
  });

  // Jobs predating the outbox can still carry a linked debit. The failed job
  // plus unreversed ledger row is itself a durable obligation.
  const remaining = take - marked.length;
  const legacy = remaining
    ? await prisma.providerJob.findMany({
        where: {
          status: JobStatus.FAILED,
          chargeLedgerId: { not: null },
          chargeLedger: { is: { reversal: { is: null } } },
          outbox: { is: null },
        },
        orderBy: { finishedAt: "asc" },
        select: { id: true },
        take: remaining,
      })
    : [];

  const ids = [...new Set([...marked, ...legacy].map(job => job.id))];
  let completed = 0;
  for (const id of ids) {
    if (await refundFailedJob(id)) completed += 1;
  }
  return {
    attempted: ids.length,
    completed,
    deferred: ids.length - completed,
  };
}

type RefundableJob = {
  id: string;
  workspaceId: string;
  inputJson: unknown;
  chargeLedgerId?: string | null;
};

function hasRefundableCharge(job: RefundableJob): boolean {
  if (job.chargeLedgerId) return true;
  if ((process.env.AUTH_MODE ?? "internal").toLowerCase() === "internal")
    return false;
  return Boolean(
    (
      job.inputJson as {
        _charge?: { key?: string; multiplier?: number };
      } | null
    )?._charge?.key
  );
}

async function completeRefundObligation(jobId: string): Promise<void> {
  await prisma.jobOutbox.updateMany({
    where: {
      providerJobId: jobId,
      lastError: { startsWith: REFUND_OUTBOX_MARKER },
    },
    data: {
      status: "DISPATCHED",
      lastError: null,
    },
  });
}

async function deferRefundObligation(
  jobId: string,
  error: unknown
): Promise<void> {
  const row = await prisma.jobOutbox.findUnique({
    where: { providerJobId: jobId },
    select: { attempts: true },
  });
  if (!row) return;
  const nextAttempt = row.attempts + 1;
  await prisma.jobOutbox.updateMany({
    where: {
      providerJobId: jobId,
      lastError: { startsWith: REFUND_OUTBOX_MARKER },
    },
    data: {
      status: "FAILED",
      attempts: { increment: 1 },
      nextAttemptAt: new Date(Date.now() + refundRetryDelayMs(nextAttempt)),
      lastError: `${REFUND_OUTBOX_MARKER}${redactSensitiveText(
        (error as Error)?.message ?? error,
        400
      )}`,
    },
  });
}

async function refundJobCharge(job: RefundableJob) {
  const internalMode =
    (process.env.AUTH_MODE ?? "internal").toLowerCase() === "internal";
  if (job.chargeLedgerId) {
    const refund = await refundWorkspaceCharge(prisma, {
      workspaceId: job.workspaceId,
      chargeId: job.chargeLedgerId,
      internalMode,
      refTable: "ProviderJob",
      refId: job.id,
    });
    if (refund.refunded) {
      console.log(
        "[job " +
          job.id +
          "] reversed charge " +
          job.chargeLedgerId +
          " on failure"
      );
    }
    return;
  }

  if (internalMode) return;
  // Compatibility for jobs created before chargeLedgerId existed.
  const charge = (
    job.inputJson as { _charge?: { key?: string; multiplier?: number } } | null
  )?._charge;
  if (!charge?.key) return;
  const amount = costOf(charge.key as never) * (charge.multiplier ?? 1);
  if (!amount) return;
  try {
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: job.workspaceId },
        data: { creditsCents: { increment: amount } },
      }),
      prisma.creditLedger.create({
        data: {
          id: `refund_${job.id}`,
          workspaceId: job.workspaceId,
          delta: amount,
          reason: `refund_${charge.key}`,
          refTable: "ProviderJob",
          refId: job.id,
        },
      }),
    ]);
    console.log(
      `[job ${job.id}] refunded ${amount} (${charge.key}) on failure`
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // already refunded
  }
}
