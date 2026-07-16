# Production Readiness Evidence - 2026-07-14

This document is the current evidence source for the production rebuild on
`codex/unified-production-rebuild`. Older APEX and test-report documents are
historical snapshots and must not be used to override this status.

## Decision

- **Implementation baseline:** PASS for controlled staging.
- **Repository gates:** PASS on the machine and isolated databases described below.
- **Commercial production launch:** CONDITIONAL on the live-account gates in this document.
- **Claim that AfroHit is better than Suno:** BLOCKED until the blind benchmark gate passes.

No skipped, unavailable, informational, or credential-dependent check is reported as green.

## What Is Implemented

- JWT-only production auth, tenant-scoped data access, encrypted provider secrets,
  SSRF-safe outbound requests, private media storage, and production stub rejection.
- Durable jobs, transactional dispatch, idempotent unit-aware credit charging,
  race-safe plan caps, one-time refunds, and cost/usage administration.
- Genre-aware music routing, provider capability checks, shot-aware video billing,
  real provider adapters, fail-closed media/email behavior, and truthful UI states.
- Rights-aware material ingestion, provenance, readiness, lane retrieval, proof of
  use, workspace-scoped artist memory, and retrieval analytics.
- Vocal isolation/verification, mix evidence, release certification, checksums,
  rights attestations, signed distribution handoff, and webhook-driven live status.
- Frozen blind benchmark pairs, distinct authenticated judgments, server-side blind
  ordering, Wilson-confidence scoring, dimension deltas, and claim suppression.
- Signed schema-4 ear-corpus verification, rights/hash enforcement, decoded video
  evidence, live-provider acceptance tooling, and a fail-closed benchmark uploader.
- Safe forward-only migration deployment, dependency-aware readiness, CI services,
  operational runbooks, and cost governance.

## Gates Proven Locally

| Gate                      | Result | Evidence                                                                                                               |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Lint                      | PASS   | `pnpm run lint`                                                                                                        |
| Required offline proofs   | PASS   | `pnpm run verify`; 44 of 44 required worker proofs passed                                                              |
| Production build          | PASS   | `pnpm run build`; all six workspace packages built                                                                     |
| Dependency audit          | PASS   | `pnpm run security:audit`; 566 exact locked versions checked, 0 advisory matches                                       |
| Ear-corpus trust boundary | PASS   | 12 of 12 signing, rights, balance, hash, tamper, and synthetic-closure tests passed; real calibration remains external |
| Video render evidence     | PASS   | MP4/H.264 decode, dimensions, duration, aspect, content hash, and cost evidence proved                                 |
| Benchmark corpus harness  | PASS   | `node scripts/test-benchmark-corpus.mjs`; valid corpus accepted and duplicate audio rejected                           |
| Fresh database migration  | PASS   | 20 migrations applied; migration status current; Prisma diff empty                                                     |
| Legacy database migration | PASS   | safe runner recognized the baseline and applied all forward migrations; none pending                                   |
| Credit concurrency        | PASS   | PostgreSQL integration proved one charge, race-safe caps, idempotent replay, and one refund                            |
| Distribution lifecycle    | PASS   | PostgreSQL integration proved signed idempotent submit/live transitions                                                |
| Redis outage behavior     | PASS   | API served `/health` with Redis unavailable and reported degraded dependency state                                     |
| Identity concurrency      | PASS   | 20 simultaneous `/api/v1/auth/me` requests all returned 200                                                            |
| Browser runtime           | PASS   | desktop and 390x844 mobile checks found no document overflow or clipped text; console had 0 errors and 0 warnings      |
| Unavailable provider UX   | PASS   | create actions and auto-create are blocked before project/job/charge creation when no route is connected               |

The database proofs used isolated PostgreSQL databases named `afrohit_empty` and
`afrohit_legacy`. They did not touch a production database.

## Current Remote Check Status

As of 2026-07-15, the GitHub `quality` job on PR #1 did not execute any
workflow step because the account has a failed payment or insufficient Actions
spending capacity. The external `Workers Builds: afroboom` check is stale: the
repository has no Cloudflare Worker configuration and the application worker
deploys through Railway. These are account/integration blockers, not passing
tests and not code failures.

## Competitive Claim Gate

The benchmark may emit an AfroHit-outperforms-Suno verdict only when all of the
following are true:

1. At least 30 eligible judgments exist.
2. At least 10 open, rights-attested, hash-frozen pairs are covered.
3. At least 5 genres are represented.
4. Competitor and AfroHit audio hashes are unique, valid, and never collide across sides.
5. Every pair uses a blind, identity-removed protocol with hash-bound EBU R128
   loudness and duration measurements, empty metadata-tag inventories, and
   persisted tolerances no greater than 1 LUFS and 1 second.
6. Every eligible pair has at least 3 distinct authenticated judges.
7. The 95% Wilson lower bound of the AfroHit win rate is above 0.50.
8. No measured quality dimension averages below -0.25 versus the competitor.

Manual or UI-created pairs without measured normalization evidence remain
available for internal listening but are ineligible for a competitive claim.
Once a pair has judgments, changing its rights or comparison protocol
supersedes it and creates a fresh pair rather than relabeling old results.

Authenticated identity uniqueness is not presented as proof of real-world judge
independence. Study recruitment and conflict-of-interest controls remain part of the
external human benchmark.

Current verdict: **insufficient evidence**. The UI and API suppress the claim.

## External Gates Still Required

These are real acceptance gates, not code placeholders:

- Run and sign the rights-clean nine-track ear corpus: three Afrobeats, three
  Amapiano, and three house references. All 45 mix/stem files must match the
  manifest hashes; a synthetic or unsigned artifact cannot open calibration.
- Exercise each configured music, voice, image, video, email, storage, and LLM
  provider with production-scoped credentials and verify output, latency, cost,
  cancellation, retry, and refund behavior.
- Execute a real PayPal sandbox purchase, capture, webhook replay, cancellation,
  refund, and reconciliation cycle before enabling live payments.
- Submit and promote a release through the actual distribution partner account,
  including replayed and out-of-order webhook cases.
- Apply `migrate:safe` to a production snapshot in a controlled rehearsal; verify
  backup restore, rollback procedure, locks, and maintenance-window timing.
- Run worker queues against production-equivalent Redis and object storage under
  concurrency, worker restart, provider timeout, and dead-letter recovery.
- Complete the blind human benchmark above before publishing any superiority claim.

Exact commands, required inputs, spend confirmations, and evidence locations are in
[`ACCEPTANCE_RUNBOOK.md`](./ACCEPTANCE_RUNBOOK.md).

## Launch Rule

A staging deploy may proceed once environment validation confirms PostgreSQL,
Redis, private object storage, auth secrets, and the intended provider routes.
A commercial production launch requires the applicable live-account gates above.
A superiority claim remains separately blocked until benchmark evidence passes,
regardless of deployment status.
