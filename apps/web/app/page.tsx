import Link from 'next/link';
import {
  ArrowRight,
  Mic2,
  Music2,
  Clapperboard,
  Scissors,
  Type,
  Hash,
  ImageIcon,
  FileText,
  CalendarDays,
  Share2,
  Sparkles,
  Video,
  Rocket,
  TrendingUp,
  Lightbulb,
  ShieldCheck,
  Gauge,
  Cpu,
  Play,
} from 'lucide-react';
import { LandingSongWall } from '@/components/LandingSongWall';
import { PricingPlans } from '@/components/PricingPlans';

/**
 * PUBLIC HOMEPAGE — repositioned around the OUTCOME (2026-07-21).
 *
 * The spine is CREATE -> VISUALIZE -> RELEASE -> GROW. The page sells a
 * finished release, not the machine that makes it: music, culture, artist and
 * audience lead; AI, rights and mastering sit in one calm section near the end.
 *
 * Laws this page keeps:
 * - HONESTY: no fabricated plays, users or testimonials. The examples wall
 *   shows real releaseReady records (GET /public/trending) or an honest empty
 *   state. Capability copy claims only what ships TODAY — song, video, and the
 *   auto Release Kit (clips, lyric video, visualizer, thumbnails, captions,
 *   3-tier hashtags, 10 titles, bio, release calendar, release page). One-tap
 *   distribution and analytics are NOT live and are framed as coming.
 * - THE WALL: engine-class language only, no vendor names.
 * - Pricing renders the shared <PricingPlans/> — the same cards /pricing uses.
 */

// Real production lanes (Project.genre vocabulary) — texture under the hero.
const LANES = ['Afrobeats', 'Amapiano', 'Afro-fusion', 'Gospel', 'Afro-R&B', 'Alté', 'Street-pop', 'Highlife', 'Afro-house'];

// HOW IT WORKS — Idea -> Song -> Video -> Release -> Audience.
const FLOW = [
  {
    icon: Lightbulb,
    label: 'Idea',
    line: 'Type it, hum it, or paste your own lyrics.',
  },
  {
    icon: Music2,
    label: 'Song',
    line: 'Written, sung and mastered in your genre — Yoruba, Pidgin, Swahili, sung right.',
  },
  {
    icon: Clapperboard,
    label: 'Video',
    line: 'The record becomes a cinematic music video with your name in the credits.',
  },
  {
    icon: Rocket,
    label: 'Release',
    line: 'A release page, cover art and the whole content kit land ready — no extra clicks.',
  },
  {
    icon: Share2,
    label: 'Audience',
    line: 'Clips, titles and hashtags tuned to travel. One-tap posting and analytics are coming.',
  },
];

// THE RELEASE CAMPAIGN fan-out — what one song turns into. Counts are honest:
// the 10-clip cut posts across TikTok / Reels / Shorts (30 short-form posts on
// its own), plus every asset below. Everything here ships today.
const FANOUT = [
  { icon: Scissors, label: '10 TikToks', note: 'hook-first, captions burned in' },
  { icon: Scissors, label: '10 Reels', note: 'same cuts, vertical' },
  { icon: Scissors, label: '10 Shorts', note: 'built to loop' },
  { icon: Video, label: 'YouTube cut', note: 'the full music video' },
  { icon: Type, label: 'Lyric video', note: 'off the master + your words' },
  { icon: Sparkles, label: 'Visualizer', note: 'audio-reactive' },
  { icon: ImageIcon, label: 'Cover + thumbnails', note: '3–5 CTR options' },
  { icon: FileText, label: 'Captions', note: 'per platform' },
  { icon: Hash, label: 'Hashtags', note: 'genre · audience · trend' },
  { icon: Type, label: '10 titles', note: 'curiosity, never clickbait' },
  { icon: FileText, label: 'Artist bio', note: 'ready to paste' },
  { icon: CalendarDays, label: 'Release calendar', note: 'post when they’re on' },
];

