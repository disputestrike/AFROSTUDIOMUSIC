# AfroHit Studio

> A responsible AI production studio for African and diaspora artists: hooks, lyrics, vocals, beats, visuals, release kits, and rights receipts — all driven by a single Studio Chat.

This is a multi-tenant SaaS, not a single-provider AI wrapper. The system is built around **taste + control + identity + rights**, with provider-agnostic adapters so we can swap music/voice/video models as the landscape changes.

## What's in the box

| Layer | What it does | Tech |
|---|---|---|
| `apps/web` | Next.js 15 app, Studio Chat command center, Labs UI, billing | Next.js, React, Tailwind, shadcn, Clerk |
| `apps/api` | REST API, tool-calling chat, auth, credits, provider orchestration | Fastify, Zod, Prisma, BullMQ, OpenAI |
| `apps/worker` | Async media jobs (music, voice, video, image, export, mix/master) | BullMQ, FFmpeg, Sharp |
| `packages/db` | Prisma schema with PostGIS + pgvector, migrations, seed | Prisma, PostgreSQL 16 |
| `packages/ai` | Provider adapters, taste engine, rights checker, prompt library | OpenAI SDK, Eleven, Stable Audio, Veo |
| `packages/shared` | Cross-package Zod schemas, types, constants (genres, languages) | Zod, TypeScript |
| `packages/prompts` | System prompts, scoring rubrics, language phrase banks | – |
| `infra/railway` | Railway service config | – |

## Local development (5 minutes)

```bash
# 1. install deps
pnpm install

# 2. start Postgres + Redis + MinIO
pnpm infra:up

# 3. copy env and fill in OPENAI_API_KEY at minimum
cp .env.example .env

# 4. push schema and run migrations
pnpm db:push
pnpm db:seed

# 5. start everything
pnpm dev
```

Visit:
- **Web**: http://localhost:3000
- **API**: http://localhost:4000 (health: `/health`, OpenAPI: `/docs`)
- **MinIO console**: http://localhost:9001 (afrohit / afrohitsecret)

## The core loop

```
Studio Chat → tool calls → queued jobs → artifacts → taste score → approval → rights receipt → export → share link with PostGIS heatmap
```

Every export carries a **rights receipt**: prompts used, models invoked, voice consent ID, sample sources, approval chain. No export without one.

## Deploying to Railway

See [docs/DEPLOY.md](docs/DEPLOY.md). One command per service:

```bash
railway up --service web
railway up --service api
railway up --service worker
```

Use Railway templates for **PostgreSQL (with PostGIS)** and **Redis**. Object storage is enabled via the Railway add-on, or swap `S3_*` env vars to Cloudflare R2.

## Project economics

| Plan | Price/mo | What's included |
|---|---|---|
| Starter | $19 | Hooks + lyrics + 5 cover-art renders |
| Creator | $49 | + 20 demo songs, MP3 exports, brand kit |
| Pro Artist | $149 | + voice profile, 60 demos, release kits, collaboration |
| Studio | $399+ | Team seats, bulk gen, priority queue, custom brand memory |
| Credits | $10 / $25 / $50 / $100 packs | Music, voice, image, video renders |

See [docs/COSTS.md](docs/COSTS.md) for unit-economics math.

## Architecture decisions

- **Provider-agnostic** — every AI call goes through an adapter in `packages/ai/src/providers`. Swap one line, not the codebase.
- **Approval gates** — `brief_approved → hook_approved → lyrics_approved → beat_approved → voice_approved → mix_approved → rights_approved → release_approved`. No skipping.
- **Taste over volume** — the system generates many drafts cheaply (text/hooks/lyrics first), and only spends expensive audio/video credits *after* approval.
- **Identity first** — every user starts with an Artist DNA profile (range, slang, lane, references, forbidden styles). No DNA, no generation.
- **PostGIS share links** — every release gets a short share link; clicks log approximate location for regional heatmaps.

## License

Proprietary. © 2026 AfroHit Studio.
