# 05 — GAP LEDGER (Apex Phase 3)

_All gaps from Phases 0–2 (drift register + 5 sweeps + 3 lenses + Owner's "do all").
Status updated as Phase 4 executes. FIXED = code merged this run; LEDGER = deferred
with reason; OWNER = needs an operator/content decision._

## P0

| # | Item | Evidence | Status |
|---|---|---|---|
| P0-1 | Daily credit wall hits AFTER the wait begins — no pre-flight check on Create | create/page.tsx:48-88 | **FIXED** — `GET /billing/preflight` + Create checks before producing; limit error links to Billing |
| P0-2 | No visible proof of quality on landing (no example songs w/ scores) | app/page.tsx:56 | **OWNER** — needs 3–5 real released songs Benjamin approves as public examples; code slice (QC/viral badges) already live in catalog/hooks |

## P1 — reliability

| # | Item | Status |
|---|---|---|
| P1-1 | PayPal webhook idempotency race (credit capture outside txn) — webhooks.ts:182 | **FIXED** — idempotency check + credit inside one transaction |
| P1-2 | /songs/:id/file loads whole file in memory, no cap — songs.ts | **FIXED** — 250MB cap + 413, streams via content-length passthrough |
| P1-3 | SSE `send()` unprotected (serialization/disconnect corrupts stream) — chat.ts | **FIXED** — safe send wrapper (try/catch + serialization guard) |
| P1-4 | Worker SIGTERM drops in-flight jobs — worker/index.ts | **FIXED** — graceful close with drain timeout |
| P1-5 | Provider generate/poll can hang indefinitely | **FIXED** — 12-min hard timeout race per candidate in processMusic |

## P1 — data safety

| # | Item | Status |
|---|---|---|
| P1-6 | Missing composite indexes: Song(workspaceId,createdAt), ChatMessage(threadId,createdAt), ProviderJob(workspaceId,createdAt) | **FIXED** — schema indexes added (applied on next deploy's db push) |
| P1-7 | TasteScore orphans on Song delete (no cascade) | **FIXED** — onDelete: Cascade |
| P1-8 | musicApiKey plaintext at rest | **LEDGER (known)** — blocked on operator setting ENCRYPTION_KEY on api+worker |

## P1 — input & protection

| # | Item | Status |
|---|---|---|
| P1-9 | POST /projects/:id/approve unvalidated body | **FIXED** — zod schema |
| P1-10 | POST /briefs polish rawIdea unvalidated/unbounded | **FIXED** — zod (max 2000) |
| P1-11 | PATCH /hooks/:hookId no schema | **FIXED** — zod schema |
| P1-12 | Raw error messages leaked to clients (uploads/settings/drop/SSE) | **FIXED** — client-safe messages, full detail to logs |

## P1 — experience & drift

| # | Item | Status |
|---|---|---|
| P1-13 | StudioChat unusable on mobile (fixed 240px sidebar) | **FIXED** — sidebar hidden on mobile, responsive grid |
| P1-14 | Create "daily limit" error strands user | **FIXED** — detects insufficient_credits → Billing link + explanation |
| P1-15 | Landing overclaims "in my voice" (voice UI not on Create) | **FIXED** — copy now truthful ("your voice or AI vocals — consent-gated") |
| P1-16 | Cover art empty alt text | **FIXED** — descriptive alt |
| P1-17 | Eval harness missing (incrementality unprovable) — strategist + DRIFT-2 | **FIXED (v1)** — scripts/eval-harness.mjs: golden briefs × genres → hooks + hit-predict → dated scorecard; run on demand (cost-gated by design) |
| P1-18 | ArtistMemoryChunk.embedding never computed (learning loop not semantic) | **FIXED** — recordFeedback computes + stores embedding (best-effort) |

## P2 (scheduled next; honest deferrals)

- Fire-and-forget telemetry swallowed silently (worker) — log at warn. **FIXED** (analyze.ts warns).
- Cron per-artist sequential without timeout — LEDGER (S, next pass).
- Mixer includes unapproved beats/vocals — **FIXED** (approved filter).
- Hook-edit title sync via updateMany heuristic — **FIXED** (clean read-compare-update).
- Reference-listen progress states (elapsed ticker exists; add spinner) — LEDGER (S).
- Artist DNA settings hidden from onboarding — LEDGER (M, UX pass with Owner).
- Share-link engagement metrics on /r/[id] — LEDGER (M, roadmap: distribution feedback).
- Rights receipt as signed PDF in export — LEDGER (L, roadmap).
- $5 onboarding grant LTV instrumentation — LEDGER (needs real users first).
- prisma migrate deploy instead of db push — LEDGER (pre-multi-tenant gate, PATH-TO-MILLIONS P3).
- Connection pooling / PgBouncer — LEDGER (P3 scale gate).

## Owner's "do all" (vision builds)

| Item | Status |
|---|---|
| Learn-My-Sound onboarding surface | **BUILT this run** — /listen "Learn my sound" multi-upload + live Sound Profile (GET /taste/sound-profile) |
| latin_pop + genre completeness | **BUILT this run** — latin_pop DNA+trends merged; 23 genres total |
| Self-improving loop | **PARTIAL** — eval harness v1 + semantic memory embeddings shipped; nightly trend-refresh cron LEDGER (needs Tavily quota + Owner cost sign-off) |
| Real-material layer ("exact beat") | **LEDGER (L)** — STRATEGY.md Phase 5; needs Owner licensing/cost decision on producer packs |

## Found by the BROWSER CLICK-THROUGH (post-K2 — curl tests could never catch these)

| # | Item | Status |
|---|---|---|
| CT-1 (**P1, the Owner's "does nothing" bug**) | /drop held one HTTP request open 1–3 min of LLM work — real-world connections die mid-request (observed live: `ECONNRESET → 500` after minutes of silent waiting). Create + Listen both consumed it synchronously. | **FIXED** (436f73f) — drop replies 202+jobId in ~1s, pipeline runs detached onto a ProviderJob, clients poll; verified live: probe returned `{jobId,status:queued}` in 1s |
| CT-2 (P1) | Listen page make-song showed only a tiny gray status line for the whole multi-minute flow — reads as a dead button; errors equally invisible | **FIXED** (690df77) — visible stepper + elapsed + loud error box + inline playback |
| CT-3 (P2) | Catalog rendered a FALSE "No songs yet" when the songs fetch failed (`.catch(() => [])`) — an outage masquerades as an empty library | **FIXED** — failure now renders an honest error panel distinct from empty |

## P3 (polish)

- 2 TODO comments; unused provider scaffolds (eleven/stable_audio/mubert docs-only) — keep, they're honest adapters; documented in 02_FEATURE_MATRIX.
- SoundReference.genre not normalized on write (found by K2-2: "Afro Fusion" vs "afro_fusion" split the profile counts) — **FIXED** post-K2: processAnalyze normalizes to the GENRES enum key before create.
