-- Preserve access to physical asset keys after the 2026-07-23 owner-ordered
-- catalog consolidation. Database ownership moved to the studio with the most
-- songs, while existing R2 keys correctly retained their original workspace
-- prefixes. The API reads this destination-only alias map; source workspaces do
-- not gain reciprocal access.
WITH destination AS (
  SELECT "workspaceId"
    FROM "Song"
   GROUP BY "workspaceId"
   ORDER BY COUNT(*) DESC, "workspaceId" ASC
   LIMIT 1
),
aliases AS (
  SELECT jsonb_agg("id" ORDER BY "id") AS ids
    FROM "Workspace"
)
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT
  'asset.workspace-prefix-aliases.v1',
  jsonb_build_object(destination."workspaceId", aliases.ids)::text,
  CURRENT_TIMESTAMP
FROM destination
CROSS JOIN aliases
WHERE aliases.ids IS NOT NULL
ON CONFLICT ("key") DO UPDATE
SET
  "value" = (
    COALESCE("SystemSetting"."value"::jsonb, '{}'::jsonb) ||
    EXCLUDED."value"::jsonb
  )::text,
  "updatedAt" = CURRENT_TIMESTAMP;
