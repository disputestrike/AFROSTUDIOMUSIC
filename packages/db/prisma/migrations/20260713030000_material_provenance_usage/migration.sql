-- Material/reference truth state and queryable proof-of-use ledgers.
ALTER TABLE "MaterialAsset"
  ADD COLUMN "readiness" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "roleEvidence" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "rightsBasis" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(6) WITH TIME ZONE;

UPDATE "MaterialAsset"
SET
  "rightsBasis" = CASE
    WHEN "source" = 'artist_stem' THEN 'user-attested'
    WHEN "source" = 'provider_stem' THEN 'provider-generated'
    WHEN "source" = 'licensed' THEN 'licensed'
    WHEN "source" = 'forged' AND COALESCE("meta"->>'synth', 'false') = 'true' THEN 'code-generated'
    WHEN "source" = 'forged' THEN 'provider-generated'
    ELSE 'unknown'
  END,
  "roleEvidence" = CASE
    WHEN "source" IN ('artist_stem', 'provider_stem') THEN 'stem-separated'
    WHEN "source" = 'forged' AND COALESCE("meta"->>'synth', 'false') = 'true' THEN 'synth-code'
    WHEN "source" = 'forged' THEN 'provider-prompted'
    ELSE 'unknown'
  END,
  "qualityState" = CASE
    WHEN COALESCE("meta"->'qc'->>'verdict', '') IN ('pass', 'weak') THEN 'passed'
    WHEN COALESCE("meta"->'qc'->>'verdict', '') = 'fail' THEN 'failed'
    ELSE 'unmeasured'
  END,
  "readiness" = CASE
    WHEN COALESCE("meta"->'qc'->>'verdict', '') IN ('pass', 'weak') THEN 'ready'
    WHEN COALESCE("meta"->'qc'->>'verdict', '') = 'fail' THEN 'rejected'
    ELSE 'pending'
  END,
  "verifiedAt" = CASE
    WHEN COALESCE("meta"->'qc'->>'verdict', '') <> '' THEN "createdAt"
    ELSE NULL
  END;

ALTER TABLE "SoundReference"
  ADD COLUMN "analysisState" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "rightsBasis" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "SoundReference"
SET
  "analysisState" = CASE
    WHEN COALESCE("recipe"->'measured'->>'engineOk', 'false') = 'true' THEN 'measured'
    WHEN "summary" IS NOT NULL OR COALESCE("recipe"->>'source', '') <> '' THEN 'inferred'
    ELSE 'pending'
  END,
  "rightsBasis" = CASE
    WHEN COALESCE("recipe"->>'source', '') = 'generated' THEN 'self-generated'
    WHEN "sourceUrl" LIKE 'facts:%' OR "sourceUrl" LIKE 'zap:%' OR "sourceUrl" LIKE 'trend:%' THEN 'facts-only'
    WHEN COALESCE("recipe"->>'source', '') IN (
      'beat-upload', 'beat-import', 'song-import', 'song-import-training',
      'finished-upload', 'learn-backfill', 'rights-confirmed-reference'
    ) THEN 'user-attested'
    ELSE 'unknown'
  END;

CREATE TABLE "MaterialUsage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "providerJobId" TEXT NOT NULL,
  "beatId" TEXT NOT NULL,
  "songId" TEXT,
  "role" TEXT NOT NULL,
  "sourceBpm" DOUBLE PRECISION,
  "targetBpm" DOUBLE PRECISION,
  "stretchRatio" DOUBLE PRECISION,
  "gain" DOUBLE PRECISION,
  "pan" DOUBLE PRECISION,
  "sections" JSONB,
  "createdAt" TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferenceUsage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "providerJobId" TEXT NOT NULL,
  "beatId" TEXT NOT NULL,
  "songId" TEXT,
  "genre" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "influence" JSONB,
  "createdAt" TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferenceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialAsset_workspaceId_contentHash_key" ON "MaterialAsset"("workspaceId", "contentHash");
CREATE INDEX "MaterialAsset_workspaceId_readiness_qualityState_idx" ON "MaterialAsset"("workspaceId", "readiness", "qualityState");
CREATE UNIQUE INDEX "SoundReference_workspaceId_contentHash_key" ON "SoundReference"("workspaceId", "contentHash");
CREATE INDEX "SoundReference_workspaceId_analysisState_idx" ON "SoundReference"("workspaceId", "analysisState");

CREATE UNIQUE INDEX "MaterialUsage_providerJobId_materialId_key" ON "MaterialUsage"("providerJobId", "materialId");
CREATE INDEX "MaterialUsage_workspaceId_createdAt_idx" ON "MaterialUsage"("workspaceId", "createdAt" DESC);
CREATE INDEX "MaterialUsage_materialId_createdAt_idx" ON "MaterialUsage"("materialId", "createdAt" DESC);
CREATE INDEX "MaterialUsage_beatId_idx" ON "MaterialUsage"("beatId");

CREATE UNIQUE INDEX "ReferenceUsage_providerJobId_referenceId_key" ON "ReferenceUsage"("providerJobId", "referenceId");
CREATE INDEX "ReferenceUsage_workspaceId_createdAt_idx" ON "ReferenceUsage"("workspaceId", "createdAt" DESC);
CREATE INDEX "ReferenceUsage_referenceId_createdAt_idx" ON "ReferenceUsage"("referenceId", "createdAt" DESC);
CREATE INDEX "ReferenceUsage_beatId_idx" ON "ReferenceUsage"("beatId");

ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "MaterialAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_providerJobId_fkey" FOREIGN KEY ("providerJobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "BeatAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialUsage" ADD CONSTRAINT "MaterialUsage_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReferenceUsage" ADD CONSTRAINT "ReferenceUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferenceUsage" ADD CONSTRAINT "ReferenceUsage_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "SoundReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferenceUsage" ADD CONSTRAINT "ReferenceUsage_providerJobId_fkey" FOREIGN KEY ("providerJobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferenceUsage" ADD CONSTRAINT "ReferenceUsage_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "BeatAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferenceUsage" ADD CONSTRAINT "ReferenceUsage_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;
