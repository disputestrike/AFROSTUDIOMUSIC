# Operations Runbook

This runbook favors evidence and reversible controls. Do not repair balances,
migration history, rights records, or release status with ad hoc SQL writes.

## Health Interpretation

| Endpoint or signal | Meaning |
|---|---|
| API `/health` | Process liveness only |
| API `/health/ready` | Database, Redis, worker heartbeat, and outbox snapshot |
| Web `/api/health` | Web process and configured API reachability |
| `SystemSetting` keys `worker:heartbeat:*` | Per-replica worker heartbeat |
| Provider and queue dashboards | External and transport state |

The API readiness body has two top-level booleans:

- `ok` means PostgreSQL is reachable. HTTP is 503 when this is false.
- `systemOk` means PostgreSQL, Redis, and at least one fresh worker heartbeat are
  all present.

Alert whenever `systemOk` is false, `pendingOutbox` rises continuously, or
`oldestPendingSeconds` exceeds the normal dispatch window.

## First Response

1. Record the UTC start time, affected workspace IDs, request/job/event IDs, and
   the deployed commit.
2. Stop further spend if the incident can fan out. Disable the affected entries
   through `/api/v1/admin/autonomy` and set `ENABLE_AUTONOMY_CRON=0` for a broad
   scheduled-work stop.
3. Preserve logs and database/object identifiers before retrying anything.
4. Classify the fault as auth/tenant, billing, queue, provider, storage, quality,
   export/distribution, or deployment.
5. Recover with idempotent application paths; never invent success state.

## Queue And Worker Incidents

If Redis or the worker is unhealthy:

1. Check `/health/ready`, worker logs, replica count, Redis memory, and network
   connectivity.
2. Inspect `JobOutbox` rows in `PENDING` or `FAILED` state and their
   `nextAttemptAt`, `attempts`, and `lastError`.
3. Match each outbox row to its `ProviderJob`. Confirm whether a provider request
   was submitted before retrying.
4. Restore Redis/worker capacity. The dispatcher will continue durable outbox
   delivery; do not enqueue a second logical job with a new idempotency key.
5. Confirm heartbeats return and backlog age declines.

A provider timeout does not prove failure. Query the provider using the stored
external job ID before launching replacement work.

## Credits And Billing

Credit balance is derived through transactional workspace updates plus immutable
`CreditLedger` entries. Paid job failure creates a one-time reversal linked by
`reversalOfId`.
Every debit records `creditKey`, billed `units`, and allowance `planUnits`.
Generation caps sum `units`; plan allowances sum `planUnits`. Video allowance is
the sum of normalized provider shot durations, not one unit per storyboard or
request. Charges and reversals share a workspace advisory lock, and owner-mode
refunds restore cap units without changing the workspace balance.

For an insufficient-credit response, inspect the balance, plan limit, daily and
monthly generation caps, and recent ledger entries. Do not bypass a plan or cap
by editing `Workspace.creditsCents`.

For a missing refund:

1. Find the failed `ProviderJob` and its `chargeLedgerId`.
2. Look for the reversal ledger row.
3. Confirm the worker failure handler completed.
4. Re-run only the idempotent refund/application workflow after the underlying
   fault is understood.

For PayPal incidents, correlate `BillingIntent`, `BillingEvent`,
`paypalOrderId`/`paypalSubscriptionId`, and the external event ID. Duplicate
webhooks are expected and must not duplicate credits. Never grant credit from an
unverified webhook or a browser success redirect.

## Storage And Data Isolation

For failed upload or playback:

1. Confirm the stored reference belongs to the active workspace.
2. Verify bucket privacy and `STORAGE_PRIVATE_CONFIRMED=1`.
3. Check endpoint, region, credentials, object existence, size, and content hash.
4. Generate a new short-lived signed URL; do not make the bucket public.
5. Treat a cross-workspace URL or object disclosure as a security incident and
   rotate affected credentials after containment.

## Music, Voice, And Quality

For music or vocal failure, inspect the `ProviderJob`, provider response,
selected engine/model, rights inputs, asset kind, content hash, measured quality,
and alignment evidence.

- `spoken_guide` is not singing.
- `full_mix` is not an instrumental or isolated vocal.
- `unmeasured`, placeholder, failed, or unverified assets must not be approved.
- A missing local DSP dependency is an environment failure, not a passed ear test.

For voice training, verify a current consent record, signer identity, consent
hash, private immutable dataset, segment/duration evidence, and pinned trainer
configuration. External datasets remain blocked unless explicitly allowed.

## Release And Distribution

When release certification is blocked, inspect each failed gate rather than
changing status:

- approved, measured master with immutable hash
- approved artwork with verified dimensions/hash
- rights receipt and current user attestations
- native-language review where required
- release metadata, splits, and identifier policy
- verified export archive and manifest

A distribution submission is confirmed only when the configured partner returns
a non-empty external ID with `submitted` or `accepted`. That is not proof that
the release is live. The song remains `EXPORTED` and non-public until a valid signed
`/webhooks/distributor` event reports `live`.

For an incident, correlate `Release.externalId`, `DistributionEvent.eventId`,
payload hash, event status, applied flag, and the partner record. Duplicate events
with the same body are idempotent; the same event ID with a different body is a
conflict. A failed or cancelled callback cannot downgrade a release already
confirmed live. Retry outbound submission with the same idempotency key only
after determining whether the partner accepted the first request.

## Deployment And Migration

A production deployment uses `pnpm --filter @afrohit/db migrate:safe`.

If it fails:

1. Stop the rollout and preserve the migration logs.
2. Check database reachability, locks, migration status, disk, and backup health.
3. If the one-time legacy baseline reports `resolving`, rerun the same command;
   it resumes missing migration resolutions.
4. Do not run `db push`, delete `_prisma_migrations`, or reset the database.
5. Escalate any destructive or ambiguous schema change for a backup-tested
   migration.

## Disaster Recovery

1. Freeze writes and scheduled spend.
2. Select a coordinated PostgreSQL and object-storage recovery point.
3. Restore to an isolated environment and run migration plus integrity checks.
4. Reconcile PayPal events, provider jobs, credit reversals, export hashes, and
   distributor external IDs after the recovery timestamp.
5. Validate tenant isolation and private media access before reopening traffic.
6. Document the root cause, financial impact, affected users, and prevention
   work.

Backups are not proven until restore drills succeed.
