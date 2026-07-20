import Link from 'next/link';
import { PLAN_LIMITS, PLAN_CREDIT_GRANT_CENTS, PLAN_TIERS, type PlanTier } from '@afrohit/shared';
import { LandingSongWall } from '@/components/LandingSongWall';
import { LandingHeroChat } from '@/components/LandingHeroChat';

/**
 * PUBLIC LANDING — the studio's front door (Wave 6).
 *
 * Laws this page obeys:
 * - HONESTY: no fabricated numbers, play counts, users or testimonials. The
 *   song wall shows real releaseReady records or an honest empty state.
 * - THE WALL: engine-class language only — no vendor names anywhere.
 * - Pricing renders the REAL plans: limits and credits are imported from
 *   @afrohit/shared, the same constants the API enforces.
 */

// Real subscribe prices — must match the billing page's PRICE map.
const PRICE: Record<PlanTier, string> = { STARTER: '$19', CREATOR: '$49', PRO: '$149', STUDIO: '$399' };
const PLAN_LABEL: Record<PlanTier, string> = { STARTER: 'Starter', CREATOR: 'Creator', PRO: 'Pro', STUDIO: 'Studio' };

// TRUTHFUL plan cards (same derivation as /billing): perks come from the
// enforced PLAN_LIMITS + the real monthly credit grant. No marketing numbers.
const PLANS = PLAN_TIERS.map((key) => {
  const l = PLAN_LIMITS[key];
  const grant = PLAN_CREDIT_GRANT_CENTS[key];
  return {
    key,
    name: PLAN_LABEL[key],
    price: PRICE[key],
    popular: key === 'CREATOR',
    perks: [
      `$${(grant / 10_000).toFixed(0)} in monthly studio credits`,
      l.monthlyDemoSongs > 0 ? `${l.monthlyDemoSongs} full songs / month` : 'Hooks, lyrics & cover art',
      `${l.coverArt} cover-art renders`,
      ...(l.monthlyVoiceRenders > 0 ? [`${l.monthlyVoiceRenders} voice renders`] : []),
      ...(l.monthlyVideoSeconds > 0 ? [`${l.monthlyVideoSeconds}s of video`] : []),
      ...(l.seats > 1 ? [`${l.seats} team seats`] : []),
    ],
  };
});

// Real production lanes (Project.genre vocabulary) — shown as hero chips.
const LANES = ['Afrobeats', 'Amapiano', 'Afro-fusion', 'Afro-dancehall', 'Gospel', 'Afro-R&B', 'Street-pop', 'Hip-hop'];

const DOORS = [
  {
    emoji: '\u{1F3A4}',
    title: 'Make a song',
    line: 'Hum it, type it or bring a beat — the studio writes, sings and finishes the record.',
  },
  {
    emoji: '\u{1F3B9}',
    title: 'Make an instrumental',
    line: 'Producer-grade beats and riddims in your lane, stem-ready for your session.',
  },
  {
    emoji: '\u{1F3AC}',
    title: 'Sounds for film & creators',
    line: 'Score scenes, intros and content — moods and cues cut to length.',
  },
  // OWNER 2026-07-19: the video door existed in the studio but was missing
  // from the landing — the site must reflect what the product truly does.
  {
    emoji: '\u{1F39E}\u{FE0F}',
    title: 'Make a music video',
    line: 'Bring your finished song — leave with a storyboard, scenes and the video, priced per scene.',
  },
];

const FEATURES = [
  {
    title: 'Measured before it ships',
    line: 'Every master gets a report card — loudness, tonal balance, lane compliance. Numbers, not vibes.',
  },
  {
    title: 'Made for the Afro sound',
    line: 'Sound-DNA lanes and native-language checks keep Afrobeats, amapiano, highlife and gospel authentic.',
  },
  {
    title: 'AfroOne — an engine that learns YOUR sound',
    line: 'Our own engine builds from your rights-tracked material and, only with your signed consent, learns from your catalog — so every record gets more you. No scraped catalogs anywhere in the chain.',
  },
  {
    title: 'Rights-clean by design',
    line: 'Split sheets, conflict checks and ISRC/UPC receipts ride with every release — receipts, not promises.',
  },
  {
    title: 'Your voice, on your terms',
    line: 'Consent-first voice: trained only on samples you approve, revocable any time.',
  },
  {
    title: 'Masters that compete',
    line: 'Commercial-loudness masters tuned for streaming, club and reels — with the measurements to prove it.',
  },
  {
    title: 'Stems for your DAW',
    line: 'Pull the finished record apart into stems and keep producing in your own session.',
  },
  {
    title: 'A video for every song',
    line: 'Each record gets a video treatment and a scroll-stopping snippet cut for short-form.',
  },
  {
    title: 'Release pipeline built in',
    line: 'Master, stems, rights receipts, smart-link page and snippet — bundled into one ready-to-ship drop.',
  },
];

// Deterministic bar heights so the server and client render identical markup.
const EQ_BARS = [38, 62, 90, 54, 74, 100, 46, 82, 66, 94, 42, 70, 58, 86, 50, 78, 96, 44, 72, 60, 88, 52, 80, 64];

