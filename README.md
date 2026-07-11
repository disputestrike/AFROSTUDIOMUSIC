# AfroHit Studio

> An AI executive producer for artists everywhere — Afro genres first, all genres
> now: it builds a per-artist sound memory from tracks you own (retrieval that
> steers future generations — RAG, not model training), writes and sings full
> records in your lane through a music engine, judges its own output like an A&R,
> and packages export-ready songs with rights receipts. Driven by a Studio Chat,
> a Create front door, and a catalog that's a
> workstation, not a shelf.

The moat is the loop, not any single model: **listen → learn → generate →
score-own-output → fix → release → better next song** (see
[docs/STRATEGY.md](docs/STRATEGY.md)).

## What's in the box

| Layer | What it does | Tech |
|---|---|---|
| `apps/web` | Next.js 15 app — Create, Studio Chat (SSE), Catalog workstation, Listen (Shazam-style), Mixer, Billing, Admin | Next.js, React, Tailwind |
| `apps/api` | REST API (`/api/v1`, 67 routes), tool-calling chat with per-request generation guard, credits + caps, PayPal | Fastify 5, Zod, Prisma |
| `apps/worker` | Async media jobs: music (best-of-N + measured QC), mix/master (ffmpeg chains), stems (Demucs), listen/learn, snippets, crons | BullMQ, system ffmpeg |
| `packages/db` | Prisma schema (plain Postgres — no extensions required) | Prisma 5, PostgreSQL |
| `packages/ai` | Claude-first generation, provider adapters (Suno/ACE-Step/MiniMax/MusicGen/…), Sound DNA (22 genres + trends), hit-craft library, A&R director, hit predictor, deep-listen | Anthropic + OpenAI SDKs, Replicate |
| `packages/shared` | Cross-package Zod schemas, types, constants (genres, languages, plans) | Zod, TypeScript |

## The intelligence layer (what makes it different)

- **Sound DNA** — production recipes for 22 genres (11 Afro + 11 global), merged
  with web-researched current-trend enrichment. Injected into every generation.
- **Hit-craft library** — 8 lyric success-modes distilled from a comparative study
  of most-streamed Afrobeats records; drives both writing and A&R judging.
- **Listen & learn** — upload/mic-capture a track you own → layered analysis
  (Whisper + ffmpeg metrics + Claude) → stored as a SoundReference → future songs
  rebuild that sound. Per-workspace; never cross-tenant.
- **Best-of-N QC** — when `BEST_OF_N > 1`, a render makes N takes in parallel,
  measures each (loudness range, crest, clipping, lane compliance) and ships the
  best. Default is 1 take (set `BEST_OF_N=2+` to trade provider cost for quality).
- **A&R** — multi-model (GPT drafts, Claude directs) with explicit virality
  scoring + a 12-dimension hit predictor that does not flatter.
- **Hard honesty laws** — no fake audio ever (failed renders fail with the real
  reason); no YouTube/Spotify ripping (imports refuse those hosts); native-language
  lines block release until human sign-off; AI disclosure in every export.

## Local development

```bash
pnpm install
cp .env.example .env       # fill DATABASE_URL, REDIS_URL, S3_*, OPENAI_API_KEY;
                           # REPLICATE_API_TOKEN (or paste in-app) for real music
pnpm db:push
pnpm dev
```

- **Web**: http://localhost:3000 · **API**: http://localhost:4000 (`/health`, OpenAPI at `/docs`)
- `STUB_AI=1 node scripts/test-stub-ai.mjs` runs the deterministic suite with zero API spend.

## Deployment

Railway: web + api + worker + Postgres + Redis; storage on Cloudflare R2 (`S3_*`
vars). Deploys run `prisma db push`. Auth is **internal single-owner mode**
(`AUTH_MODE=internal`) until public launch — do not expose the API publicly
without a gate in front. Quality levers: set `SUNO_API_KEY` on api + worker for
Suno V5 full-song rendering (else full songs render on MiniMax via Replicate);
`BEST_OF_N` (default 1) controls takes per song.

## Plans

| Plan | Price/mo | What's included |
|---|---|---|
| Starter | $19 | Hooks + lyrics + 5 cover-art renders |
| Creator | $49 | + 20 demo songs, exports |
| Pro Artist | $149 | + voice profile, 60 demos, release kits |
| Studio | $399+ | Team seats, bulk generation, priority queue |

(Billing is wired via PayPal; the credit wall is bypassed in internal mode by design.)

## Architecture decisions

- **Provider-agnostic** — every AI call goes through an adapter in `packages/ai/src/providers`; engines are swappable per request.
- **Claude is the brain** — creative generation routes Claude-first with OpenAI fallback (`generateJson`).
- **Approval gates** — brief → hook → lyrics → beat → voice → mix → rights → release. No skipping.
- **Taste over volume** — cheap text drafts first; expensive audio only after choice; best-of-N picks the strongest take.
- **Outcome verification** — rendered audio is measured (ebur128/astats), verdicts are stored honestly (`pass/weak/fail`), and release green-lights refuse until splits + native review pass.

## License

Proprietary. © 2026 AfroHit Studio.
