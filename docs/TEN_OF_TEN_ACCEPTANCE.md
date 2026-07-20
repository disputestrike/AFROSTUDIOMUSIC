# AfroStudioMusic 10/10 Acceptance Contract

This document defines what the product may claim and what evidence must exist
before a claim becomes green. A passing unit test proves that the gate works. It
does not prove that the real-world outcome happened.

## Governing Rules

1. Product-generated evidence is append-only and bound to workspace, song,
   artifact hashes, provider jobs, and timestamps.
2. Human scores are external receipts. The application may validate and
   aggregate them, but it may not create, default, or improve them.
3. Retention is derived from a later creator-initiated session. It is never a
   checkbox on the initial review.
4. Estimated provider costs and configured prices are not actual margin.
5. A model candidate is not active until its evaluation receipt is bound and
   the promotion transaction updates the active route pointer.
6. A workflow is green only when its strict acceptance command exits zero.
7. Missing evidence fails closed as unproven, not passed.

## The Eleven Gates

| # | Claim | Machine-enforced acceptance | External evidence still required |
| --- | --- | --- | --- |
| 1 | Three usable directions reach a DAW within 20 minutes | Three distinct controlled render receipts, certified stems, replay hashes, start/finish timestamps, and DAW-import receipt | Producer confirms that each imported without technical repair |
| 2 | A cold personal kit becomes usable within 10 minutes | Upload, classification, confirmation, shelf-ready, and first-render timestamps are from persisted jobs | Producer completes normal onboarding without staff intervention |
| 3 | Groove quality averages at least 4/5 | Five-dimension rubric, five unique reviewers, two independent reviewers, one AI-skeptical reviewer, blinded comparator labels | Real reviewers submit the scores |
| 4 | Producers choose AfroStudio over manual rebuilding | Choice and manual-baseline receipts are attached to the same brief and session | Producers make the choice under real deadline pressure |
| 5 | At least three producers return unprompted | A later creator-initiated session is matched to the initial experiment; reminders and staff-created sessions are excluded | Elapsed behavior from real producers |
| 6 | AfroOne singing is release-usable | Isolated vocal bytes, lyric alignment, lineage, quality certification, mix binding, and external score receipt all pass | Artists/producers approve vocal naturalness and cultural phrasing |
| 7 | A trained AfroOne candidate is better and active | Dataset hash, consent snapshot, provider job, bound evaluation, improvement threshold, promotion transaction, and rollback pointer | Rights-clean evaluation corpus and legitimate evaluator receipt |
| 8 | Heavy users are margin-positive | Charges, refunds, retries, actual provider invoices, infrastructure allocations, and distribution revenue reconcile by engine/workflow/cohort | Complete invoices and real paid usage |
| 9 | Multi-scene video completes reliably | Every required scene succeeds, final assembly contains audio, coverage and duration are measured, cost and lineage reconcile, and no placeholder render exists | Real provider renders and creator acceptance |
| 10 | Signup-to-export is professionally usable | Keyboard-safe forms, no automatic spend, explicit price confirmation, resumable progress, recovery actions, rights choices, shelf onboarding, and visible DAW export path | Observed usability sessions |
| 11 | Hosted delivery is green | Fast preflight, full CI, migration/drift checks, build, security audit, and deployment smoke evidence all pass on the merged SHA | GitHub account billing and external deployment credentials remain valid |

## Final Product Verdict

The strict readiness report returns one of three states per gate:

- **green**: every machine requirement and every required external receipt is
  present and current.
- **amber**: the implementation is complete but a real external receipt or
  elapsed behavior is still missing.
- **red**: implementation, integrity, or evidence failed.

The overall product cannot report 10/10 while any gate is amber or red. Investor
exports must include the underlying evidence identifiers and the report
generation timestamp, not only the color.
