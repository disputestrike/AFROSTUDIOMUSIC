> **Historical snapshot (2026-07-06).** This document is retained for provenance
> and does not describe current production readiness. Use
> `docs/PRODUCTION_READINESS_2026-07-14.md` for current evidence and blockers.

# 00 — VISION (Apex Protocol, Phase 0)

_Author: Apex run, 2026-07-06. Sources: docs/STRATEGY.md, README.md, landing copy
(apps/web/app/page.tsx), session directives from Benjamin (the Owner), and the code
itself. Where the code contradicts the vision, a DRIFT line is recorded._

## The irreducible job (one sentence, no category jargon)

> **Turn an artist's idea — or their own voice and beats — into a finished,
> culturally-true song that's ready to release and has a real shot at hitting,
> in minutes instead of months, without a studio, a producer, or a label.**

Banned-word check: no "software/app/platform/tool/solution." ✅

## Continuous or episodic?

**Episodic today** (each song is a session) with the continuity engine already
seeded: the studio LEARNS from every listen (SoundReference), every approval/
rejection (ArtistMemory taste graph), and every hit-score — so the *next* song
starts smarter. The path to fully continuous: Morning Drop (daily songs, built,
worker cron), trend auto-refresh (roadmap), and release-performance feedback
(roadmap). Repair → protection: from "make me a song" to "keep my catalog
growing and getting better while I sleep."

## The full cast

| Cast | The fear the instant before they act | The proof they must SEE (not be told) |
|---|---|---|
| **Buyer/Owner** (independent Afro artist, Benjamin-like) | "It'll sound weak/generic — AI slop with my name on it. I'll embarrass myself." | Press play: a full sung record in their genre with real drums/log-drum, an honest QC verdict, a hit/viral score with reasons — and their OWN sound reflected after uploads. |
| **Owner/Operator** (Benjamin running it) | "Costs run away / something silently fakes output." | Hard caps visible (MAX_DAILY_GENERATIONS), no-fake-audio law in worker, per-job cost + bestOf provenance in meta. |
| **Abandoner** | "This is taking too long / I'm lost." | Progress stages during 1–3-min renders (SSE stages exist in chat), a front-door Create page with obvious defaults; catalog that never loses work. |
| **Skeptic** ("AI music is soulless") | "It can't be culturally real." | Native-language review gate that BLOCKS release; hit-craft modes derived from actual most-streamed songs; pidgin/Yoruba idiom flagged for human sign-off, not faked. |
| **Non-Buyer** (silent majority of artists) | "AI will steal my style / rights are murky." | Rights spine: split sheets, ISRC/UPC, AI-disclosure receipts, learn-only-from-what-you-own doctrine, no ripping — written into code (import refuses YT/Spotify). |
| **Influencer** (producer/scout who shares) | "If I share this and it's trash, that's on me." | Share link (/r/[id]) that plays a mastered record + shows the release-ready facts. |
| **Gatekeeper/Regulator** (DSPs, PROs, rights) | "Undisclosed AI, uncleared rights." | RightsReceipt hash chain, AI-disclosure in every export bundle, release green-light gate that refuses until splits sum to 100 + native review passes. |

## The value exchange, quantified

- **Cost to customer**: subscription (PLAN_LIMITS: Starter → Studio) + minutes of
  their time. Provider cost per full song ≈ $0.12–$2 (×N for best-of-N).
- **Value delivered**: a produced+mastered+rights-clean release candidate.
  Traditional equivalent: producer ($300–$2k/beat) + studio time ($50–150/hr) +
  mixing/mastering ($150–500/track) + weeks of cycle time. Even discounting AI
  output to 10–20% of a human team's ceiling, the exchange is **>10×** on cost
  and **>100×** on time-to-first-listen. Healthy extraction: subscription price
  is a small slice of the value of ONE usable release.
- **Decisions eliminated**: genre defaults, engine auto-pick (Suno-first), one
  hook chosen by A&R in autopilot, master preset defaults, best-of-N auto-select.

## Which structural gap does it fill?

Primarily **Democratization** (a label's A&R + producer + studio + rights desk,
democratized to one artist) and **Accountability** (the system *verifies* output:
measured QC verdicts, hit/viral scores with reasons, release gates — not just
"process ran"). Secondary: **Tacit Knowledge** (hit-craft modes + Sound DNA encode
what producers/A&Rs know) and **Trust Portability** (rights receipts + AI
disclosure make the output defensible downstream).

