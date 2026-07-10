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
    // their own API keys — no internal credit wall. WO-1 SAFETY RAIL: spend is
    // CAPPED BY DEFAULT (daily + monthly) so a runaway loop can never exceed it
    // — the API is publicly reachable and best-of-N multiplies renders. Override
    // via MAX_DAILY_GENERATIONS / MAX_MONTHLY_GENERATIONS (0 = explicit opt-out).
    if (isInternalMode()) {
      const daily = Number(process.env.MAX_DAILY_GENERATIONS ?? 250);
      const monthly = Number(process.env.MAX_MONTHLY_GENERATIONS ?? 4000);
      if (daily > 0) {
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        // Count EVERY charged action today (debit ledger rows), not just
        // ProviderJob rows — so text-only chat loops are capped too, and paid
        // paths like analyze count once (not via an inflating side effect).
        const usedToday = await prisma.creditLedger.count({
          where: { workspaceId: opts.workspaceId, createdAt: { gte: since }, delta: { lt: 0 } },
        });
        if (usedToday >= daily) {
          return { ok: false as const, needed: daily, balance: usedToday, reason: 'daily_cap' };
        }
      }
      if (monthly > 0) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const usedMonth = await prisma.creditLedger.count({
          where: { workspaceId: opts.workspaceId, createdAt: { gte: monthStart }, delta: { lt: 0 } },
        });
        if (usedMonth >= monthly) {
          return { ok: false as const, needed: monthly, balance: usedMonth, reason: 'monthly_cap' };
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
