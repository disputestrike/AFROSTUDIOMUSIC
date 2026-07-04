# Deploying AfroHit Studio to Railway

Three services + Postgres (default, no extensions) + Redis + object storage.

## 1. Push the repo to GitHub

```bash
git init
git add .
git commit -m "Initial AfroHit Studio commit"
git remote add origin https://github.com/<you>/afrohit-studio.git
git push -u origin main
```

`.gitignore` already excludes `apps/*/.env`, `node_modules`, `dist`, and `.next` — only templates (`.env.example`) get committed.

## 2. Create the Railway project

In the Railway dashboard:

1. **New Project** → **Deploy from GitHub repo** → pick your repo.
2. Railway will offer to detect services. **Cancel** that and create them manually so we control the root-directory mapping.

## 3. Provision databases

From the Railway dashboard, add three plugins:

| Plugin | Notes |
|---|---|
| **PostgreSQL** | The **default** PostgreSQL template is fine — no extensions required. |
| **Redis** | Default config is fine. |
| **Object Storage** | Or connect Cloudflare R2 / AWS S3 via `S3_*` env vars. |

**Connect DB + Redis to `api` AND `worker`** (both use Prisma + BullMQ). The `web` service needs **neither** — it only talks to the API over HTTP. In each service: Variables → **Add Reference** → `DATABASE_URL` (from Postgres) and `REDIS_URL` (from Redis).

Railway auto-injects `DATABASE_URL`, `REDIS_URL`, and `S3_*` when referenced.

## 4. Create the three services

For each service, do **New Service** → **GitHub Repo** → set:

| Service | Root Directory | Watch paths |
|---|---|---|
| `api` | `apps/api` | `apps/api/**`, `packages/**` |
| `worker` | `apps/worker` | `apps/worker/**`, `packages/**` |
| `web` | `apps/web` | `apps/web/**`, `packages/shared/**` |

Each service has its own `railway.json` (already committed) with a `buildCommand` that installs the workspace (with dev deps) and compiles the shared packages in dependency order (`shared → db → ai → app`) before building the service. Railway's default builder (Railpack) runs it automatically. Keep each service's **Root Directory at the repo root** (`/`) — the build commands are pnpm workspace filters that must run from root.

**Note on ffmpeg (worker):** the worker boots and runs all stub jobs without ffmpeg. Real mix/master needs the `ffmpeg` binary — add it when you move to real audio, either by switching the worker service to a Dockerfile (`apt-get install -y ffmpeg`) or a Railpack package step. Until then, mix/master jobs fail with a clear "ffmpeg not found" message; nothing else is affected.

Link each service to the Postgres + Redis plugins via the **Variables** tab → **Add Reference**.

## 5. Set environment variables per service

### `api` service

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Auto-injected from Postgres plugin |
| `REDIS_URL` | Auto-injected from Redis plugin |
| `OPENAI_API_KEY` | Your real key (or `sk-...` placeholder if `STUB_AI=1`) |
| `AUTH_MODE` | `internal` — no external auth, one default workspace (current mode) |
| `INTERNAL_WORKSPACE_SLUG` | `studio` (default) |
| `INTERNAL_OWNER_EMAIL` | `owner@afrohit.local` (default) |
| `PAYPAL_MODE` | `sandbox` or `live` |
| `PAYPAL_CLIENT_ID` | From PayPal app |
| `PAYPAL_CLIENT_SECRET` | From PayPal app |
| `PAYPAL_WEBHOOK_ID` | From PayPal webhook setup |
| `PAYPAL_PLAN_STARTER` / `_CREATOR` / `_PRO` / `_STUDIO` | Plan IDs (start with `P-...`) |
| `INTERNAL_API_SECRET` | Long random string, shared with worker |
| `S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY` `S3_SECRET_KEY` | Auto from Railway Object Storage, or your R2/S3 credentials |
| `S3_PUBLIC_BASE_URL` | CDN URL (e.g. `https://cdn.afrohit.studio`) |
| `WEB_URL` | The web service's public domain |
| `API_URL` | The api service's public domain |

