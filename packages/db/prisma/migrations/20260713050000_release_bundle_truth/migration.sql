-- Export, rights, artwork, and master evidence must describe real immutable artifacts.
ALTER TABLE "Master"
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

UPDATE "Master"
SET
  "qualityState" = CASE
    WHEN "meta"->'qc'->>'verdict' IN ('pass', 'weak') THEN 'passed'
    WHEN "meta"->'qc'->>'verdict' = 'fail' THEN 'failed'
    ELSE 'unmeasured'
  END,
  "contentHash" = NULLIF("meta"->>'contentHash', ''),
  "verifiedAt" = CASE
    WHEN "meta"->>'verifiedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN ("meta"->>'verifiedAt')::timestamptz
    ELSE NULL
  END;

CREATE INDEX "Master_songId_qualityState_approved_idx"
  ON "Master"("songId", "qualityState", "approved");
CREATE INDEX "Master_projectId_contentHash_idx"
  ON "Master"("projectId", "contentHash");

ALTER TABLE "ImageAsset"
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

CREATE INDEX "ImageAsset_projectId_kind_qualityState_approved_idx"
  ON "ImageAsset"("projectId", "kind", "qualityState", "approved");
CREATE INDEX "ImageAsset_projectId_contentHash_idx"
  ON "ImageAsset"("projectId", "contentHash");

ALTER TABLE "RightsReceipt"
  ADD COLUMN "canonicalPayload" JSONB;

CREATE TABLE "ReleaseAttestation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "hash" TEXT NOT NULL,
  "attestedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseAttestation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReleaseAttestation"
  ADD CONSTRAINT "ReleaseAttestation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseAttestation"
  ADD CONSTRAINT "ReleaseAttestation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseAttestation"
  ADD CONSTRAINT "ReleaseAttestation_songId_fkey"
  FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ReleaseAttestation_workspaceId_idx"
  ON "ReleaseAttestation"("workspaceId");
CREATE INDEX "ReleaseAttestation_songId_kind_createdAt_idx"
  ON "ReleaseAttestation"("songId", "kind", "createdAt" DESC);

ALTER TABLE "Export"
  ADD COLUMN "archiveUrl" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "sourceFingerprint" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "manifest" JSONB,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

UPDATE "Export"
SET "qualityState" = 'legacy_reference_only'
WHERE "archiveUrl" IS NULL;

CREATE UNIQUE INDEX "Export_songId_sourceFingerprint_key"
  ON "Export"("songId", "sourceFingerprint");
CREATE INDEX "Export_songId_qualityState_idx"
  ON "Export"("songId", "qualityState");
