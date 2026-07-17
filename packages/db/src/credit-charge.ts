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
  // Per-scene class keys (owner-approved pricing) still meter the SAME plan
  // category in provider seconds — planUnits carries the real workload.
  video_shot_draft: "monthlyVideoSeconds",
  video_shot_standard: "monthlyVideoSeconds",
  video_shot_flagship: "monthlyVideoSeconds",
  cover_art_low: "coverArt",
  cover_art_high: "coverArt",
};

const KEYS_BY_CATEGORY: Record<PlanCategory, CreditKey[]> = {
  monthlyDemoSongs: ["full_song_demo", "beat_idea_short_30s"],
  monthlyVoiceRenders: ["voice_render_30s", "voice_render_full"],
  monthlyVideoSeconds: [
    "video_8s",
    "video_20s",
    "video_shot_draft",
    "video_shot_standard",
    "video_shot_flagship",
  ],
  coverArt: ["cover_art_low", "cover_art_high"],
};

const DEFAULT_PLAN_UNITS: Partial<Record<CreditKey, number>> = {
  video_8s: 8,
  video_20s: 20,
};

export const QUEUE_BOUND_MEDIA_CREDIT_KEYS = [
  "cover_art_low",
  "cover_art_high",
  "beat_idea_short_30s",
  "full_song_demo",
  "stems_export",
  "analyze_audio",
  "voice_render_30s",
  "voice_render_full",
  "voice_profile_setup",
  "voice_clone_training",
  "voice_sing_render",
  "mix_preset",
  "master_preset",
  "video_8s",
  "video_20s",
  "video_shot_draft",
  "video_shot_standard",
  "video_shot_flagship",
  "release_export",
] as const satisfies readonly CreditKey[];

export const QUEUE_BOUND_MEDIA_REFERENCE_TABLES = [
  "Project",
  "Song",
  "Workspace",
  "VoiceConsent",
  "VoiceProfile",
  "VideoConcept",
] as const;

export const DEFAULT_ORPHAN_CHARGE_AGE_MS = 60 * 60 * 1_000;
export const MIN_ORPHAN_CHARGE_AGE_MS = 15 * 60 * 1_000;
export const MAX_ORPHAN_CHARGE_BATCH_SIZE = 100;
const DEFAULT_ORPHAN_CHARGE_BATCH_SIZE = 25;

const QUEUE_BOUND_MEDIA_KEY_SET = new Set<string>(
  QUEUE_BOUND_MEDIA_CREDIT_KEYS
);
const QUEUE_BOUND_MEDIA_REFERENCE_SET = new Set<string>(
  QUEUE_BOUND_MEDIA_REFERENCE_TABLES
);
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
  /** Hard per-day money ceiling in 1/100-cent units (0 = disabled). Trips on
   *  real spend regardless of operation count. */
  dailyCostCeiling?: number;
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

/** COST-AWARE CEILING (audit 2026-07-17): the operation cap counts actions,
 *  so 25 flagship video renders trip it identically to 25 cheap hooks — a
 *  real bill of very different size. This sums the ACTUAL debit (delta, in
 *  1/100-cent units) spent since `since`, so a hard per-day money ceiling can
 *  cap catastrophic overspend regardless of operation count. */
async function costUsage(
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
    _sum: { delta: true },
  });
  return Math.abs(result._sum.delta ?? 0);
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
        // HARD MONEY CEILING — independent of the operation count. Catches the
        // "25 flagship videos" abuse the operation cap misses. 0 = disabled.
        const costCeiling = configuredCap(opts.dailyCostCeiling, 0);
        if (costCeiling > 0) {
          const spentToday = await costUsage(tx, opts.workspaceId, dayStart);
          if (spentToday + cost > costCeiling) {
            return {
              ok: false as const,
              needed: costCeiling,
              balance: spentToday,
              reason: "daily_spend_ceiling",
            };
          }
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

type RefundableCharge = {
  id: string;
  delta: number;
  reason: string;
  creditKey: string | null;
  refTable: string | null;
  refId: string | null;
  reversal: { id: string } | null;
};

async function lockCreditLedgerRow(
  tx: Prisma.TransactionClient,
  chargeId: string
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "CreditLedger" WHERE "id" = $1 FOR UPDATE',
    chargeId
  );
  return rows.length === 1;
}

async function refundWorkspaceChargeInTransaction(
  tx: Prisma.TransactionClient,
  opts: WorkspaceRefundOptions,
  charge: RefundableCharge
): Promise<WorkspaceRefundResult> {
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
      return refundWorkspaceChargeInTransaction(tx, opts, charge);
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}

export interface OrphanQueueChargeCandidate {
  delta: number;
  reason: string;
  creditKey: string | null;
  refTable: string | null;
  refId: string | null;
  createdAt: Date;
  chargedJob: { id: string } | null;
  reversal: { id: string } | null;
}