### `worker` service

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Auto-injected |
| `REDIS_URL` | Auto-injected |
| `OPENAI_API_KEY` | Your real key |
| `INTERNAL_API_SECRET` | Same string as api |
| `S3_*` | Same as api |
| `MUSIC_PROVIDER` | `eleven` / `stable_audio` / `mubert` / `stub` |
| `ELEVEN_API_KEY` etc. | Whichever providers you enabled |
| `VOICE_PROVIDER` | `eleven` / `stub` |
| `VIDEO_PROVIDER` | `veo` / `sora` / `stub` |
| `IMAGE_PROVIDER` | `openai` / `stub` |
| `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_SERVICE_ACCOUNT_JSON_B64` | If using Veo |
| `WORKER_CONCURRENCY` | Default 4 |

### `web` service

Internal mode needs **no auth keys** — the app is open and the API resolves the single default workspace.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Public api URL |
| `API_URL` | Same (server-side fetches) |

> **Auth:** currently `AUTH_MODE=internal` — the web app has no login and every request maps to one default workspace. This is for internal/single-tenant use only; do not expose the public URL widely. When you want real accounts, add a `google` mode in `apps/api/src/middleware/auth.ts` and a sign-in page — the seam is already there.

## 6. First deploy

Push to `main`. Railway will:

1. Build each service (compiles `@afrohit/shared`, `@afrohit/db`, `@afrohit/ai`, then the app).
2. On the **api** service, the `preDeployCommand` runs `prisma db push` — it creates every table on the plain Postgres (no extensions, no migration-history fragility), then `node dist/index.js` boots. No manual index step, no PostGIS.
3. Internal auth mode creates the default workspace on the first request — nothing to seed.

> Already have a Postgres with a **failed migration** from an earlier attempt? No reset needed. `db push` ignores migration history and creates the tables fresh (the old attempt died on the first `CREATE EXTENSION` line, so no tables exist).

(Optional) seed extra demo data:

```bash
railway run --service api -- pnpm --filter @afrohit/db seed
```

## 7. Wire webhooks (point at the api service's public domain)

| Webhook | URL | Events |
|---|---|---|
| PayPal | `https://<api>.up.railway.app/webhooks/paypal` | `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.CAPTURE.COMPLETED` |
| Music provider (if used) | `https://<api>.up.railway.app/webhooks/music` | Provider-specific |

## 8. Smoke test the live deployment

```bash
# From your laptop, point the integration suite at production
API_URL=https://api.afrohit.studio node scripts/integration-test.mjs
```

The runner:

- Hits `/health` and `/docs/json`
- Exercises every authenticated route family with 401 expectations
- Creates an artist → project → brief → hooks → lyrics → beat → vocal → mix → cover art → storyboard → rights receipt → export bundle
- Logs PostGIS share events from 4 countries and queries `/share/heatmap`
- Verifies the export gate (412 without receipt, 202 with)
- Verifies webhook signature rejection

Expected: every phase prints `✓`, suite exits 0.

## 9. Costs

See `docs/COSTS.md`. Starting estimate: **$30-$150/month** during light testing.

## Health checks

| URL | What |
|---|---|
| `https://<web>/api/health` | web app readiness |
| `https://<api>/health` | API readiness |
| `https://<api>/docs` | OpenAPI Swagger UI |

## Troubleshooting

### Migration / `P3009` failed-migration errors

Shouldn't happen anymore — the schema needs no extensions and the api uses
`prisma db push` (which ignores migration history). If you see a leftover
failed `_prisma_migrations` row from an old attempt, it's harmless; `db push`
creates the tables regardless. No DB reset needed.

### Worker won't connect to Redis

Make sure you **linked** the Redis plugin to the worker service (Variables → Add Reference → `REDIS_URL`). Just having Redis in the project isn't enough.

### Migration deploy hangs

Check `DATABASE_URL` is set on the **api** service. The startCommand runs `prisma migrate deploy && node dist/index.js` — both need DB access.

### "@afrohit/shared not found" at build time

You're missing a build phase. The `apps/*/railway.json` files build the workspace packages in the right order. If you customized them, ensure `shared → db → ai → app` order.
