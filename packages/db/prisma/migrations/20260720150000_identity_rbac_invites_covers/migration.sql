-- IDENTITY WAVE (2026-07-20): RBAC-ready invites + per-song covers.
--
--  * Song.coverUrl — per-song cover image (canonical private storage ref).
--    Null falls back to the project's newest cover ImageAsset, so legacy
--    covers keep rendering unchanged.
--  * WorkspaceInvite — single-use, expiring, HASHED invite tokens
--    (PasswordResetToken doctrine: only the SHA-256 hash is stored; a DB leak
--    cannot be replayed into a membership).
--
-- Membership itself needs no backfill: WorkspaceMember already exists and
-- every signup/bootstrap path has always written an OWNER row.

-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "coverUrl" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PRODUCER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "invitedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_createdAt_idx" ON "WorkspaceInvite"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_expiresAt_idx" ON "WorkspaceInvite"("expiresAt");

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
