import fp from 'fastify-plugin';
import { prisma } from '@afrohit/db';
import { costOf, PLAN_LIMITS, type CreditKey } from '@afrohit/shared';
import { isInternalMode } from './auth';

/** What prisma.$transaction hands an interactive callback: the client minus the
 *  session-level methods (mirrors Prisma's ITXClientDenyList). Written via
 *  `typeof prisma` so it stays correct under both the real client types and the
 *  sandbox compile shim (where prisma is `any`). */
type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// Map a credit action → the PLAN_LIMITS monthly category it counts against, and
// the ledger reasons that make up that category's usage. Keys not listed are
// uncapped (charged on balance only).
const LIMIT_CATEGORY: Partial<Record<CreditKey, string>> = {
  full_song_demo: 'monthlyDemoSongs',
  beat_idea_short_30s: 'monthlyDemoSongs',
  voice_render_30s: 'monthlyVoiceRenders',
  voice_render_full: 'monthlyVoiceRenders',
  cover_art_low: 'coverArt',
  cover_art_high: 'coverArt',
};
const CATEGORY_REASONS: Record<string, string[]> = {
  monthlyDemoSongs: ['full_song_demo', 'beat_idea_short_30s'],
  monthlyVoiceRenders: ['voice_render_30s', 'voice_render_full'],
  coverArt: ['cover_art_low', 'cover_art_high'],
};

declare module 'fastify' {
  interface FastifyInstance {
    chargeCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
      idempotencyKey?: string;
    }): Promise<{ ok: true; balance: number; chargeId: string; key: CreditKey; replayed?: boolean } | { ok: false; needed: number; balance: number; reason?: string }>;

    refundCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
      chargeId?: string;
    }): Promise<{ refunded: boolean; refundId?: string }>;
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
    // — the API may be publicly reachable and best-of-N multiplies renders.
    // Enforcement is ON by default; ENFORCE_GENERATION_CAP=0 is the explicit
    // local-only opt-out.
    if (isInternalMode()) {
      if (process.env.ENFORCE_GENERATION_CAP !== '0') {
        const daily = Number(process.env.MAX_DAILY_GENERATIONS ?? 100);
        const monthly = Number(process.env.MAX_MONTHLY_GENERATIONS ?? 2000);
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
      }
      // Ledger the charge so the cap has a uniform unit across all generation types.
      try {
        const ledger = await prisma.creditLedger.create({
          data: {
            ...(ledgerId ? { id: ledgerId } : {}),
            workspaceId: opts.workspaceId,
            delta: -(costOf(opts.key) * (opts.multiplier ?? 1)),
            reason: opts.key,
            refTable: opts.refTable,
            refId: opts.refId,
            idempotencyKey: opts.idempotencyKey,
          },
        });
        return { ok: true as const, balance: Number.MAX_SAFE_INTEGER, chargeId: ledger.id, key: opts.key };
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' && ledgerId) {
          return { ok: true as const, balance: Number.MAX_SAFE_INTEGER, chargeId: ledgerId, key: opts.key, replayed: true };
        }
        throw e;
      }
    }
    // PLAN_LIMITS enforcement (audit DEAD: the table was advertised but never
    // enforced). For real tenants, refuse an action once this month's usage in its
    // category exceeds the tier's hard cap (cap × 1.2 tolerance). Internal/owner
    // mode returned above, so this only gates paying multi-tenant workspaces.
    const category = LIMIT_CATEGORY[opts.key];
    if (category) {
      const ws = await prisma.workspace.findUnique({ where: { id: opts.workspaceId }, select: { plan: true } });
      const limits = PLAN_LIMITS[(ws?.plan ?? 'STARTER') as keyof typeof PLAN_LIMITS];
      const cap = limits ? (limits as Record<string, number>)[category] : undefined;
      if (typeof cap === 'number' && cap >= 0) {
        const monthStart = new Date();
        monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
        const used = await prisma.creditLedger.count({
          where: { workspaceId: opts.workspaceId, createdAt: { gte: monthStart }, reason: { in: CATEGORY_REASONS[category] } },
        });
        if (used >= Math.ceil(cap * 1.2)) {
          return { ok: false as const, needed: costOf(opts.key) * (opts.multiplier ?? 1), balance: 0, reason: `plan_limit:${category}` };
        }
      }
    }
    const cost = costOf(opts.key) * (opts.multiplier ?? 1);
    return prisma.$transaction(async (tx: Tx) => {
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
        const ledger = await tx.creditLedger.create({
          data: {
            ...(ledgerId ? { id: ledgerId } : {}),
            workspaceId: opts.workspaceId,
            delta: -cost,
            reason: opts.key,
            refTable: opts.refTable,
            refId: opts.refId,
            idempotencyKey: opts.idempotencyKey,
          },
        });
        const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
        return { ok: true as const, balance: ws?.creditsCents ?? 0, chargeId: ledger.id, key: opts.key };
      } catch (e) {
        // Idempotent replay: the charge already exists — undo this debit and
        // report success (money mutations atomic; success only on full success).
        if ((e as { code?: string }).code === 'P2002') {
          await tx.workspace.update({ where: { id: opts.workspaceId }, data: { creditsCents: { increment: cost } } });
          const ws = await tx.workspace.findUnique({ where: { id: opts.workspaceId }, select: { creditsCents: true } });
          return { ok: true as const, balance: ws?.creditsCents ?? 0, chargeId: ledgerId!, key: opts.key, replayed: true };
        }
        throw e;
      }
    });
  });

  app.decorate('refundCredits', async (opts: {
    workspaceId: string;
    key: CreditKey;
    multiplier?: number;
    refTable?: string;
    refId?: string;
    chargeId?: string;
  }) => {
    const { createHash } = await import('node:crypto');
    return prisma.$transaction(async (tx: Tx) => {
      const charge = opts.chargeId
        ? await tx.creditLedger.findFirst({
            where: { id: opts.chargeId, workspaceId: opts.workspaceId, delta: { lt: 0 } },
            select: { id: true, delta: true },
          })
        : null;
      const amount = charge ? -charge.delta : costOf(opts.key) * (opts.multiplier ?? 1);
      const reversalOfId = charge?.id;
      const refundId = `refund_${createHash('sha256')
        .update(reversalOfId ?? `${opts.workspaceId}|${opts.key}|${opts.refTable ?? ''}|${opts.refId ?? ''}`)
        .digest('hex')
        .slice(0, 24)}`;
      const existing = await tx.creditLedger.findUnique({ where: { id: refundId }, select: { id: true } });
      if (existing || (opts.chargeId && !charge)) {
        return { refunded: false as const, ...(existing ? { refundId: existing.id } : {}) };
      }
      await tx.workspace.update({
        where: { id: opts.workspaceId },
        data: { creditsCents: { increment: amount } },
      });
      const refund = await tx.creditLedger.create({
        data: {
          id: refundId,
          workspaceId: opts.workspaceId,
          delta: amount,
          reason: `refund_${opts.key}`,
          refTable: opts.refTable,
          refId: opts.refId,
          reversalOfId,
        },
      });
      return { refunded: true as const, refundId: refund.id };
    });
  });
});
