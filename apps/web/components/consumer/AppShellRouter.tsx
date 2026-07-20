'use client';

/**
 * ROLE-GATED SHELL ROUTER (USERSHELL, owner order 2026-07-19).
 *
 * One decision, made once per hard load from GET /auth/me (via the same
 * useOperatorView seam the NavBar and OperatorGate already share):
 * - operator === true (and not previewing as a user) → EXACTLY today's
 *   layout: the top NavBar and a plain scroll area. Byte-for-byte unchanged.
 * - everyone else → the new Suno-shaped consumer shell (sidebar + player).
 *
 * While /auth/me resolves we hold on a small branded loading state instead of
 * guessing — the two frames are too different for an optimistic render, and a
 * wrong guess would flash a whole layout swap (the "flicker hack" the order
 * bans). The /auth/me promise is cached per hard load, so this shows once.
 *
 * PRESENTATION ONLY: every operator surface stays requireAdmin-gated
 * server-side, and OperatorGate still wraps operator pages individually.
 */

import { LoaderCircle } from 'lucide-react';
import { NavBar } from '@/components/NavBar';
import { AudioSolo } from '@/components/AudioSolo';
import { useOperatorView } from '@/components/OperatorGate';
import { ConsumerShell } from './ConsumerShell';

export function AppShellRouter({ children }: { children: React.ReactNode }) {
  const view = useOperatorView();

  if (view.loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-ink shadow-glow">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 18V5l10-2v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
          </span>
          <span className="flex items-center gap-2 text-sm">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Opening the studio…
          </span>
        </div>
      </div>
    );
  }

  // The operator's studio — EXACTLY the pre-USERSHELL frame.
  if (view.effectiveOperator) {
    return (
      <div className="flex h-screen flex-col">
        <AudioSolo />
        <NavBar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    );
  }

  // Every other account — the consumer shell.
  return (
    <>
      <AudioSolo />
      <ConsumerShell>{children}</ConsumerShell>
    </>
  );
}
