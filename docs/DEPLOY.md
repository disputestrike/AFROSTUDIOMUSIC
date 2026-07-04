# Deploying AfroHit Studio to Railway

Three services + Postgres (with PostGIS + pgvector) + Redis + object storage.

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
| **PostgreSQL** | Use the **PostgreSQL with PostGIS** template (one click in the marketplace). pgvector is included in the PostGIS image. |
| **Redis** | Default config is fine. |
| **Object Storage** | Or alternatively connect Cloudflare R2 / AWS S3 by setting `S3_*` env vars manually. |

Railway will auto-inject `DATABASE_URL`, `REDIS_URL`, and `S3_*` vars when you link these plugins to your services in step 4.

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
| `OPENAI_API_KEY` | Your real key |
| `CLERK_SECRET_KEY` | From Clerk dashboard |
| `CLERK_WEBHOOK_SECRET` | From Clerk webhook setup |
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

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Clerk |
| `CLERK_SECRET_KEY` | From Clerk (also needs to be on web for `@clerk/nextjs/server`) |
| `NEXT_PUBLIC_API_URL` | Public api URL |
| `API_URL` | Same (server-side fetches) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` |  |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up` |  |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/studio` |  |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/studio` |  |

## 6. First deploy

Push to `main`. Railway will:

1. Run nixpacks build for each service (compiles `@afrohit/shared`, `@afrohit/db`, `@afrohit/ai`, then the app).
2. On the **api** service start: `prisma migrate deploy` runs first (uses the 880-line init migration), then `node dist/index.js` boots. **The migration applies PostGIS + pgvector + uuid-ossp + pg_trgm extensions and all tables in one transaction.**
3. The post-deploy PostGIS index script must be run **once** by hand (Prisma can't express GIST/HNSW indexes natively):

```bash
# From your laptop, against the Railway Postgres
railway run --service api -- bash -c 'psql "$DATABASE_URL" -f packages/db/sql/01-postgis-indexes.sql'
```

4. (Optional) seed a demo workspace:

```bash
railway run --service api -- pnpm --filter @afrohit/db seed
```

## 7. Wire webhooks (point at the api service's public domain)

| Webhook | URL | Events |
|---|---|---|
| Clerk | `https://<api>.up.railway.app/webhooks/clerk` | `user.created`, `user.updated` |
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

### "extension 'postgis' is not allowed" on migrate

The default Railway Postgres plugin does not include PostGIS. Use the **PostGIS** template from the Railway marketplace instead. (pgvector is in the same image.)

### Worker won't connect to Redis

Make sure you **linked** the Redis plugin to the worker service (Variables → Add Reference → `REDIS_URL`). Just having Redis in the project isn't enough.

### Migration deploy hangs

Check `DATABASE_URL` is set on the **api** service. The startCommand runs `prisma migrate deploy && node dist/index.js` — both need DB access.

### "@afrohit/shared not found" at build time

You're missing a build phase. The `apps/*/railway.json` files build the workspace packages in the right order. If you customized them, ensure `shared → db → ai → app` order.
