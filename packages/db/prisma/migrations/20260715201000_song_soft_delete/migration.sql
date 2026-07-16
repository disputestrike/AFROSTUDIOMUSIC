-- NEVER LOSE A SONG — soft delete for Song.
--
-- DELETE /songs/:id used to queue every asset for reaping and then run a real
-- row delete, cascading through LyricDraft, BeatAsset, Stem, VocalRender, Mix,
-- Master, Export, RightsReceipt, ReleaseAttestation and Release. One click in
-- the catalog destroyed the song, its words, every take and every byte of audio,
-- with no tombstone and nothing to restore from. DELETE /projects/:id was worse:
-- Song.projectId cascades, so deleting one folder wiped every song inside it.
--
-- The route now stamps deletedAt instead, the project route refuses while songs
-- remain, and the catalog's "Show ALL songs" view surfaces deleted songs so any
-- song ever made can be found and restored.
--
-- Purely additive and nullable: existing rows read as "not deleted", which is
-- exactly right — nothing in the catalog changes on deploy.

ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "deletedReason" TEXT;

-- The catalog list is the hottest read in the app and now filters deletedAt on
-- every request. Partial index: only live songs are indexed, so it stays small
-- and serves the default (deletedAt IS NULL) scan directly.
CREATE INDEX IF NOT EXISTS "Song_workspaceId_createdAt_live_idx"
  ON "Song" ("workspaceId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;
