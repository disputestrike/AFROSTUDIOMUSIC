import fp from "fastify-plugin";
import {
  chargeWorkspaceCredits,
  refundWorkspaceCharge,
  prisma,
} from "@afrohit/db";
import type { CreditKey } from "@afrohit/shared";
import { isInternalMode } from "./auth";

declare module "fastify" {
  interface FastifyInstance {
    chargeCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      planUnits?: number;
      refTable?: string;
      refId?: string;
      idempotencyKey?: string;
    }): ReturnType<typeof chargeWorkspaceCredits>;

    refundCredits(opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
      chargeId: string;
    }): ReturnType<typeof refundWorkspaceCharge>;
  }
}

/**
 * Atomically applies idempotency, generation caps, plan limits, and balance
 * changes under one workspace advisory lock.
 */
export const creditsPlugin = fp(async function (app) {
  app.decorate(
    "chargeCredits",
    async (opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      planUnits?: number;
      refTable?: string;
      refId?: string;
      idempotencyKey?: string;
    }) =>
      chargeWorkspaceCredits(prisma, {
        ...opts,
        internalMode: isInternalMode(),
        enforceGenerationCap: process.env.ENFORCE_GENERATION_CAP !== "0",
        dailyCap: Number(process.env.MAX_DAILY_GENERATIONS ?? 100),
        monthlyCap: Number(process.env.MAX_MONTHLY_GENERATIONS ?? 2_000),
      })
  );

  app.decorate(
    "refundCredits",
    async (opts: {
      workspaceId: string;
      key: CreditKey;
      multiplier?: number;
      refTable?: string;
      refId?: string;
      chargeId: string;
    }) =>
      refundWorkspaceCharge(prisma, {
        workspaceId: opts.workspaceId,
        chargeId: opts.chargeId,
        internalMode: isInternalMode(),
        refTable: opts.refTable,
        refId: opts.refId,
      })
  );
});