// FOUR PILLARS — CREATE · VISUALIZE · RELEASE · GROW.
const PILLARS = [
  {
    icon: Mic2,
    title: 'Create',
    tint: 'text-gold',
    outcomes: ['Original songs in 40+ genres', 'Professional vocals in your language', 'Lyrics you can edit word-for-word', 'Cover art, generated or uploaded'],
  },
  {
    icon: Video,
    title: 'Visualize',
    tint: 'text-afrobrand-400',
    outcomes: ['Cinematic music videos', 'Short clips for TikTok, Reels & Shorts', 'A lyric video off your words', 'An audio-reactive visualizer'],
  },
  {
    icon: Rocket,
    title: 'Release',
    tint: 'text-magenta',
    outcomes: ['Commercial-loudness masters', 'Cover art and thumbnails', 'A shareable release page', 'The whole Release Kit, auto-built'],
  },
  {
    icon: TrendingUp,
    title: 'Grow',
    tint: 'text-sage',
    outcomes: ['Clips built to travel', 'Captions and 3-tier hashtags', '10 titles and a release calendar', 'One-tap posting + analytics — coming'],
  },
];

// WHAT ONE SESSION GETS YOU — capability scenarios, not fabricated testimonials.
const SESSIONS = [
  {
    icon: Music2,
    title: 'Sung in your language, correctly',
    line: 'Yoruba tone, Pidgin cadence, Swahili phrasing — not a foreign accent guessing at your words. That is the part nobody else gets right.',
  },
  {
    icon: Clapperboard,
    title: 'Voice note in, music video out',
    line: 'Bring a hum or a finished song and leave with a mastered record and its video. Already have the track? Start at the video door.',
  },
  {
    icon: CalendarDays,
    title: 'A month of content from one drop',
    line: 'Finish a song on Monday and the clips, captions, titles and calendar for a whole release week are already sitting there, waiting.',
  },
];

// TECHNOLOGY — pushed DOWN here, supporting not leading.
const CRAFT = [
  {
    icon: Cpu,
    title: 'An engine built for Afro',
    line: 'Our own composition engine knows African genres and languages. It learns only from material you own and consent to — never scraped catalogs.',
  },
  {
    icon: Gauge,
    title: 'Masters with the receipts',
    line: 'Every master ships with loudness and tonal numbers, tuned for streaming, club and reels. Measurements, not vibes.',
  },
  {
    icon: ShieldCheck,
    title: 'Rights-clean by design',
    line: 'Split sheets, consent-first voice and ISRC/UPC receipts ride with the release. We steer style; we never clone a real person’s voice.',
  },
  {
    icon: Sparkles,
    title: 'You direct, AI does the labor',
    line: 'You set the genre, the feel and the reference. The engine handles the hours. The taste stays yours.',
  },
];

// Deterministic bar heights so server and client render identical markup.
const EQ_BARS = [38, 62, 90, 54, 74, 100, 46, 82, 66, 94, 42, 70, 58, 86, 50, 78, 96, 44, 72, 60, 88, 52, 80, 64];

