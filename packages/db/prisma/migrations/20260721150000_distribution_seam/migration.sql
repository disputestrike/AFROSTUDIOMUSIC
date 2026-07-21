-- PART B — THE DISTRIBUTION SEAM (Phase 5, owner 2026-07-21). One aggregator
-- (Ayrshare) fans a finished release out to the artist's social platforms, so we
-- do NOT build nine native uploaders (the ViralForge lesson). Two tables, both
-- inert until the operator sets DISTRIBUTION_ENABLED=1 and an AYRSHARE_API_KEY:
-- without the key nothing publishes and the UI says "connect your accounts",
-- never a fake success.

-- A social account the workspace connected through the aggregator. "connected"
-- means the aggregator holds a live link to the artist's platform. One row per
-- platform per workspace. Cascade — a connection is meaningless once the
-- workspace is gone.
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "displayName" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectedAccount_workspaceId_platform_key" ON "ConnectedAccount"("workspaceId", "platform");
CREATE INDEX "ConnectedAccount_workspaceId_idx" ON "ConnectedAccount"("workspaceId");

ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One scheduled/published social post, recorded HONESTLY. A row exists only when
-- a REAL publish was attempted through the aggregator (flag + key present); its
-- status carries the aggregator's own verdict. Nothing is ever written on a
-- fake / not-configured path. Cascade from both the workspace and the song.
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "releaseId" TEXT,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalPostId" TEXT,
    "caption" TEXT,
    "mediaKind" TEXT,
    "scheduledAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialPost_workspaceId_createdAt_idx" ON "SocialPost"("workspaceId", "createdAt" DESC);
CREATE INDEX "SocialPost_songId_idx" ON "SocialPost"("songId");

ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
