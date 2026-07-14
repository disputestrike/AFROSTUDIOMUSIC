import type { Prisma, PrismaClient } from "@prisma/client";
import { costOf, PLAN_LIMITS, type CreditKey } from "@afrohit/shared";

type PlanCategory =
  | "monthlyDemoSongs"
  | "monthlyVoiceRenders"
  | "monthlyVideoSeconds"
  | "coverArt";

const CATEGORY_BY_KEY: Partial<Record<CreditKey, PlanCategory>> = {
  full_song_demo: "monthlyDemoSongs",
  beat_idea_short_30s: "monthlyDemoSongs",
  voice_render_30s: "monthlyVoiceRenders",
  voice_render_full: "monthlyVoiceRenders",
  video_8s: "monthlyVideoSeconds",
  video_20s: "monthlyVideoSeconds",
  cover_art_low: "coverArt",
  cover_art_high: "coverArt",
};

const KEYS_BY_CATEGORY: Record<PlanCategory, CreditKey[]> = {
  monthlyDemoSongs: ["full_song_demo", "beat_idea_short_30s"],
  monthlyVoiceRenders: ["voice_render_30s", "voice_render_full"],
  monthlyVideoSeconds: ["video_8s", "video_20s"],
  coverArt: ["cover_art_low", "cover_art_high"],
};

const DEFAULT_PLAN_UNITS: Partial<Record<CreditKey, number>> = {
  video_8s: 8,
  video_20s: 20,
};

export type WorkspaceChargeResult =
  | {
      ok: true;
      balance: number;
      chargeId: string;
      key: CreditKey;
      replayed?: boolean;
    }
  | {
      ok: false;
      needed: number;
      balance: number;
      reason?: string;
    };

export interface WorkspaceChargeOptions {
  workspaceId: string;
  key: CreditKey;
  multiplier?: number;
  planUnits?: number;
  refTable?: string;
  refId?: string;
  idempotencyKey?: string;
  reasonSuffix?: string;
  internalMode: boolean;
  enforceGenerationCap?: boolean;
  dailyCap?: number;
  monthlyCap?: number;
  now?: Date;
}

function positiveUnits(value: number | undefined, fallback = 1): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 10_000) {
    throw new Error("credit units must be an integer between 1 and 10000");
  }
  return candidate;
}

function configuredCap(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

async function lockWorkspace(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: number }>>`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(hashtextextended(${`credits:${workspaceId}`}, 0))
  `;
}

async function operationUsage(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  since: Date
): Promise<number> {
  const result = await tx.creditLedger.aggregate({
    where: {
      workspaceId,
      createdAt: { gte: since },
      delta: { lt: 0 },
      reversal: { is: null },
    },
    _sum: { units: true },
  });
  return result._sum.units ?? 0;
}

async function categoryUsage(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  category: PlanCategory,
  since: Date
): Promise<number> {
  const result = await tx.creditLedger.aggregate({
    where: {
      workspaceId,
      createdAt: { gte: since },
      delta: { lt: 0 },
      reversal: { is: null },
      creditKey: { in: KEYS_BY_CATEGORY[category] },
    },
    _sum: { planUnits: true },
  });
  return result._sum.planUnits ?? 0;
}

