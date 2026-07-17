# Treatment Prompt Design — the law book beside the brain

This document lives beside the video prompt system
(`packages/ai/src/prompts/storyboard.ts`) and records **why each law exists,
what past rewrites removed, and what prompts cannot fix** — so no future
rewrite silently drops a hard-won rule. (Pattern learned from CrucibAI's
`docs/APEX/CRUCIBAI_SYSTEM_PROMPT.md`: a system prompt is behavioral
steering, not intelligence; keep its rationale under version control.)

## The laws, and the incidents that made them

| Law | Born from | Code twin |
|---|---|---|
| **PERFORMER LAW (roster)** | 2026-07-16/17: "A.I baddie" cast a male lead for a woman-sung song; then a duet rendered with the female singer never appearing. Root cause: the brain received ONE scalar word (often "unknown") instead of a cast list. | `performersFromVoice`, duet gate `missingDuetLeads` (502 before spend) |
| **VOCAL-SYNC** | Same duet incident: who is ON SCREEN must be who is SINGING. Voicing comes from the vocal arranger (`sectionVoicing`), mapped onto measured sections. | `sections[i].vocal` in the brain payload |
| **CAST LAW** | 2026-07-17: "we're seeing a bunch of white women" — engines default to training-set bias when the prompt is silent. An unstated cast is a wrong cast. | Pinned in `test-video-storyboard` (both brains) |
| **ARTIST'S VISION LAW** | Owner: "people have their own ideas — stick with it, or enhance it… you HAVE to use their script." strict = translate; enhance = elevate, recognizably theirs. Binds UNDER performer/cast/safety. | `vision`/`visionMode` schema; UI on both empty + rewrite states |
| **VERBATIM CONTINUITY** | Video engines have no memory between shots; the words ARE the continuity. Locked cast descriptions repeat verbatim; sequence continuity folds into every shot prompt. | `decorateTreatmentShotsForRender` |
| **CHARACTER SHEETS (Package B)** | Same-faces-all-video: one portrait per lead, i2v keyframe on that lead's scenes. Cheaper than t2v ($0.19 vs $0.28). | `ensureCharacterSheets` (atomic claim; best-effort) |
| **CRITIC + MINIMAL REPAIR (Package C)** | Pennies of text protect ~$10 of renders. Fixed rubric; the ANTI-ASSUMPTION TRIPWIRE (must quote the lyrics it grounded in — "I assume" is auto-rejected); ONE repair round changing ONLY what the critic named. | Route: critic → tripwire → repair → re-gate; `meta.criticReport` |
| **STRUCTURE FROM MEASUREMENT** | The model never decides timing — sections come from measured audio boundaries; the normalizer distrusts model timing entirely. | `normalizeVideoTreatment` |
| **FULL-SONG COVERAGE** | "The song and the video go together — it covers the full length." Scenes cycle to fill the record; honest `loopedCycles`. | assembler `coverAudio` |
| **NAMING/CREDITS** | "Name the video — name and producer." Lower-third credit burned at 0.8–5.2s; disposition-named downloads. | `overlayVideoCredits` |

## What prompts cannot fix (the honest-gap ledger)

- **Raw engine fidelity** — rented ceiling; attack via engine bake-offs, not prose.
- **Lip-sync** — needs the audio-driven pass (verified: kling-lip-sync $0.084/6s primary; feed the ISOLATED VOCAL STEM; singing-lead shots only).
- **True cross-scene identity** — sheets narrow it; only likeness training closes it.

## Future slots (structural room reserved, not rendered)

- **Producer ident** — label logo sting before the record starts.
- **Cold open** — a pre-music scene; treatment schema may carry `ident` /
  `coldOpen` objects which the normalizer passes through untouched.
- **Scene-grammar vocabulary** — research in flight: named Afrobeats
  choreography (zanku, legwork, amapiano footwork…), shot-type ratios per
  section, and an anti-repetition rotation across a workspace's videos.

## Change protocol

Any edit to the prompt laws MUST: (1) update this document's rationale table,
(2) keep/extend the test pins (`test-video-storyboard`, `test-catalog-types`,
`test-video-cards`), (3) state in the commit message which incident or owner
directive motivated it.
