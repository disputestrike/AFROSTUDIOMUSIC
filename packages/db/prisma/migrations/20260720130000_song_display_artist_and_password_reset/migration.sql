-- OWNER-REQUESTED EDIT FEATURES (2026-07-20).
--
-- 1) Song.displayArtist — a PER-SONG stage/singer name. Renaming one song's
--    singer must never rename the workspace Artist (Artist.stageName) nor any
--    sibling song, so the displayed artist gets a nullable per-song column;
--    NULL falls back to project.artist.stageName at read time.
--
-- 2) PasswordResetToken — the forgotten-password grant. Single-use (usedAt),
--    expiring (expiresAt ~1h), and stored ONLY as a SHA-256 hash (tokenHash) so
--    a DB leak cannot be replayed into an account takeover.

-- Feature 2: per-song display artist.
ALTER TABLE "Song" ADD COLUMN "displayArtist" TEXT;

-- Feature 4: forgotten-password reset tokens.
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- The token hash is the lookup key on redemption and must be unique.
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
-- Supports a cheap sweep of expired tokens.
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
