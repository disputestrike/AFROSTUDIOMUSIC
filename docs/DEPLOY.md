# Railway Deployment

AfroHit Studio deploys as three services plus PostgreSQL, Redis, and private
S3-compatible object storage:

- `apps/web`: Next.js
- `apps/api`: Fastify API and durable orchestration
- `apps/worker`: BullMQ workers in the supplied Dockerfile

Use the repository root as the build context. Point each Railway service at its
committed config: `apps/web/railway.json`, `apps/api/railway.json`, or
`apps/worker/railway.json`. The worker Dockerfile also expects the repository
root as its context.

## 1. Provision Dependencies

Create PostgreSQL 16, Redis 7, and an S3-compatible bucket. Link PostgreSQL and
Redis to both the API and worker. Give the API and worker the same private bucket
configuration.

The bucket must deny anonymous reads. New media is stored as private `s3://`
references and served through authenticated, short-lived URLs. Set
`STORAGE_PRIVATE_CONFIRMED=1` only after verifying that public access is disabled.

Enable provider-side backups, point-in-time recovery where available, object
versioning, and retention policies before accepting customer data.

## 2. Configure Production Secrets

Set `NODE_ENV=production` on every service. Keep secrets in Railway variables,
never in Git.

Required API safety values:

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `AUTH_MODE` | `jwt`; production refuses `internal` |
| `JWT_SECRET` | At least 32 random bytes |
| `IP_HASH_SECRET` | Independent random secret |
| `INTERNAL_API_SECRET` | At least 32 random bytes; shared with worker |
| `ENCRYPTION_KEY` | Key used by the encrypted workspace-secret store |
| `WEB_URL` / `API_URL` | Exact public HTTPS origins |
| `SESSION_COOKIE_SAMESITE` | `lax`, or `none` only for cross-site HTTPS |
| `S3_*` or `R2_*` | Private object-storage endpoint, bucket, and credentials |
| `STORAGE_PRIVATE_CONFIRMED` | `1` after access-policy verification |

Generate independent secrets, for example:

```bash
openssl rand -base64 48
```

Set `ALLOW_PUBLIC_SIGNUP=1` only while public registration is intended. Otherwise
create or invite accounts through an operator-controlled process.

Required worker values are `DATABASE_URL`, `REDIS_URL`,
`INTERNAL_API_SECRET`, `ENCRYPTION_KEY`, storage variables, and the credentials
for every enabled media provider. Unknown or unconfigured production providers
must fail closed.

Set `NEXT_PUBLIC_API_URL` and server-side `API_URL` on the web service. They must
point to the public API origin.

Use `.env.example` as the complete variable inventory. Do not set
`ALLOW_STUB_AUDIO=1` in production.

## 3. Configure Billing

Create the PayPal product and plan IDs, then set:

- `PAYPAL_MODE=live`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_PLAN_STARTER`
- `PAYPAL_PLAN_CREATOR`
- `PAYPAL_PLAN_PRO`
- `PAYPAL_PLAN_STUDIO`

Register `https://<api-host>/webhooks/paypal` for the subscription and payment
events used by the application. The API verifies PayPal's webhook signature,
records each event once, and grants credits only through a matching durable
billing intent.

Test order capture and subscription activation in PayPal sandbox before changing
to live mode. A successful HTTP response alone is not proof that money or credits
moved; verify the `BillingIntent`, `BillingEvent`, and `CreditLedger` records.

## 4. Configure Media Providers

Configure only providers whose account, model version, rights, rate limit, and
commercial-use terms have been reviewed. Pin model/version overrides where the
adapter requires them.

The production worker contains ffmpeg, librosa, pyloudnorm, soundfile, and CPU
Demucs. Do not replace it with a generic Node image: mix/master, deep measurement,
and stem-aware quality gates depend on those binaries.

If a Suno-compatible gateway is enabled, its callback may target
`https://<api-host>/webhooks/suno`; the callback is intentionally a no-op and the
worker's authenticated polling remains the source of truth.

