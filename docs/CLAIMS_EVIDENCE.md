# CLAIMS ↔ EVIDENCE CONTRACT

> Adopted from the CrucibAI honesty layer (2026-07-11). Every quality claim any
> user surface makes must map to a stored measurement. Claims without current
> evidence are **HELD** — the strongest allowed wording is listed. A CI probe
> (`apps/worker/scripts/test-claims.ts`, in the suite) fails the build if a held
> phrase or an invented number appears in web source strings.

## Approved claims (each traces to evidence)

| Claim (UI wording) | Evidence source |
|---|---|
| "Lane score N/100" | `Song.laneScore` — DSP ear + lane compliance (measured refs / expert-prior, disclosed) |
| "A&R N/100" / "Will it hit" | `Song.hitScore` / `hitRead` — judgment-brain read; **never shown when null** |
| "Mastered (streaming loudness)" | `Master.meta.qc.integratedLufs` — measured on the mastered artifact |
| "Drift: none/minor/major" | `Song.laneGaps.drift` — compliance detector |
| grounding line ("measured (N refs: X external + Y self)") | `groundingOf()` over SoundReference origins |
| "This take was rendered on a fast draft engine…" | `engineAdequacy()` — class language only (§1.11) |
| Cost figures on /admin | ProviderJob.cost + AnalyticsEvent llm.call/stems.run — **labeled estimates** |

## HELD claims — never render these

Strongest allowed wording appears in parentheses.

- **"radio-ready" / "studio-quality" / "industry-standard"** (allowed: "mastered to a competitive streaming loudness — measured N LUFS")
- **"guaranteed hit" / "will go viral"** (allowed: "A&R read: N/100 — advisory; your ear decides")
- **"#1" / "number one" / "best in the world"** (allowed: nothing — comparative superlatives need external evidence that does not exist)
- **Any percentage or uptime the ear didn't measure** ("99.x%", "N% success rate")
- **Naming third-party engines on public surfaces** (§1.11 — engine classes only)
- **"learns your sound" beyond what the lake proves** (allowed: the /lake page's real counts + the grounding line)

## Rules

1. A metric renders from a stored value or renders as "not yet measured" — never a literal number in JSX.
2. New user-facing quality wording must be added to this table (with its evidence source) in the same PR.
3. The suite's claims probe is the enforcement — if it can't see your evidence mapping, the wording is held.
