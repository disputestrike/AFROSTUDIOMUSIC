# Production Acceptance Runbook

This runbook covers gates that cannot be truthfully passed by offline tests.
Credentials, rights-clean audio, human judges, payment accounts, and distributor
accounts remain operator-controlled inputs. Evidence belongs under
artifacts/acceptance/, which is intentionally ignored by Git.

## 1. Repository Baseline

Run these before any paid acceptance:

```bash
pnpm run lint
pnpm run verify
pnpm run build
pnpm run security:audit
```

Any failure stops the acceptance. A skipped, unavailable, synthetic, or
credential-dependent result is not green.

## 2. Signed Ear Corpus

The DSP calibration manifest is
apps/worker/py/fixtures/manifest.json. It must contain exactly nine tracks:
three afrobeats, three amapiano, and three house. The committed repository does
not contain those recordings; the private bytes and training snapshot remain
under the fixture directory's deny-by-default `.gitignore`.

Every track must provide:

- A unique ID, expected tempo, and expected four-on-floor result.
- A relative mix path plus SHA-256.
- Relative bass, drums, other, and vocals stem paths plus SHA-256.
- Rights basis owned-master or licensed-evaluation.
- A concrete rights reference, attester, and UTC attestation timestamp.
- A real-recording classification: human-produced master or licensed reference.
- Stable source asset IDs and one source-family ID (normally the parent song).
- A frozen, hash-pinned snapshot of the exact active training dataset.

Symlinks, path traversal, duplicate IDs, missing files, unexpected fields,
wrong hashes, mislabeled/non-audio bytes, unbalanced genres, and unsupported
audio formats fail validation. Any overlap with training by source ID,
source-family ID, mix hash, or stem hash also fails.

First deploy the lineage-aware trainer and complete one legitimate training run.
Then export the active training receipt without exposing database credentials:

```powershell
pnpm --filter @afrohit/worker run ear:training-snapshot -- --output "C:\acceptance\ear-training-snapshot.json"
```

Create `C:\acceptance\ear-candidates.json` with schema version 1, `frozenBy`,
and exactly nine tracks. Each track has the final manifest fields except hashes:
`id`, `genre`, `sourceAssetIds`, `sourceFamilyId`, `recordingType`,
`expectTempoBpm`, `fourOnFloor`, relative `path`, four relative stem paths, and
the rights block. Candidate paths are relative to one private source root.

Validate without writing, then freeze. `--replace` is intentionally required
to refreeze an existing holdout:

```powershell
pnpm --filter @afrohit/worker run ear:freeze -- --draft "C:\acceptance\ear-candidates.json" --source-root "C:\acceptance\audio" --training-snapshot "C:\acceptance\ear-training-snapshot.json" --dry-run
pnpm --filter @afrohit/worker run ear:freeze -- --draft "C:\acceptance\ear-candidates.json" --source-root "C:\acceptance\audio" --training-snapshot "C:\acceptance\ear-training-snapshot.json"
```

Review and commit only `manifest.json`. Never force-add `ear-holdout-v1/`.
After the frozen manifest is deployed, set `EAR_HOLDOUT_REQUIRED=1` on every
training worker. That converts a missing or malformed holdout into a hard stop
instead of allowing a future training run to contaminate evaluation.

Generate a secret outside Git and use the same secret in every worker runtime
that consumes the calibration:

```bash
LOGDRUM_CALIBRATION_SIGNING_KEY="<32-or-more-byte-secret>" pnpm --filter @afrohit/worker run ear:evaluate
```

A passing run writes schema-5 HMAC evidence to
apps/worker/py/fixtures/logdrum_calibration.json. A failed or synthetic run
cannot overwrite that truth artifact. Verify the deployed worker with:

```bash
python apps/worker/analyze_dsp.py --calibration-status
```

calibrated must be true and the reported corpus hash, training snapshot hash,
freeze timestamp, track count, rights/leakage status, signature key ID, and
schema must match the signed artifact.

## 3. Live Provider Acceptance

The live runner requires JWT production auth. It rejects anonymous production
access, degraded PostgreSQL/Redis/worker readiness, stubs, placeholders, missing
media hashes, missing charged-unit receipts, missing provider cost evidence,
and successful jobs that were refunded.

Infrastructure only, with no paid generation:

```bash
API_URL="https://api.example.com" AUTH_TOKEN="<jwt>" pnpm run acceptance:production
```

Selected paid scopes:

```bash
API_URL="https://api.example.com" AUTH_TOKEN="<jwt>" ACCEPTANCE_MUSIC_ENGINE="minimax" ACCEPTANCE_VOCAL_ENGINE="minimax" pnpm run acceptance:production -- --scopes infra,music,vocal,image,video --confirm-spend
```

Available scopes are infra, music, vocal, image, video, voice, paypal, and
distribution. Voice conversion additionally requires ACCEPTANCE_VOICE_ID and
ACCEPTANCE_SOURCE_SONG_ID.

