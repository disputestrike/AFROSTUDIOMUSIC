/**
 * Worker-side credit debit — mirrors the API's chargeCredits (atomic,
 * refuses when short). Used by autonomous jobs (Morning Drop) that spend
 * credits without an HTTP request in the loop.
 */
import { prisma } from '@afrohit/db';
import { costOf, type CreditKey } from '@afrohit/shared';

export async function debitCredits(opts: {
  workspaceId: string;
  key: CreditKey;
  multiplier?: number;
  reasonSuffix?: string;
}): Promise<{ ok: true; balance: number } | { ok: false; needed: number; balance: number }> {
  const cost = costOf(opts.key) * (opts.multiplier ?? 1);
  return prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUnique({
      where: { id: opts.workspaceId },
      select: { creditsCents: true },
    });
    if (!ws) throw new Error('workspace missing');
    if (ws.creditsCents < cost) {
      return { ok: false as const, needed: cost, balance: ws.creditsCents };
    }
    const updated = await tx.workspace.update({
      where: { id: opts.workspaceId },
      data: { creditsCents: { decrement: cost } },
    });
    await tx.creditLedger.create({
      data: {
        workspaceId: opts.workspaceId,
        delta: -cost,
        reason: `${opts.key}${opts.reasonSuffix ? `_${opts.reasonSuffix}` : ''}`,
      },
    });
    return { ok: true as const, balance: updated.creditsCents };
  });
}
