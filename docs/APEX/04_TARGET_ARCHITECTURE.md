# 04 — TARGET ARCHITECTURE (Apex Phase 3)

_The perfect version, concretely — and the diff from reality. Order of law applied:
Question → Delete → Simplify → Accelerate → Automate._

## Questioned & deleted (the survival list)

- **Survives (serves the exchange):** create→release pipeline, listen/learn,
  best-of-N QC, A&R + hit predictor, rights spine, catalog workstation, chat.
- **Deleted/deferred by decision:** marketplace, streams-feedback loop, DAW
  feature-parity, PostGIS heatmaps (already removed), AI/MCP landing section
  (removed on Owner feedback), referral mechanics (until users exist).
- **Kept as honest seams (not deleted, clearly labeled):** distribution
  (not_configured until key), video render (stub), voice clone (needs paid plan).

## Modern architecture bar — status

| Bar | Status | Evidence / gap |
|---|---|---|
| Typed end-to-end, zero unexplained `any` | ✅ | any-census = 0 |
| Inputs schema-validated at every boundary | ✅ after 0cf5d14 | zod on all POST/PATCH bodies incl. approve/polish/hook-edit |
| Single source of truth per concern | ✅ | auth=middleware/auth, credits=middleware/credits, queue=lib/queue, storage=lib/storage |
| Multi-step writes transactional | ✅ | credits txn, webhook handlers txn (0cf5d14), duplicate/reuse txns |
| Tenant isolation at data layer | ✅ (single-tenant today) | workspaceId on every user query (verified by sweep); enforced-by-schema comes with P2 auth |
| Side effects retried + idempotent | ✅ | BullMQ retries; PayPal idempotency by unique key incl. race path (0cf5d14) |
| Fail-fast env validation | ⚠️ LEDGER | vars documented (.env.example complete now); a boot validator is P2 |
| Observability | ✅ | Sentry + PostHog + pino + honest job errors |
| CI gates | ⚠️ LEDGER | tests exist + run locally; GitHub Actions workflow is P2 |
| Reversible migrations | ⚠️ deliberate | db push until multi-tenant gate; then prisma migrate |
| Hot-query indexes | ✅ after 0cf5d14 | Song/ChatMessage/ProviderJob composites |

## Modern experience bar — status

Value <5min ✅ (once music key set; ~90s/song) · No dead ends ✅ after 0cf5d14
(cap → Billing; failures → honest reasons; after-"no" paths lead somewhere) ·
Loading/empty/error states ✅ mostly (listen spinner = P2) · Mobile ✅ after
0cf5d14 (chat responsive) · Honest copy ✅ (README + landing truth pass).

## Modern AI/agent bar — status

Perfect knowledge at contact ✅ (DNA + memory + learned refs + trends injected) ·
Adapts per individual ✅ · Outcome verification ✅ (measured QC + honest verdicts
+ release gates) · Learns and compounds ✅ per-event (semantic embeddings now
stored; nightly consolidation = roadmap) · Tenant-isolated learning ✅ ·
Human-overridable ✅ (manual hook pick, gen-guard caps, native-review block) ·
Graceful model failure ✅ (Claude→OpenAI fallback; suno→ace_step fallback;
layered listen).

## Future-proof bar — status

Providers behind interfaces ✅ (music/voice/image/video adapters) · Versioned API
✅ (/api/v1) · Data exportable ✅ (release bundles; full export = P3) · Docs
current ✅ (this pack) · 10× headroom ⚠️ (P3 items: split queues, webhooks not
polls, PgBouncer — gated to pre-public).

## The five-step verdict

Question ✅ · Delete ✅ · Simplify ✅ · Accelerate ✅ (the one remaining lever is
Owner-side: a music key that unlocks first-visit value) · Automate ✅ (last, and
bounded by cost caps everywhere).
