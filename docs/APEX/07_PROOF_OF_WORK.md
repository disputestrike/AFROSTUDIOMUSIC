# 07 — PROOF OF WORK (Apex Phase 5)

_All evidence real, captured against production (afrohitapi-production, commit
`0cf5d14`) on 2026-07-06, or local runs with exit codes. Nothing simulated._

## 1. Static

| Check | Result |
|---|---|
| `pnpm -w typecheck` (9 packages) | ✅ exit 0 |
| `prisma generate` | ✅ clean |
| `any` census | 0 |

## 2. Unit + integration (deterministic, zero API spend)

| Suite | Result |
|---|---|
| `scripts/test-stub-ai.mjs` (brief→hooks→taste→lyrics→rights→receipt-hash) | ✅ 28/28 PASS |
| `scripts/test-stub-providers.mjs` (all provider adapters) | ✅ 18/18 PASS |
| Mock-only caveat | stub suites pass with all third parties offline BY DESIGN; live behavior proven in §3 |
| Untested (honest) | measureAudioQuality parser unit tests; chat gen-guard unit tests; browser e2e — LEDGER (P2) |

## 3. K2 summit runs (live production, this deploy)

| Journey | Result | Evidence |
|---|---|---|
| Pre-flight before spend (NEW) | **PASS** | `GET /billing/preflight` → `{ok:true, mode:"internal", usedToday:42, cap:300, remainingToday:258}` |
| Learn-My-Sound profile (NEW) | **PASS** | `GET /taste/sound-profile` → 8 learned references, per-genre counts + real trait lines ("soft-punchy afrobeats kit… rimshot on the '3'…") |
| Input validation (NEW zod) | **PASS** | empty hook text → 400 `"body/text Hook text cannot be empty."` — clean, no stack leak |
| **THE CORE JOB — full song, GLOBAL genre (latin_pop), end-to-end** | **PASS — SUMMITED** | brief → bilingual hook ("El mar borró tu nombre en la arena / But I still feel your hand in mine, under palm trees leaning"), A&R 7.2 → lyrics → sung render SUCCEEDED in 40s → **QC verdict `pass`, flags [], −15.6 LUFS, LRA 5.4, crest 16.9 dB, 150s** → `bestOf {tried:2, rendered:1, pickedScore:233}` |
| Outcome verified (not just "no error") | **PASS** | the render was MEASURED (ebur128/astats) and judged `pass` — accountability gap closed |
| After-"no" path | **PASS** | cap accounting live (42→47 used across the run); Create's limit error links to Billing/catalog (code path, K2-1 shape confirms data) |
| Failure honesty | **PASS (this deploy + prior)** | bestOf shows 1 of 2 candidates failed → system survived, shipped winner, recorded provenance; prior session: failed providers fail with real reasons, never fake audio |
| Prior-session journeys still standing | **PASS (previously proven)** | mic Shazam listen; reuse-lyrics 201 / reuse-instrumental guard / re-sing 202; unreleased master leak → null; YT import → 422; SSRF probes → 400; release green-light blocks until splits+native review |
| Pay / upgrade / cancel | **BLOCKED (safely)** | PayPal wired + webhook idempotent (code-proven); executing a real payment requires a real transaction — Owner action, per protocol's irreversible-spend rule |
| Opt-out / STOP cross-channel | **N/A** | no outbound messaging product surface (email is transactional only) |

## 4. Defensive hardening pass (our own repo)

- Authorization: workspaceId scoping verified across all 29 user-data routes by the data-safety sweep; object-level guards (assertOwnedKey) on storage attach.
- Input validation: all POST/PATCH bodies now zod-validated (last three gaps closed in 0cf5d14).
- Rate limits: global 240/min; expensive paths cost-capped by credits + MAX_DAILY_GENERATIONS (per-route extra limits = P2 ledger).
- Secrets: none printed anywhere in this docs pack; `.env` gitignored; keys pasted in chat earlier this project were flagged to the Owner for rotation (standing item).
- Error hygiene: raw provider/internal errors no longer echoed to clients (uploads/settings/drop/SSE).
- Dependency audit: **UNSURE — to verify, run `pnpm audit --prod` and check for criticals** (not run this pass; ledger P2).

## 5. Load sanity

Not load-tested this run (single-owner internal product; 10× of current traffic ≈
a handful of concurrent users, comfortably inside one Railway instance + BullMQ
concurrency 4). First real bottlenecks are already named for the pre-public gate:
cachedIdentity singleton, in-handler polling, base64 upload proxy, no PgBouncer
(PATH-TO-MILLIONS P3). **BLOCKED until multi-tenant is scheduled — deliberate.**

## New finding from K2 (added to ledger)

- P3: SoundReference.genre not normalized on write ("Afro Fusion" vs "afro_fusion"
  count separately in the profile). Fix: normalize to the GENRES enum key in
  processAnalyze before create.
