-- ONE-TIME OWNER-ORDERED DATA RECOVERY (2026-07-20)
-- Owner: "bring every deleted song back, across all catalogs and all users."
--
-- Songs are only ever SOFT-deleted: the delete route stamps `deletedAt` (and an
-- optional `deletedReason`) and KEEPS the row — see apps/api/src/routes/songs.ts
-- ("NEVER LOSE A SONG"). So recovery is simply clearing that tombstone; nothing
-- is created or destroyed. This returns every soft-deleted song, in every
-- workspace, to its catalog at once.
--
-- SAFE + REVERSIBLE: this does NOT touch the QA `quarantined` flag (a separate
-- safety gate), and any individual song can be re-deleted afterward via the
-- normal DELETE route. Idempotent by construction (WHERE "deletedAt" IS NOT NULL)
-- and runs exactly once as a migration.
DO $$
DECLARE
  restored_count integer;
BEGIN
  UPDATE "Song"
     SET "deletedAt" = NULL,
         "deletedReason" = NULL
   WHERE "deletedAt" IS NOT NULL;
  GET DIAGNOSTICS restored_count = ROW_COUNT;
  RAISE NOTICE 'BULK SONG RESTORE: % soft-deleted song(s) returned to their catalogs', restored_count;
END $$;
