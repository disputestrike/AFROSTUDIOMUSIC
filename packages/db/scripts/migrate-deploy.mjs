import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "prisma", "migrations");
const prismaCli = createRequire(import.meta.url).resolve("prisma");
const baselineKey = "database.migrationBaseline.v1";
const lockId = 2_026_071_306_000;

/**
 * THE BASELINE ANCHOR — why a vendored schema exists.
 *
 * Production predates the migrations directory: it was maintained by
 * `db push` until 4cc3d10 (Jul 14), the commit that both AUTHORED the whole
 * migration history and switched preDeploy to this script. Its baseline
 * `db push` of the CURRENT schema then failed on Prisma's unique-constraint
 * data-loss warnings, freezing every deploy since.
 *
 * The original design pushed the current schema and marked EVERY migration
 * applied without executing it. That is correct for schema (push built it) and
 * silently, permanently wrong for everything schema.prisma cannot express:
 * 20260715143000's billing-history backfills, 20260715190000's identifier
 * canonicalization + conflict ledger + revision seeding + 7 functions +
 * 6 triggers (the DB-side enforcement of release immutability and
 * never-lose-a-song), and 20260715200000's lyric backfill. None of those would
 * ever have run on production, with no error to reveal it.
 *
 * So the baseline now anchors to the BOUNDARY, not the tip:
 *
 *   1. Push prisma/baseline/schema-4cc3d10.prisma — the schema at the exact
 *      commit the migration history was authored to describe. This bridges
 *      production's unknown drift (its last successful push is some commit in
 *      the Jul 13–14 window) to a KNOWN state. Verified purely additive: a
 *      set-level diff of (model, scalar column) pairs between every window
 *      state and the vendored schema shows nothing dropped, so this push
 *      cannot destroy data. --accept-data-loss only waives the warnings for
 *      the unique constraints deduplicated below.
 *   2. Mark ONLY the migrations up to that boundary (<= 20260713072000) as
 *      applied — those are the ones whose schema the push just materialized.
 *   3. Let `prisma migrate deploy` EXECUTE everything after the boundary
 *      exactly as authored and exactly as CI runs it from an empty database:
 *      triggers, functions, backfills, conflict recording, lyric backfill.
 *   4. Run the legacy data fixups (reclassifications for rows that predate the
 *      provenance columns), then mark the baseline complete.
 *
 * Interruption at any point resumes: the marker is written only after the
 * push; resolve and the fixups are idempotent; migrate deploy keeps its own
 * bookkeeping (a failed migration is loud and requires an explicit resolve,
 * never silent skipping).
 */
const BASELINE_BOUNDARY = "20260713072000_credit_usage_units";
const baselineSchemaPath = resolve(
  packageRoot,
  "prisma",
  "baseline",
  "schema-4cc3d10.prisma"
);

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

/**
 * Duplicate resolution for the unique constraints the VENDORED push adds.
 *
 * Prisma's --accept-data-loss waives the warning, but Postgres still fails the
 * constraint if duplicate values actually exist. Only constraints introduced by
 * the vendored schema need this — everything later (Song.isrc/upc,
 * Release.upc) is created by migration 20260715190000, which handles its own
 * duplicates CANONICALLY: canonicalize, record every displaced value in
 * ReleaseIdentifierConflict, retain the oldest. Nothing here may shadow that.
 *
 * Dedup doctrine: NEVER delete a row. The OLDEST row keeps the value — it is
 * the original owner of an identifier or link, and the row other tables'
 * usage rows are most likely to reference — and later duplicates have the
 * column cleared (Postgres unique treats NULLs as distinct). Two exceptions:
 *   - Export keeps the NEWEST fingerprint: the freshest export is the current
 *     release package; an older duplicate losing its fingerprint just marks a
 *     stale bundle as stale.
 *   - VoiceDataset.contentHash is NOT NULL, so clearing is impossible; later
 *     duplicates get the hash suffixed with ':dup:<id>' — still unique, row
 *     preserved, original hash visibly embedded for forensics.
 *
 * Residual risk, accepted and documented: a ProviderJob whose chargeLedgerId
 * was cleared could, if it later fails, refund via its legacy inputJson charge
 * marker while the retained job also refunds — but two jobs sharing one charge
 * is already an anomaly the unique constraint exists to end, and refunds are
 * idempotency-guarded upstream.
 */
