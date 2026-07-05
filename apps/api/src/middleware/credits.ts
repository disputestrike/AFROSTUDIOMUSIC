import fp from 'fastify-plugin';
import { prisma } from '@afrohit/db';
import { costOf, type CreditKey } from '@afrohit/shared';
import { isInternalMode } from './auth';

declare module 'fastify' {
  interface FastifyInstance {
    chargeCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
    }): Promise<{ ok: true; balance: number } | { ok: false; needed: number; balance: number; reason?: string }>;

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
    // Internal single-owner mode: the operator pays provider costs directly via
    // their own API keys — no internal credit wall. Generation is free for them,
    // BUT a hard daily generation cap still applies so a runaway loop, a batch,
    // or a bot can never drain the operator's provider card. Set MAX_DAILY_GENERATIONS.
    if (isInternalMode()) {
      const cap = Number(process.env.MAX_DAILY_GENERATIONS ?? 300);
      if (cap > 0) {
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        // Count EVERY charged action today (debit ledger rows), not just
        // ProviderJob rows — so text-only chat loops are capped too, and paid
        // paths like analyze count once (not via an inflating side effect).
        const usedToday = await prisma.creditLedger.count({
          where: { workspaceId: opts.workspaceId, createdAt: { gte: since }, delta: { lt: 0 } },
        });
        if (usedToday >= cap) {
          return { ok: false as const, needed: cap, balance: usedToday, reason: 'daily_cap' };
        }
      }
      // Ledger the charge so the cap has a uniform unit across all generation types.
      await prisma.creditLedger.create({
        data: {
          workspaceId: opts.workspaceId,
          delta: -(costOf(opts.key) * (opts.multiplier ?? 1)),
          reason: opts.key,
          refTable: opts.refTable,
          refId: opts.refId,
        },
      });
      return { ok: true as const, balance: Number.MAX_SAFE_INTEGER };
    }
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
