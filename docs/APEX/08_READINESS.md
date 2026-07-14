> **Historical snapshot (2026-07-06).** This document is retained for provenance
> and does not describe current production readiness. Use
> `docs/PRODUCTION_READINESS_2026-07-14.md` for current evidence and blockers.

# 08 — READINESS VERDICT (Apex Phase 6)

_No softening. Issued 2026-07-06 at commit `2e6f97f`+, all evidence in 07._

## VERDICT

**READY — as the single-owner internal studio it is deliberately being run as.**
**READY FOR CONTROLLED BETA** the day the Owner completes the three items below.
**NOT READY for public multi-tenant launch** — by design, with the gate list known.

The distinction matters: every engineering claim in this pack is proven live
(typecheck 0, 46/46 stub assertions, every K2 journey summited including a full
latin_pop song rendered, measured, and QC-passed in production). What separates
"ready" from "beta" is not code.

## The three Owner items between here and CONTROLLED BETA

1. **A music-provider key with headroom** — Replicate is live today; SUNO_API_KEY
   is the single biggest quality lever (auto-activates, code-proven).
2. **P0-2: proof content** — 3–5 real released songs the Owner approves for the
   landing page, with their real scores/QC verdicts. Never synthetic.
3. **Key rotation** — the API keys pasted into chat during development must be
   rotated before anyone else touches the product (standing security item).

## Remaining P0/P1 (all owner-side or deliberately gated)

| Item | Class | Effort |
|---|---|---|
| P0-2 landing proof content | OWNER (content) | days (curation) |
| musicApiKey encryption | blocked on ENCRYPTION_KEY set on api+worker | S (code ready to write once set) |
| Eval-harness baseline run | OWNER (approve ~$0.25 spend) → `node scripts/eval-harness.mjs` | minutes |

## Untested flows (honest)

Real PayPal payment execution (code-proven, spend-gated) · browser e2e suite ·
`pnpm audit --prod` dependency scan · load beyond single-owner traffic. Each has
an unblock path in 07.

## Mock-only surfaces (all honestly labeled in-product)

Video render (stub adapters) · distribution (not_configured seam) · voice clone
(needs ElevenLabs paid plan + consent flow already built).

## Fix order for the PUBLIC gate (severity, then effort — from PATH-TO-MILLIONS)

1. Real auth at the auth.ts seam + delete cachedIdentity (P0 for multi-tenant)
2. Credit wall on + per-workspace limits (P0)
3. prisma migrate deploy + PgBouncer (P1)
4. Split queues, provider webhooks not polls, streamed media (P1)
5. CI pipeline on PRs; per-route rate limits (P1)
6. Signed-PDF rights receipts; share-page metrics; DNA onboarding (P2, Human lens)

## Final self-audit (protocol checklist)

- [x] Every claim carries evidence (file:line / exit code / live JSON) or an explicit UNSURE with a verification path (2 UNSUREs: dependency audit, load test — both pathed).
- [x] Env vars, routes, integrations, jobs documented (01 + .env.example complete).
- [x] Every critical journey has a K2 result or an explicit BLOCKED/UNTESTED with unblock path (07).
- [x] No secret values anywhere in this pack.
- [x] Every P0 listed; every BLOCKED item has a reason + unblock path; nothing silently skipped.
- [x] Lens disagreements mined and resolutions recorded (03 §Disagreements).
- [x] Docs pack complete: 00–09 under docs/APEX/.
- [x] Verdict issued and honest.

## The Apex Test

| Lens | Pass condition | Call |
|---|---|---|
| Builder | alive, adaptive, autonomous, compounding | **PASS with one asterisk** — compounding is per-event, nightly consolidation is roadmap #3 |
| Strategist | provable money, kept customers, growing moat | **PASS for the current mission** (single-owner, cost-capped, moat = per-user learned data); revenue proof awaits real users |
| Human | everyone feels understood, safe, served | **CONDITIONAL PASS** — the artist using it: yes (honest verdicts, consent gates, no fakes); the stranger evaluating it: not yet (needs P0-2 proof content) |

Value in <5min ✅ (~90s/song) · truth on every surface ✅ (fixed this run) ·
outcomes verified not assumed ✅ (measured QC + summited K2) · no dead ends ✅
(fixed this run) · smarter every night ⚠️ (per-event today; roadmap #3).
