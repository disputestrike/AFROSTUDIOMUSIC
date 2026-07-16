/**
 * TENANT SURFACE ISOLATION (Wave 8a) — the single source of truth for who
 * sees which surface.
 *
 * The owner's law: ordinary users get a Suno-shaped consumer app; the
 * operator keeps the whole engine room (lake, word bank, materials, bench,
 * admin). This manifest is PRESENTATION routing only — the real wall is
 * server-side (`requireAdmin` on every operator route group in
 * apps/api/src/routes). Hiding a button is never the security boundary.
 *
 * Pure data + pure functions: no React, no 'use client' — unit-testable
 * (scripts/test-nav-manifest.mjs asserts the consumer set NEVER intersects
 * the operator-only set).
 */

export type NavAudience = 'all' | 'operator';

export interface NavItem {
  href: string;
  label: string;
  /** 'all' = every signed-in user; 'operator' = ADMIN_EMAILS allowlist only. */
  audience: NavAudience;
}

/**
 * Every top-nav surface, in display order. The order intentionally matches the
 * operator's muscle memory from the pre-isolation nav.
 */
export const NAV_MANIFEST: readonly NavItem[] = [
  { href: '/create', label: 'Create', audience: 'all' },
  { href: '/zap', label: 'Zap', audience: 'operator' },
  { href: '/voice', label: 'My Voice', audience: 'all' },
  { href: '/likeness', label: 'My Likeness', audience: 'all' },
  { href: '/listen', label: 'Listen', audience: 'all' },
  { href: '/studio', label: 'Chat', audience: 'all' },
  // Raw projects list is operator plumbing — consumers reach their work
  // through Catalog and the Studio flows (project DETAIL pages stay shared).
  { href: '/projects', label: 'Projects', audience: 'operator' },
  { href: '/catalog', label: 'Catalog', audience: 'all' },
  { href: '/materials', label: 'Materials', audience: 'operator' },
  { href: '/instrumentals', label: 'Instrumentals', audience: 'operator' },
  { href: '/lake', label: 'Data Lake', audience: 'operator' },
  { href: '/lexicon', label: 'Word Bank', audience: 'operator' },
  { href: '/albums', label: 'Albums', audience: 'all' },
  { href: '/billing', label: 'Billing', audience: 'all' },
  { href: '/settings', label: 'Settings', audience: 'all' },
  { href: '/benchmark', label: 'Benchmark', audience: 'operator' },
  { href: '/admin', label: 'Admin', audience: 'operator' },
];

/** The consumer (tenant) nav — what an ordinary signed-up artist sees. */
export function consumerNav(): NavItem[] {
  return NAV_MANIFEST.filter((item) => item.audience === 'all');
}

/** Surfaces ONLY the operator sees — the engine room. */
export function operatorOnlyNav(): NavItem[] {
  return NAV_MANIFEST.filter((item) => item.audience === 'operator');
}

/** What the NavBar renders for a given role (manifest order preserved). */
export function navItemsFor(operator: boolean): NavItem[] {
  return operator ? [...NAV_MANIFEST] : consumerNav();
}

/**
 * Page routes wrapped in <OperatorGate> — a consumer deep-linking here gets a
 * polite "this area is for studio operators" screen, never a crash. '/projects'
 * gates the LIST page only: '/projects/[id]' and '/projects/new' are part of
 * consumer flows (BringYourOwn / ReferenceListen navigate there).
 */
export const OPERATOR_GATED_PAGES: readonly string[] = operatorOnlyNav().map((item) => item.href);

/** True when a pathname belongs to an operator-gated page (list-only for /projects). */
export function isOperatorGatedPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return OPERATOR_GATED_PAGES.some((href) =>
    href === '/projects' ? path === href : path === href || path.startsWith(`${href}/`)
  );
}
