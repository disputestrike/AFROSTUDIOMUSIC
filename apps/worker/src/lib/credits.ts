/**
 * Worker-side credit charge for autonomous jobs. It uses the same locked,
 * unit-aware service as HTTP requests so background work cannot bypass caps.
 */
import {
  chargeWorkspaceCredits,
  prisma,
  refundWorkspaceCharge,
} from "@afrohit/db";
import type { CreditKey } from "@afrohit/shared";

export async function debitCredits(opts: {
  workspaceId: string;
  key: CreditKey;
  multiplier?: number;
  planUnits?: number;
  reasonSuffix?: string;
  idempotencyKey: string;
}) {
  return chargeWorkspaceCredits(prisma, {
    ...opts,
    internalMode:
      (process.env.AUTH_MODE ?? "internal").toLowerCase() === "internal",
    enforceGenerationCap: process.env.ENFORCE_GENERATION_CAP !== "0",
    dailyCap: Number(process.env.MAX_DAILY_GENERATIONS ?? 100),
    monthlyCap: Number(process.env.MAX_MONTHLY_GENERATIONS ?? 2_000),
  });
}

export async function refundDebitedCredits(opts: {
  workspaceId: string;
  chargeId: string;
  refTable: string;
  refId: string;
}) {
  return refundWorkspaceCharge(prisma, {
    ...opts,
    internalMode:
      (process.env.AUTH_MODE ?? "internal").toLowerCase() === "internal",
  });
}
