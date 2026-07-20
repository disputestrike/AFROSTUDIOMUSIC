/**
 * NOTIFICATIONS (USERSHELL) — honest empty state.
 *
 * There is NO notifications backend yet, so this page fabricates nothing:
 * it says exactly what will land here once renders/reviews start reporting,
 * and points at the two places live status actually shows today (the Create
 * page's render status and the Catalog).
 */

import Link from 'next/link';
import { Bell, LibraryBig, Sparkles } from 'lucide-react';

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <Bell className="h-6 w-6 text-slate-400" aria-hidden />
      </div>
      <h1 className="mt-5 font-display text-3xl">Nothing yet</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
        Your renders and reviews will show up here. For now, a render&apos;s live status stays on the
        Create page while it cooks, and every finished record lands in your Library.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/create" className="inline-flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
          <Sparkles className="h-4 w-4" aria-hidden /> Make something
        </Link>
        <Link
          href="/library"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          <LibraryBig className="h-4 w-4" aria-hidden /> Open Library
        </Link>
      </div>
    </div>
  );
}
