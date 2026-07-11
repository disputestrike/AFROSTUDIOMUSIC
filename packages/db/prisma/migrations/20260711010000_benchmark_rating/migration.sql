-- Listening benchmark: human ratings vs machine lane score, per genre.
CREATE TABLE "BenchmarkRating" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "genre" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'afrohit',
  "songId" TEXT,
  "audioUrl" TEXT NOT NULL,
  "engine" TEXT,
  "laneScore" INTEGER,
  "humanRating" INTEGER NOT NULL,
  "blindLabel" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenchmarkRating_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BenchmarkRating_workspaceId_genre_idx" ON "BenchmarkRating"("workspaceId", "genre");
ALTER TABLE "BenchmarkRating" ADD CONSTRAINT "BenchmarkRating_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
