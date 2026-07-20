'use client';

/**
 * CONSUMER SIDEBAR (USERSHELL) — the Suno-shaped left rail for every
 * non-operator account. Collapsible on desktop (chevron), a drawer on mobile.
 *
 * IA (owner's reference screenshots, mapped to OUR real features):
 * - brand wordmark; user chip (avatar initial, name, plan) with a dropdown:
 *   Profile → /settings, Subscription → /billing, Sign out. An Upgrade pill
 *   under the chip → /billing.
 * - primary nav: Home, Explore, Create, Studio, Library, Notifications.
 * - lower group: Terms & Policies → /terms, and "More" expanding the rest of
 *   the consumer surfaces (My Voice, My Likeness, Listen, My Sounds, Albums,
 *   Catalog). "Earn Credits" is intentionally ABSENT — no referral system
 *   exists yet, and a dead button is banned (clickthrough-audit doctrine).
 * - Active item = filled rounded pill. Presentation only: every operator
 *   route stays requireAdmin-gated server-side.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  CreditCard,
  Disc3,
  Ear,
  FileText,
  Home,
  LayoutGrid,
  LibraryBig,
  LogOut,
  MessagesSquare,
  Mic2,
  MoreHorizontal,
  ScanFace,
  Settings as SettingsIcon,
  Sparkles,
  Undo2,
  User,
  Waves,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApi } from '@/lib/api';
import { useOperatorView } from '@/components/OperatorGate';

const COLLAPSE_KEY = 'afrohit.sidebar.collapsed';

const PRIMARY: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/create', label: 'Create', icon: Sparkles },
  { href: '/studio', label: 'Studio', icon: MessagesSquare },
  { href: '/library', label: 'Library', icon: LibraryBig },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

const MORE: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/voice', label: 'My Voice', icon: Mic2 },
  { href: '/likeness', label: 'My Likeness', icon: ScanFace },
  { href: '/listen', label: 'Listen', icon: Ear },
  { href: '/materials', label: 'My Sounds', icon: Waves },
  { href: '/albums', label: 'Albums', icon: Disc3 },
  { href: '/catalog', label: 'Catalog', icon: LayoutGrid },
];

function planLabel(plan?: string | null): string {
  if (!plan) return 'Free plan';
  const p = plan.toLowerCase();
  return `${p.charAt(0).toUpperCase()}${p.slice(1)} plan`;
}

export function ConsumerSidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const api = useApi();
  const path = usePathname();
  const view = useOperatorView();
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Restore the collapse preference after mount (SSR-safe).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        if (!c) window.localStorage.setItem(COLLAPSE_KEY, '1');
        else window.localStorage.removeItem(COLLAPSE_KEY);
      } catch {
        /* noop */
      }
      return !c;
    });
  };

  // Close menus + the mobile drawer on navigation.
  useEffect(() => {
    setAccountOpen(false);
    onMobileClose();
    // Keep the "More" group open when the active page lives inside it.
    setMoreOpen(MORE.some((m) => path === m.href || path.startsWith(m.href + '/')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.post('/auth/logout', undefined);
    } catch {
      /* session may already be gone */
    }
    window.location.href = '/signin';
  }

  const isActive = (href: string) => path === href || path.startsWith(href + '/');
  const initial = (view.me?.name || view.me?.email || '?').trim().charAt(0).toUpperCase() || '?';
  const plan = view.me?.workspace?.plan ?? null;

  const itemClass = (href: string) =>
    `group flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-grotesk transition-colors ${
      isActive(href)
        ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    } ${collapsed ? 'justify-center px-0' : ''}`;

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand + collapse */}
      <div className={`flex items-center gap-2 px-3 pt-4 ${collapsed ? 'flex-col' : 'justify-between'}`}>
        <Link href="/home" className="flex min-w-0 items-center gap-2" onClick={onMobileClose}>
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-ink shadow-glow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 18V5l10-2v13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" fill="currentColor" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
          </span>
          {!collapsed && (
            <span className="truncate font-display text-lg tracking-tight">
              AFRO<span className="text-gradient">HIT</span>
            </span>
          )}
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 lg:inline-flex"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Operator previewing the consumer app — always show the way back. */}
      {view.viewingAsUser && !collapsed && (
        <button
          type="button"
          onClick={() => view.setViewAsUser(false)}
          className="mx-3 mt-3 flex items-center gap-2 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-3 py-1.5 text-left text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
        >
          <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Viewing as user — switch back
        </button>
      )}

      {/* User chip + account dropdown */}
      <div className="relative mt-4 px-3">
        {view.signedIn === false ? (
          !collapsed && (
            <Link
              href="/signin"
              className="flex items-center justify-center rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-3 py-2 text-sm text-afrobrand-300 hover:bg-afrobrand-500/20"
            >
              Sign in
            </Link>
          )
        ) : (
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            aria-expanded={accountOpen}
            aria-label="Account menu"
            className={`flex w-full items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-left transition-colors hover:bg-white/[0.08] ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-grotesk text-sm text-slate-100">
              {view.loading ? <User className="h-4 w-4 text-slate-400" aria-hidden /> : initial}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-100">{view.me?.name || view.me?.email || 'Your account'}</span>
                  <span className="block truncate text-xs text-slate-500">{planLabel(plan)}</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${accountOpen ? 'rotate-180' : ''}`} aria-hidden />
              </>
            )}
          </button>
        )}
        {accountOpen && (
          <>
            <button type="button" aria-hidden tabIndex={-1} onClick={() => setAccountOpen(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="absolute left-3 right-3 top-full z-50 mt-1.5 rounded-2xl border border-white/10 bg-ink/95 p-1.5 shadow-xl backdrop-blur">
              {(view.me?.name || view.me?.email) && (
                <div className="px-3 pb-1.5 pt-2">
                  {view.me?.name && <div className="truncate text-sm text-slate-200">{view.me.name}</div>}
                  {view.me?.email && <div className="truncate text-xs text-slate-500">{view.me.email}</div>}
                </div>
              )}
              <Link href="/settings" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100">
                <User className="h-4 w-4 text-slate-500" aria-hidden /> Profile
              </Link>
              <Link href="/billing" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100">
                <CreditCard className="h-4 w-4 text-slate-500" aria-hidden /> Subscription
              </Link>
              <Link href="/settings" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100">
                <SettingsIcon className="h-4 w-4 text-slate-500" aria-hidden /> Account
              </Link>
              <div className="mx-2 my-1 border-t border-white/5" />
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-slate-100 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4 text-slate-500" aria-hidden /> {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Upgrade pill — a real page, only when there is somewhere to go. */}
      {view.signedIn !== false && !collapsed && plan !== 'STUDIO' && (
        <div className="mt-2 px-3">
          <Link
            href="/billing"
            className="flex items-center justify-center gap-2 rounded-full bg-brand-gradient px-3 py-2 text-sm font-medium text-ink shadow-glow transition-transform hover:scale-[1.02]"
          >
            <Sparkles className="h-4 w-4" aria-hidden /> Upgrade plan
          </Link>
        </div>
      )}

      {/* Primary nav */}
      <nav className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1">
          {PRIMARY.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className={itemClass(item.href)} title={collapsed ? item.label : undefined}>
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Lower group */}
        <div className="mt-6 border-t border-white/5 pt-4">
          <ul className="space-y-1">
            <li>
              <Link href="/terms" className={itemClass('/terms')} title={collapsed ? 'Terms & Policies' : undefined}>
                <FileText className="h-5 w-5 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">Terms &amp; Policies</span>}
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                className={`flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm font-grotesk transition-colors ${
                  moreOpen || MORE.some((m) => isActive(m.href))
                    ? 'text-slate-200'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                } ${collapsed ? 'justify-center px-0' : ''}`}
                title={collapsed ? 'More' : undefined}
              >
                <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">More</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden />
                  </>
                )}
              </button>
            </li>
            {moreOpen &&
              MORE.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={itemClass(item.href)} title={collapsed ? item.label : undefined}>
                      <Icon className="h-5 w-5 shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={`hidden shrink-0 border-r border-white/5 bg-night-900/70 backdrop-blur transition-[width] duration-200 lg:block ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        {body}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" onClick={onMobileClose} className="absolute inset-0 bg-black/60" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/10 bg-night-900/95 backdrop-blur">
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
