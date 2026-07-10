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
      idempotencyKey?: string;
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
    /** Crucib lesson: a retried/double-submitted request must never charge
     *  twice. Same key + workspace + action = one ledger row, ever. */
    idempotencyKey?: string;
  }) => {
    // Deterministic ledger id when an idempotency key is given — the unique PK
    // makes the double-charge structurally impossible (P2002 = already charged).
    const { createHash } = await import('node:crypto');
    const ledgerId = opts.idempotencyKey
      ? 'idem_' + createHash('sha256').update(`${opts.workspaceId}|${opts.key}|${opts.idempotencyKey}`).digest('hex').slice(0, 24)
      : undefined;
    // Internal single-owner mode: the operator pays provider costs directly via
    // their own API keys — no internal credit wall. WO-1 SAFETY RAIL: spend is
    // CAPPED BY DEFAULT (daily + monthly) so a runaway loop can never exceed it
    // — the API is publicly reachable and best-of-N multiplies renders. Override
    // via MAX_DAILY_GENERATIONS / MAX_MONTHLY_GENERATIONS (0 = explicit opt-out).
    if (isInternalMode()) {
      // TESTING PHASE (owner directive 2026-07-11): 1000/day so testing never
      // stalls mid-session; the rail still exists — a runaway loop dies at the
      // cap, and the monthly ceiling scales with it (1000/day needs >4000/mo).
      const daily = Number(process.env.MAX_DAILY_GENERATIONS ?? 1000);
      const monthly = Number(process.env.MAX_MONTHLY_GENERATIONS ?? 20000);
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
      try {
        await prisma.creditLedger.create({
          data: {
            ...(ledgerId ? { id: ledgerId } : {}),
            workspaceId: opts.workspaceId,
            delta: -(costOf(opts.key) * (opts.multiplier ?? 1)),
            reason: opts.key,
            refTable: opts.refTable,
            refId: opts.refId,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return { ok: true as const, balance: Number.MAX_SAFE_INTEGER }; // already charged — idempotent
        throw e;
      }
      return { ok: true as const, balance: Number.MAX_SAFE_INTEGER };
    }
    const cost = costOf(opts.key) * (opts.multiplier ?? 1);
    return prisma.$transaction(async (tx) => {
      // ATOMIC CONDITIONAL DEBIT (Crucib P0-6 lesson): read-check-then-write let
      // two concurrent charges both pass the balance check. One guarded UPDATE
      // is the whole check — 0 rows touched = insufficient funds, race-free.
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
            ...(ledgerId ? { id: ledgerId } : {}),
            workspaceId: opts.workspaceId,
            delta: -cost,
            reason: opts.key,
            refTable: opts.refTable,
            refId: opts.refId,
          },
        });
      } catch (e) {
        // Idempotent replay: the charge already exists — undo this debit and
        // report success (money mutations atomic; success only on full success).
        if ((e as { code?: string }).code === 'P2002') {
          await tx.workspace.update({ where: { id: opts.workspaceId }, data: { creditsCents: { increment: cost } } });
          const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
          return { ok: true as const, balance: ws?.creditsCents ?? 0 };
        }
        throw e;
      }
      const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
      return { ok: true as const, balance: ws?.creditsCents ?? 0 };
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
