import fp from "fastify-plugin";
import {
  chargeWorkspaceCredits,
  refundWorkspaceCharge,
  prisma,
} from "@afrohit/db";
import type { CreditKey } from "@afrohit/shared";
import { isFirstPartyWorkspace } from "@afrohit/shared";
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
 * THE HOUSE DOES NOT BILL ITSELF. When AUTH_MODE=jwt replaced internal mode,
 * every workspace — including the operator's own — started debiting real
 * credits, and the owner hit a 402 wall in their own studio mid-testing
 * (live incident, 2026-07-16). First-party workspaces charge like internal
 * mode did: no balance debit, ledger rows still written for accounting, and
 * generation caps read from FIRST_PARTY_MAX_DAILY/MONTHLY_GENERATIONS
 * (default 0 = uncapped — it is the operator's own provider budget).
 *
 * First-party = FIRST_PARTY_WORKSPACE_IDS (the shared env contract the worker
 * also uses for engine routing) OR a workspace whose OWNER is on
 * ADMIN_EMAILS — the zero-configuration path, since the operator's admin
 * identity is already declared. The DB lookup is cached for five minutes;
 * paying customers never take it (the env check short-circuits first, and a
 * cache miss is one indexed query per workspace per window).
 */
const FIRST_PARTY_CACHE_MS = 5 * 60 * 1000;
const firstPartyCache = new Map<string, { value: boolean; at: number }>();

/**
 * THE ORIGINAL STUDIO IS THE HOUSE — unconditionally. The admin-email rule
 * shipped first and immediately failed live (2026-07-16): the owner operates
 * under two emails, and whether ADMIN_EMAILS held the one they logged in with
 * was unknowable from outside. A first-party rule that depends on
 * configuration matching is a rule that fails at 2 AM. The OLDEST workspace
 * is the internal-mode-era original — the owner's entire catalog lives there,
 * every public signup creates a NEW workspace, so this can never leak to a
 * customer, and it needs zero configuration. Its id is immutable, cached
 * forever after first read.
 */
let houseWorkspaceId: string | null | undefined;
async function oldestWorkspaceId(): Promise<string | null> {
  if (houseWorkspaceId !== undefined) return houseWorkspaceId;
  const oldest = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  houseWorkspaceId = oldest?.id ?? null;
  return houseWorkspaceId;
}

export async function isFirstPartyBilling(workspaceId: string): Promise<boolean> {
  if (isFirstPartyWorkspace(workspaceId)) return true;
  if (workspaceId === (await oldestWorkspaceId())) return true;

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.length) return false;

  const cached = firstPartyCache.get(workspaceId);
  if (cached && Date.now() - cached.at < FIRST_PARTY_CACHE_MS) {
    return cached.value;
  }
  const owner = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId,
      role: "OWNER",
      user: { email: { in: adminEmails } },
    },
    select: { id: true },
  });
  const value = Boolean(owner);
  firstPartyCache.set(workspaceId, { value, at: Date.now() });
  return value;
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
    }) => {
      const firstParty = await isFirstPartyBilling(opts.workspaceId);
      if (firstParty) {
        return chargeWorkspaceCredits(prisma, {
          ...opts,
          internalMode: true,
          enforceGenerationCap: process.env.ENFORCE_GENERATION_CAP !== "0",
          dailyCap: Number(process.env.FIRST_PARTY_MAX_DAILY_GENERATIONS ?? 0),
          monthlyCap: Number(
            process.env.FIRST_PARTY_MAX_MONTHLY_GENERATIONS ?? 0
          ),
        });
      }
      return chargeWorkspaceCredits(prisma, {
        ...opts,
        internalMode: isInternalMode(),
        enforceGenerationCap: process.env.ENFORCE_GENERATION_CAP !== "0",
        dailyCap: Number(process.env.MAX_DAILY_GENERATIONS ?? 100),
        monthlyCap: Number(process.env.MAX_MONTHLY_GENERATIONS ?? 2_000),
      });
    }
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
    }) => {
      const firstParty = await isFirstPartyBilling(opts.workspaceId);
      return refundWorkspaceCharge(prisma, {
        workspaceId: opts.workspaceId,
        chargeId: opts.chargeId,
        internalMode: firstParty || isInternalMode(),
        refTable: opts.refTable,
        refId: opts.refId,
      });
    }
  );
});
