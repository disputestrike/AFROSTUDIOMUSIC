-- Vocal assets used to conflate spoken TTS, isolated vocals, and full-song
-- voice conversions. Classify them explicitly and admit only measured isolated
-- vocals to future mixdowns.
ALTER TABLE "VocalRender"
  ADD COLUMN "assetKind" TEXT NOT NULL DEFAULT 'isolated_vocal',
  ADD COLUMN "performanceSource" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6),
ADD COLUMN "alignment" JSONB;

ALTER TABLE "BeatAsset"
ADD COLUMN "assetKind" TEXT NOT NULL DEFAULT 'instrumental',
ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
ADD COLUMN "contentHash" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);

-- A historical render attached to a mastered song is a complete mix, not an
-- instrumental mixer input. Anything uncertain remains unmeasured and cannot
-- be selected by the new mixer gate until it is explicitly classified.
UPDATE "BeatAsset" AS beat
SET "assetKind" = 'full_mix'
WHERE beat."songId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Master" AS master
    WHERE master."songId" = beat."songId"
  );

UPDATE "BeatAsset"
SET "approved" = false
WHERE "assetKind" = 'full_mix';

UPDATE "VocalRender"
SET
  "assetKind" = CASE
    WHEN "meta"->>'fullRemix' = 'true' THEN 'full_mix'
    WHEN "meta"->>'spokenGuideNotSung' = 'true' THEN 'spoken_guide'
    ELSE 'isolated_vocal'
  END,
  "performanceSource" = CASE
    WHEN "meta"->>'fullRemix' = 'true' THEN 'voice_conversion'
    WHEN "meta"->>'spokenGuideNotSung' = 'true' THEN 'tts_guide'
    WHEN "meta"->>'uploaded' = 'true' THEN 'artist_upload'
    WHEN "meta"->>'imported' = 'true' THEN 'artist_import'
    ELSE 'unknown'
  END;

-- These files are not isolated vocals and must never enter a vocal channel.
UPDATE "VocalRender"
SET "approved" = false
WHERE "assetKind" <> 'isolated_vocal';

CREATE INDEX "VocalRender_songId_assetKind_qualityState_approved_idx"
ON "VocalRender"("songId", "assetKind", "qualityState", "approved");
CREATE INDEX "VocalRender_projectId_contentHash_idx"
ON "VocalRender"("projectId", "contentHash");

CREATE INDEX "BeatAsset_songId_assetKind_qualityState_approved_idx"
ON "BeatAsset"("songId", "assetKind", "qualityState", "approved");

CREATE INDEX "BeatAsset_projectId_contentHash_idx"
ON "BeatAsset"("projectId", "contentHash");

ALTER TABLE "Mix"
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN "meta" JSONB;

CREATE INDEX "Mix_songId_qualityState_approved_idx"
  ON "Mix"("songId", "qualityState", "approved");

CREATE TABLE "VoiceDataset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "segments" INTEGER NOT NULL,
  "totalSeconds" INTEGER NOT NULL,
  "qualityState" TEXT NOT NULL,
  "verifiedAt" TIMESTAMPTZ(6) NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceDataset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceDataset_url_key" ON "VoiceDataset"("url");
CREATE UNIQUE INDEX "VoiceDataset_workspaceId_contentHash_key" ON "VoiceDataset"("workspaceId", "contentHash");
CREATE INDEX "VoiceDataset_workspaceId_qualityState_idx" ON "VoiceDataset"("workspaceId", "qualityState");
ALTER TABLE "VoiceDataset"
  ADD CONSTRAINT "VoiceDataset_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceProfile" ADD COLUMN "voiceDatasetId" TEXT;
CREATE INDEX "VoiceProfile_voiceDatasetId_idx" ON "VoiceProfile"("voiceDatasetId");
ALTER TABLE "VoiceProfile"
  ADD CONSTRAINT "VoiceProfile_voiceDatasetId_fkey"
  FOREIGN KEY ("voiceDatasetId") REFERENCES "VoiceDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
