-- TRAINING-LICENSE CONSENT (the consent door, 2026-07-19) — the versioned,
-- hashed, revocable grant that lets a workspace's USER-ORIGINAL uploads count
-- as training fuel. Mirrors the VoiceConsent/LikenessConsent doctrine.
-- LIVE INCIDENT RECEIPT: the model landed in schema.prisma WITHOUT this
-- migration file; prod deploys run `migrate deploy` (migrate:safe), so the
-- table was never created — the owner's first Grant tap 500'd and signups
-- (which record the ToS acceptance) broke. This file is the fix.

-- CreateTable
CREATE TABLE "TrainingConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT,
    "signedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingConsent_workspaceId_revokedAt_idx" ON "TrainingConsent"("workspaceId", "revokedAt");
