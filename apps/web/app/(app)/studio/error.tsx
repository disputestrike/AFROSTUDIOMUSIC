'use client';

import { useEffect } from 'react';

/**
 * SEGMENT ERROR BOUNDARY for /studio (2026-07-18). A render crash in the chat
 * — most often a resumed thread whose messages won't render — used to white-
 * screen the whole page with the useless global "Application error". This turns
 * it into a RECOVERABLE card: the artist can start a fresh chat (which also
 * clears the saved-thread pointer that auto-resumes on every visit, so a single
 * bad session can't keep crashing the page) or retry. Nothing here can itself
 * crash — plain markup only.
 */
export default function StudioError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real reason in the browser console for diagnosis.
    console.error('studio segment error:', error?.message, error?.digest, error);
  }, [error]);

  const startFresh = () => {
    try {
      localStorage.removeItem('afrohit.activeThread');
    } catch {
      /* storage unavailable — the reset alone still helps */
    }
    reset();
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
      <h1 className="font-display text-2xl">The chat hit a snag</h1>
      <p className="mt-3 text-sm text-slate-400">
        Something in this session wouldn&rsquo;t load. Start a fresh chat — your projects,
        songs and catalog are safe.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={startFresh}
          className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow"
        >
          Start a fresh chat
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-slate-200 hover:bg-white/5"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
