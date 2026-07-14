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
- Frozen blind benchmark pairs, independent judgments, server-side blind ordering,
  Wilson-confidence scoring, dimension deltas, and claim suppression.
- Safe forward-only migration deployment, dependency-aware readiness, CI services,
  operational runbooks, and cost governance.

## Gates Proven Locally

| Gate | Result | Evidence |
|---|---|---|
| Lint | PASS | `pnpm run lint` |
| Required offline proofs | PASS | `pnpm run verify`; 42 of 42 required worker proofs passed |
| Production build | PASS | `pnpm run build`; all six workspace packages built |
| Dependency audit | PASS | `pnpm run security:audit`; no known vulnerabilities |
| Fresh database migration | PASS | 20 migrations applied; migration status current; Prisma diff empty |
| Legacy database migration | PASS | safe runner recognized the baseline and applied all forward migrations; none pending |
| Credit concurrency | PASS | PostgreSQL integration proved one charge, race-safe caps, idempotent replay, and one refund |
| Distribution lifecycle | PASS | PostgreSQL integration proved signed idempotent submit/live transitions |
| Redis outage behavior | PASS | API served `/health` with Redis unavailable and reported degraded dependency state |
| Identity concurrency | PASS | 20 simultaneous `/api/v1/auth/me` requests all returned 200 |
| Browser runtime | PASS | desktop and 390x844 mobile checks found no document overflow or clipped text; console had 0 errors and 0 warnings |
| Unavailable provider UX | PASS | create actions and auto-create are blocked before project/job/charge creation when no route is connected |

The database proofs used isolated PostgreSQL databases named `afrohit_empty` and
`afrohit_legacy`. They did not touch a production database.

## Competitive Claim Gate

The benchmark may emit an AfroHit-outperforms-Suno verdict only when all of the
following are true:

1. At least 30 eligible judgments exist.
2. At least 10 frozen pairs are covered.
3. At least 5 genres are represented.
4. Every eligible pair has at least 3 independent judges.
5. The 95% Wilson lower bound of the AfroHit win rate is above 0.50.
6. No measured quality dimension averages below -0.25 versus the competitor.

Current verdict: **insufficient evidence**. The UI and API suppress the claim.

## External Gates Still Required

These are real acceptance gates, not code placeholders:

- Run the rights-clean nine-track ear corpus: three Afrobeats, three Amapiano,
  and three house references. The local DSP test is informational when `librosa`
  is absent; CI installs the pinned DSP stack and requires it.
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

## Launch Rule

A staging deploy may proceed once environment validation confirms PostgreSQL,
Redis, private object storage, auth secrets, and the intended provider routes.
A commercial production launch requires the applicable live-account gates above.
A superiority claim remains separately blocked until benchmark evidence passes,
regardless of deployment status.