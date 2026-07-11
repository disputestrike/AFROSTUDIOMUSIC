import { prisma, JobStatus } from '@afrohit/db';
import { costOf } from '@afrohit/shared';

export async function markRunning(jobId: string) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
}

export async function markSucceeded(jobId: string, output: unknown, cost?: number) {
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
    .replace(/\bfal\b/gi, 'engine route')
    .replace(/suno|minimax|ace[-_ ]?step|replicate|eleven(labs)?|stable[_ ]?audio|musicgen|demucs|cerebras/gi, 'engine');
}

export async function markFailed(jobId: string, err: unknown) {
  const real = String((err as Error)?.message ?? err ?? '').trim() || 'unknown failure (no message)';
  console.warn(`[job ${jobId}] failed — internal reason: ${real.slice(0, 300)}`);
  const job = await prisma.providerJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      errorJson: { message: wallSafe(real).slice(0, 800) } as never,
    },
    select: { id: true, workspaceId: true, inputJson: true },
  });
  // REFUND ON FAILURE (audit DEAD: charge-before-enqueue never refunded). If the
  // route stamped a `_charge` on the job, credit it back — atomically and once
  // (deterministic ledger id). Skipped in internal/owner mode (no real balance).
  await refundJobCharge(job).catch((e) => console.warn(`[job ${jobId}] refund skipped:`, (e as Error)?.message));
}

async function refundJobCharge(job: { id: string; workspaceId: string; inputJson: unknown }) {
  if ((process.env.AUTH_MODE ?? 'internal').toLowerCase() === 'internal') return; // owner pays providers directly
  const charge = (job.inputJson as { _charge?: { key?: string; multiplier?: number } } | null)?._charge;
  if (!charge?.key) return;
  const amount = costOf(charge.key as never) * (charge.multiplier ?? 1);
  if (!amount) return;
  try {
    await prisma.$transaction([
      prisma.workspace.update({ where: { id: job.workspaceId }, data: { creditsCents: { increment: amount } } }),
      prisma.creditLedger.create({
        data: { id: `refund_${job.id}`, workspaceId: job.workspaceId, delta: amount, reason: `refund_${charge.key}`, refTable: 'ProviderJob', refId: job.id },
      }),
    ]);
    console.log(`[job ${job.id}] refunded ${amount} (${charge.key}) on failure`);
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e; // already refunded
  }
}
