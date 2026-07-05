# AfroHit Studio — Strategy & Build Direction

_Owner: Benjamin. Written 2026-07-05. This is the north star, not a checklist. The
current product is **frozen as the baseline** — we ADD to it where there is real
use; we do not rebuild or redesign it._

---

## 1. What we are (the position)

Not "Suno but Afro." Not a DAW. Not a prompt box.

**AfroHit is an AI executive producer.** It sits between three worlds and takes the
best of each:

| World | Their strength | Our answer |
|---|---|---|
| Suno | instant full songs | instant songs **that get better over time and know your sound** |
| FL Studio | deep producer control | producer-level control **without DAW skill** |
| Pro Tools | pro edit/mix/release trust | mix, master, stems, rights, export, release **built in** |

The one-line pitch:

> Anyone can make a song fast. AfroHit makes a song that sounds **culturally right**,
> gets **better every time you use it**, can be **fixed like a producer would fix it**,
> and comes out **ready to release.**

## 2. The moat is the loop, not "we use AI"

Everyone uses AI. The defensible thing is the **compounding loop**:

```
create / upload  →  deep-listen & learn the sound  →  generate candidates
      ↑                                                      ↓
better next song  ←  release / feedback  ←  fix weak parts  ←  score its own output
```

We already own the left half (listen → learn → generate). **The right half — the
system scoring and fixing its OWN output — is the missing heart.** That is priority #1.

## 3. The one truth ChatGPT never said: why it's "not the exact beat"

Benjamin's most persistent complaint — "it's shallow, same-y, not the exact beat" — is
**architectural, not a bug we can prompt our way out of.**

Every beat today comes from a **text-to-audio black box** (Suno / MusicGen / ACE-Step /
MiniMax). You describe a vibe in words; the model *hallucinates* a beat. You physically
**cannot get an exact beat out of it**, because it does not take a beat as input — only
text. Our Sound DNA + learned recipes push it closer, but there is a hard ceiling. More
prompt engineering will not break that ceiling.

A real producer does not describe a beat in a sentence. He **arranges real material** —
drum one-shots, log-drum loops, shakers, 808s, MIDI grooves, chord stabs.

So the honest path to "the exact beat" and to beating Suno on *control* is:

> **Add a real musical-material layer the AI arranges** — a library of owned / licensed /
> royalty-free loops, one-shots, and MIDI grooves — instead of relying 100% on a
> text-to-audio model to invent everything.

This is the biggest strategic bet on the page (see Phase 5). It is what turns AfroHit
from "a better prompt" into "a producer that actually places sounds."

## 4. The wedge: "Learn My Sound"

The first premium, differentiating feature is **not more buttons**. It is:

> Upload 5–10 songs you own or license → AfroHit builds your **artist sound profile**
> (your Afro lane, worship lane, street-pop lane, R&B lane…) → **every** future
> generation moves toward *your* sound.

We already have the plumbing (upload → deep-listen → `SoundReference` → injected into
generation). We do **not** have it packaged as the headline onboarding. Package it.

**Legal line (permanent):** learning comes ONLY from user-owned uploads, licensed audio,
royalty-free / CC audio, and public **metadata**. We never rip YouTube / Spotify / TikTok
audio. This is not "training a model" in the legal-risk sense — it is a per-user
**production memory** (RAG), which is fine.

## 5. The four libraries

1. **MusicDNA** — internal, per genre/subgenre: BPM, swing, drum grid, bass behavior,
   chords, arrangement sections, vocal style, mix, viral-moment placement. _Today this is
   prose. Upgrade to structured rules (Phase 3) so it feeds BOTH generation and the QC scorer._
2. **User Sound** — the user's owned/licensed uploads. This is where taste is learned. ✅ plumbing exists.
3. **Producer Packs** — commissioned/curated **royalty-free** loops, one-shots, log drums,
   shakers, gospel keys, highlife guitars, 808s. This is the "real material" for Phase 5.
4. **Trend** — YouTube/TikTok/chart **metadata only** (already wired). Direction, not sound.

## 6. What we already have (do NOT rebuild)

SoundReference learn library · deep-listen producer breakdown · learned refs injected into
generation · hit-predictor/A&R · per-genre Sound DNA · reuse-beat (clean instrumental) ·
unique-filename downloads · genre honored · artist-name-as-influence · mix · master/remaster ·
stems · snippet engine · rights/split-sheet/ISRC · release gate · cost caps · SSRF guard ·
persistent chat · manual hook selection · real Shazam (mic + file). **These are done.**

## 7. The real gaps — build order (all additive, freeze-safe)

**Phase 1 — Close the quality loop (the flywheel's heart). HIGHEST VALUE.**
After every render, the system re-listens to *its own output* (`analyzeAudio`) and scores
it against the target: genre match, BPM/key, groove/pocket, hook strength, vocal realism,
mix, and a 8–15s viral moment. If it fails a bar, it **says so honestly and regenerates
the weak part** instead of shipping a straight line. Reuses `analyzeAudio` + `hit-predictor`
we already have. Today's QC is only `duration >= 12s` — that's the whole gap.

**Phase 2 — Eval harness (measure & prove; approved by Benjamin).**
A golden set of briefs × genres (Afrobeats, Amapiano, Afro-R&B, Street-Pop, Gospel,
Highlife, Hip-Hop, Pop, R&B, Dancehall, EDM, background) run through the full pipeline,
each scored (genre match, groove, drums, hook, vocal realism, arrangement, mix, viral
moment), saved as a dated scorecard. This is how we know we're improving and catch
regressions. Without it, "it got better" is a vibe, not a fact.

**Phase 3 — MusicDNA 2.0 (prose → structured rules).**
Turn the Sound DNA prose into a structured per-genre/subgenre object (BPM range, swing %,
drum pattern, bass behavior, arrangement map, viral-moment placement). Makes generation
more precise AND gives the Phase-1 scorer an objective target to grade against.

**Phase 4 — "Learn My Sound" surface (the wedge).**
Package the existing upload→learn plumbing as a first-class onboarding: multi-upload, a
visible **Sound Profile** per artist, and every generation defaulting to it.

**Phase 5 — Real musical-material layer (the moat; biggest bet — see §3).**
A royalty-free Producer Pack library the AI arranges (loops/one-shots/MIDI), plus using
providers that accept **melody/drum conditioning** so a real groove can be fed in. This is
the path to "the exact beat" and true producer control. Largest scope; needs a
licensing/cost decision.

## 8. What we REJECT from the feedback (it was strong AND stupid)

- **"Baseline theater"** — pnpm install / BASELINE_STATE.md / re-verify-everything
  checklists. We know our state. Don't re-run the intro every session.
- **Marketplace / verified-creators** — way too early. Business item, not now.
- **Distribution-feedback loop (streams→taste)** — premature; no real volume yet.
- **"Beat every DAW"** — no. Win the *loop*, not feature-parity with Pro Tools.
- **Repeating the fix-list back as strategy** — the checklist is not the strategy. The
  loop is the strategy.

## 9. The rule for every phase

Additive only. Prove it live (real render, real fields — no stubs, no fake green). After
each phase: files changed, why, what ran, pass/fail, remaining risk. Never claim done
unless build + typecheck + tests are green and it's verified on a real song.
