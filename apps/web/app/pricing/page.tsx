import { redirect } from 'next/navigation';

export const metadata = { title: 'Pricing — AfroHits Studio' };

/**
 * ONE SOURCE OF PRICING TRUTH. This page used to hand-write five tiers
 * (including a "Free" plan and a "$149 Pro Artist") that did not exist in
 * billing — the landing's pricing section derives every perk and price from
 * PLAN_LIMITS + PLAN_CREDIT_GRANT_CENTS, the same constants the API enforces,
 * so the page and the bill can never disagree. A second hand-written copy is
 * a drift machine; redirect instead of duplicating (pre-launch fix,
 * 2026-07-16 — the stale tiers were caught by the landing build's audit).
 */
export default function Pricing() {
  redirect('/#pricing');
}
