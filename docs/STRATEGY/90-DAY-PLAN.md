# AfroHits Studio — 90-Day Execution Plan

*Grounded in the actual codebase as of 2026-07-21. This is not a generic roadmap — every "build" line is checked against what already exists in the repo, so we don't pay to rebuild things you already have. Written to be handed to Claude or a developer and acted on directly.*

---

## The strategy in one line

Turn AfroHits from "an AI song generator" into the place an independent African artist goes to **make a song that sounds right, wrap it in a release, and get it seen** — CREATE → RELEASE → GROW. The customer never buys "AI." They buy a finished record and a shot at an audience.

## The customer decision — make it now, don't stay vague

**First customer: independent African & diaspora artists.** Not everyday-fun users (won't pay), not churches/brands (that's a content-buyer product, build it second off the same engine). Pick artists, and the homepage, pricing, and the whole "one song → many assets" promise sharpen around one real person.

Why artists specifically, and why this isn't arbitrary:
- The **only defensible moat in the code** points at them: the Afro genre depth and the tone-correct Yoruba/Swahili vocal conditioning (`african-g2p.ts`, the singer work). A US rapper uses Suno; a Naija artist who needs their language sung *correctly* can't. Nobody else serves that.
- They feel the exact pain the product solves: "I made a song and nobody hears it." Release + grow **is** their gap.
- One audience means one message instead of the current site talking to six at once.

Everything below assumes that customer.

---

## Honest starting line: what already exists (do NOT rebuild)

Half the "Release Campaign Generator" from the vision doc is already in the repo. The work is mostly **packaging + repurposing**, not green-field.

| Vision-doc capability | Status in code | File(s) |
|---|---|---|
| Song / instrumental / vocals | Live | `own-engine.ts`, `produce.ts`, provider adapters |
| Stems | Live (`withStems`) | beats/generate path |
| Mastered audio | Live | `master.ts`, ffmpeg master path |
| Lyrics (+ verbatim edit) | Live | `songs.ts` lyrics routes |
| Cover art — upload **and** AI-generated | Live | `images.ts`, `/songs/:id/cover/generate` |
| Music video (treatment → scenes → assembled cut) | Live | `video-treatment.ts`, `assemble-video.ts` |
| Logo splash + persistent "afro" watermark | Live | `assemble-video.ts` |
| **Socials pack: story + 3 captions + hashtags + hook** | Live (built 2026-07-20) | `socials-pack.ts`, `/songs/:id/socials` |
| RBAC / multi-tenant / profile + song pictures | Live | `identity` work |
| Offline playback | Live (flag) | PlayerContext, `sw.js` |
| Distribution assets | **Partial** | `distribution.ts` (PayPal, some scaffolding) |

**The genuinely missing pieces are narrow:** auto-cutting the master video into vertical Shorts/Reels/TikToks, a lyric video, a public release page, YouTube titles/descriptions, a release calendar, and *packaging all of the above into one "Release Pack" flow* instead of scattered buttons. That's a much smaller build than "become a media company" implies — which is good, because overbuilding is the standing risk.

---

## The sequencing call — where I disagree with the advisor

The advisor said: *build the content-repurposing engine before adding more music features; the moat isn't the song.*

**Half right. Fix the song FIRST — it's nearly there, don't skip it.** As of tonight, "rap" finally sounds like rap, "feel like Dre" finally reaches the sound, and the genre/reference bugs are fixed. But the sound is **validated by tests, not yet by ears**, and songs still take ~4–5 minutes. A 30-piece content machine amplifies whatever it's fed — build it on mediocre songs and you get 30× mediocre content. So:

1. **Week 1: validate the sound with real ears** (the owner + a few real artists), across genres. This is the cheapest, highest-leverage thing and it's a listening session, not a build.
2. **Then** build the amplifier. The advisor's *"generate once, repurpose many"* is correct and — importantly — **economically true in this stack**: generating a video is expensive (forge + render), but cropping one master into 10 vertical clips is near-free ffmpeg work. The 30-piece promise holds **only** if built as edits, never as 30 regenerations. If anyone builds it by re-rendering, it bankrupts you.

---

## Phase 1 — Days 1–30: Foundation (make the promise true and legible)

Goal: a first artist lands, understands "I make and release music here," makes one song they're proud of, and exports a release pack.

1. **Validate the sound (Week 1, no code).** Owner + 3–5 real artists generate across rap, afrobeats, amapiano, gospel with genre + a "feels like" reference. Confirm by ear that selection = output. Log what's still off; that's the sound backlog. *Don't build anything else until this passes.*
2. **Reposition the homepage around the outcome.** Hero: *"Turn your idea into a finished release."* Two buttons: **Create a Song**, **Turn My Song Into a Video**. Move "A video for every song" and real examples up top; push rights/mastering/consent copy **down** into a "why it's professional" section. Lead with music and culture, not AI. *(Copy must pass the `humanization` skill — no filler, specific, takes a position.)*
3. **Turn on the speed wins already built.** Flip `SONG_BED_FIRST_STREAMING=1` after one verification render (instant playback), and set worker `CEREBRAS_API_KEYS` and `REPLICATE_MUSIC_VERSION`. These are env levers, not builds — free speed.
4. **Package what exists into a "Release Pack" export.** One button on a finished song that bundles what's ALREADY generated: master, instrumental, stems, cover, lyrics, the socials pack, and the video if it exists — into one downloadable/shareable set. This is assembly of existing pieces, ~days not weeks.
5. **Open the front door.** `ALLOW_PUBLIC_SIGNUP=1` + `RESEND_API_KEY` so real artists can actually sign up and reset passwords.

## Phase 2 — Days 31–60: The Release Campaign engine (the moat)

