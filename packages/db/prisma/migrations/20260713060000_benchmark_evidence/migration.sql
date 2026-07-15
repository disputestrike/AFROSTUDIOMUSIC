CREATE TABLE "BenchmarkPair" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "songId" TEXT NOT NULL,
  "genre" TEXT NOT NULL,
  "competitor" TEXT NOT NULL DEFAULT 'suno',
  "afrohitAssetRef" TEXT NOT NULL,
  "afrohitContentHash" TEXT NOT NULL,
  "referenceAssetRef" TEXT NOT NULL,
  "referenceContentHash" TEXT NOT NULL,
  "referenceSizeBytes" INTEGER NOT NULL,
  "referenceFormat" TEXT NOT NULL,
  "rightsBasis" TEXT NOT NULL,
  "rightsAttestation" JSONB NOT NULL,
  "seed" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),

  CONSTRAINT "BenchmarkPair_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BenchmarkPair_referenceSizeBytes_check" CHECK ("referenceSizeBytes" >= 1000)
);

CREATE TABLE "BenchmarkJudgment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "pairId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "winner" TEXT NOT NULL,
  "afrohitScores" JSONB NOT NULL,
  "competitorScores" JSONB NOT NULL,
  "confidence" INTEGER NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BenchmarkJudgment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BenchmarkJudgment_winner_check" CHECK ("winner" IN ('afrohit', 'competitor', 'tie')),
  CONSTRAINT "BenchmarkJudgment_confidence_check" CHECK ("confidence" BETWEEN 1 AND 5)
);

CREATE INDEX "BenchmarkPair_workspaceId_status_createdAt_idx"
  ON "BenchmarkPair"("workspaceId", "status", "createdAt" DESC);
CREATE INDEX "BenchmarkPair_competitor_genre_idx"
  ON "BenchmarkPair"("competitor", "genre");
CREATE UNIQUE INDEX "BenchmarkJudgment_pairId_userId_key"
  ON "BenchmarkJudgment"("pairId", "userId");
CREATE INDEX "BenchmarkJudgment_workspaceId_createdAt_idx"
  ON "BenchmarkJudgment"("workspaceId", "createdAt" DESC);

ALTER TABLE "BenchmarkPair"
  ADD CONSTRAINT "BenchmarkPair_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkPair"
  ADD CONSTRAINT "BenchmarkPair_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkPair"
  ADD CONSTRAINT "BenchmarkPair_songId_fkey"
  FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkJudgment"
  ADD CONSTRAINT "BenchmarkJudgment_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkJudgment"
  ADD CONSTRAINT "BenchmarkJudgment_pairId_fkey"
  FOREIGN KEY ("pairId") REFERENCES "BenchmarkPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenchmarkJudgment"
  ADD CONSTRAINT "BenchmarkJudgment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
