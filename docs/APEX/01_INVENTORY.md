# 01 — INVENTORY OF REALITY (Apex Phase 1)

_Evidence captured 2026-07-06 at commit `a58ef7b` on `main` (clean tree, synced to
github.com/disputestrike/AFROSTUDIOMUSIC). Exit codes recorded. No secret values._

## Build health (verified, not claimed)

| Check | Result | Evidence |
|---|---|---|
| Typecheck (9 packages) | ✅ exit 0 | `pnpm -w typecheck` → "Tasks: 9 successful" |
| Build | ✅ exit 0 | turbo build, all green |
| Stub AI suite | ✅ 28/28 PASS | `node scripts/test-stub-ai.mjs` |
| Stub provider suite | ✅ 18/18 PASS | `node scripts/test-stub-providers.mjs` |
| `any` census (api/worker/ai/shared src) | **0** | rg `: any\b|as any\b` → 0 |
| TODO/FIXME census | **2** (benign) | rg TODO/FIXME/HACK → 2 |

## Scale

- 184 tracked files, 136 TS/TSX. Monorepo: `apps/{web,api,worker}` + `packages/{db,ai,shared}`.
- **67 API route handlers** across 24 route files (`apps/api/src/routes/*`), all under `/api/v1`, plus `/health` and `/webhooks`.
- **13 web pages**: create, studio (chat), projects(+detail), catalog, listen, billing(+success/cancel), settings, admin, landing `/`, public share `/r/[id]`.

## Stack & infrastructure

- Web: Next.js 15.5 (App Router). API: Fastify 5 (+helmet, cors, rate-limit 240/min, swagger at /docs). Worker: BullMQ + system ffmpeg (Railway nixpacks).
- DB: Prisma 5.22 / Postgres (Railway), deployed via `prisma db push`. Redis: BullMQ queues (music, voice, image, video, master, export).
- Storage: Cloudflare R2 via S3 client. Payments: PayPal (plans + webhook). Email: Resend. Observability: Sentry + PostHog (env-gated).
- AI: Claude-first `generateJson` (claude-sonnet-5) with OpenAI fallback; music engines suno/ace_step/minimax/replicate-musicgen/eleven/stable_audio/mubert/stub behind one adapter interface (packages/ai/src/providers/music.ts:624).

## The intelligence layer (what makes it alive)

- **Sound DNA**: 11 Afro + 11 global genres, full production recipes (packages/ai/src/sound-dna/recipes.ts + global-genres.ts) + 2026 trend enrichment (enrichment.ts) merged at lookup (index.ts).
- **Hit-craft library**: 8 lyric success-modes + verified craft blocks + A&R rubric (packages/ai/src/prompts/hit-craft.ts), injected into hook writer, lyric gen, and A&R director.
- **Listen & learn**: layered analyzeAudio (Whisper + ffmpeg metrics + optional omni + Claude synthesis, packages/ai/src/analyze.ts) → SoundReference per workspace/genre → learnedReferenceBrief injected into generation (apps/api/src/lib/learned.ts).
- **Best-of-N QC**: N parallel renders, measured QC (ebur128+astats), ship the best (apps/worker/src/processors/music.ts; apps/worker/src/lib/ffmpeg.ts:measureAudioQuality).
- **A&R**: multi-model (GPT drafts → Claude director) with explicit virality dims + hit predictor (12 dims) + taste memory feedback loop.

## Env hygiene (GAP — feeds ledger)

Referenced in code but **missing from `.env.example`**: `REPLICATE_API_TOKEN` (the
primary music key!), `MAX_DAILY_GENERATIONS`, `MIN_HOOK_SCORE`, `ISRC_PREFIX`,
`YOUTUBE_API_KEY`, `BRAVE_API_KEY`, `AUDIOMACK_API_KEY`, `DISTRIBUTOR`,
`DISTRIBUTOR_API_KEY`, `SUNO_CALLBACK_URL`, `WORKER_CONCURRENCY`, `PORT`,
`REPLICATE_*_MODEL/_VERSION` overrides (~10 alias/override vars). No fail-fast
startup env validator exists (config read lazily at call time). → GAP-ENV.

## Known deliberate deferrals (NOT new findings)

- AUTH_MODE=internal single-owner; real auth = PATH-TO-MILLIONS P2 (Owner directive: hold until public).
- `Workspace.musicApiKey` plaintext at rest — blocked on operator setting `ENCRYPTION_KEY` on api+worker.
- `prisma db push` instead of migrations — acceptable single-owner; must change before multi-tenant.

## Jobs, crons, webhooks

- Worker crons: Morning Drop (daily autopilot song) + release radar (apps/worker/src — in-process cron).
- Webhook: PayPal (apps/api/src/routes/webhooks.ts).
- Queues: music/voice/image/video/master/export with BullMQ.

## Test coverage shape

- Deterministic stub suites (46 assertions) exercise: brief→hooks→taste→lyrics→rights→receipt-hash + all provider adapters.
- Live integration script (scripts/integration-test.mjs, 23 scenarios) requires running stack — used in prior sessions (22/23 → fixed to 23/23).
- **Gap**: no unit tests for `measureAudioQuality` parsing, `qcScore` ranking, chat gen-guard; no e2e browser tests. → GAP-TESTS.