const BASELINE_UNIQUE_DEDUP = [
  { table: "VoiceDataset", column: "contentHash", partitionBy: ["workspaceId", "contentHash"], strategy: "suffix", keep: "oldest" },
  { table: "MaterialAsset", column: "contentHash", partitionBy: ["workspaceId", "contentHash"], strategy: "null", keep: "oldest" },
  { table: "SoundReference", column: "contentHash", partitionBy: ["workspaceId", "contentHash"], strategy: "null", keep: "oldest" },
  { table: "Export", column: "sourceFingerprint", partitionBy: ["songId", "sourceFingerprint"], strategy: "null", keep: "newest" },
  { table: "Release", column: "isrc", partitionBy: ["isrc"], strategy: "null", keep: "oldest" },
  { table: "Release", column: "externalId", partitionBy: ["externalId"], strategy: "null", keep: "oldest" },
  { table: "ProviderJob", column: "chargeLedgerId", partitionBy: ["chargeLedgerId"], strategy: "null", keep: "oldest" },
  { table: "ProviderJob", column: "idempotencyKey", partitionBy: ["workspaceId", "kind", "idempotencyKey"], strategy: "null", keep: "oldest" },
  { table: "CreditLedger", column: "reversalOfId", partitionBy: ["reversalOfId"], strategy: "null", keep: "oldest" },
  { table: "CreditLedger", column: "idempotencyKey", partitionBy: ["workspaceId", "idempotencyKey"], strategy: "null", keep: "oldest" },
];