## 5. Configure Distribution

The application hands a certified release bundle to an approved HTTPS partner
endpoint. Set:

- `DISTRIBUTOR`
- `DISTRIBUTOR_WEBHOOK_URL`
- `DISTRIBUTOR_WEBHOOK_SECRET` with at least 32 bytes

The outbound request carries `x-afrohit-timestamp`, an HMAC-SHA256
`x-afrohit-signature`, and an `idempotency-key`. The partner must return JSON with
`status` equal to `submitted` or `accepted` and a non-empty `externalId`.
That confirmation records a submission only; it does not publish the song or
mark it released.

Configure the partner to POST lifecycle events to
`https://<api-host>/webhooks/distributor`. Each raw JSON body must carry the same
timestamp and signature headers, signed as
`HMAC_SHA256(secret, timestamp + "." + rawBody)`, and contain:

```json
{
  "schemaVersion": 1,
  "event": "release.status",
  "eventId": "unique-partner-event-id",
  "externalId": "the-submission-external-id",
  "status": "accepted",
  "occurredAt": "2026-07-13T00:00:00.000Z",
  "channels": {}
}
```

Allowed callback statuses are `accepted`, `live`, `failed`, and `cancelled`.
Only a valid, fresh, idempotent `live` callback moves the song to `RELEASED`.
The endpoint must be credential-free HTTPS and pass the API's network-safety
checks. Redirects, private-network destinations, oversized responses, stale
signatures, replay conflicts, and unverified success payloads are rejected.

## 6. Apply Migrations

The API Railway pre-deploy hook runs:

```bash
pnpm --filter @afrohit/db migrate:safe
```

Behavior:

1. An empty database receives `prisma migrate deploy`.
2. A database with Prisma history receives pending migrations normally.
3. A legacy database previously managed by `db push` is reconciled once:
   privacy and evidence backfills run, SQL-only constraints are restored, every
   migration is resolved, and a durable baseline marker is written.
4. An interrupted baseline resumes without replaying charges or overwriting
   newer evidence classifications.
A completed legacy baseline does not suppress later migrations. Every subsequent
deploy still runs `prisma migrate deploy` and applies only pending migrations.

Migration `20260713072000_credit_usage_units` backfills ledger `creditKey`,
`units`, and `planUnits`, then adds constraints and indexes used by spend caps.
Take a tested backup and schedule the first production application during a
low-write window because the backfill updates historical ledger rows and index
creation can contend with billing traffic.

Take a database backup before the first deployment of this transition. Never run
`prisma db push`, edit `_prisma_migrations`, or reset production as an incident
shortcut. A failed migration blocks deployment and must be investigated.

## 7. Deploy And Verify

Deploy the worker, API, and web services from the same commit. Then verify:

```bash
curl -fsS https://<api-host>/health
curl -fsS https://<api-host>/health/ready
curl -fsS https://<web-host>/api/health
```

`/health/ready` reports database, Redis, worker-heartbeat, and outbox state.
Railway treats database unavailability as a failed readiness check. Operators
must also require `systemOk: true`; a 200 response with `systemOk: false` means
the API is alive but media production is degraded.

Before public traffic:

```bash
pnpm run lint
pnpm run verify
pnpm run build
pnpm run security:audit
```

Also execute controlled live tests for sign-up/sign-in, PayPal sandbox capture,
one job per enabled provider, private media playback, automatic failed-job
refund, rights/export certification, and distributor sandbox submission. Record
the asset IDs and external transaction IDs; screenshots alone are not evidence.

## 8. Rollback

Roll application services back to a previously verified commit only when that
commit is compatible with the deployed schema. Prisma migrations are forward
changes; do not delete migration rows or reverse DDL during an outage.

For data loss, restore PostgreSQL and object storage to a coordinated recovery
point, then reconcile provider jobs and billing events by immutable external IDs.
See `docs/RUNBOOK.md`.
