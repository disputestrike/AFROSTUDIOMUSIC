'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronDown, CreditCard, Eye, LogOut, Menu, Settings as SettingsIcon, Undo2, User, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { navItemsFor } from '@/lib/nav-manifest';
import { useOperatorView } from '@/components/OperatorGate';

/**
 * TENANT SURFACE ISOLATION (Wave 8a): the nav renders from the manifest by
 * role — consumers get the Suno-shaped set, the operator gets the engine room
 * too. This is presentation only; every operator route group is requireAdmin-
 * gated server-side.
 */
export function NavBar() {
  const api = useApi();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const view = useOperatorView();

  // Until /auth/me resolves, render the consumer manifest — it matches the
  // server-rendered markup and never flashes operator surfaces at a tenant.
  const links = navItemsFor(view.effectiveOperator);

  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
    setMoreOpen(false);
  }, [path]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // No body: JSON.stringify(undefined) yields no payload, so the client
      // sends a clean body-less POST (avoids Fastify's empty-JSON-body guard).
      await api.post('/auth/logout', undefined);
    } catch {
      /* the session may already be gone — still land on sign-in */
    }
    window.location.href = '/signin';
  }

  const isActive = (href: string) => path === href || path.startsWith(href + '/');

  const linkClass = (href: string, mobile = false) =>
    `${mobile ? 'px-3 py-2.5 text-sm' : 'px-3 py-1.5'} rounded-full transition-colors ${
      isActive(href)
        ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`;

  const initial = (view.me?.name || view.me?.email || '?').trim().charAt(0).toUpperCase() || '?';

  const viewingBadge = view.viewingAsUser && (
    <button
      type="button"
      onClick={() => view.setViewAsUser(false)}
      title="You're previewing the consumer app. Click to switch back to operator view."
      className="shrink-0 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-3 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
    >
      Viewing as user — switch back
    </button>
  );

  const accountMenu = view.signedIn && (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAccountOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={accountOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 font-grotesk text-sm text-slate-200 hover:bg-white/10"
      >
        {view.loading ? <User className="h-4 w-4 text-slate-400" /> : initial}
      </button>
      {accountOpen && (
        <>
        {/* Backdrop closes the menu on any outside click/tap (the menu renders
            in both the desktop and mobile containers — a shared ref can't). */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setAccountOpen(false)}
          className="fixed inset-0 z-40 cursor-default"
        />
        <div className="absolute right-0 top-10 z-50 w-60 rounded-2xl border border-white/10 bg-ink/95 p-1.5 shadow-xl backdrop-blur">
          {(view.me?.name || view.me?.email) && (
            <div className="px-3 pb-1.5 pt-2">
              {view.me?.name && <div className="truncate text-sm text-slate-200">{view.me.name}</div>}
              {view.me?.email && <div className="truncate text-xs text-slate-500">{view.me.email}</div>}
            </div>
          )}
          <Link
            href="/settings"
            onClick={() => setAccountOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100"
          >
            <SettingsIcon className="h-4 w-4 text-slate-500" /> Profile
          </Link>
          <Link
            href="/billing"
            onClick={() => setAccountOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100"
          >
            <CreditCard className="h-4 w-4 text-slate-500" /> Subscription
          </Link>
          {view.operator && (
            <button
              type="button"
              onClick={() => {
                view.setViewAsUser(!view.viewingAsUser);
                setAccountOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100"
            >
              {view.viewingAsUser ? (
                <>
                  <Undo2 className="h-4 w-4 text-afrobrand-400" /> Back to operator view
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 text-slate-500" /> View as user
                </>
              )}
            </button>
          )}
          <div className="mx-2 my-1 border-t border-white/5" />
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 text-slate-500" /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
        </>
      )}
    </div>
  );

  // Keep the desktop row from overflowing the header (owner 2026-07-18): the
  // common destinations stay inline; the rest fold into a "More" dropdown. Only
  // splits when there are genuinely too many (the 6-item consumer nav is untouched).
  const PRIMARY_NAV = 9;
  const tooMany = links.length > PRIMARY_NAV + 1;
  const primaryLinks = tooMany ? links.slice(0, PRIMARY_NAV) : links;
  const overflowLinks = tooMany ? links.slice(PRIMARY_NAV) : [];
  const overflowActive = overflowLinks.some((l) => isActive(l.href));

  const moreMenu = overflowLinks.length > 0 && (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={moreOpen}
        className={`${linkClass('#never-active')} inline-flex items-center gap-1 ${overflowActive ? 'text-white' : ''}`}
      >
        More <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {moreOpen && (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-10 z-50 w-52 rounded-2xl border border-white/10 bg-ink/95 p-1.5 shadow-xl backdrop-blur">
            {overflowLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMoreOpen(false)}
                className={`block rounded-xl px-3 py-2 text-sm ${
                  isActive(l.href) ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );

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

        {/* Desktop nav — full horizontal row only where it fits (xl+). Extras
            past PRIMARY_NAV fold into a "More" dropdown so the row never
            overflows the header. */}
        <nav className="hidden items-center gap-0.5 font-grotesk text-sm xl:flex">
          {primaryLinks.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)}>
              {l.label}
            </Link>
          ))}
          {moreMenu}
          {viewingBadge && <span className="ml-2">{viewingBadge}</span>}
          {view.signedIn === false && (
            <Link href="/signin" className="ml-1 shrink-0 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-3 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20">
              Sign in
            </Link>
          )}
          {accountMenu && <span className="ml-2">{accountMenu}</span>}
        </nav>

        {/* Mobile / tablet — hamburger. */}
        <div className="flex items-center gap-2 xl:hidden">
          {viewingBadge}
          {view.signedIn === false && (
            <Link href="/signin" className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-[11px] text-afrobrand-300">
              Sign in
            </Link>
          )}
          {accountMenu}
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
            {links.map((l) => (
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
