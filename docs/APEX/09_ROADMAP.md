> **Historical snapshot (2026-07-06).** This document is retained for provenance
> and does not describe current production readiness. Use
> `docs/PRODUCTION_READINESS_2026-07-14.md` for current evidence and blockers.

# 09 — THE COMPOUNDING ROADMAP (Apex Phase 6)

## The three highest-leverage next builds

1. **Real-material layer ("the exact beat")** — Builder lens · Gate G8 · the
   Buyer's fear ("it sounds generic"). A royalty-free producer-pack library
   (log drums, one-shots, MIDI grooves) the AI *arranges*, plus melody-conditioned
   generation. This is the ceiling-breaker no prompt can reach. **Needs the
   Owner's licensing/cost decision first** (see STRATEGY.md §3, Phase 5).
2. **Proof-on-every-surface** — Human lens (score 42, the weakest) · Gate "quality
   proof" · the Skeptic's fear ("AI slop"). Owner picks 3–5 real released songs →
   landing showcases them with scores + QC verdicts; share pages get listen
   counts; rights receipt becomes a signed PDF in the bundle. Mostly content +
   M-effort code.
3. **Nightly compounding** — Builder lens · "gets smarter every night" · the
   Owner's fear (stagnation). A cost-capped nightly job: consolidate the day's
   taste feedback per artist, refresh one genre's trend digest (rotating), run
   the eval harness weekly and diff scorecards. Blocked only on Tavily quota +
   Owner sign-off on ~$1-2/night spend.

## What compounds (and how it's measured)

- **The learning loop**: SoundReferences per workspace (count ↑), semantic
  memory chunks with embeddings (hit-rate of retrieved examples), taste-score
  trend per artist. Measure: eval-harness scorecards over time.
- **The data moat**: per-user learned sound (not the prose DNA — a competitor can
  copy prose; they cannot copy a user's accumulated SoundReferences + taste graph).
  Measure: % of generations that used ≥1 learned reference.
- **The referral/renewal seed**: share links + release pages. Measure (when
  users exist): shares per release, return-rate after first release.

## Management cadence

- **Weekly**: expected vs actual value delta — songs created, % pass QC verdict,
  top-3 drop-off points (Create → render → release funnel via PostHog).
- **Monthly**: run the Algorithm on our own processes — what do we DELETE this
  month? (Standing candidates: unused provider scaffolds, stale docs.)
- **Quarterly**: are we still solving "idea → release-ready song that can hit,
  in minutes" — or drifting into features? Re-read 00_VISION.md against the repo.
- **Annually**: has the structural landscape shifted (new model classes, DSP AI
  policy, rights law)? Which new gap should we own?

## Standing gates before PUBLIC launch (from PATH-TO-MILLIONS, unchanged)

Real auth at the auth.ts seam · delete cachedIdentity · credit wall on ·
prisma migrate deploy · PgBouncer · split queues · webhooks not polls ·
ENCRYPTION_KEY set + musicApiKey encrypted · CI pipeline on PRs.
