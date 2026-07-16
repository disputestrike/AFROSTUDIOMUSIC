-- PROD SIMULATION SEED — runs against the pre-freeze schema (8df53ee or
-- 4cc3d10^) BEFORE migrate-deploy.mjs, to exercise the exact defect classes the
-- baseline must survive on the real production database:
--   * a project holding TWO songs, one bound lyric, one orphan draft
--     (the song-scoped lyric backfill: adopt/copy/realign paths)
--   * a STALE Song.lyricId pointer at another song's draft (the transient
--     unique-violation case in step 3)
--   * Song.isrc duplicates that only collide AFTER canonicalization
--     (190000's canonicalize -> conflict-ledger -> oldest-wins pipeline)
-- Test-only file; never runs in production.

INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt")
VALUES ('w1', 'Sim Workspace', 'sim-workspace', NOW());

INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
VALUES ('sim.sentinel', 'seeded', NOW());

INSERT INTO "Artist" ("id", "workspaceId", "name", "stageName", "updatedAt")
VALUES ('ar1', 'w1', 'Sim Artist', 'SIMMY', NOW());

INSERT INTO "Project" ("id", "workspaceId", "artistId", "title", "genre", "updatedAt")
VALUES ('p1', 'w1', 'ar1', 'Two-song project', 'amapiano', NOW());

-- Song A: owns a bound lyric. Song B: no lyric of its own (the reuse-beat
-- shape), holding a STALE pointer at A's draft. B's isrc canonicalizes equal
-- to A's ('  ng-a01-26-00001 ' -> 'NG-A01-26-00001') so only 190000's
-- canonicalization can catch the collision.
INSERT INTO "Song" ("id", "workspaceId", "projectId", "title", "isrc", "createdAt")
VALUES
  ('sA', 'w1', 'p1', 'Song A', 'NG-A01-26-00001', NOW() - INTERVAL '2 hour'),
  ('sB', 'w1', 'p1', 'Song B', '  ng-a01-26-00001 ', NOW() - INTERVAL '1 hour');

INSERT INTO "LyricDraft" ("id", "projectId", "songId", "title", "body", "createdAt")
VALUES
  ('lA', 'p1', 'sA', 'Song A words', E'[Hook]\nThese words belong to song A only', NOW() - INTERVAL '2 hour'),
  ('lOrphan', 'p1', NULL, 'Orphan words', E'[Hook]\nNewest draft in the project, bound to nobody', NOW() - INTERVAL '30 minute');

UPDATE "Song" SET "lyricId" = 'lA' WHERE "id" = 'sB'; -- the stale fallback-era pointer

INSERT INTO "CreditLedger" ("id", "workspaceId", "delta", "reason", "createdAt")
VALUES ('cl1', 'w1', -3000, 'lyrics_full sim', NOW() - INTERVAL '90 minute');