export async function chargeWorkspaceCredits(
  client: PrismaClient,
  opts: WorkspaceChargeOptions
): Promise<WorkspaceChargeResult> {
  const units = positiveUnits(opts.multiplier);
  const planUnits = positiveUnits(
    opts.planUnits,
    units * (DEFAULT_PLAN_UNITS[opts.key] ?? 1)
  );
  const cost = costOf(opts.key) * units;
  const now = opts.now ?? new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  return client.$transaction(
    async tx => {
      await lockWorkspace(tx, opts.workspaceId);
      const workspace = await tx.workspace.findUnique({
        where: { id: opts.workspaceId },
        select: { creditsCents: true, plan: true },
      });
      if (!workspace) throw new Error("workspace missing");

      if (opts.idempotencyKey) {
        const existing = await tx.creditLedger.findFirst({
          where: {
            workspaceId: opts.workspaceId,
            idempotencyKey: opts.idempotencyKey,
            delta: { lt: 0 },
          },
          select: { id: true },
        });
        if (existing) {
          return {
            ok: true as const,
            balance: opts.internalMode
              ? Number.MAX_SAFE_INTEGER
              : workspace.creditsCents,
            chargeId: existing.id,
            key: opts.key,
            replayed: true,
          };
        }
      }

      if (opts.internalMode && (opts.enforceGenerationCap ?? true)) {
        const dailyCap = configuredCap(opts.dailyCap, 100);
        const monthlyCap = configuredCap(opts.monthlyCap, 2_000);
        const [usedToday, usedMonth] = await Promise.all([
          operationUsage(tx, opts.workspaceId, dayStart),
          operationUsage(tx, opts.workspaceId, monthStart),
        ]);
        if (dailyCap > 0 && usedToday + units > dailyCap) {
          return {
            ok: false as const,
            needed: dailyCap,
            balance: usedToday,
            reason: "daily_cap",
          };
        }
        if (monthlyCap > 0 && usedMonth + units > monthlyCap) {
          return {
            ok: false as const,
            needed: monthlyCap,
            balance: usedMonth,
            reason: "monthly_cap",
          };
        }
      }

      if (!opts.internalMode) {
        const category = CATEGORY_BY_KEY[opts.key];
        if (category) {
          const advertised = PLAN_LIMITS[workspace.plan][category];
          const hardCap = Math.ceil(advertised * 1.2);
          const used = await categoryUsage(
            tx,
            opts.workspaceId,
            category,
            monthStart
          );
          if (used + planUnits > hardCap) {
            return {
              ok: false as const,
              needed: cost,
              balance: workspace.creditsCents,
              reason: `plan_limit:${category}`,
            };
          }
        }

        const debited = await tx.workspace.updateMany({
          where: {
            id: opts.workspaceId,
            creditsCents: { gte: cost },
          },
          data: { creditsCents: { decrement: cost } },
        });
        if (debited.count === 0) {
          return {
            ok: false as const,
            needed: cost,
            balance: workspace.creditsCents,
          };
        }
      }

      const ledger = await tx.creditLedger.create({
        data: {
          workspaceId: opts.workspaceId,
          delta: -cost,
          reason: `${opts.key}${opts.reasonSuffix ? `_${opts.reasonSuffix}` : ""}`,
          creditKey: opts.key,
          units,
          planUnits,
          refTable: opts.refTable,
          refId: opts.refId,
          idempotencyKey: opts.idempotencyKey,
        },
      });
      const balance = opts.internalMode
        ? Number.MAX_SAFE_INTEGER
        : workspace.creditsCents - cost;
      return {
        ok: true as const,
        balance,
        chargeId: ledger.id,
        key: opts.key,
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}
export type WorkspaceRefundResult =
  | { refunded: true; refundId: string; amount: number }
  | { refunded: false; refundId?: string };

export interface WorkspaceRefundOptions {
  workspaceId: string;
  chargeId: string;
  internalMode: boolean;
  refTable?: string;
  refId?: string;
}

export async function refundWorkspaceCharge(
  client: PrismaClient,
  opts: WorkspaceRefundOptions
): Promise<WorkspaceRefundResult> {
  return client.$transaction(
    async tx => {
      await lockWorkspace(tx, opts.workspaceId);
      const charge = await tx.creditLedger.findFirst({
        where: {
          id: opts.chargeId,
          workspaceId: opts.workspaceId,
          delta: { lt: 0 },
        },
        select: {
          id: true,
          delta: true,
          reason: true,
          creditKey: true,
          refTable: true,
          refId: true,
          reversal: { select: { id: true } },
        },
      });
      if (!charge) return { refunded: false as const };
      if (charge.reversal) {
        return {
          refunded: false as const,
          refundId: charge.reversal.id,
        };
      }

      const amount = -charge.delta;
      if (!opts.internalMode) {
        await tx.workspace.update({
          where: { id: opts.workspaceId },
          data: { creditsCents: { increment: amount } },
        });
      }

      const refund = await tx.creditLedger.create({
        data: {
          id: "refund_" + charge.id,
          workspaceId: opts.workspaceId,
          delta: amount,
          reason: "refund_" + (charge.creditKey ?? charge.reason),
          creditKey: charge.creditKey,
          units: 0,
          planUnits: 0,
          refTable: opts.refTable ?? charge.refTable,
          refId: opts.refId ?? charge.refId,
          reversalOfId: charge.id,
        },
      });
      return {
        refunded: true as const,
        refundId: refund.id,
        amount,
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}