async function dedupeForBaselineUniqueConstraints(prisma) {
  for (const target of BASELINE_UNIQUE_DEDUP) {
    const columns = [
      ...new Set([...target.partitionBy, target.column, "createdAt"]),
    ];
    const partition = target.partitionBy.map(col => `"${col}"`).join(", ");
    const notNull = target.partitionBy
      .map(col => `"${col}" IS NOT NULL`)
      .join(" AND ");
    const order = target.keep === "newest" ? "DESC" : "ASC";
    const assignment =
      target.strategy === "suffix"
        ? `"${target.column}" = "${target.column}" || ':dup:' || "id"`
        : `"${target.column}" = NULL`;
    // Guarded on column existence: production sits at an unknown commit in the
    // Jul 13-14 window, so any of these columns may not exist yet. Absent
    // column (or absent table) makes this a no-op instead of an error.
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF (
          SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = '${target.table}'
            AND column_name IN (${columns.map(col => `'${col}'`).join(", ")})
        ) = ${columns.length}
        THEN
          UPDATE "${target.table}" SET ${assignment}
          WHERE "id" IN (
            SELECT "id" FROM (
              SELECT "id",
                     ROW_NUMBER() OVER (
                       PARTITION BY ${partition}
                       ORDER BY "createdAt" ${order}, "id" ${order}
                     ) AS rn
              FROM "${target.table}"
              WHERE ${notNull}
            ) ranked
            WHERE ranked.rn > 1
          );
        END IF;
      END $$;
    `);
  }
}

/**
 * PHASE 1 — anchor the legacy database to the baseline boundary.
 * Lock, sanity-check, dedupe, push the vendored schema, set the marker.
 */
async function reconcileLegacyDatabase(prisma) {
  if (!existsSync(baselineSchemaPath)) {
    throw new Error(
      `baseline schema missing at ${baselineSchemaPath} — it is vendored in the repo and required to anchor a legacy database`
    );
  }
  await prisma.$transaction(
    async tx => {
      await tx.$queryRawUnsafe(
        `SELECT 1::int AS locked FROM pg_advisory_xact_lock(${lockId})`
      );

      // A concurrent deploy may have advanced the baseline while this one
      // waited on the lock.
      const state = await baselineState(tx);
      if (state === "resolving" || state === "complete") return;
      if (state !== null) {
        throw new Error(`Unknown migration baseline state: ${state}`);
      }

      // SENTINELS — this path must only ever run against the frozen legacy
      // database it was written for. CreditLedger is ancient and must exist;
      // BillingSubscription is created by post-boundary migration
      // 20260715143000, so its presence means the database is already beyond
      // the boundary and anchoring it again could corrupt it. Abort loudly and
      // leave everything untouched.
      if (!(await relationExists(prisma, "CreditLedger"))) {
        throw new Error(
          "legacy baseline sanity check failed: CreditLedger does not exist — this does not look like the production database this baseline was written for. Refusing to touch it."
        );
      }
      if (await relationExists(prisma, "BillingSubscription")) {
        throw new Error(
          "legacy baseline sanity check failed: BillingSubscription already exists, so post-boundary migrations have already run here. Set the baseline marker manually after verifying state; refusing to re-anchor."
        );
      }

      // Duplicate resolution runs on the OUTER client, not tx: each statement
      // autocommits, because `db push` below is a CHILD PROCESS on its own
      // connection and would never see rows updated inside this still-open
      // transaction. The advisory lock (held by tx) serializes concurrent
      // deploys around the whole phase.
      await dedupeForBaselineUniqueConstraints(prisma);

      // Anchor to the boundary schema (see header). --accept-data-loss waives
      // only the unique-constraint warnings — the vendored diff is proven
      // additive, and duplicates were just resolved above.
      runPrisma([
        "db",
        "push",
        "--skip-generate",
        "--accept-data-loss",
        "--schema",
        baselineSchemaPath,
      ]);

      // Marker written ONLY after the push succeeded: a resume at 'resolving'
      // may safely assume the boundary schema is in place.
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

/**
 * Mark ONLY the boundary migrations (<= 20260713072000) as applied — the ones
 * whose schema the vendored push just materialized. Everything after the
 * boundary is deliberately left unresolved so `prisma migrate deploy` EXECUTES
 * it. This is the fix for the original design's silent gap: resolve-without-
 * execute is only ever legitimate for schema the push actually built.
 *
 * Idempotent: already-recorded migrations are skipped. If two deploys race
 * here despite the phase-1 lock, `migrate resolve` fails loudly on the loser
 * and the next push retries cleanly.
 */
async function resolveBaselineMigrations(prisma) {
  const names = (await listMigrationNames()).filter(
    name => name <= BASELINE_BOUNDARY
  );
  let applied = await appliedMigrations(prisma);
  for (const migration of names) {
    if (applied.has(migration)) continue;
    runPrisma(["migrate", "resolve", "--applied", migration]);
    applied = await appliedMigrations(prisma);
    if (!applied.has(migration)) {
      throw new Error(`Prisma did not record resolved migration ${migration}`);
    }
  }
}

/**
 * PHASE 2 — legacy data fixups, then mark the baseline complete.
 *
 * These reclassify rows that predate the provenance/lifecycle columns; they
 * assume the CURRENT schema, so they run after `migrate deploy`. Every
 * statement is idempotent (guarded by "only rows still in the legacy state"
 * predicates), and the whole phase is one transaction with the marker write,
 * so an interruption resumes cleanly.
 *
 * Note: the Release triggers created by 20260715190000 are live by the time
 * these UPDATEs run, so legacy releases gain revision snapshots as a side
 * effect — which is correct: their pre-fixup state is preserved as history.
 */
async function legacyDataFixups(prisma) {
  await prisma.$transaction(
    async tx => {
      await tx.$queryRawUnsafe(
        `SELECT 1::int AS locked FROM pg_advisory_xact_lock(${lockId})`
      );

      const state = await baselineState(tx);
      if (state === "complete") return;
      if (state !== "resolving") {
        throw new Error(
          `Cannot run legacy data fixups from baseline state: ${state ?? "missing"}`
        );
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

      await tx.systemSetting.update({
        where: { key: baselineKey },
        data: { value: "complete" },
      });
    },
    { maxWait: 30_000, timeout: 1_800_000 }
  );
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
        "Legacy db-push database detected; anchoring it to the migration baseline."
      );
      await reconcileLegacyDatabase(prisma);
    } else {
      console.log("Resuming an interrupted migration baseline.");
    }

    // Boundary migrations are recorded as applied (their schema came from the
    // vendored push); everything AFTER the boundary now genuinely EXECUTES.
    await resolveBaselineMigrations(prisma);
    runPrisma(["migrate", "deploy"]);
    await legacyDataFixups(prisma);
    await prisma.$disconnect();
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
