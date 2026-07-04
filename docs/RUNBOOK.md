# Operations Runbook

Quick reference for the common things that break.

## Health endpoints

| Service | URL |
|---|---|
| web | `/api/health` |
| api | `/health` |
| worker | check logs; no HTTP endpoint (could add one later) |

## Common failure modes

### "402 insufficient_credits"

The user ran out of credits. Direct them to `/billing` → credit pack. The `creditsCents` column on `Workspace` is the source of truth. Refunds go through `app.refundCredits` (server-side only).

### "412 no_rights_receipt"

User tried to export a release without running rights check. POST `/api/v1/rights/check` first. The check writes a `RightsReceipt` row whose `hash` field is the canonical sha256 of the receipt JSON.

### Voice profile stuck in `TRAINING`

Check the worker logs for the `setup-voice-profile` job. ElevenLabs typically completes in seconds; if it hangs, retry the job (BullMQ does this 3× automatically before marking failed). If it failed in the provider, the `VoiceProfile.status` will be `FAILED` — let the user re-upload samples and retry.

### Music generation job hangs

The `processMusic` processor polls up to 25 attempts with 8s waits = ~3 min ceiling. If the provider truly stalls, the job is marked FAILED and credits are NOT auto-refunded — manually refund via:

```sql
UPDATE "Workspace" SET "creditsCents" = "creditsCents" + 75000
  WHERE id = '...';
INSERT INTO "CreditLedger" (id, "workspaceId", delta, reason, "createdAt")
  VALUES (gen_random_uuid(), '...', 75000, 'manual_refund', now());
```

Or call `app.refundCredits()` from a tiny script.

### Worker can't reach S3/R2

The worker uploads must succeed for `BeatAsset` / `VocalRender` rows to land. If `S3_*` env is wrong, jobs will fail with `BadEndpoint` or `NoSuchBucket`. Test with:

```bash
aws --endpoint-url=$S3_ENDPOINT s3 ls s3://$S3_BUCKET
```

### Clerk session not resolving to a workspace

The Clerk webhook auto-creates a workspace on `user.created`. If that webhook didn't fire (Clerk dashboard says "no recent deliveries"), the user lands in a state where `WorkspaceMember` is missing. Quick recovery:

```sql
INSERT INTO "Workspace" (id, name, slug, plan, "creditsCents", "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'Manual', 'manual-xxx', 'STARTER', 500000, now(), now());
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, "createdAt")
  VALUES (gen_random_uuid(), '<ws id>', '<user id>', 'OWNER', now());
```

### PostGIS index missing

The `01-postgis-indexes.sql` script must be run after the first Prisma migration. Heatmap queries get slow without it. Re-run is idempotent.

## Scaling levers

| Symptom | Lever |
|---|---|
| Hooks/lyrics slow | Bump `gpt-5.4-mini` quota or temporarily switch `OPENAI_DRAFT_MODEL` to `gpt-5.3-mini` |
| Beat queue backlog | Add worker replicas (each handles `WORKER_CONCURRENCY` jobs) |
| Video queue backlog | Same — but stay polite to provider rate limits |
| Postgres slow | Promote to a bigger Railway instance, or add read replicas; never trade ACID for caching here |
| Redis OOM | Shorten `removeOnComplete` to 100 from 1000 |

## Disaster recovery

1. Restore Postgres from Railway backup (point-in-time within 7 days).
2. Object storage is versioned — restore lost objects via R2/S3 versioning.
3. Re-run any failed BullMQ jobs by enqueuing from `ProviderJob` rows where `status='FAILED'`.
