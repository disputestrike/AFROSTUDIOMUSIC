CREATE INDEX IF NOT EXISTS "ArtistMemoryChunk_workspaceId_artistId_kind_createdAt_idx"
ON "ArtistMemoryChunk"("workspaceId", "artistId", "kind", "createdAt");
