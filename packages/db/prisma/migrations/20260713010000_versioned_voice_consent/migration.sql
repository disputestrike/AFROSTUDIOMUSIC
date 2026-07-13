ALTER TABLE "VoiceConsent"
  ADD COLUMN "artistId" TEXT,
  ADD COLUMN "signerUserId" TEXT,
  ADD COLUMN "consentVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "consentTextHash" TEXT,
  ADD COLUMN "ipHash" TEXT;

UPDATE "VoiceConsent" SET "ipAddress" = NULL WHERE "ipAddress" IS NOT NULL;

CREATE INDEX "VoiceConsent_artistId_idx" ON "VoiceConsent"("artistId");
CREATE INDEX "VoiceConsent_signerUserId_idx" ON "VoiceConsent"("signerUserId");

ALTER TABLE "VoiceConsent"
  ADD CONSTRAINT "VoiceConsent_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceConsent"
  ADD CONSTRAINT "VoiceConsent_signerUserId_fkey"
  FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
