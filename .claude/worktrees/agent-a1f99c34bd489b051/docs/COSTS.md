# Cost Accounting

Credit prices are product configuration. They are not proof of provider cost,
margin, or profitability.

## Sources Of Truth

| Question | Source |
|---|---|
| What the product charges | `packages/shared/src/credits.ts` |
| Current workspace balance | `Workspace.creditsCents` |
| Why balance changed | immutable `CreditLedger` rows |
| Which paid job ran | `ProviderJob`, including provider and `costUsd` when reported |
| Which language call ran | `AnalyticsEvent` named `llm.call` |
| Which payment was approved | `BillingIntent` plus verified `BillingEvent` |
| Provider invoice truth | provider billing export or invoice |
| Infrastructure cost | Railway, storage, egress, email, and observability invoices |

All credit integers use 1/100 cent units: `10_000` equals USD 1.00.
Ledger accounting separates money from usage. `delta` is the balance movement,
`units` is the number of billed operations used by generation caps, and
`planUnits` is the allowance quantity. For video, `units` is the number of
provider shots billed and `planUnits` is their total normalized duration in
seconds. Reversals use zero units and link to the original debit.

`AnalyticsEvent` estimates help detect direction and anomalies, but they do not
replace invoices. A provider job with no trustworthy `costUsd` is unknown cost,
not zero cost.

## Required Reconciliation

At least daily during testing and monthly in production:

1. Export provider usage/invoices for the same UTC window.
2. Sum successful and failed `ProviderJob` spend by provider, model, job kind,
   and workspace.
3. Sum `llm.call` counts and separately mark estimated versus invoice-backed cost.
4. Reconcile PayPal captures to completed `BillingIntent` and `BillingEvent` rows.
5. Reconcile every credit debit and reversal to its logical job or action.
6. Include infrastructure, storage, egress, payment fees, refunds, support, and
   taxes in the cost window.
7. Investigate unknown-cost jobs, unmatched captures, duplicate-looking ledger
   entries, and jobs with spend but no user-visible outcome.

Keep the reconciliation artifact and the query/version used to produce it.

## Margin Calculation

Do not publish a margin percentage until all terms below are measured for the
same period:

```text
net revenue
- payment fees and refunds
- provider invoices
- compute, database, Redis, storage, and egress
- email, observability, and other variable services
- allocated support and moderation cost
= contribution
```

Then:

```text
contribution margin = contribution / net revenue
```

Plan allowances and credit prices must be stress-tested against heavy but valid
usage. An allowance is not profitable merely because a nominal credit value is
larger than an estimated API call.

## Spend Controls

- Idempotent credit debits and one reversal per failed charge.
- Daily and monthly generation caps, plus plan-specific action limits.
- Transactional outbox dispatch so retries do not create new logical jobs.
- Provider job IDs and idempotency keys retained across timeout recovery.
- Operator autonomy switches for every scheduled money-spending workflow.
- `BACKGROUND_LLM_DAILY_CAP` for background language work.
- Progressive best-of-N: buy another take only after evidence justifies it.
- Local CPU Demucs for eligible background stem work.
- Production refusal of placeholder media and unconfigured providers.

Recommended alerts:

- provider spend without a matching `ProviderJob`
- a job cost far above its kind/model baseline
- repeated retries or candidate count above policy
- failed job with no reversal after the failure handler window
- PayPal capture without one completed billing intent
- credit grant without a verified billing event or named admin action
- background spend over its daily cap
- rising cost per approved or retained song

## Changing Prices Or Providers

Before changing `CREDIT_COSTS`, a plan allowance, or a routing default:

1. Use recent measured p50, p90, and worst-case successful cost.
2. Include retry rate, failure rate, best-of-N expansion, and egress.
3. Run offline quality gates and a controlled live bake-off.
4. Confirm commercial rights, data handling, model version, and rate limits.
5. Update tests, customer-facing price copy, and this accounting model together.
6. Watch the first production cohort with a rollback threshold.

Unknown or volatile provider pricing must stay configurable and be reviewed
against the provider's current contract. This repository intentionally makes no
fixed provider-cost or Suno-margin claim.
