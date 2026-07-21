import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLAN_LIMITS } from '@afrohit/shared';

/**
 * OUTCOME PRICING — sell what you can CREATE and RELEASE, not credits.
 *
 * Shared by the homepage #pricing section and the standalone /pricing page so
 * the two can never drift into two hand-written copies. Every plan is shown as
 * a full card — Starter, Creator, Pro and Studio — because a customer should
 * see all four real prices, never two cards plus a footnote.
 *
 * Honesty laws:
 * - Every capability NUMBER (songs, video seconds, voice takes, cover art,
 *   seats) is DERIVED from PLAN_LIMITS — the exact constants the API enforces
 *   (packages/shared/src/constants.ts, hard cap = advertised * 1.2). A card can
 *   never promise what the server won't grant.
 * - Credits stay internal plumbing. No "$X in credits" or "460 credits" line.
 * - The COST DRIVER is the AI music video (per-shot Replicate); everything else
 *   (clips, lyric videos, visualizers, kit assets) is ffmpeg/Cerebras and free
 *   to render. So the ladder gates on video: Starter has none, Creator gets
 *   short-form moments, Pro unlocks full cinematic videos, Studio runs a roster.
 * - Distribution and one-tap posting + analytics are NOT live and are never
 *   sold here. The Release Kit assets (clips, captions, hashtags, titles, bio,
 *   calendar, release page) all ship today, so those are what the cards claim.
 *
 * Prices mirror the billing page's PRICE map ($19/$49/$149/$399) — the only
 * place a customer actually subscribes (via PayPal, after signup). Every CTA
 * routes to /signin?mode=signup, so the checkout wiring is untouched.
 */

const { STARTER, CREATOR, PRO, STUDIO } = PLAN_LIMITS;

const fmt = (n: number) => n.toLocaleString('en-US');

/** Monthly AI-video budget, read from PLAN_LIMITS.*.monthlyVideoSeconds. */
function videoBudget(seconds: number): string {
  return seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
}

interface Tier {
  name: string;
  price: string;
  tagline: string;
  outcomes: string[];
  /** Honest caveat rendered muted, below the outcomes — no checkmark. */
  note?: string;
  cta: string;
  /** 'popular' = the mainstream pick (accent ring). 'featured' = the premium highlight (glow). */
  emphasis?: 'popular' | 'featured';
  badge?: string;
}

const TIERS: Tier[] = [
  {
    name: 'Starter',
    price: '$19',
    tagline: 'The writing room. Shape an idea before you record it.',
    outcomes: [
      'Write and rework hooks and full lyrics across 24 languages',
      `${fmt(STARTER.coverArt)} cover-art renders a month`,
      'Your own workspace, one seat',
    ],
    note: 'Full AI songs and music videos begin on Creator.',
    cta: 'Start writing',
  },
  {
    name: 'Creator',
    price: '$49',
    tagline: 'The release factory. Everything one artist needs to drop a record.',
    outcomes: [
      `About ${fmt(CREATOR.monthlyDemoSongs)} finished songs a month — written, sung and mastered`,
      `${fmt(CREATOR.coverArt)} cover-art renders — a fresh cover for every drop`,
      `Lyric videos, visualizers and short clips from every song, plus ${videoBudget(CREATOR.monthlyVideoSeconds)} of AI video a month`,
      'The auto Release Kit per song: captions, 3-tier hashtags, 10 titles, an artist bio and a posting calendar',
      'A shareable release page for every record',
      'Commercial release rights',
    ],
    cta: 'Start creating',
    emphasis: 'popular',
    badge: 'Most popular',
  },
  {
    name: 'Pro',
    price: '$149',
    tagline: 'Cinematic music videos, and the volume to run a catalog.',
    outcomes: [
      `Around ${fmt(PRO.monthlyDemoSongs)} finished songs a month`,
      `${videoBudget(PRO.monthlyVideoSeconds)} of AI video a month — full cinematic music videos, not just clips`,
      `A voice studio: ${fmt(PRO.monthlyVoiceRenders)} vocal takes to chase the right performance`,
      `${fmt(PRO.coverArt)} cover-art renders`,
      `${fmt(PRO.seats)} seats — bring your producer and manager into the same studio`,
      'Everything in Creator, with full commercial rights across your catalog',
    ],
    cta: 'Go Pro',
    emphasis: 'featured',
    badge: 'Made for video',
  },
  {
    name: 'Studio',
    price: '$399',
    tagline: 'Label scale. The whole roster in one studio.',
    outcomes: [
      `Up to ${fmt(STUDIO.monthlyDemoSongs)} finished songs a month`,
      `${videoBudget(STUDIO.monthlyVideoSeconds)} of AI video a month — videos across the roster`,
      `${fmt(STUDIO.monthlyVoiceRenders)} voice-studio takes`,
      `${fmt(STUDIO.coverArt)} cover-art renders`,
      `${fmt(STUDIO.seats)} seats for your whole team`,
      'Everything in Pro, built for a label’s release calendar',
    ],
    cta: 'Scale a label',
  },
];

function PlanCard({ tier }: { tier: Tier }) {
  const { emphasis } = tier;
  const featured = emphasis === 'featured';
  const popular = emphasis === 'popular';

  return (
    <div
      className={`relative flex flex-col rounded-3xl p-6 sm:p-7 ${
        featured
          ? 'glass border-gradient shadow-glow'
          : popular
            ? 'glass ring-1 ring-afrobrand-500/40'
            : 'glass'
      }`}
    >
      {tier.badge && (
        <div
          className={`absolute -top-3 left-6 rounded-full px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            featured
              ? 'bg-brand-gradient text-ink'
              : 'bg-afrobrand-500/15 text-afrobrand-300 ring-1 ring-afrobrand-500/40'
          }`}
        >
          {tier.badge}
        </div>
      )}

      <h3 className="font-display text-2xl tracking-tight sm:text-3xl">{tier.name}</h3>
      <p className="mt-1 text-sm leading-snug text-slate-400">{tier.tagline}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold text-slate-50">{tier.price}</span>
        <span className="text-sm text-slate-500">/month</span>
      </div>

      <ul className="mt-6 flex-1 space-y-2.5 text-sm leading-relaxed text-slate-300">
        {tier.outcomes.map((o) => (
          <li key={o} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-afrobrand-400" aria-hidden />
            <span>{o}</span>
          </li>
        ))}
      </ul>

      {tier.note && <p className="mt-4 text-xs leading-relaxed text-slate-500">{tier.note}</p>}

      <Link
        href="/signin?mode=signup"
        className={`mt-7 block rounded-full px-5 py-3 text-center text-sm font-semibold transition-colors ${
          featured
            ? 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400'
            : popular
              ? 'bg-afrobrand-500/90 text-ink hover:bg-afrobrand-400'
              : 'border border-slate-700 text-slate-100 hover:border-afrobrand-500/50 hover:text-white'
        }`}
      >
        {tier.cta}
      </Link>
    </div>
  );
}

export function PricingPlans() {
  return (
    <div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <PlanCard key={tier.name} tier={tier} />
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-slate-500">
        Billed through PayPal · cancel anytime · prices in USD. Every plan is metered under the hood,
        so a failed render never costs you — you pick a plan by what it lets you make, not by counting
        credits. One-tap distribution and analytics are on the way; today you get every asset a release
        needs, export-ready.
      </p>
    </div>
  );
}
