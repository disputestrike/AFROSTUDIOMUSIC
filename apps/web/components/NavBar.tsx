'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/create', label: 'Create' },
  { href: '/listen', label: 'Listen' },
  { href: '/studio', label: 'Chat' },
  { href: '/projects', label: 'Projects' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/materials', label: 'Materials' },
  { href: '/lake', label: 'Data Lake' },
  { href: '/lexicon', label: 'Word Bank' },
  { href: '/albums', label: 'Albums' },
  { href: '/billing', label: 'Billing' },
  { href: '/settings', label: 'Settings' },
];

export function NavBar() {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(href + '/');

  return (
    <header className="sticky top-0 z-40 glass-strong border-b border-white/5">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/create" className="group flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-gradient text-ink shadow-glow transition-transform group-hover:scale-105">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 18V5l10-2v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
          </span>
          <span className="font-display text-xl tracking-tight">
            AFRO<span className="text-gradient">HIT</span> STUDIO
          </span>
        </Link>

        <nav className="flex items-center gap-1 font-grotesk text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                isActive(l.href)
                  ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/admin"
            className={`ml-1 rounded-full px-3 py-1.5 text-slate-600 transition-colors hover:text-slate-300 ${
              isActive('/admin') ? 'text-slate-300' : ''
            }`}
          >
            Admin
          </Link>
          <span className="ml-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
            Internal
          </span>
        </nav>
      </div>
    </header>
  );
}
