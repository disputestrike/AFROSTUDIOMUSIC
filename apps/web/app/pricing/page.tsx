import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PricingPlans } from '@/components/PricingPlans';

export const metadata = { title: 'Pricing — AfroHits Studio' };

/**
 * PRICING — a real standalone page (2026-07-21), sold by OUTCOME.
 *
 * This used to redirect to /#pricing to avoid two hand-written copies drifting.
 * The cards now live in ONE shared component, <PricingPlans/>, rendered both
 * here and on the homepage — so there is still a single source of truth, and
 * /pricing is a page a customer can actually land on and link to.
 *
 * The real subscribe happens in /billing (PayPal) after signup — every CTA
 * here routes to signup, exactly as before, so billing wiring is untouched.
 */
export default function Pricing() {
  return (
    <main className="relative min-h-screen">
      <header className="sticky top-0 z-40 glass-strong">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" aria-hidden className="h-7 w-7 rounded-md" />
            <span className="font-display text-xl tracking-tight sm:text-2xl">
              <span className="text-gradient">AFRO</span>HITS
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <Link href="/#examples" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/5 hover:text-white sm:block">
              Songs
            </Link>
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

      <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 text-center sm:px-6 md:pt-20">
        <p className="font-grotesk text-[11px] uppercase tracking-[0.35em] text-afrobrand-300 sm:text-xs">
          Plans
        </p>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Priced by what you <span className="text-gradient">ship</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
          Four plans, priced by what each one lets you make — from writing your first hook to shipping
          cinematic music videos for a whole roster.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <PricingPlans />
      </section>

      {/* Honest, plain answers — no fake urgency, no hidden asterisks. */}
      <section className="mx-auto max-w-3xl px-5 pb-20 sm:px-6">
        <h2 className="font-display text-2xl uppercase tracking-tight sm:text-3xl">Straight answers</h2>
        <dl className="mt-6 divide-y divide-white/5">
          <div className="py-5">
            <dt className="font-display text-lg tracking-tight text-slate-100">Do I own what I make?</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-400">
              Yes — on a paid plan you get commercial release rights to the songs you generate. You
              are responsible for clearance where your use needs it; we give you measurement receipts,
              not a copyright guarantee.
            </dd>
          </div>
          <div className="py-5">
            <dt className="font-display text-lg tracking-tight text-slate-100">Can it distribute to Spotify or TikTok for me?</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-400">
              Not yet. Today you get every asset a release needs — clips, captions, hashtags, titles, a
              calendar and a release page — export-ready. One-tap posting and analytics are what we are
              building next; we would rather ship them right than promise them early.
            </dd>
          </div>
          <div className="py-5">
            <dt className="font-display text-lg tracking-tight text-slate-100">What happens if a render fails?</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-400">
              You are not charged for it. Rendering is metered under the hood, and a failed render never
              draws down your plan.
            </dd>
          </div>
          <div className="py-5">
            <dt className="font-display text-lg tracking-tight text-slate-100">Can I cancel?</dt>
            <dd className="mt-2 text-sm leading-relaxed text-slate-400">
              Anytime, from the billing screen. Your plan runs to the end of the period, then drops to
              Starter. Payments are handled by PayPal.
            </dd>
          </div>
        </dl>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link
            href="/signin?mode=signup"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-afrobrand-500 px-8 py-3.5 text-base font-semibold text-ink shadow-glow transition-all hover:-translate-y-0.5 hover:bg-afrobrand-400 sm:w-auto"
          >
            Start creating
          </Link>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to home
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-slate-500 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 font-display text-lg tracking-tight text-slate-300">
            <img src="/logo.png" alt="" aria-hidden className="h-5 w-5 rounded" />
            <span><span className="text-gradient">AFRO</span>HITS</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/terms" className="hover:text-slate-300">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-300">Privacy</Link>
            <Link href="/signin" className="hover:text-slate-300">Sign in</Link>
          </nav>
          <div className="text-xs">© 2026 AfroHits Studio</div>
        </div>
      </footer>
    </main>
  );
}
