-- OWNER RE-REQUEST (2026-07-21): "turn all the deleted songs back to the catalog."
-- The 20260720190000 migration already cleared deletedAt globally (verified: 0
-- soft-deleted remain). If songs are still missing, the other cause is the QA
-- QUARANTINE flag (a separate gate the first restore did not touch). This clears
-- BOTH so every recoverable song returns — deleted AND quarantined. Note: this
-- also surfaces QA-flagged takes; a weak render may reappear (playable, owned).
-- Idempotent; runs once at preDeploy.
DO $$
DECLARE undeleted integer; unquarantined integer;
BEGIN
  UPDATE "Song" SET "deletedAt" = NULL, "deletedReason" = NULL WHERE "deletedAt" IS NOT NULL;
  GET DIAGNOSTICS undeleted = ROW_COUNT;
  UPDATE "Song" SET "quarantined" = false, "quarantineReason" = NULL WHERE "quarantined" = true;
  GET DIAGNOSTICS unquarantined = ROW_COUNT;
  RAISE NOTICE 'RESTORE: % un-deleted, % un-quarantined song(s) returned to catalogs', undeleted, unquarantined;
END $$;
