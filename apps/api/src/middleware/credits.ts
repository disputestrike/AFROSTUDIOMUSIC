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
  // Oldest workspace THAT HOLDS SONGS — plain oldest failed live within the
  // hour: an empty dev-era workspace row can predate the real original studio
  // and steal the crown while the owner's catalog workspace pays retail. The
  // house is where the songs are.
  const oldest = await prisma.workspace.findFirst({
    where: { songs: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  houseWorkspaceId = oldest?.id ?? null;
  return houseWorkspaceId;
}

/**
 * SELF-DIAGNOSIS for the billing engine — every fact the owner needed tonight
 * while three detection rules failed invisibly. Caller-scoped booleans only;
 * never leaks emails or other workspaces' data.
 */
export async function billingDiagnosis(workspaceId: string, userEmail: string | null) {
  const houseId = await oldestWorkspaceId();
  const emails = [
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
    process.env.BOOTSTRAP_OWNER_EMAIL ?? "",
  ]
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  const [songCount, workspace] = await Promise.all([
    prisma.song.count({ where: { workspaceId } }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { createdAt: true, creditsCents: true, plan: true },
    }),
  ]);
  return {
    workspaceId,
    firstParty: await isFirstPartyBilling(workspaceId),
    billingEnforcement: billingEnforced() ? "on" : "off (beta)",
    rules: {
      envList: isFirstPartyWorkspace(workspaceId),
      isHouseWorkspace: workspaceId === houseId,
      houseWorkspaceKnown: houseId != null,
      emailIsMaster: userEmail != null && emails.includes(userEmail.toLowerCase()),
      masterEmailsConfigured: emails.length,
    },
    workspace: {
      songCount,
      createdAt: workspace?.createdAt ?? null,
      plan: workspace?.plan ?? null,
      creditsCents: workspace?.creditsCents ?? null,
    },
  };
}

export async function isFirstPartyBilling(workspaceId: string): Promise<boolean> {
  if (isFirstPartyWorkspace(workspaceId)) return true;
  if (workspaceId === (await oldestWorkspaceId())) return true;

  // BOOTSTRAP_OWNER_EMAIL is the email the operator provisioned their own
  // account with — the strongest possible "this is the master account"
  // signal, and it survives ADMIN_EMAILS typos/mismatches because the owner
  // LOGS IN with exactly this address.
  const adminEmails = [
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
    process.env.BOOTSTRAP_OWNER_EMAIL ?? "",
  ]
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
/**
 * PRE-LAUNCH BILLING VALVE. BILLING_ENFORCEMENT defaults to 'off' until the
 * operator flips it 'on' at launch: during beta the only real user is the
 * owner, and three successive first-party detection rules failed live while
 * they were locked out of their own product ("it's still not letting me
 * create anything"). Off = every charge runs internal-mode (no balance
 * debit, ledger still written): the house is uncapped; everyone else gets
 * the BETA daily cap so an abusive stranger cannot burn provider budget.
 * LAUNCH CHECKLIST: set BILLING_ENFORCEMENT=on.
 */
const billingEnforced = () => process.env.BILLING_ENFORCEMENT === "on";
const betaDailyCap = () => Number(process.env.BETA_DAILY_GENERATIONS ?? 25);
/** Hard per-day money ceiling for a beta workspace, in 1/100-cent units.
 *  Default $25 = 250000. Set BETA_DAILY_SPEND_CEILING to change; 0 disables. */
const betaDailyCostCeiling = () =>
  Number(process.env.BETA_DAILY_SPEND_CEILING ?? 250_000);

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
      if (!billingEnforced() && !firstParty) {
        return chargeWorkspaceCredits(prisma, {
          ...opts,
          internalMode: true,
          enforceGenerationCap: true,
          dailyCap: betaDailyCap(),
          monthlyCap: Number(process.env.BETA_MONTHLY_GENERATIONS ?? 300),
          // HARD MONEY CEILING (audit 2026-07-17): even inside the beta's free
          // operation cap, a stranger doing expensive video renders can rack
          // up real provider cost. Cap actual spend per beta workspace per day
          // — default ~$25 (250000 1/100-cent units), operator-tunable. The
          // house (first-party) path below never gets this ceiling.
          dailyCostCeiling: betaDailyCostCeiling(),
        });
      }
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
