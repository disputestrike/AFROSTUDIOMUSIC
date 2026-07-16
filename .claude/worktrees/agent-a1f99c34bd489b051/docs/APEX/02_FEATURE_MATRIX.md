> **Historical snapshot (2026-07-06).** This document is retained for provenance
> and does not describe current production readiness. Use
> `docs/PRODUCTION_READINESS_2026-07-14.md` for current evidence and blockers.

# 02 — FEATURE MATRIX (Apex Phase 1)

_Every feature vs the Phase-0 vision. LIVE = verified working in production this
session (evidence noted). PARTIAL = works with a stated limit. MOCK-ONLY = stub/
scaffold. MISSING = in vision, not in code._

## Create → Release pipeline

| Feature | Status | Evidence |
|---|---|---|
| Front-door Create (22 genres, mood/bpm/lang/vibe/influence, engine picker) | **LIVE** | apps/web/app/(app)/create/page.tsx; global genres runtime-verified (pop 120bpm…) |
| Brief polish → hooks (A&R-scored) | **LIVE** | live proof 2026-07-05: director:claude, viralScore 8.2 |
| Hook select/edit (direct API, inline edit) | **LIVE** | PATCH hook verified live; ArtifactCard direct approve |
| Lyrics (hit-craft modes + Sound DNA + learned refs) | **LIVE** | a58ef7b wiring; lyric sample verified in-genre |
| Full sung song (ace_step/minimax; suno when key set) | **LIVE** (suno PARTIAL: needs SUNO_API_KEY) | worker music.ts:31; live renders all session |
| Best-of-N QC (parallel takes, ship the best) | **LIVE** | bestOf {tried:2, pickedScore:91} in prod meta |
| Measured QC verdict (loudness/LRA/crest, honest flags) | **LIVE** | qc verdict "weak/flat" on 20s test clip — honest |
| Mix (preset + console mixer) & Master (LUFS targets) | **LIVE** | prior live verifications; ffmpeg.ts chains |
| Stems / instrumental (Demucs) | **LIVE** | instrumental:true verified prior session |
| Catalog workstation (download/reuse×3/re-sing/duplicate/rename/hit-score) | **LIVE** | reuse-lyrics 201, re-sing 202 verified live |
| Snippet engine (9:16 TikTok clip) | **LIVE** | prior session verification |
| Rights spine (splits, ISRC/UPC, native-review gate, receipts) | **LIVE** | routes/release.ts; green-light blocks verified |
| Release kit export + share page /r/[id] | **LIVE** | prior verification; public.ts gated on releaseReady |
| Distribution (Audiomack seam) | **PARTIAL** | returns not_configured until DISTRIBUTOR key set — honest seam |

## Intelligence & learning

| Feature | Status | Evidence |
|---|---|---|
| Sound DNA (22 genres + 2026 trends) | **LIVE** | 341cf45/c87c7e1; runtime lookup verified |
| Hit-craft library (8 modes, A&R rubric) | **LIVE** | live hooks with viral scores post-a58ef7b |
| Listen (mic Shazam + upload) → deep profile | **LIVE** | 3-song proof: transcripts, LUFS, recipes |
| SoundReference learn library → generation | **LIVE** | worker analyze.ts:47; learned.ts injection |
| Taste memory (approve/reject feedback loop) | **LIVE** | artist-memory service; recordFeedback wired |
| Hit predictor (12-dim, honest) | **LIVE** | scored real song 42, empty shell 8 |
| Trend research (Tavily/YouTube metadata) | **PARTIAL** | wired; Benjamin's Tavily key quota-capped; YOUTUBE_API_KEY unset |
| Eval harness (golden briefs × genres, scored over time) | **MISSING** | approved in vision/strategy; not built → LEDGER |
| Nightly compounding (trend auto-refresh, taste consolidation) | **MISSING** | crons exist for Drop/radar only → LEDGER |
| Learn-My-Sound first-class onboarding | **MISSING** (plumbing LIVE) | buried in /listen; no multi-upload profile surface → LEDGER |
| Real-material layer (loops/one-shots the AI arranges) | **MISSING** | STRATEGY.md Phase 5 → LEDGER |
| latin_pop genre | **MISSING** | authoring agent failed; reggaeton covers interim → LEDGER |

## Platform

| Feature | Status | Evidence |
|---|---|---|
| Studio chat (persistent, SSE, autopilot, 20+ tools, gen-guard) | **LIVE** | 1bc212d cap verified in code; thread resume prior |
| Billing (PayPal plans + webhook) | **PARTIAL** | wired end-to-end; internal mode bypasses credit wall by design |
| Admin page + review queue | **LIVE** | routes/admin.ts, reviews.ts (ADMIN_EMAILS gate) |
| Auth (multi-tenant) | **DEFERRED by design** | internal single-owner; P2 seam documented |
| Voice clone (consented voice profiles) | **PARTIAL** | ElevenLabs adapter needs paid plan; consent flow built |
| Video render (veo/sora) | **MOCK-ONLY** | provider stubs; storyboard LIVE, render stub |
| Cover art (gpt-image-1) | **LIVE** | prior verifications |
| Email notifications (Resend) | **LIVE** | worker notifications; RESEND key present |
