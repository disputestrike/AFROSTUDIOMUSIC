-- AFROREF (trainlegal wave) — the rights-clean audio REFERENCE set: the
-- measuring stick FAD-CLAP compares training candidates against. Ingestion is
-- gated in code by afroRefEligibility (@afrohit/shared training-corpus.ts):
-- ONLY own-engine renders and consented user-original uploads; third-party
-- renders (MiniMax/Suno/ACE-step/Eleven) are refused unconditionally.
-- DDL generated from the canonical prisma schema (never db push).

-- CreateTable
CREATE TABLE "AfroRefClip" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "songId" TEXT,
    "materialId" TEXT,
    "url" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "language" TEXT,
    "provenance" TEXT NOT NULL,
    "engine" TEXT,
    "contentHash" TEXT,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AfroRefClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AfroRefClip_genre_language_idx" ON "AfroRefClip"("genre", "language");

-- CreateIndex
CREATE INDEX "AfroRefClip_songId_idx" ON "AfroRefClip"("songId");

-- CreateIndex
CREATE UNIQUE INDEX "AfroRefClip_contentHash_key" ON "AfroRefClip"("contentHash");
