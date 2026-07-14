-- DropForeignKey
ALTER TABLE "BeatAsset" DROP CONSTRAINT IF EXISTS "BeatAsset_songId_fkey";

-- DropForeignKey
ALTER TABLE "Export" DROP CONSTRAINT IF EXISTS "Export_songId_fkey";

-- DropForeignKey
ALTER TABLE "LyricDraft" DROP CONSTRAINT IF EXISTS "LyricDraft_songId_fkey";

-- DropForeignKey
ALTER TABLE "Master" DROP CONSTRAINT IF EXISTS "Master_songId_fkey";

-- DropForeignKey
ALTER TABLE "Mix" DROP CONSTRAINT IF EXISTS "Mix_songId_fkey";

-- DropForeignKey
ALTER TABLE "Release" DROP CONSTRAINT IF EXISTS "Release_songId_fkey";

-- DropForeignKey
ALTER TABLE "RightsReceipt" DROP CONSTRAINT IF EXISTS "RightsReceipt_songId_fkey";

-- DropForeignKey
ALTER TABLE "ShareLink" DROP CONSTRAINT IF EXISTS "ShareLink_songId_fkey";

-- DropForeignKey
ALTER TABLE "TasteScore" DROP CONSTRAINT IF EXISTS "TasteScore_hookId_fkey";

-- DropForeignKey
ALTER TABLE "TasteScore" DROP CONSTRAINT IF EXISTS "TasteScore_songId_fkey";

-- DropForeignKey
ALTER TABLE "VocalRender" DROP CONSTRAINT IF EXISTS "VocalRender_songId_fkey";

-- AlterTable
ALTER TABLE "LyricDraft" ADD COLUMN IF NOT EXISTS "artistAuthored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "versions" JSONB;

-- AlterTable
ALTER TABLE "Master" ADD COLUMN IF NOT EXISTS "meta" JSONB;

-- AlterTable
ALTER TABLE "Mix" ADD COLUMN IF NOT EXISTS "settings" JSONB;

-- AlterTable
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "albumId" TEXT,
ADD COLUMN IF NOT EXISTS "hitRead" JSONB,
ADD COLUMN IF NOT EXISTS "hitScore" INTEGER,
ADD COLUMN IF NOT EXISTS "isrc" TEXT,
ADD COLUMN IF NOT EXISTS "laneGaps" JSONB,
ADD COLUMN IF NOT EXISTS "laneScore" INTEGER,
ADD COLUMN IF NOT EXISTS "measuredAnalysis" JSONB,
ADD COLUMN IF NOT EXISTS "nativeReviewOk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "proofPack" JSONB,
ADD COLUMN IF NOT EXISTS "quarantineReason" TEXT,
ADD COLUMN IF NOT EXISTS "quarantined" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "releaseReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "splitSheet" JSONB,
ADD COLUMN IF NOT EXISTS "upc" TEXT,
ADD COLUMN IF NOT EXISTS "viralScore" INTEGER;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "musicApiKey" TEXT,
ADD COLUMN IF NOT EXISTS "musicProvider" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MaterialAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "genre" TEXT,
    "bpm" INTEGER,
    "keySignature" TEXT,
    "bars" INTEGER,
    "durationS" DOUBLE PRECISION,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Album" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "anchorSongId" TEXT,
    "styleBrief" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SoundReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artistId" TEXT,
    "genre" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT,
    "recipe" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LexiconEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "term" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "register" TEXT,
    "meaning" TEXT,
    "example" TEXT,
    "tags" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LexiconEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaterialAsset_workspaceId_genre_role_idx" ON "MaterialAsset"("workspaceId", "genre", "role");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Album_workspaceId_idx" ON "Album"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SoundReference_workspaceId_genre_idx" ON "SoundReference"("workspaceId", "genre");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SoundReference_artistId_idx" ON "SoundReference"("artistId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LexiconEntry_language_category_idx" ON "LexiconEntry"("language", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LexiconEntry_workspaceId_idx" ON "LexiconEntry"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LexiconEntry_term_language_category_key" ON "LexiconEntry"("term", "language", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderJob_workspaceId_createdAt_idx" ON "ProviderJob"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Song_albumId_idx" ON "Song"("albumId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Song_workspaceId_createdAt_idx" ON "Song"("workspaceId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "MaterialAsset" DROP CONSTRAINT IF EXISTS "MaterialAsset_workspaceId_fkey";
ALTER TABLE "MaterialAsset" ADD CONSTRAINT "MaterialAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Album" DROP CONSTRAINT IF EXISTS "Album_workspaceId_fkey";
ALTER TABLE "Album" ADD CONSTRAINT "Album_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Song" DROP CONSTRAINT IF EXISTS "Song_albumId_fkey";
ALTER TABLE "Song" ADD CONSTRAINT "Song_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LyricDraft" DROP CONSTRAINT IF EXISTS "LyricDraft_songId_fkey";
ALTER TABLE "LyricDraft" ADD CONSTRAINT "LyricDraft_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatAsset" DROP CONSTRAINT IF EXISTS "BeatAsset_songId_fkey";
ALTER TABLE "BeatAsset" ADD CONSTRAINT "BeatAsset_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocalRender" DROP CONSTRAINT IF EXISTS "VocalRender_songId_fkey";
ALTER TABLE "VocalRender" ADD CONSTRAINT "VocalRender_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mix" DROP CONSTRAINT IF EXISTS "Mix_songId_fkey";
ALTER TABLE "Mix" ADD CONSTRAINT "Mix_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Master" DROP CONSTRAINT IF EXISTS "Master_songId_fkey";
ALTER TABLE "Master" ADD CONSTRAINT "Master_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TasteScore" DROP CONSTRAINT IF EXISTS "TasteScore_songId_fkey";
ALTER TABLE "TasteScore" ADD CONSTRAINT "TasteScore_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TasteScore" DROP CONSTRAINT IF EXISTS "TasteScore_hookId_fkey";
ALTER TABLE "TasteScore" ADD CONSTRAINT "TasteScore_hookId_fkey" FOREIGN KEY ("hookId") REFERENCES "HookCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsReceipt" DROP CONSTRAINT IF EXISTS "RightsReceipt_songId_fkey";
ALTER TABLE "RightsReceipt" ADD CONSTRAINT "RightsReceipt_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" DROP CONSTRAINT IF EXISTS "Export_songId_fkey";
ALTER TABLE "Export" ADD CONSTRAINT "Export_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" DROP CONSTRAINT IF EXISTS "Release_songId_fkey";
ALTER TABLE "Release" ADD CONSTRAINT "Release_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" DROP CONSTRAINT IF EXISTS "ShareLink_songId_fkey";
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
