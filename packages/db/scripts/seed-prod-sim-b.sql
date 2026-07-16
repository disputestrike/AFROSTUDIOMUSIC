-- PROD SIMULATION B — the synthetic "middle state": a window commit where the
-- dedup target COLUMNS exist with data but their UNIQUE indexes do not yet.
-- This is the only state in which duplicates can exist on production, and the
-- only state where dedupeForBaselineUniqueConstraints has real work to do.
-- Fabricated by dropping three of the uniques, then seeding duplicates:
--   * MaterialAsset  (nullable column  -> NULL strategy, oldest keeps hash)
--   * VoiceDataset   (NOT NULL column  -> ':dup:' suffix strategy)
--   * CreditLedger   (idempotencyKey   -> NULL strategy, oldest keeps key)
-- Test-only file; never runs in production.

DROP INDEX "MaterialAsset_workspaceId_contentHash_key";
DROP INDEX "VoiceDataset_workspaceId_contentHash_key";
DROP INDEX "CreditLedger_workspaceId_idempotencyKey_key";

INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt")
VALUES ('w1', 'Sim B Workspace', 'sim-b-workspace', NOW());

INSERT INTO "MaterialAsset" ("id", "workspaceId", "kind", "role", "source", "url", "contentHash", "createdAt")
VALUES
  ('mat_old', 'w1', 'loop', 'drums', 'forged', 'https://cdn/sim/a.wav', 'hash-AAA', NOW() - INTERVAL '2 hour'),
  ('mat_new', 'w1', 'loop', 'drums', 'forged', 'https://cdn/sim/a-reupload.wav', 'hash-AAA', NOW() - INTERVAL '1 hour');

INSERT INTO "VoiceDataset" ("id", "workspaceId", "name", "url", "contentHash", "segments", "totalSeconds", "verifiedAt", "qualityState", "createdAt")
VALUES
  ('vd_old', 'w1', 'take one', 'https://cdn/sim/v1.zip', 'voice-HHH', 10, 300, NOW(), 'passed', NOW() - INTERVAL '2 hour'),
  ('vd_new', 'w1', 'take one again', 'https://cdn/sim/v2.zip', 'voice-HHH', 10, 300, NOW(), 'passed', NOW() - INTERVAL '1 hour');

INSERT INTO "CreditLedger" ("id", "workspaceId", "delta", "reason", "idempotencyKey", "createdAt")
VALUES
  ('cl_old', 'w1', -3000, 'lyrics_full sim', 'op-123', NOW() - INTERVAL '2 hour'),
  ('cl_new', 'w1', -3000, 'lyrics_full sim retry', 'op-123', NOW() - INTERVAL '1 hour');
