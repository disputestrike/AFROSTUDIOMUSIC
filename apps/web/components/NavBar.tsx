'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

const LINKS = [
  { href: '/create', label: 'Create' },
  { href: '/zap', label: 'Zap' },
  { href: '/voice', label: 'My Voice' },
  { href: '/listen', label: 'Listen' },
  { href: '/studio', label: 'Chat' },
  { href: '/projects', label: 'Projects' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/materials', label: 'Materials' },
  { href: '/instrumentals', label: 'Instrumentals' },
  { href: '/lake', label: 'Data Lake' },
  { href: '/lexicon', label: 'Word Bank' },
  { href: '/albums', label: 'Albums' },
  { href: '/billing', label: 'Billing' },
  { href: '/settings', label: 'Settings' },
  { href: '/benchmark', label: 'Benchmark' },
  { href: '/admin', label: 'Admin' },
];

export function NavBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // null = unknown (matches the server-rendered markup, so no hydration
  // mismatch); the token check is client-only by nature.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    try { setSignedIn(!!localStorage.getItem('afrohit.token')); } catch { setSignedIn(true); }
  }, []);
  const isActive = (href: string) => path === href || path.startsWith(href + '/');

  const linkClass = (href: string, mobile = false) =>
    `${mobile ? 'px-3 py-2.5 text-sm' : 'px-3 py-1.5'} rounded-full transition-colors ${
      isActive(href)
        ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`;

  return (
    <header className="sticky top-0 z-40 glass-strong border-b border-white/5">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link href="/create" onClick={() => setOpen(false)} className="group flex shrink-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient text-ink shadow-glow transition-transform group-hover:scale-105">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 18V5l10-2v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
          </span>
          <span className="font-display text-lg tracking-tight sm:text-xl">
            AFRO<span className="text-gradient">HIT</span><span className="hidden sm:inline"> STUDIO</span>
          </span>
        </Link>

        {/* Desktop nav — full horizontal row only where it fits (xl+). */}
        <nav className="hidden items-center gap-0.5 font-grotesk text-sm xl:flex">
          {LINKS.slice(0, -1).map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)}>
              {l.label}
            </Link>
          ))}
          <Link href="/admin" className={`ml-0.5 rounded-full px-3 py-1.5 text-slate-600 transition-colors hover:text-slate-300 ${isActive('/admin') ? 'text-slate-300' : ''}`}>
            Admin
          </Link>
          <span className="ml-2 shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">Internal</span>
          {signedIn === false && (
            <Link href="/signin" className="ml-1 shrink-0 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-3 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20">
              Sign in
            </Link>
          )}
        </nav>

        {/* Mobile / tablet — hamburger. */}
        <div className="flex items-center gap-2 xl:hidden">
          {signedIn === false && (
            <Link href="/signin" className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-[11px] text-afrobrand-300">
              Sign in
            </Link>
          )}
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">Internal</span>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-100 active:scale-95"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <nav className="border-t border-white/5 px-3 pb-3 pt-2 font-grotesk xl:hidden">
          <div className="grid grid-cols-2 gap-1">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={linkClass(l.href, true)}>
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
