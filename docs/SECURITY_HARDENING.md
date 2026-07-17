# Pre-Release Security Hardening (2026-07-17)

An adversarial 6-surface audit (auth, rate-limit, injection, secrets, spoofing,
reliability) produced 20 findings; a skeptical verify pass confirmed 6 as
high-severity exploitable. All 6 are fixed on branch `security-hardening`, plus
several mediums the owner named (content abuse, CAPTCHA, CSP). Every fix is
pinned by `apps/api test:security-hardening` so it can't silently regress.

## Confirmed high-severity — FIXED

| # | Hole | Fix |
|---|---|---|
| 1 | **Cross-tenant IDOR in chat** — a caller-supplied `projectId` was used unscoped, leaking another workspace's hooks/lyrics/songs and running tools against it | `ownedProjectId()` validates the project belongs to the caller's workspace at both thread-create sites; a foreign id becomes null |
| 2 | **Chat/autopilot LLM spend** was uncapped and invisible to the daily cap | per-workspace throttle on both chat endpoints (autopilot far tighter); env `CHAT_PER_MIN` / `CHAT_AUTOPILOT_PER_MIN` |
| 3 | **Cost-blind daily cap** — 25 flagship videos counted like 25 hooks | hard **money ceiling** on beta workspaces (`costUsage` sums real debit; default ~$25/day; `BETA_DAILY_SPEND_CEILING`); the house is exempt |
| 4 | **Account-creation spam** | already 5/min-per-IP + prod-gated by `ALLOW_PUBLIC_SIGNUP`; **CAPTCHA** now gates it when armed |
| 5 | **Open redirect** on the public share link (phishing launder) | `isAllowedShareTarget()` allowlist (own domains + real music/social platforms); off-list targets 403 |
| 6 | **Redis outage took down the whole API** — the rate limiter was a fail-closed single point of failure | `skipOnError: true` — the limiter degrades to briefly-unmetered; the per-workspace guards still bound the expensive routes |

## Mediums also fixed
- **Content-abuse gate** on the video prompt (`checkGenerativeContent`): high-confidence real-person likenesses, copyrighted characters, and prohibited content are refused before spend.
- **CSP** enabled on the API (`default-src 'none'`; the JSON/redirect API needs nothing looser); `API_CSP=off` to opt out.

## Operator switches (owner action at launch)
- `CAPTCHA_SECRET` (+ `CAPTCHA_PROVIDER=turnstile|hcaptcha`) and the matching **site key on the web signup form** — arms bot defense. Until set, signup is unchanged.
- `BILLING_ENFORCEMENT=on` at launch (the beta free-mode default is intentional but fail-open; the money ceiling now caps abuse either way).
- `SHARE_REDIRECT_ALLOWED_HOSTS` — add any extra domains your artists legitimately link to.
- Rotate any keys pasted in chat during development.

## MFA — the decision (documented, not yet built)
MFA is real work, not a config flip. Recommended when going past beta:
- **TOTP (authenticator app)** is the cleanest first step — a `UserMfa` table (secret, verifiedAt, recoveryCodes), an enroll/verify endpoint pair, and a check inserted at the `login` handler after password verification (before the session cookie is minted). No third-party dependency, no per-message cost.
- Insertion point: `apps/api/src/routes/auth.ts` login handler, gated by a per-user `mfaEnabled` flag so it's opt-in until enforced.
- Defer SMS MFA (cost + SIM-swap risk); TOTP + recovery codes covers the threat.
Say the word and it's a focused build.

## Honest scope note
Live load/chaos/penetration traffic against production was **not** run — that
violates the freeze and risks a real outage. This is code-level hardening plus
the automated gate. A real load/pen test is an owner-authorized ops exercise
against a staging copy, best run after this branch deploys.
