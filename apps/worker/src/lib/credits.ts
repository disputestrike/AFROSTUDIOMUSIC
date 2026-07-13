/**
 * Worker-side credit debit — mirrors the API's chargeCredits (atomic,
 * refuses when short). Used by autonomous jobs (Morning Drop) that spend
 * credits without an HTTP request in the loop.
 */
import { prisma } from '@afrohit/db';
import { costOf, type CreditKey } from '@afrohit/shared';
import { createHash } from 'node:crypto';

// Interactive-transaction client — same shape as Prisma.TransactionClient
// (Omit<PrismaClient, ITXClientDenyList>), spelled via typeof so it also
// resolves under the sandbox db-shim where prisma is `any`.
type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function debitCredits(opts: {
  workspaceId: string;
  key: CreditKey;
  multiplier?: number;
  reasonSuffix?: string;
  idempotencyKey: string;
}): Promise<{ ok: true; balance: number; chargeId: string; replayed?: boolean } | { ok: false; needed: number; balance: number }> {
  const cost = costOf(opts.key) * (opts.multiplier ?? 1);
  const ledgerId = `idem_${createHash('sha256')
    .update(`${opts.workspaceId}|${opts.key}|${opts.idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)}`;
  return prisma.$transaction(async (tx: Tx) => {
    const debited = await tx.workspace.updateMany({
      where: { id: opts.workspaceId, creditsCents: { gte: cost } },
      data: { creditsCents: { decrement: cost } },
    });
    if (debited.count === 0) {
      const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
      if (!ws) throw new Error('workspace missing');
      return { ok: false as const, needed: cost, balance: ws.creditsCents };
    }
    try {
      await tx.creditLedger.create({
        data: {
          id: ledgerId,
          workspaceId: opts.workspaceId,
          delta: -cost,
          reason: `${opts.key}${opts.reasonSuffix ? `_${opts.reasonSuffix}` : ''}`,
          idempotencyKey: opts.idempotencyKey,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      await tx.workspace.update({ where: { id: opts.workspaceId }, data: { creditsCents: { increment: cost } } });
      const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
      return { ok: true as const, balance: ws?.creditsCents ?? 0, chargeId: ledgerId, replayed: true };
    }
    const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
    return { ok: true as const, balance: ws?.creditsCents ?? 0, chargeId: ledgerId };
  });
}