## Press release of the perfect version (Working Backwards)

> **AfroHit Studio turns one artist into a label.** Today an independent artist in
> Lagos wrote an idea on her phone at noon and had a release-ready Afro-fusion
> record — sung, mastered at −14 LUFS, rights-clean with a split sheet and ISRC,
> with a TikTok clip cut at the hook — before dinner. The studio knew her sound
> because it had listened to her old records; its A&R scored 8 hooks for viral
> potential and told her honestly which one would hit and why. Every render was
> measured, the weak takes were thrown away automatically, and nothing shipped
> that the system couldn't stand behind. No studio. No producer. No label. Her
> catalog gets smarter every night.

### The 10 hardest FAQ, answered honestly
1. **Is this just Suno with a skin?** No — Suno (or ACE-Step/MiniMax) renders audio; AfroHit runs the whole label loop around it: learn-your-sound, A&R scoring, best-of-N QC, rights/release. The generator is a swappable part (file: packages/ai/src/providers/music.ts).
2. **Does it copy artists?** No. Artists are style *lanes*; imports refuse YouTube/Spotify; learning uses only what you own/license. Enforced in code, not policy prose.
3. **Will it sound generic?** It fights that three ways: genre Sound DNA + current-trend enrichment, your own learned SoundReferences, and best-of-N which discards flat takes. Honest limit: text-to-audio models still cap the ceiling; the "real material layer" is the roadmap answer.
4. **Can I trust the hit score?** It's a calibrated opinion with reasons, not a promise. It has scored a real song 42/100 and an empty shell 8/100 — it does not flatter.
5. **Who owns the output?** You. Split sheet + rights receipt generated per release; AI-assistance disclosed.
6. **What about my language?** Yoruba/Igbo/Hausa lines are flagged for native review and BLOCK release until a human signs off. The system never fakes idiom silently.
7. **What happens when a provider is down?** The job fails with the real reason. It never substitutes fake audio (worker law, apps/worker/src/processors/music.ts).
8. **Is my data training someone else's model?** No cross-tenant learning; SoundReference and taste memory are per-workspace.
9. **Why isn't multi-user login live?** Deliberate: single-owner mode until public launch; the auth seam + tenant schema already exist (PATH-TO-MILLIONS P2).
10. **What does it cost to run?** ~$0.12–2 per full song render (×2 for best-of-N default); hard daily caps prevent runaway spend.

## "This worked" — kitchen-table words

> **"I played it for my guys and nobody believed I made it at home. It sounds
> like ME — and it was done before I finished my food. And it told me straight
> which hook was the weak one."**

## DRIFT register (vision vs code, found in Phase 0 read)

- **DRIFT-1**: Vision says "learns your sound" is the wedge; code has the full
  plumbing (analyze → SoundReference → learnedReferenceBrief injection) but NO
  first-class onboarding surface ("Learn My Sound" flow) — it's buried in the
  Listen page. → Gap Ledger (matches Owner's "do all" item #2).
- **DRIFT-2**: Vision/strategy demands "measure success by delivery" (eval
  harness, Phase 2 of STRATEGY.md); no eval harness exists in the repo. → Ledger.
- **DRIFT-3**: Landing/README describe the artist-first ship pipeline; README.md
  still describes the earlier scaffold state (predates Suno/best-of-N/hit-craft).
  → Ledger (truth-on-every-surface).
- **DRIFT-4**: "All-genre" now true in DNA (22 genres) but latin_pop missing
  (authoring failed) → Ledger (Owner's "do all" item #3).
- **DRIFT-5**: "Gets smarter every night" — learning happens per-event; there is
  no nightly compounding job (trend refresh cron, taste consolidation). → Ledger
  (Owner's "do all" item #4).
- **DRIFT-6**: "Exact beat" control — vision names the real-material layer
  (Phase 5, STRATEGY.md); not yet built. → Ledger (Owner's "do all" item #1).

## Owner's standing directives (OWNER'S NOTES, reconstructed from session)

- Real output only — no stubs, placeholders, or fake green. Prove everything live.
- Never rip YouTube/Spotify audio; learn only from owned/licensed material; artists are lanes, never clones.
- No Suno key available currently — quality must come from best-of-N + craft (Suno auto-activates if a key is ever set).
- All genres, not Afro-only. Simplify UX (8 hooks not 20, one song per ask).
- Keep single-owner internal mode until public launch; keep API private.
- Budget-conscious: hard caps stay on; cost per song visible.
