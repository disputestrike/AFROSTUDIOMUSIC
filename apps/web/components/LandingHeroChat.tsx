'use client';

/**
 * LANDING CHAT HERO (Wave 8b) — the prompt-through-signup funnel.
 *
 * The logged-out landing leads with a chat box, the way a studio front desk
 * asks "what are we making?". HONESTY LAWS:
 * - No anonymous rendering: typing here never creates anything. It routes to
 *   /signin?mode=signup&intent=<prompt> — the visitor's idea rides through
 *   signup and lands PREFILLED in the studio, where their plan/credits govern.
 * - No free-song promises anywhere in the copy. The button says Create.
 * - The hand-off reuses the EXISTING /create?vibe= prefill (create/page.tsx
 *   reads ?vibe= into the visible vibe field). It never uses ?produce=1 — that
 *   is the AUTO-CREATE param, and auto-firing a paid render from a landing
 *   funnel is the exact "?produce=1 re-creates for days" incident class.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Hard cap on the carried prompt — enough for an idea, too short for abuse. */
const INTENT_MAX = 200;

export function LandingHeroChat() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');

  function submit() {
    // Single-line intent: collapse whitespace/newlines, trim, cap the length.
    const clean = prompt.replace(/\s+/g, ' ').trim().slice(0, INTENT_MAX);
    router.push(clean ? `/signin?mode=signup&intent=${encodeURIComponent(clean)}` : '/signin?mode=signup');
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="glass border-gradient mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full p-1.5 pl-4 shadow-card transition-all focus-within:shadow-glow sm:p-2 sm:pl-6"
    >
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        maxLength={INTENT_MAX}
        placeholder='Tell the studio what to make — "a smooth amapiano song about moving to Lagos"'
        aria-label="Describe the record you want to make"
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none sm:text-base"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-afrobrand-500 px-5 py-2.5 text-sm font-semibold text-ink shadow-glow transition-all hover:bg-afrobrand-400 sm:px-7 sm:py-3 sm:text-base"
      >
        Create
      </button>
    </form>
  );
}
