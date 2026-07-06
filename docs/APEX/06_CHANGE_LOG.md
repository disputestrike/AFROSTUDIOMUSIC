# 06 — CHANGE LOG (Apex Phase 4)

_Every item: files touched — test proving it — result. This run = commit `0cf5d14`
(plus the session's earlier waves `1bc212d`…`a58ef7b` documented in git log)._

| Item | Files | Proof | Result |
|---|---|---|---|
| P0-1 preflight before the wait | routes/billing.ts (+GET /preflight), create/page.tsx | live K2-1 (see 07) | cap refused BEFORE producing; recovery links |
| P1-1 webhook idempotency race | routes/webhooks.ts | typecheck + code path (P2002→idempotent) | double-credit impossible; retries return 200 |
| P1-2 download streaming + cap | routes/songs.ts (/file) | typecheck; manual review | streams; 413 over 250MB |
| P1-3 SSE hardening | routes/chat.ts | typecheck | serialization/disconnect can't crash the loop |
| P1-4 worker bounded drain | worker/index.ts | typecheck | 25s drain → force-close; stalled jobs re-queue |
| P1-5 render hard timeout | worker/processors/music.ts | typecheck | 12-min ceiling per candidate |
| P1-6 composite indexes | prisma/schema.prisma | prisma generate ok | applied on deploy (db push) |
| P1-7 TasteScore cascade | prisma/schema.prisma | prisma generate ok | no orphans on song delete |
| P1-9/10/11 zod validation | routes/projects.ts, briefs.ts, hooks.ts | live K2-3 (400 on empty text) | all bodies validated |
| P1-12 error-leak wraps | routes/uploads.ts, settings.ts, drop.ts | typecheck | client-safe messages; real cause logged |
| P1-13 chat mobile | components/StudioChat.tsx | typecheck; responsive classes | usable on phones |
| P1-14 cap recovery path | create/page.tsx | code path | Billing/catalog links, honest copy |
| P1-15 landing truth | app/page.tsx | read-back | no overclaim |
| P1-16 alt text | projects/[id]/page.tsx | read-back | descriptive alt |
| P1-17 eval harness v1 | scripts/eval-harness.mjs | script authored; golden set fixed | dated scorecards to docs/APEX/scorecards |
| P1-18 semantic memory | services/artist-memory.ts | typecheck + stub suite 28/28 | embeddings stored best-effort |
| P2 telemetry honesty | worker/processors/analyze.ts | typecheck | warn instead of silent swallow |
| P2 mixer approved filter | routes/mixer.ts | typecheck | only approved assets on console |
| P2 hook-edit title sync | routes/hooks.ts | live K2-3 | read-compare-update |
| Learn-My-Sound surface | components/LearnMySound.tsx, listen/page.tsx, routes/taste.ts | live K2-2 | multi-upload + live profile |
| latin_pop genre (23 total) | sound-dna/global-genres.ts, shared/constants.ts, create/page.tsx | live K2-4 (latin_pop end-to-end) | all-genre front door |
| Create page ALL genres | create/page.tsx | read-back | 23 genres offered (was 11 — real drift caught) |
| Env hygiene | .env.example | inventory diff | every referenced var documented |
| README truth | README.md | read-back | matches reality |
| APEX docs 00-09 | docs/APEX/* | this pack | complete |

Build health after all changes: typecheck exit 0 (9/9 packages) · stub suites
28/28 + 18/18 · prisma client generates clean.
