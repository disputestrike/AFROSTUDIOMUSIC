import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "prisma", "migrations");
const prismaCli = createRequire(import.meta.url).resolve("prisma");
const baselineKey = "database.migrationBaseline.v1";
const lockId = 2_026_071_306_000;

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `prisma ${args.join(" ")} exited with status ${result.status ?? "unknown"}`
    );
  }
}

async function relationExists(prisma, relation) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."${relation}"')::text AS name`
  );
  return Boolean(rows[0]?.name);
}

async function appliedMigrations(prisma) {
  if (!(await relationExists(prisma, "_prisma_migrations"))) return new Set();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
  );
  return new Set(rows.map(row => row.migration_name));
}

async function baselineState(prisma) {
  if (!(await relationExists(prisma, "SystemSetting"))) return null;
  const rows = await prisma.$queryRawUnsafe(
    'SELECT value FROM "SystemSetting" WHERE key = $1 LIMIT 1',
    baselineKey
  );
  return rows[0]?.value ?? null;
}

async function reconcileLegacyDatabase(prisma) {
  await prisma.$transaction(
    async tx => {
      await tx.$queryRawUnsafe(
        `SELECT 1::int AS locked FROM pg_advisory_xact_lock(${lockId})`
      );

      // The lock is held before schema reconciliation so concurrent deploys
      // cannot race through the one-time db-push transition.
      runPrisma(["db", "push", "--skip-generate"]);

      const state = await baselineState(tx);
      if (state === "resolving" || state === "complete") return;
      if (state !== null) {
        throw new Error(`Unknown migration baseline state: ${state}`);
      }

      await tx.$executeRawUnsafe(
        'UPDATE "VoiceConsent" SET "ipAddress" = NULL WHERE "ipAddress" IS NOT NULL'
      );
      await tx.$executeRawUnsafe(`
        UPDATE "BillingEvent"
        SET "processingAt" = "createdAt"
        WHERE "status" = 'processing' AND "processingAt" IS NULL
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "MaterialAsset"
        SET
          "rightsBasis" = CASE
            WHEN "rightsBasis" <> 'unknown' THEN "rightsBasis"
            WHEN "source" = 'artist_stem' THEN 'user-attested'
            WHEN "source" = 'provider_stem' THEN 'provider-generated'
            WHEN "source" = 'licensed' THEN 'licensed'
            WHEN "source" = 'forged' AND COALESCE("meta"->>'synth', 'false') = 'true' THEN 'code-generated'
            WHEN "source" = 'forged' THEN 'provider-generated'
            ELSE 'unknown'
          END,
          "roleEvidence" = CASE
            WHEN "roleEvidence" <> 'unknown' THEN "roleEvidence"
            WHEN "source" IN ('artist_stem', 'provider_stem') THEN 'stem-separated'
            WHEN "source" = 'forged' AND COALESCE("meta"->>'synth', 'false') = 'true' THEN 'synth-code'
            WHEN "source" = 'forged' THEN 'provider-prompted'
            ELSE 'unknown'
          END,
          "qualityState" = CASE
            WHEN "qualityState" <> 'unmeasured' THEN "qualityState"
            WHEN COALESCE("meta"->'qc'->>'verdict', '') IN ('pass', 'weak') THEN 'passed'
            WHEN COALESCE("meta"->'qc'->>'verdict', '') = 'fail' THEN 'failed'
            ELSE 'unmeasured'
          END,
          "readiness" = CASE
            WHEN "readiness" <> 'pending' THEN "readiness"
            WHEN COALESCE("meta"->'qc'->>'verdict', '') IN ('pass', 'weak') THEN 'ready'
            WHEN COALESCE("meta"->'qc'->>'verdict', '') = 'fail' THEN 'rejected'
            ELSE 'pending'
          END,
          "verifiedAt" = CASE
            WHEN "verifiedAt" IS NOT NULL THEN "verifiedAt"
            WHEN COALESCE("meta"->'qc'->>'verdict', '') <> '' THEN "createdAt"
            ELSE NULL
          END
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "SoundReference"
        SET
          "analysisState" = CASE
            WHEN "analysisState" <> 'pending' THEN "analysisState"
            WHEN COALESCE("recipe"->'measured'->>'engineOk', 'false') = 'true' THEN 'measured'
            WHEN "summary" IS NOT NULL OR COALESCE("recipe"->>'source', '') <> '' THEN 'inferred'
            ELSE 'pending'
          END,
          "rightsBasis" = CASE
            WHEN "rightsBasis" <> 'unknown' THEN "rightsBasis"
            WHEN COALESCE("recipe"->>'source', '') = 'generated' THEN 'self-generated'
            WHEN "sourceUrl" LIKE 'facts:%' OR "sourceUrl" LIKE 'zap:%' OR "sourceUrl" LIKE 'trend:%' THEN 'facts-only'
            WHEN COALESCE("recipe"->>'source', '') IN (
              'beat-upload', 'beat-import', 'song-import', 'song-import-training',
              'finished-upload', 'learn-backfill', 'rights-confirmed-reference'
            ) THEN 'user-attested'
            ELSE 'unknown'
          END
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "BeatAsset" AS beat
        SET "assetKind" = 'full_mix', "approved" = false
        WHERE beat."songId" IS NOT NULL
          AND beat."assetKind" = 'instrumental'
          AND beat."qualityState" = 'unmeasured'
          AND beat."contentHash" IS NULL
          AND beat."verifiedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "Master" AS master WHERE master."songId" = beat."songId"
          )
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "VocalRender"
        SET
          "assetKind" = CASE
            WHEN "meta"->>'fullRemix' = 'true' THEN 'full_mix'
            WHEN "meta"->>'spokenGuideNotSung' = 'true' THEN 'spoken_guide'
            ELSE "assetKind"
          END,
          "performanceSource" = CASE
            WHEN "performanceSource" <> 'unknown' THEN "performanceSource"
            WHEN "meta"->>'fullRemix' = 'true' THEN 'voice_conversion'
            WHEN "meta"->>'spokenGuideNotSung' = 'true' THEN 'tts_guide'
            WHEN "meta"->>'uploaded' = 'true' THEN 'artist_upload'
            WHEN "meta"->>'imported' = 'true' THEN 'artist_import'
            ELSE 'unknown'
          END
        WHERE "qualityState" = 'unmeasured'
          AND "contentHash" IS NULL
          AND "verifiedAt" IS NULL
      `);
      await tx.$executeRawUnsafe(
        `UPDATE "VocalRender" SET "approved" = false WHERE "assetKind" <> 'isolated_vocal'`
      );
      await tx.$executeRawUnsafe(`
        UPDATE "Master"
        SET
          "qualityState" = CASE
            WHEN "qualityState" <> 'unmeasured' THEN "qualityState"
            WHEN "meta"->'qc'->>'verdict' IN ('pass', 'weak') THEN 'passed'
            WHEN "meta"->'qc'->>'verdict' = 'fail' THEN 'failed'
            ELSE 'unmeasured'
          END,
          "contentHash" = COALESCE("contentHash", NULLIF("meta"->>'contentHash', '')),
          "verifiedAt" = COALESCE(
            "verifiedAt",
            CASE
              WHEN "meta"->>'verifiedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                THEN ("meta"->>'verifiedAt')::timestamptz
              ELSE NULL
            END
          )
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "Export"
        SET "qualityState" = 'legacy_reference_only'
        WHERE "archiveUrl" IS NULL AND "qualityState" = 'pending'
      `);

      await tx.$executeRawUnsafe(`
        UPDATE "Release"
        SET
          "status" = 'legacy_unverified',
          "submittedAt" = COALESCE("submittedAt", "createdAt")
        WHERE "status" = 'released'
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "Song" AS song
        SET "status" = 'EXPORTED'
        FROM "Release" AS release
        WHERE release."songId" = song."id"
          AND release."status" = 'legacy_unverified'
          AND song."status" = 'RELEASED'
      `);

      await tx.$executeRawUnsafe(`
        UPDATE "CreditLedger"
        SET "creditKey" = CASE
          WHEN "reason" LIKE 'hooks_batch_20%' THEN 'hooks_batch_20'
          WHEN "reason" LIKE 'lyrics_full%' THEN 'lyrics_full'
          WHEN "reason" LIKE 'taste_score_batch_50%' THEN 'taste_score_batch_50'
          WHEN "reason" LIKE 'brief_polish%' THEN 'brief_polish'
          WHEN "reason" LIKE 'cover_art_low%' THEN 'cover_art_low'
          WHEN "reason" LIKE 'cover_art_high%' THEN 'cover_art_high'
          WHEN "reason" LIKE 'beat_idea_short_30s%' THEN 'beat_idea_short_30s'
          WHEN "reason" LIKE 'full_song_demo%' THEN 'full_song_demo'
          WHEN "reason" LIKE 'stems_export%' THEN 'stems_export'
          WHEN "reason" LIKE 'analyze_audio%' THEN 'analyze_audio'
          WHEN "reason" LIKE 'hit_predict%' THEN 'hit_predict'
          WHEN "reason" LIKE 'voice_render_30s%' THEN 'voice_render_30s'
          WHEN "reason" LIKE 'voice_render_full%' THEN 'voice_render_full'
          WHEN "reason" LIKE 'voice_profile_setup%' THEN 'voice_profile_setup'
          WHEN "reason" LIKE 'voice_clone_training%' THEN 'voice_clone_training'
          WHEN "reason" LIKE 'voice_sing_render%' THEN 'voice_sing_render'
          WHEN "reason" LIKE 'mix_preset%' THEN 'mix_preset'
          WHEN "reason" LIKE 'master_preset%' THEN 'master_preset'
          WHEN "reason" LIKE 'video_8s%' THEN 'video_8s'
          WHEN "reason" LIKE 'video_20s%' THEN 'video_20s'
          WHEN "reason" LIKE 'release_export%' THEN 'release_export'
          ELSE "creditKey"
        END
        WHERE "creditKey" IS NULL AND "delta" < 0
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "CreditLedger"
        SET "units" = CASE "creditKey"
          WHEN 'hooks_batch_20' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 1500)::integer)
          WHEN 'lyrics_full' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
          WHEN 'taste_score_batch_50' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 2000)::integer)
          WHEN 'brief_polish' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 500)::integer)
          WHEN 'cover_art_low' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
          WHEN 'cover_art_high' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 25000)::integer)
          WHEN 'beat_idea_short_30s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 25000)::integer)
          WHEN 'full_song_demo' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 75000)::integer)
          WHEN 'stems_export' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 50000)::integer)
          WHEN 'analyze_audio' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 5000)::integer)
          WHEN 'hit_predict' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
          WHEN 'voice_render_30s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 30000)::integer)
          WHEN 'voice_render_full' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 80000)::integer)
          WHEN 'voice_profile_setup' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 200000)::integer)
          WHEN 'voice_clone_training' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 50000)::integer)
          WHEN 'voice_sing_render' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 15000)::integer)
          WHEN 'mix_preset' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 10000)::integer)
          WHEN 'master_preset' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 15000)::integer)
          WHEN 'video_8s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 100000)::integer)
          WHEN 'video_20s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 250000)::integer)
          WHEN 'release_export' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 5000)::integer)
          ELSE "units"
        END
        WHERE "delta" < 0
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "CreditLedger"
        SET "planUnits" = CASE
          WHEN "creditKey" = 'video_8s' THEN "units" * 8
          WHEN "creditKey" = 'video_20s' THEN "units" * 20
          ELSE "units"
        END
        WHERE "delta" < 0
      `);
      await tx.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'CreditLedger_units_check'
          ) THEN
            ALTER TABLE "CreditLedger"
              ADD CONSTRAINT "CreditLedger_units_check"
              CHECK ("units" >= 0);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'CreditLedger_planUnits_check'
          ) THEN
            ALTER TABLE "CreditLedger"
              ADD CONSTRAINT "CreditLedger_planUnits_check"
              CHECK ("planUnits" >= 0);
          END IF;
        END $$
      `);

      // Prisma schema push does not preserve SQL CHECK constraints.
      await tx.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'BenchmarkPair_referenceSizeBytes_check'
          ) THEN
            ALTER TABLE "BenchmarkPair"
              ADD CONSTRAINT "BenchmarkPair_referenceSizeBytes_check"
              CHECK ("referenceSizeBytes" >= 1000);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'BenchmarkJudgment_winner_check'
          ) THEN
            ALTER TABLE "BenchmarkJudgment"
              ADD CONSTRAINT "BenchmarkJudgment_winner_check"
              CHECK ("winner" IN ('afrohit', 'competitor', 'tie'));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'BenchmarkJudgment_confidence_check'
          ) THEN
            ALTER TABLE "BenchmarkJudgment"
              ADD CONSTRAINT "BenchmarkJudgment_confidence_check"
              CHECK ("confidence" BETWEEN 1 AND 5);
          END IF;
        END $$
      `);

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
          VALUES ($1, 'resolving', CURRENT_TIMESTAMP)
          ON CONFLICT ("key") DO UPDATE
          SET "value" = 'resolving', "updatedAt" = CURRENT_TIMESTAMP
        `,
        baselineKey
      );
    },
    { maxWait: 30_000, timeout: 900_000 }
  );
}

async function listMigrationNames() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function finishBaseline(prisma) {
  const observer = new PrismaClient();
  try {
    await prisma.$transaction(
      async tx => {
        await tx.$queryRawUnsafe(
          `SELECT 1::int AS locked FROM pg_advisory_xact_lock(${lockId})`
        );

        const state = await baselineState(tx);
        if (state !== "resolving" && state !== "complete") {
          throw new Error(
            `Cannot resolve migration baseline from state: ${state ?? "missing"}`
          );
        }

        const migrationNames = await listMigrationNames();
        let applied = await appliedMigrations(observer);
        const missing = migrationNames.filter(
          migration => !applied.has(migration)
        );

        if (state === "complete" && missing.length > 0) {
          throw new Error(
            `Migration baseline is marked complete but is missing: ${missing.join(", ")}`
          );
        }

        for (const migration of missing) {
          runPrisma(["migrate", "resolve", "--applied", migration]);
          applied = await appliedMigrations(observer);
          if (!applied.has(migration)) {
            throw new Error(
              `Prisma did not record resolved migration ${migration}`
            );
          }
        }

        await tx.systemSetting.update({
          where: { key: baselineKey },
          data: { value: "complete" },
        });
      },
      { maxWait: 30_000, timeout: 1_800_000 }
    );
  } finally {
    await observer.$disconnect();
  }
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const prisma = new PrismaClient();
  try {
    const hasWorkspace = await relationExists(prisma, "Workspace");
    if (!hasWorkspace) {
      console.log("Empty database detected; applying Prisma migrations.");
      await prisma.$disconnect();
      runPrisma(["migrate", "deploy"]);
      return;
    }

    const state = await baselineState(prisma);
    const applied = await appliedMigrations(prisma);
    const isBaseline = state === "resolving" || state === "complete";

    if (state === "complete") {
      console.log(
        "Migration baseline is complete; applying migrations added after the baseline."
      );
      await prisma.$disconnect();
      runPrisma(["migrate", "deploy"]);
      return;
    }

    if (applied.size > 0 && !isBaseline) {
      console.log(
        "Migration history detected; applying pending Prisma migrations."
      );
      await prisma.$disconnect();
      runPrisma(["migrate", "deploy"]);
      return;
    }

    if (!isBaseline) {
      console.log(
        "Legacy db-push database detected; creating a one-time migration baseline."
      );
      await reconcileLegacyDatabase(prisma);
    } else if (state === "resolving") {
      console.log("Resuming an interrupted migration baseline.");
    }

    await finishBaseline(prisma);
    await prisma.$disconnect();
    runPrisma(["migrate", "deploy"]);
    console.log(
      "Migration baseline complete; future deploys use Prisma migrate deploy."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
