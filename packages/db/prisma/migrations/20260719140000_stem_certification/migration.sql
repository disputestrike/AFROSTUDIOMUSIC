-- Per-stem byte certification and source lineage. All columns are additive so
-- legacy/provider/Demucs rows remain readable and downloadable. Existing rows
-- stay explicitly unmeasured until regenerated through a certified path.
ALTER TABLE "Stem"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "qualityState" TEXT NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN "lineage" JSONB;

CREATE INDEX "Stem_beatId_qualityState_verifiedAt_idx"
  ON "Stem"("beatId", "qualityState", "verifiedAt");

CREATE INDEX "Stem_beatId_contentHash_idx"
  ON "Stem"("beatId", "contentHash");