export function isOrphanQueueBoundMediaDebit(
  candidate: OrphanQueueChargeCandidate,
  cutoff: Date
): boolean {
  const createdAt = candidate.createdAt.getTime();
  const cutoffAt = cutoff.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(cutoffAt)) return false;
  if (candidate.delta >= 0 || createdAt > cutoffAt) return false;
  if (candidate.chargedJob || candidate.reversal) return false;
  if (
    !candidate.creditKey ||
    !QUEUE_BOUND_MEDIA_KEY_SET.has(candidate.creditKey)
  ) {
    return false;
  }
  if (
    !candidate.refTable ||
    !QUEUE_BOUND_MEDIA_REFERENCE_SET.has(candidate.refTable) ||
    !candidate.refId?.trim()
  ) {
    return false;
  }
  return (
    candidate.reason === candidate.creditKey ||
    candidate.reason.startsWith(candidate.creditKey + "_")
  );
}

export interface OrphanQueueChargeRecoveryOptions {
  internalMode: boolean;
  now?: Date;
  minAgeMs?: number;
  batchSize?: number;
}

export interface OrphanQueueChargeRecoveryPolicy {
  cutoff: Date;
  batchSize: number;
}

export function resolveOrphanQueueChargeRecoveryPolicy(
  opts: Pick<OrphanQueueChargeRecoveryOptions, "now" | "minAgeMs" | "batchSize">
): OrphanQueueChargeRecoveryPolicy {
  const now = opts.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new Error("now must be a valid date");

  const minAgeMs = opts.minAgeMs ?? DEFAULT_ORPHAN_CHARGE_AGE_MS;
  if (!Number.isSafeInteger(minAgeMs) || minAgeMs < MIN_ORPHAN_CHARGE_AGE_MS) {
    throw new Error(
      "orphan charge age must be an integer of at least 15 minutes"
    );
  }

  const requestedBatch = opts.batchSize ?? DEFAULT_ORPHAN_CHARGE_BATCH_SIZE;
  if (!Number.isSafeInteger(requestedBatch) || requestedBatch < 1) {
    throw new Error("orphan charge batch size must be a positive integer");
  }

  return {
    cutoff: new Date(now.getTime() - minAgeMs),
    batchSize: Math.min(requestedBatch, MAX_ORPHAN_CHARGE_BATCH_SIZE),
  };
}

export interface OrphanQueueChargeRecoveryResult {
  considered: number;
  refunded: number;
  skipped: number;
  amount: number;
  chargeIds: string[];
  cutoff: Date;
}

export async function refundOrphanedQueueBoundMediaCharges(
  client: PrismaClient,
  opts: OrphanQueueChargeRecoveryOptions
): Promise<OrphanQueueChargeRecoveryResult> {
  const policy = resolveOrphanQueueChargeRecoveryPolicy(opts);
  const candidates = await client.creditLedger.findMany({
    where: {
      delta: { lt: 0 },
      creditKey: { in: [...QUEUE_BOUND_MEDIA_CREDIT_KEYS] },
      refTable: { in: [...QUEUE_BOUND_MEDIA_REFERENCE_TABLES] },
      refId: { not: null },
      createdAt: { lte: policy.cutoff },
      chargedJob: { is: null },
      reversal: { is: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: policy.batchSize,
    select: {
      id: true,
      workspaceId: true,
      delta: true,
      reason: true,
      creditKey: true,
      refTable: true,
      refId: true,
      createdAt: true,
      chargedJob: { select: { id: true } },
      reversal: { select: { id: true } },
    },
  });

  let refunded = 0;
  let skipped = 0;
  let amount = 0;
  const chargeIds: string[] = [];

  for (const candidate of candidates) {
    if (!isOrphanQueueBoundMediaDebit(candidate, policy.cutoff)) {
      skipped += 1;
      continue;
    }

    const result = await client.$transaction(
      async tx => {
        await lockWorkspace(tx, candidate.workspaceId);
        if (!(await lockCreditLedgerRow(tx, candidate.id))) {
          return { refunded: false as const };
        }

        const locked = await tx.creditLedger.findFirst({
          where: {
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            delta: { lt: 0 },
            creditKey: { in: [...QUEUE_BOUND_MEDIA_CREDIT_KEYS] },
            refTable: { in: [...QUEUE_BOUND_MEDIA_REFERENCE_TABLES] },
            refId: { not: null },
            createdAt: { lte: policy.cutoff },
            chargedJob: { is: null },
            reversal: { is: null },
          },
          select: {
            id: true,
            delta: true,
            reason: true,
            creditKey: true,
            refTable: true,
            refId: true,
            createdAt: true,
            chargedJob: { select: { id: true } },
            reversal: { select: { id: true } },
          },
        });
        if (!locked || !isOrphanQueueBoundMediaDebit(locked, policy.cutoff)) {
          return { refunded: false as const };
        }

        return refundWorkspaceChargeInTransaction(
          tx,
          {
            workspaceId: candidate.workspaceId,
            chargeId: candidate.id,
            internalMode: opts.internalMode,
          },
          locked
        );
      },
      { maxWait: 10_000, timeout: 30_000 }
    );

    if (!result.refunded) {
      skipped += 1;
      continue;
    }
    refunded += 1;
    amount += result.amount;
    chargeIds.push(candidate.id);
  }

  return {
    considered: candidates.length,
    refunded,
    skipped,
    amount,
    chargeIds,
    cutoff: policy.cutoff,
  };
}
