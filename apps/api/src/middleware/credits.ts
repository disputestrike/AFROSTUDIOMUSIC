import fp from 'fastify-plugin';
import { prisma } from '@afrohit/db';
import { costOf, type CreditKey } from '@afrohit/shared';

declare module 'fastify' {
  interface FastifyInstance {
    chargeCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
    }): Promise<{ ok: true; balance: number } | { ok: false; needed: number; balance: number }>;

    refundCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
    }): Promise<void>;
  }
}

/**
 * Credits plugin — atomically debits credits inside a transaction, refusing
 * if the workspace is short. Every job kind reads its cost from CREDIT_COSTS.
 */
export const creditsPlugin = fp(async function (app) {
  app.decorate('chargeCredits', async (opts: {
    workspaceId: string;
    key: CreditKey;
    multiplier?: number;
    refTable?: string;
    refId?: string;
  }) => {
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
          reason: opts.key,
          refTable: opts.refTable,
          refId: opts.refId,
        },
      });
      return { ok: true as const, balance: updated.creditsCents };
    });
  });

  app.decorate('refundCredits', async (opts: {
    workspaceId: string;
    key: CreditKey;
    multiplier?: number;
    refTable?: string;
    refId?: string;
  }) => {
    const amount = costOf(opts.key) * (opts.multiplier ?? 1);
    await prisma.$transaction(async (tx) => {
      await tx.workspace.update({
        where: { id: opts.workspaceId },
        data: { creditsCents: { increment: amount } },
      });
      await tx.creditLedger.create({
        data: {
          workspaceId: opts.workspaceId,
          delta: amount,
          reason: `refund_${opts.key}`,
          refTable: opts.refTable,
          refId: opts.refId,
        },
      });
    });
  });
});
