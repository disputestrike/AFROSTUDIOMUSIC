'use client';

/**
 * CONSUMER SHELL (USERSHELL) — the Suno-shaped frame every non-operator
 * account lives in: persistent left sidebar, scrollable main area, and the
 * bottom player bar that keeps playing across page navigation (the provider
 * and its <audio> element live at this level, so client-side route changes
 * never unmount them).
 */

import Link from 'next/link';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { PlayerProvider } from './PlayerContext';
import { PlayerBar } from './PlayerBar';
import { ConsumerSidebar } from './ConsumerSidebar';

export function ConsumerShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <PlayerProvider>
      <div className="flex h-screen flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <ConsumerSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Slim mobile top bar — brand + hamburger. */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 glass-strong lg:hidden">
              <Link href="/home" className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient text-ink shadow-glow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M9 18V5l10-2v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="6" cy="18" r="3" fill="currentColor" />
                    <circle cx="16" cy="16" r="3" fill="currentColor" />
                  </svg>
                </span>
                <span className="font-display text-base tracking-tight">
                  AFRO<span className="text-gradient">HITS</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 active:scale-95"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
          </div>
        </div>
        <PlayerBar />
      </div>
    </PlayerProvider>
  );
}
