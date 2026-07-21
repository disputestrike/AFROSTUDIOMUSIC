# AfroHits — The Release Campaign: the definite end-to-end build

*Grounded in what's actually in the code + the viral rules + the ViralForge patterns. This is the concrete flow, not strategy talk. Written to hand to Claude and build.*

---

## The one flow — the assembly line

```
CREATE            VISUALIZE                 RELEASE KIT (automatic)        DISTRIBUTE        GROW
  song    →   music video   →   auto-cut into shorts/reels/tiktoks   →   one-click to    →  watch time
 (have)       (have)            + lyric video + visualizer               all platforms      shares, saves
                                + captions + hashtags + titles                              → repost winners
                                + thumbnails + bio + calendar
                                (all generated the moment the video is done — NO clicking)
```

One song goes in. A full release comes out. The rule underneath everything: **generate once, cut many.** The song and the master video are the only expensive renders; every clip, caption, title, and hashtag is a cheap edit or a Cerebras text call off what already exists.

---

## What's DEFINITE (already in the code) vs what we BUILD

| Asset | Status | Where |
|---|---|---|
| Song (genre-correct + "feel like" reference) | **HAVE** — fixed tonight, tuning by ear | own-engine |
| Music video (splash + "afro" watermark + credit) | **HAVE** — improved tonight | assemble-video |
| Video title / concept | **HAVE** | video-concept |
| Cover art (upload + AI-generated) | **HAVE** | images / cover-generate |
| Lyrics, master, instrumental, stems | **HAVE** | songs / master |
| Socials pack: story + captions + hashtags + hook | **HAVE but MANUAL** — you must click "Generate" | socials-pack |
| **10 short clips (TikTok/Reels/Shorts)** | **BUILD** | — |
| **Lyric video + visualizer** | **BUILD** | — |
| **Thumbnail options (for CTR)** | **BUILD** | — |
| **10 YouTube titles + description + artist bio + release calendar** | **BUILD** (extend socials pack) | — |
| **Release page** | **BUILD** | — |
| **Distribution to platforms** | **BUILD** (one aggregator) | — |
| **Analytics / grow loop** | **BUILD** (last, thin) | — |

---

## The #1 behavior change: AUTOMATIC, not manual

Today the Socials tab makes you press "Generate," and the hashtags don't show until you do — that's why *"we did not see it."* Wrong model. **The Release Kit must generate itself the moment a song and its video finish**, so when you open the song, everything is already sitting there: captions, hashtags, titles, clips — done, waiting. A "Regenerate" button stays for when you want a fresh take, but nothing waits on a click.

Fix: on song completion (and again when the video finishes), fire the kit generation in the background as its own job; the tab renders the finished kit. No user action. This is the fastest visible win and it directly fixes what you flagged.

---

## The Release Kit — every asset, with the viral rules baked in

**Short-form video (the missing core — ffmpeg crops off the ONE master video):**
- Full music video *(have)*
- **10 vertical clips at 15/30/60s** for TikTok / Reels / Shorts. Each one: starts on the strongest **1–3 second hook**, no slow intro, **captions burned in** (most people watch sound-off), subject centered, designed to loop, a strong moment every few seconds.
- **Lyric video** (off the master audio + existing lyrics)
- **Visualizer** (audio-reactive, cheap)
- **3–5 thumbnail options** (thumbnail + title decide the click on YouTube)

**Words / metadata (Cerebras-cheap — extend the socials pack that exists):**
- Story — what the song is about *(have)*
- **10 YouTube titles** (curiosity, never clickbait) + 1 description
- Per-platform captions *(have captions; make them per-platform)*
- **Hashtags in 3 tiers** *(have hashtags; formalize)*: **genre** (#Afrobeats, #AfricanMusic), **audience** (#NewMusic, #IndependentArtist), **matched-trend only** (never an unrelated trending tag). 3–5 per post, not stuffed.
- Artist bio
- **Release calendar** (post when the audience is active)
- Pinned comment + one genuine question to spark discussion

**Audio / art *(all have)*:** master, instrumental, stems, cover art.

---

## Distribution — one aggregator, not nine builds

One integration (Postiz/Ayrshare-style) pushes the video + shorts to YouTube, TikTok, IG, Facebook, and the rest. The artist connects their accounts once; we schedule from the release calendar. This is the single biggest time-saver learned from ViralForge — do **not** build nine native uploaders.

## Grow — last and thin

Pull back **watch time, shares, saves, repeat plays** (not likes-vanity, not generation count). Show which clip / title / thumbnail won. Repost the winners. Don't build the full learning loop until real posts exist — it's inert without them.

---

## Website — the definite changes

- **Hero:** *"Turn your idea into a finished release."* Sub: *"Create original songs, professional vocals, mastered audio, cinematic video, and social content — ready to release."* Two buttons: **Create a Song** · **Turn My Song Into a Video.**
- **Four pillars as the spine:** CREATE · VISUALIZE · RELEASE · GROW.
- **Homepage order:** Hero → real Examples (songs + videos playing) → How it works (Idea → Song → Video → Release → Audience) → **"One song. 30 pieces of content."** (the Release Campaign, with the fan-out diagram) → Creator success → Technology (AI, rights, mastering, quality — pushed DOWN here, supporting not leading) → Pricing.
- **Kill AI-first language** everywhere. Lead with music, culture, artist, audience. AI is underneath.

## Pricing — outcomes, not credits

- **Creator — $49:** songs + cover art + short videos + release kit
- **Pro — $149:** more songs + full music videos + content packs + commercial rights
- Credits stay internal plumbing; the page says what you can **create and release**, never "460 credits."

---

## Build order — what to do first

1. **Auto-generate the Release Kit on song/video completion** (kill the manual "Generate," wire the existing socials pack to fire + display automatically, formalize the 3-tier hashtags). *Fixes "we did not see it." Fastest visible win.*
2. **Auto-clip the master video → 10 vertical shorts** (ffmpeg, hook-first, captions burned in). *The biggest missing piece, and cheap because it's edits.*
3. **Lyric video + visualizer + thumbnails.**
4. **Release page** (the shareable destination a campaign points at).
5. **Distribution aggregator** (one integration → all platforms).
6. **Grow / analytics** (watch time, shares, saves; repost winners).

## The viral rules, applied (not decoration)

Every clip: hook in 1–3s, no slow open, captions on, loop-friendly, subject centered, a strong beat every few seconds. Every title: curiosity, not clickbait. Every hashtag set: 3–5 relevant, tiered, never an unrelated trend. Every metric that matters: watch time + shares + saves + repeat plays. Never optimize for how many files we made.
