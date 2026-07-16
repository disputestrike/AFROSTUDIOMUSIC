-- ARTIST LIKENESS (Wave 4): versioned own-face consent + likeness assets.
-- Mirrors the VoiceConsent doctrine — consent recorded BEFORE any training or
-- generation, workspace-scoped, revocable, soft-delete friendly. Self-contained
-- so CI's from-empty `migrate deploy` applies it with no manual steps.

-- CreateTable
CREATE TABLE "LikenessConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "signerUserId" TEXT,
    "legalName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "LikenessConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistLikeness" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentHash" TEXT,
    "consentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trainedModelRef" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ArtistLikeness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LikenessConsent_workspaceId_idx" ON "LikenessConsent"("workspaceId");
CREATE INDEX "LikenessConsent_artistId_idx" ON "LikenessConsent"("artistId");
CREATE INDEX "LikenessConsent_signerUserId_idx" ON "LikenessConsent"("signerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistLikeness_workspaceId_contentHash_key" ON "ArtistLikeness"("workspaceId", "contentHash");
CREATE INDEX "ArtistLikeness_workspaceId_idx" ON "ArtistLikeness"("workspaceId");
CREATE INDEX "ArtistLikeness_artistId_status_idx" ON "ArtistLikeness"("artistId", "status");
CREATE INDEX "ArtistLikeness_consentId_idx" ON "ArtistLikeness"("consentId");

-- AddForeignKey
ALTER TABLE "LikenessConsent" ADD CONSTRAINT "LikenessConsent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LikenessConsent" ADD CONSTRAINT "LikenessConsent_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LikenessConsent" ADD CONSTRAINT "LikenessConsent_signerUserId_fkey"
    FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistLikeness" ADD CONSTRAINT "ArtistLikeness_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistLikeness" ADD CONSTRAINT "ArtistLikeness_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistLikeness" ADD CONSTRAINT "ArtistLikeness_consentId_fkey"
    FOREIGN KEY ("consentId") REFERENCES "LikenessConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