export default function Landing() {
  return (
    <main className="relative">
      {/* ---- Header ------------------------------------------------------- */}
      <header className="sticky top-0 z-40 glass-strong">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link href="/" className="font-display text-xl tracking-tight sm:text-2xl">
            <span className="text-gradient">AFROHIT</span> STUDIO
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <a href="#wall" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              Sounds
            </a>
            <a href="#features" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              Studio
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
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:px-6 md:pb-24 md:pt-24">
        <p className="font-grotesk text-[11px] uppercase tracking-[0.35em] text-afrobrand-300 sm:text-xs">
          The AI production house
        </p>
        <h1 className="mx-auto mt-5 max-w-4xl font-display text-5xl uppercase leading-[0.95] tracking-tight sm:text-7xl md:text-8xl">
          Make the <span className="text-gradient">record</span> you hear in your head
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
          Write, sing, mix and master real records in your lane — then turn them into{" "}
          <span className="font-semibold text-slate-100">full music videos</span>: your story, your
          cast, your name in the credits. Already have a song? Bring it — leave with the video.
        </p>

        {/* CHAT HERO (Wave 8b): the primary CTA is a chat box — the visitor's
            idea rides through signup and lands prefilled in the studio. It
            never renders anonymously and never promises free songs. */}
        <div className="mt-9">
          <LandingHeroChat />
          <div className="mt-4 flex justify-center">
            <a
              href="#wall"
              className="glass rounded-full px-8 py-3 text-sm text-slate-200 transition-all hover:-translate-y-0.5 hover:border-afrobrand-500/40 hover:text-white sm:text-base"
            >
              Hear what it makes <span aria-hidden>↓</span>
            </a>
          </div>
        </div>

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
          {LANES.map((lane) => (
            <li key={lane} className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
              {lane}
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Three doors --------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {DOORS.map((door) => (
            <Link
              key={door.title}
              href="/signin?mode=signup"
              className="group glass rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-afrobrand-500/40"
            >
              <span className="text-3xl" aria-hidden>
                {door.emoji}
              </span>
              <h2 className="mt-3 font-display text-2xl tracking-tight">{door.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{door.line}</p>
              <span className="mt-4 inline-block text-sm text-afrobrand-300 transition-transform duration-300 group-hover:translate-x-1">
                Start <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- Song wall ------------------------------------------------------ */}
      <section id="wall" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-6 md:py-28">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
              Hear what it <span className="text-gradient">makes</span>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
              Real records off the studio floor — measured and mastered, hand-picked by the house. Nothing staged.
            </p>
          </div>
        </div>
        <div className="mt-8">
          <LandingSongWall />
        </div>
      </section>

      {/* ---- Feature grid --------------------------------------------------- */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-20 sm:px-6 md:pb-28">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          Built like a label. <span className="text-gradient">Measured like a lab.</span>
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
          The whole record — writing, voice, mix, master, rights and release — finished in one place.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="glass rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-afrobrand-500/40"
            >
              <div className="font-grotesk text-xs tracking-[0.25em] text-afrobrand-400">
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="mt-3 font-display text-xl tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.line}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Pricing --------------------------------------------------------- */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-20 sm:px-6 md:pb-28">
        <h2 className="font-display text-4xl uppercase tracking-tight sm:text-5xl">
          Plans with <span className="text-gradient">receipts</span>
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
          What each card promises is exactly what the studio enforces — limits and credits come straight
          from the same configuration the server runs on.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.key}
              className={`relative rounded-2xl p-6 ${p.popular ? 'glass border-gradient shadow-glow' : 'glass'}`}
            >
              {p.popular && (
                <div className="absolute -top-3 left-6 rounded-full bg-brand-gradient px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">
                  Most popular
                </div>
              )}
              <h3 className="font-display text-2xl tracking-tight">{p.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{p.price}</span>
                <span className="text-sm text-slate-500">/mo</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <span className="text-afrobrand-400" aria-hidden>
                      •
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
              <Link
                href="/signin?mode=signup"
                className={`mt-6 block rounded-full px-4 py-2.5 text-center text-sm font-medium transition-colors ${
                  p.popular
                    ? 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400'
                    : 'border border-slate-700 text-slate-200 hover:border-afrobrand-500/50 hover:text-white'
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          New studios start on Starter limits — subscribing adds the monthly credit grant. Billing via PayPal ·
          one-time credit packs from $10 · cancel anytime · prices USD.
        </p>
      </section>

      {/* ---- Footer ----------------------------------------------------------- */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-slate-500 sm:flex-row sm:px-6">
          <div>
            <div className="font-display text-lg tracking-tight text-slate-300">
              <span className="text-gradient">AFROHIT</span> STUDIO
            </div>
            <p className="mt-1 text-xs">GenAI-assisted, human-directed.</p>
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
          <div className="text-xs">© 2026 AfroHit Studio</div>
        </div>
      </footer>
    </main>
  );
}
