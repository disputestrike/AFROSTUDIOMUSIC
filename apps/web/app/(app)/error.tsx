'use client';

import { useEffect } from 'react';

/**
 * APP-GROUP ERROR BOUNDARY (2026-07-18). Catches a render crash on ANY signed-in
 * page (create, catalog, chat, …) so a single bad component or a bad piece of
 * saved state can never white-screen the whole app with the useless global
 * "Application error". Recoverable: retry, or go home. It also clears the chat's
 * resumed-thread pointer, since an un-renderable resumed session is the most
 * common cause and it auto-loads on every visit. Plain markup — can't itself crash.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('app segment error:', error?.message, error?.digest, error);
  }, [error]);

  const recover = () => {
    try {
      localStorage.removeItem('afrohit.activeThread');
    } catch {
      /* ignore */
    }
    reset();
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
      <h1 className="font-display text-2xl">Something didn&rsquo;t load</h1>
      <p className="mt-3 text-sm text-slate-400">
        This page hit a snag. Try again — your projects, songs and catalog are safe.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={recover}
          className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow"
        >
          Try again
        </button>
        <a
          href="/create"
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-slate-200 hover:bg-white/5"
        >
          Go to Create
        </a>
      </div>
    </div>
  );
}
