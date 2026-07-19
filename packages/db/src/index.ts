import { PrismaClient, Prisma } from "@prisma/client";
import { isSealedSecret, sealSecret } from "./secrets";

export * from "./secrets";
export * from "./release-certification";
export * from "./credit-charge";

declare global {
  var __afrohit_prisma: PrismaClient | undefined;
}

export const prisma =
  global.__afrohit_prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["query", "error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__afrohit_prisma = prisma;
}

export { Prisma };
export * from "@prisma/client";

/** Encrypt legacy plaintext integration keys without overwriting concurrent edits. */
export async function migratePlaintextWorkspaceSecrets(): Promise<number> {
  const rows = await prisma.workspace.findMany({
    where: { musicApiKey: { not: null } },
    select: { id: true, musicApiKey: true },
  });
  let migrated = 0;
  for (const row of rows) {
    if (!row.musicApiKey || isSealedSecret(row.musicApiKey)) continue;
    const result = await prisma.workspace.updateMany({
      where: { id: row.id, musicApiKey: row.musicApiKey },
      data: { musicApiKey: sealSecret(row.musicApiKey) },
    });
    migrated += result.count;
  }
  return migrated;
}

/**
 * AUTONOMY FLAGS — live operator on/off for the money-spending background jobs,
 * toggled from /admin (no redeploy). Jobs are OFF until explicitly enabled.
 * Database failures also fail closed so an outage cannot trigger unbudgeted
 * provider calls. Cached 30s so a cron loop doesn't hammer the DB.
 */
export type AutonomyJob =
  | "morning_drop"
  | "zap_radar"
  | "nightly_compound"
  | "will_it_blow";
const _flagCache = new Map<string, { on: boolean; at: number }>();
export async function isAutonomyEnabled(job: AutonomyJob): Promise<boolean> {
  const key = `autonomy.${job}`;
  const cached = _flagCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < 30_000) return cached.on;
  let on = false;
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    on = row?.value === "on";
  } catch {
    on = false;
  }
  _flagCache.set(key, { on, at: now });
  return on;
}
export async function setAutonomyEnabled(
  job: AutonomyJob,
  enabled: boolean
): Promise<void> {
  const key = `autonomy.${job}`;
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: enabled ? "on" : "off" },
    update: { value: enabled ? "on" : "off" },
  });
  _flagCache.set(key, { on: enabled, at: Date.now() });
}
/**
 * OUTSIDE-RENDER LEARNING (owner order 2026-07-19: "our engine has to learn —
 * slacken the no-outside rule, I need to turn it on and off"). Admits
 * third-party-engine renders (MiniMax/Suno/ACE-step/...) as training fuel when
 * ON. Ships OFF; DB failure fails CLOSED (the protective default). Flipping it
 * is the operator accepting the ToS risk — every flip is audit-logged by the
 * admin route, and manifests keep the third-party-render provenance label so
 * what trained the weights stays provable. A later OFF stops new fuel but
 * cannot make a model unlearn.
 */
const OUTSIDE_LEARNING_KEY = "training.allowThirdParty.v1";
export async function isOutsideRenderLearningEnabled(): Promise<boolean> {
  const cached = _flagCache.get(OUTSIDE_LEARNING_KEY);
  const now = Date.now();
  if (cached && now - cached.at < 30_000) return cached.on;
  let on = false;
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: OUTSIDE_LEARNING_KEY } });
    on = row?.value === "on";
  } catch {
    on = false;
  }
  _flagCache.set(OUTSIDE_LEARNING_KEY, { on, at: now });
  return on;
}
export async function setOutsideRenderLearning(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: OUTSIDE_LEARNING_KEY },
    create: { key: OUTSIDE_LEARNING_KEY, value: enabled ? "on" : "off" },
    update: { value: enabled ? "on" : "off" },
  });
  _flagCache.set(OUTSIDE_LEARNING_KEY, { on: enabled, at: Date.now() });
}

export async function allAutonomyFlags(): Promise<
  Record<AutonomyJob, boolean>
> {
  const jobs: AutonomyJob[] = [
    "morning_drop",
    "zap_radar",
    "nightly_compound",
    "will_it_blow",
  ];
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: jobs.map(j => `autonomy.${j}`) } },
  });
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  return Object.fromEntries(
    jobs.map(j => [j, byKey.get(`autonomy.${j}`) === "on"])
  ) as Record<AutonomyJob, boolean>;
}
