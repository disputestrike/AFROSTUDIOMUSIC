/**
 * TENANT SURFACE ISOLATION (Wave 8a → USERSHELL) — the single source of truth
 * for who sees which surface.
 *
 * The owner's law: ordinary users get a Suno-shaped consumer app; the
 * operator keeps the whole engine room (lake, word bank, materials, bench,
 * admin) — and keeps EXACTLY today's top-bar layout. This manifest is
 * PRESENTATION routing only — the real wall is server-side (`requireAdmin` on
 * every operator route group in apps/api/src/routes). Hiding a button is
 * never the security boundary.
 *
 * THREE AUDIENCES (USERSHELL, owner order 2026-07-19):
 * - 'all'      — surfaces both roles can open.
 * - 'operator' — the engine room; ADMIN_EMAILS allowlist only.
 * - 'consumer' — the new consumer shell's own surfaces (Home, Explore,
 *   Library, Notifications). They exist ONLY in the consumer sidebar so the
 *   operator's nav stays byte-for-byte what it was before the shell landed.
 *
 * Pure data + pure functions: no React, no 'use client' — unit-testable
 * (scripts/test-nav-manifest.mjs asserts the consumer set NEVER intersects
 * the operator-only set, and that the operator's nav is unchanged).
 */

export type NavAudience = 'all' | 'operator' | 'consumer';

export interface NavItem {
  href: string;
  label: string;
  /** 'all' = both roles; 'operator' = ADMIN_EMAILS allowlist only;
   *  'consumer' = consumer-shell surfaces the operator nav never shows. */
  audience: NavAudience;
  /** Shown INLINE in the operator's desktop top bar. Non-primary items
   *  collapse into the "More" dropdown so the header never overflows.
   *  (Consumer-audience rows carry it only for completeness — the consumer
   *  sidebar lays itself out from its own groups.) */
  primary?: boolean;
}

/**
 * Every nav surface, in display order. The relative order of the
 * non-consumer rows intentionally matches the operator's muscle memory from
 * the pre-isolation nav — filtering out 'consumer' rows reproduces the
 * operator's nav EXACTLY as it was.
 */
export const NAV_MANIFEST: readonly NavItem[] = [
  { href: '/home', label: 'Home', audience: 'consumer', primary: true },
  { href: '/explore', label: 'Explore', audience: 'consumer', primary: true },
  { href: '/create', label: 'Create', audience: 'all', primary: true },
  { href: '/zap', label: 'Zap', audience: 'operator', primary: true },
  { href: '/voice', label: 'My Voice', audience: 'all', primary: true },
  { href: '/likeness', label: 'My Likeness', audience: 'all', primary: true },
  { href: '/listen', label: 'Listen', audience: 'all', primary: true },
  { href: '/studio', label: 'Chat', audience: 'all', primary: true },
  { href: '/library', label: 'Library', audience: 'consumer', primary: true },
  { href: '/notifications', label: 'Notifications', audience: 'consumer' },
  // Raw projects list is operator plumbing — consumers reach their work
  // through Catalog and the Studio flows (project DETAIL pages stay shared).
  { href: '/projects', label: 'Projects', audience: 'operator', primary: true },
  { href: '/catalog', label: 'Catalog', audience: 'all', primary: true },
  { href: '/materials', label: 'My Sounds', audience: 'all' },
  { href: '/instrumentals', label: 'Instrumentals', audience: 'operator', primary: true },
  { href: '/lake', label: 'Data Lake', audience: 'operator' },
  { href: '/lexicon', label: 'Word Bank', audience: 'operator' },
  { href: '/albums', label: 'Albums', audience: 'all', primary: true },
  { href: '/billing', label: 'Billing', audience: 'all' },
  { href: '/settings', label: 'Settings', audience: 'all' },
  { href: '/benchmark', label: 'Benchmark', audience: 'operator' },
  { href: '/admin', label: 'Admin', audience: 'operator' },
];

/** The consumer (tenant) surface set — what an ordinary signed-up artist can open. */
export function consumerNav(): NavItem[] {
  return NAV_MANIFEST.filter((item) => item.audience === 'all' || item.audience === 'consumer');
}

/** Surfaces ONLY the operator sees — the engine room. */
export function operatorOnlyNav(): NavItem[] {
  return NAV_MANIFEST.filter((item) => item.audience === 'operator');
}

/**
 * What the top NavBar renders for a given role (manifest order preserved).
 * The operator's list excludes 'consumer' rows — it is EXACTLY the
 * pre-USERSHELL nav, unchanged.
 */
export function navItemsFor(operator: boolean): NavItem[] {
  return operator
    ? NAV_MANIFEST.filter((item) => item.audience !== 'consumer')
    : consumerNav();
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
