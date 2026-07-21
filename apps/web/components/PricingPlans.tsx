import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLAN_LIMITS } from '@afrohit/shared';

/**
 * OUTCOME PRICING — sell what you can CREATE and RELEASE, not credits.
 *
 * Shared by the homepage #pricing section and the standalone /pricing page so
 * the two can never drift into two hand-written copies. Honesty laws carried
 * over from the old credit-derived cards:
 * - Every capability number (songs, videos, cover art, seats) is DERIVED from
 *   PLAN_LIMITS — the exact constants the API enforces — so a card can never
 *   promise what the server won't grant.
 * - Credits stay internal plumbing. No "$X in credits" or "460 credits" line.
 * - Distribution and analytics are NOT live yet and are never sold as working
 *   here; the Release Kit assets (clips, captions, hashtags, titles, calendar,
 *   release page) all ship today, so those are what the cards claim.
 *
 * Prices mirror the billing page's PRICE map — the only place a customer
 * actually subscribes (via PayPal, after signup).
 */

const CREATOR = PLAN_LIMITS.CREATOR;
const PRO = PLAN_LIMITS.PRO;
const STARTER = PLAN_LIMITS.STARTER;
const STUDIO = PLAN_LIMITS.STUDIO;

const CREATOR_OUTCOMES = [
  `About ${CREATOR.monthlyDemoSongs} finished songs a month — written, sung and mastered`,
  `Cover art for every drop (${CREATOR.coverArt} renders)`,
  'Short-form clips, a lyric video and a visualizer cut from each song',
  'The auto Release Kit: captions, 3-tier hashtags, 10 titles, an artist bio and a release calendar',
  'A shareable release page for every record',
  'Commercial release rights',
];

const PRO_OUTCOMES = [
  `Around ${PRO.monthlyDemoSongs} finished songs a month`,
  `Full cinematic music videos, not just short clips (up to ${PRO.monthlyVideoSeconds}s a render)`,
  `A voice studio: ${PRO.monthlyVoiceRenders} vocal takes to chase the right performance`,
  `Bigger content packs (${PRO.coverArt} cover renders) and priority in the render queue`,
  `${PRO.seats} seats — bring your producer and manager into the same studio`,
  'Everything in Creator, with full commercial rights for your catalog',
];

function PlanCard({
  name,
  price,
  tagline,
  outcomes,
  featured,
}: {
  name: string;
  price: string;
  tagline: string;
  outcomes: string[];
  featured?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-3xl p-7 sm:p-8 ${
        featured ? 'glass border-gradient shadow-glow' : 'glass'
      }`}
    >
      {featured && (
        <div className="absolute -top-3 left-8 rounded-full bg-brand-gradient px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">
          For working artists
        </div>
      )}
      <h3 className="font-display text-3xl tracking-tight">{name}</h3>
      <p className="mt-1 text-sm text-slate-400">{tagline}</p>
      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-bold text-slate-50">{price}</span>
        <span className="text-sm text-slate-500">/month</span>
      </div>
      <ul className="mt-6 flex-1 space-y-3 text-sm leading-relaxed text-slate-300">
        {outcomes.map((o) => (
          <li key={o} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-afrobrand-400" aria-hidden />
            <span>{o}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/signin?mode=signup"
        className={`mt-7 block rounded-full px-5 py-3 text-center text-sm font-semibold transition-colors ${
          featured
            ? 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400'
            : 'border border-slate-700 text-slate-100 hover:border-afrobrand-500/50 hover:text-white'
        }`}
      >
        {featured ? 'Start creating' : 'Get started'}
      </Link>
    </div>
  );
}

export function PricingPlans() {
  return (
    <div>
      <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-2">
        <PlanCard
          name="Creator"
          price="$49"
          tagline="A release factory for one artist."
          outcomes={CREATOR_OUTCOMES}
        />
        <PlanCard
          name="Pro"
          price="$149"
          tagline="For artists shipping music videos and running a catalog."
          outcomes={PRO_OUTCOMES}
          featured
        />
      </div>

      <p className="mx-auto mt-7 max-w-2xl text-center text-sm leading-relaxed text-slate-400">
        Just testing the water? <span className="text-slate-200">Starter, $19</span> covers hooks,
        lyrics and {STARTER.coverArt} cover renders. Running a label?{' '}
        <span className="text-slate-200">Studio, $399</span> scales to {STUDIO.monthlyDemoSongs} songs
        a month and {STUDIO.seats} seats. Both are on the plans screen once you sign in.
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-slate-500">
        Billed through PayPal · cancel anytime · prices in USD. Every plan is metered under the hood so
        a failed render never costs you — you only ever pick a plan by what it lets you make.
      </p>
    </div>
  );
}