export default function Landing() {
  return (
    <main className="relative">
      {/* ---- Header ------------------------------------------------------- */}
      <header className="sticky top-0 z-40 glass-strong">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" aria-hidden className="h-7 w-7 rounded-md" />
            <span className="font-display text-xl tracking-tight sm:text-2xl">
              <span className="text-gradient">AFRO</span>HITS
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <a href="#examples" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              Songs
            </a>
            <a href="#campaign" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              How it works
            </a>
            <a href="#pricing" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              Pricing
            </a>
            <Link href="/signin" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/signin?mode=signup"
              className="rounded-full bg-afrobrand-500 px-4 py-1.5 font-medium text-ink transition-colors hover:bg-afrobrand-400"
            >
              Create
            </Link>
          </nav>
        </div>
      </header>

      {/* ---- Hero --------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 text-center sm:px-6 md:pb-20 md:pt-24">
        <p className="font-grotesk text-[11px] uppercase tracking-[0.35em] text-afrobrand-300 sm:text-xs">
          Built for independent African &amp; diaspora artists
        </p>
        <h1 className="mx-auto mt-5 max-w-4xl font-display text-5xl uppercase leading-[0.95] tracking-tight sm:text-7xl md:text-[5.5rem]">
          Turn your idea into a <span className="text-gradient">finished release</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
          Create original songs, professional vocals, mastered audio, cinematic video, and social
          content — ready to release.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signin?mode=signup"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-afrobrand-500 px-8 py-3.5 text-base font-semibold text-ink shadow-glow transition-all hover:-translate-y-0.5 hover:bg-afrobrand-400 sm:w-auto"
          >
            <Mic2 className="h-5 w-5" aria-hidden />
            Create a Song
          </Link>
          <Link
            href="/signin?mode=signup"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-8 py-3.5 text-base font-semibold text-slate-100 transition-all hover:-translate-y-0.5 hover:border-afrobrand-500/40 hover:text-white sm:w-auto"
          >
            <Clapperboard className="h-5 w-5 text-afrobrand-300" aria-hidden />
            Turn My Song Into a Video
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">No card to start · your idea carries straight into the studio</p>

        {/* Signature equalizer strip — pure decoration, respects reduced motion */}
        <div className="mx-auto mt-14 flex h-14 max-w-2xl items-end justify-center gap-1 sm:gap-1.5" aria-hidden>
          {EQ_BARS.map((h, i) => (
            <span
              key={i}
              className="w-1.5 origin-bottom animate-eq rounded-full bg-brand-gradient opacity-70 motion-reduce:animate-none sm:w-2"
              style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.12}s`, animationDuration: `${0.8 + (i % 5) * 0.14}s` }}
            />
          ))}
        </div>

        <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-2">
          {LANES.map((lane, i) => (
            <li key={`${lane}-${i}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
              {lane}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Examples ----------------------------------------------------- */}
      <section id="examples" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
              Songs made <span className="text-gradient">inside AfroHits</span>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Real records off the studio floor — measured, mastered, hand-picked. Press play. Nothing
              staged, no fake plays.
            </p>
          </div>
        </div>
        <div className="mt-8">
          <LandingSongWall />
        </div>
      </section>

      {/* ---- How it works ------------------------------------------------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:px-6 md:py-20">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          From a line in your head <span className="text-gradient">to an audience</span>
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
          Five steps, one place. You bring the idea; the studio carries it to release.
        </p>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FLOW.map((step, i) => (
            <li key={step.label} className="glass relative rounded-2xl p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-afrobrand-300">
                  <step.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="font-grotesk text-xs tracking-[0.2em] text-slate-500">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="mt-4 font-display text-2xl tracking-tight">{step.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.line}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- The Release Campaign (centerpiece) --------------------------- */}
      <section id="campaign" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:px-6 md:py-24">
        <div className="glass border-gradient relative overflow-hidden rounded-3xl p-7 sm:p-10 md:p-14">
          <p className="font-grotesk text-[11px] uppercase tracking-[0.35em] text-afrobrand-300">The Release Campaign</p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-6xl">
            One song. <span className="text-gradient">30 pieces of content.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
            You make the record once. The studio fans it out into everything a release needs — and it
            starts the moment the song and video finish. No clicking &ldquo;generate&rdquo; thirty times.
          </p>

          {/* Source node */}
          <div className="mt-10 flex flex-col items-center">
            <div className="inline-flex items-center gap-3 rounded-2xl bg-brand-gradient px-6 py-4 text-ink shadow-glow">
              <Play className="h-5 w-5 fill-ink" aria-hidden />
              <span className="font-display text-xl tracking-tight sm:text-2xl">Your song + its music video</span>
            </div>
            <div className="my-5 flex items-center gap-2 text-slate-400" aria-hidden>
              <span className="h-8 w-px bg-gradient-to-b from-afrobrand-500/60 to-transparent" />
            </div>
            <p className="mb-8 text-xs uppercase tracking-[0.3em] text-slate-500" aria-hidden>
              fans out into
            </p>

            {/* Fan-out grid */}
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {FANOUT.map((asset) => (
                <div key={asset.label} className="glass rounded-xl p-4 transition-colors hover:border-afrobrand-500/40">
                  <asset.icon className="h-5 w-5 text-afrobrand-300" aria-hidden />
                  <div className="mt-2.5 text-sm font-semibold text-slate-100">{asset.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{asset.note}</div>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-9 max-w-2xl text-sm leading-relaxed text-slate-400">
            <span className="text-slate-200">Generated once, cut many.</span> The clips are edits off
            the one master video, not thirty fresh renders — that is why a full campaign is fast, and
            why it does not cost a fortune.
          </p>
        </div>
      </section>

      {/* ---- Four pillars ------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          Create · Visualize · <span className="text-gradient">Release · Grow</span>
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
          Four stages of a release, all under one roof. Here is what each one actually hands you.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="glass rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-afrobrand-500/40">
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 ${pillar.tint}`}>
                <pillar.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-2xl tracking-tight">{pillar.title}</h3>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-400">
                {pillar.outcomes.map((o) => (
                  <li key={o} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-afrobrand-400" aria-hidden />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---- What one session gets you ------------------------------------ */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          What one session <span className="text-gradient">gets you</span>
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {SESSIONS.map((s) => (
            <div key={s.title} className="glass rounded-2xl p-7">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient text-ink">
                <s.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-xl tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.line}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Technology (supporting, pushed down) ------------------------- */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 md:py-20">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          Why the records <span className="text-gradient">hold up</span>
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
          The craft under the outcome — the reason a drop from here can sit next to a label release.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CRAFT.map((c) => (
            <div key={c.title} className="glass flex gap-4 rounded-2xl p-6">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-afrobrand-300">
                <c.icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-display text-lg tracking-tight">{c.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{c.line}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Pricing ------------------------------------------------------ */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:px-6 md:py-24">
        <div className="text-center">
          <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
            Priced by what you <span className="text-gradient">ship</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Pick a plan by the records and campaigns it lets you make — not by counting credits.
          </p>
        </div>
        <div className="mt-10">
          <PricingPlans />
        </div>
      </section>

      {/* ---- Footer CTA --------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-6">
        <div className="glass border-gradient relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-10 sm:py-20">
          <h2 className="mx-auto max-w-2xl font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-6xl">
            Your next release is <span className="text-gradient">one idea away</span>.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
            Bring a hum, a line, or a finished track. Leave with a record, a video, and a week of
            content to release it.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signin?mode=signup"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-afrobrand-500 px-8 py-3.5 text-base font-semibold text-ink shadow-glow transition-all hover:-translate-y-0.5 hover:bg-afrobrand-400 sm:w-auto"
            >
              <Mic2 className="h-5 w-5" aria-hidden />
              Create a Song
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a
              href="#examples"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-8 py-3.5 text-base font-semibold text-slate-100 transition-all hover:border-afrobrand-500/40 hover:text-white sm:w-auto"
            >
              Hear it first
            </a>
          </div>
        </div>
      </section>

      {/* ---- Footer ------------------------------------------------------- */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-slate-500 sm:flex-row sm:px-6">
          <div>
            <div className="flex items-center gap-2 font-display text-lg tracking-tight text-slate-300">
              <img src="/logo.png" alt="" aria-hidden className="h-5 w-5 rounded" />
              <span><span className="text-gradient">AFRO</span>HITS</span>
            </div>
            <p className="mt-1 text-xs">A studio and a record label, in one place. AI-assisted, artist-directed.</p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/pricing" className="hover:text-slate-300">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-slate-300">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-slate-300">
              Privacy
            </Link>
            <Link href="/signin" className="hover:text-slate-300">
              Sign in
            </Link>
          </nav>
          <div className="text-xs">© 2026 AfroHits Studio</div>
        </div>
      </footer>
    </main>
  );
}
