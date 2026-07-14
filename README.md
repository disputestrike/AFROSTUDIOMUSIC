# AfroHit Studio

AfroHit Studio is a multi-tenant music production workspace built around an
evidence loop: listen, learn, generate, measure, revise, certify, release, and
learn again. African and diaspora lanes are first-class, while the architecture
supports broader genres through the same provider and quality contracts.

This repository is a production system, not a claim that its songs already
outperform Suno. Competitive claims are blocked until the blind benchmark has
enough independent judgments, genre coverage, a positive 95% confidence floor,
and no material quality-dimension deficit.

## Product Surfaces

- Create and Studio Chat for briefs, hooks, lyrics, instrumentals, vocals, and songs.
- Catalog, mixer, mastering, rights, artwork, release bundles, and distribution handoff.
- Listen, Zap, materials, and learned references with rights and proof-of-use records.
- Voice consent, immutable training datasets, owned-voice training, and vocal verification.
- Billing, credit packs, plan limits, durable job dispatch, automatic refunds, and admin controls.
- Competitive A/B benchmarking with frozen assets and server-side blind ordering.

## Architecture

| Package | Responsibility |
|---|---|
| `apps/web` | Next.js application and operational product UI |
| `apps/api` | Fastify API, JWT sessions, tenant authorization, billing, orchestration, and release gates |
| `apps/worker` | BullMQ media jobs, provider polling, DSP analysis, stems, mixing, mastering, and heartbeats |
| `packages/ai` | Language, music, voice, image, analysis, routing, and genre intelligence |
| `packages/db` | Prisma schema, migrations, encrypted workspace secrets, and durable ledgers |
| `packages/shared` | Contracts, schemas, credit prices, release evidence, and benchmark statistics |

PostgreSQL is the system of record, Redis carries queues, and private
S3-compatible storage holds media. The worker image includes ffmpeg, the pinned
Python DSP stack, and CPU Demucs.

## Truth Gates

- Production requires JWT auth and refuses internal auth mode.
- Tenant-owned records and media references are checked against the active workspace.
- Paid jobs use idempotent charges, a transactional outbox, durable provider jobs,
  and one-time reversal ledgers on failure.
- Training materials record readiness, rights basis, content hash, and actual use.
- Spoken guides, full mixes, and unmeasured vocals cannot masquerade as isolated singing.
- Release bundles require verified audio, artwork, rights attestations, hashes, and manifests.
- Distribution reports success only after a configured partner returns an external ID.
- Placeholder media is development-only and cannot pass production or release gates.

## Local Development

Prerequisites: Node.js 20.19+, pnpm 9.12, Docker, and Git.

```bash
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm infra:up
pnpm --filter @afrohit/db migrate:deploy
pnpm dev
```

Fill the datastore, storage, auth, and provider values in `.env` before exercising
real media paths. Local internal auth is available for isolated development;
production always requires `AUTH_MODE=jwt`.

- Web: `http://localhost:3000`
- API liveness: `http://localhost:4000/health`
- API dependency state: `http://localhost:4000/health/ready`
- OpenAPI in non-production: `http://localhost:4000/docs`

## Verification

```bash
pnpm run lint
pnpm run verify
pnpm run build
pnpm run security:audit
```

CI additionally provisions clean PostgreSQL and Redis services, applies every
migration, and requires the pinned Python DSP proof stack. Real-provider
acceptance, human listening, payments, and distributor submissions require
separately controlled credentials and evidence; offline tests do not impersonate
those results. See [the current production-readiness evidence](docs/PRODUCTION_READINESS_2026-07-14.md)
for the exact pass, conditional, and blocked gates.

## Deployment And Operations

Use [docs/DEPLOY.md](docs/DEPLOY.md) for the Railway deployment contract,
[docs/RUNBOOK.md](docs/RUNBOOK.md) for incidents, and
[docs/COSTS.md](docs/COSTS.md) for cost accounting. Production deploys run
`pnpm --filter @afrohit/db migrate:safe`; direct production `db push` is not an
operator workflow.

## License

Proprietary. Copyright 2026 AfroHit Studio.