Set the current contracted video price as SORA_COST_USD_PER_SECOND,
VEO_COST_USD_PER_SECOND, or the generic VIDEO_COST_USD_PER_SECOND. The runner
deliberately fails cost accounting when the provider does not report cost and no
operator-pinned rate is configured.

For each media job, confirm:

- A real provider class and positive provider cost are recorded.
- Durable charged units match the ledger.
- Failed charged jobs have one reversal receipt.
- Music, image, voice, and video output includes SHA-256 evidence.
- Video is decoded MP4/H.264 with measured duration, dimensions, and requested
  aspect ratio.
- The closing credit balance equals the opening balance minus durable charges.

## 4. Blind Competitor Corpus

The competitor manifest must use schema version 1 and include at least ten
unique Suno files paired with ten unique AfroHit song IDs across at least five
genres. Each file is locally byte-sniffed, size-checked, and SHA-256 verified.
Every row requires an owner or licensed-evaluation rights attestation.

The top-level protocol must attest:

- Blind source identity.
- Identity metadata removed.
- Loudness matched.
- Duration matched.
- At least three independent judges per pair.
- A note identifying the controlled listening procedure.

Every corpus entry must also include analyzer-produced normalization evidence
bound to the SHA-256 hashes of both audio files. The evidence must record EBU
R128 integrated LUFS and duration for both sides, prove that format and stream
metadata tags were removed, and persist tolerances no greater than 1 LUFS and
1 second. Declaration booleans alone are ineligible for a competitive claim.

Validate without network access:

```powershell
pnpm run acceptance:benchmark -- --manifest "C:\controlled-benchmark\manifest.json" --validate-only
```

Upload only after validation:

```powershell
$env:API_URL="https://api.example.com"
$env:AUTH_TOKEN="<jwt>"
pnpm run acceptance:benchmark -- --manifest "C:\controlled-benchmark\manifest.json" --confirm-upload
```

The uploader never stores bearer tokens or signed upload URLs. After upload it
calls the server evidence endpoint and fails unless the server independently
finds at least ten rights-valid, byte-independent pairs across five genres.
Duplicate competitor hashes, duplicate AfroHit hashes, cross-side collisions,
malformed rights evidence, or missing measured normalization evidence are
excluded before judgments are scored. A judged pair cannot be reused under a
different rights or comparison protocol; it is superseded and a new pair is
created instead.

The superiority claim remains locked until there are at least 30 eligible
judgments, ten eligible pairs, five genres, three independent judges per pair,
a 95% Wilson lower win-rate bound above 0.50, and no quality dimension below the
configured deficit floor.

## 5. PayPal Sandbox

The paypal live-runner scope creates and verifies an idempotent sandbox checkout
intent only. It does not pretend that buyer approval happened.

Complete the remaining cycle in the sandbox:

1. Approve the returned order as a sandbox buyer.
2. Let the API return route capture the exact order and intent.
3. Verify the PayPal webhook signature and credit grant.
4. Replay the same webhook and prove no second grant.
5. Cancel a subscription and verify authoritative status.
6. Refund the transaction and reconcile PayPal, billing intent, workspace
   balance, and credit ledger.
7. Confirm the transactional email arrived and contains the correct receipt.

Retain PayPal event IDs, hashed order IDs, ledger IDs, balances, timestamps, and
email provider delivery IDs. Do not retain access tokens.

## 6. Distribution

Distribution is an external release action and requires both --confirm-spend and
--confirm-release, plus ACCEPTANCE_RELEASE_PROJECT_ID and
ACCEPTANCE_RELEASE_SONG_ID.

```bash
API_URL="https://api.example.com" AUTH_TOKEN="<jwt>" ACCEPTANCE_RELEASE_PROJECT_ID="<release-ready-project>" ACCEPTANCE_RELEASE_SONG_ID="<release-ready-song>" pnpm run acceptance:production -- --scopes infra,distribution --confirm-spend --confirm-release
```

The song must already have current certified audio, approved cover art, rights
receipt, split evidence, release package, and matching artifact fingerprint.
After submission, replay duplicate and out-of-order partner webhooks and prove
the state remains monotonic and idempotent.

## 7. Repository Hosting Checks

Before treating a remote red check as a product regression, confirm that its
runner actually started.

- GitHub Actions run `29432100392` allocated no runner and executed zero steps.
  GitHub reported a failed account payment or exhausted Actions spending limit.
  Corrective action: restore Actions billing/spend capacity, then rerun the job.
- `Workers Builds: afroboom` is a stale Cloudflare GitHub App integration. This
  repository has no Wrangler config or Cloudflare Worker deployment; its BullMQ
  worker deploys through Railway. Disconnect `afroboom` under Cloudflare Workers
  & Pages → Settings → Builds, then remove this repository from the Cloudflare
  GitHub App's repository access. Do not disable repository CI.

## 8. Launch Decision

Repository green means the implementation baseline is fit for controlled
staging. Commercial launch still requires the applicable live account,
migration rehearsal, backup restore, queue chaos, payment, and distribution
evidence. "Better than Suno" remains a separate human-evidence decision and must
never be inferred from repository tests or provider output alone.