Goal: one song → a whole campaign, built by **repurposing**, not regenerating.

1. **Auto-clip the master video → short-form.** From the one assembled video, cut vertical 15/30/60s clips (ffmpeg crops + the existing "afro" watermark). Target 6–10 clips per song. This is the single highest-value new build and it's edit-work, cheap. Design videos for it: subjects centered, a strong moment every few seconds, no slow intro.
2. **Lyric video + visualizer.** Cheap generated variants off the master audio + existing lyrics — no new song render.
3. **Extend the socials pack into a full release kit.** You already generate story/captions/hashtags/hook (`socials-pack.ts`). Add: 10 YouTube titles, a description, a 3-tier hashtag set (genre / audience / matched-trend-only — never unrelated trends), an artist bio, and a simple release calendar. All Cerebras-cheap text; extend the existing endpoint.
4. **Public release page per song.** A shareable page (cover, player, artist, links) — the destination a campaign points at. Reuse the existing share route + covers.
5. **Bake humanization into the generators.** The lyrics/socials/bio/title prompts must pass the `humanization` skill, and add a lightweight "artifact detector" review step that rejects generic/filler output before it ships. *(Real code task in `packages/ai` prompts — this is what makes the campaign not sound like AI.)*

## Phase 3 — Days 61–90: Grow (first slice only — resist scope)

Goal: prove the loop from release → audience for the first cohort. Build the *thinnest useful* version, not a full platform.

1. **One distribution integration, done well** (start with YouTube upload of the video + Shorts). Treat distribution as a legal/ops layer — publishing on an artist's behalf pulls in rights and payouts; keep it narrow and correct, not broad and half-working.
2. **Minimal analytics that matter.** Track and show the owner's own north-star signals: watch time, shares, saves, repeat plays — not generation volume.
3. **Artist public profile + a small Discover surface.** Reuse the profile/cover work; let a listener browse a handful of AfroHits releases. This is the seed of the "label," kept tiny.

---

## The kill list — do NOT build yet (where not to spend)

- **Full multi-DSP distribution** (Spotify/Apple/content-ID). One integration first; the rest is a rights/ops project, not a feature.
- **Marketplace / collaboration / community.** Phase 4+, only after the release loop is proven.
- **More music-generation *features*** beyond validating and tuning what exists. The moat is the campaign, not another knob — *once the sound passes the ear test.*
- **Regenerating content that could be an edit.** Any "10 TikToks" built as 10 renders is banned by economics.
- **"World's first African digital entertainment studio" as today's homepage.** Right north star, wrong claim for a product that can't yet deliver the full label. Grow the copy into it as the product catches up.

---

## Metrics — optimize for audience, not output

Primary: **watch time, shares, saves, repeat plays.** Secondary: likes, followers, comments. The strongest single signal: *did people keep watching and share it?* Do **not** optimize for songs-generated or files-produced — that's a vanity number that costs money.

## The money + risk reality (say it plainly)

- **Video is the cost center.** 30 assets is cheap as edits, but the *first* video is still minutes and real spend. The bed-first streaming and video-speed work already done matter most here — the campaign only feels magic if the first render isn't a 10-minute wait.
- **Speed is a retention issue, not a nicety.** A furious owner tonight was a preview of a furious customer. The under-2-minutes target and instant playback stay on the critical path.
- **Legal lines hold.** Style-steering ("feel like Dre") yes; voice-cloning a real person, no — the never-clone guard stays. Distribution drags in rights; move deliberately.

---

## Revision — patterns learned from ViralForge (2026-07-21)

*Read the owner's separate ViralForge OS project for understanding only — nothing connected, nothing imported. It's a working blueprint for the publish/grow problems below, and it sharpens this plan four ways. Patterns adopted, not code.*

1. **Distribution = one aggregator, not N native uploaders.** ViralForge routes all 9 social platforms through a single aggregator adapter. Phase 3 distribution shrinks from weeks-per-platform to one integration for everything (caveat: the aggregator needs the artist's connected accounts). Biggest speedup.
2. **Keep the render on ffmpeg — do NOT adopt Remotion/Chromium.** ViralForge's one fatal prod flaw was a Chromium-dependent render that ran "degraded / no MP4" on slim containers. AfroHits' ffmpeg pipeline (proven live) is the robust choice. Phase 2's auto-clip stays pure ffmpeg crops. De-risked.
3. **The grow loop has a proven recipe:** analytics → reward → bandit picks winners → auto-repost winners across channels. Phase 3 gets a blueprint, not a research problem (comes alive only once real posts exist — cold-start).
4. **Fan-out data model settled:** one master → tracked derivative assets (ViralForge's project→run→treatment shape). Removes Phase 2 design churn.

**The cautionary lesson (hardens the kill list):** ViralForge built the full autonomous empire — 9 workers, documentaries, podcasts, talking-heads — and by its own audit **never ran a single paid live generation** and never verified live publishing. A skeleton unproven at paid scale. So: build the thin music slice and **prove ONE real thing live end-to-end — one song rendered, clipped, and actually published — before adding any breadth.** Do not repeat "coded but never run."

Net effect on timeline: Phase 1 unchanged (sound validation still gates everything, ears-first — ViralForge speeds up none of it). Phase 2 same scope but lower risk. Phase 3 meaningfully faster and clearer.

## The first three things to do tomorrow

1. **Listen.** Owner + real artists validate the sound across genres. No build until it passes.
2. **Reposition the homepage** around Create → Release → Grow, outcome-first, AI underneath. (humanization skill applies to every word.)
3. **Ship the "Release Pack" export** of the pieces you already generate — the cheapest possible proof of the campaign vision.

Everything after that follows the phases above. The moat isn't making the song — but a great song is the fuel the moat runs on. Get both right, in that order.
