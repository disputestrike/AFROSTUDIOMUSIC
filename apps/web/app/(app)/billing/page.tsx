'use client';

import { useEffect, useState } from 'react';
import { PLAN_LIMITS, PLAN_CREDIT_GRANT_CENTS } from '@afrohit/shared';
import { useApi } from '@/lib/api';
import { formatUsd } from '@/lib/utils';

interface Billing {
  plan: 'STARTER' | 'CREATOR' | 'PRO' | 'STUDIO';
  creditsCents: number;
  paypalSubscriptionId: string | null;
}

// TRUTHFUL plan cards (T3): perks are DERIVED from the enforced PLAN_LIMITS +
// the real monthly credit grant — what the card promises is exactly what the
// server enforces and grants. No hand-written marketing numbers.
const PRICE: Record<Billing['plan'], string> = { STARTER: '$19/mo', CREATOR: '$49/mo', PRO: '$149/mo', STUDIO: '$399/mo' };
const PLANS: Array<{ key: Billing['plan']; price: string; perks: string[] }> = (
  ['STARTER', 'CREATOR', 'PRO', 'STUDIO'] as Billing['plan'][]
).map((key) => {
  const l = PLAN_LIMITS[key];
  const grant = PLAN_CREDIT_GRANT_CENTS[key];
  return {
    key,
    price: PRICE[key],
    perks: [
      `${(grant / 10_000).toFixed(0)}$ in monthly studio credits`,
      l.monthlyDemoSongs > 0 ? `${l.monthlyDemoSongs} full songs / month` : 'Hooks + lyrics + cover art',
      `${l.coverArt} cover-art renders`,
      ...(l.monthlyVoiceRenders > 0 ? [`${l.monthlyVoiceRenders} voice renders`] : []),
      ...(l.monthlyVideoSeconds > 0 ? [`${l.monthlyVideoSeconds}s of video`] : []),
      ...(l.seats > 1 ? [`${l.seats} team seats`] : []),
    ],
  };
});

const PACKS = ['pack_10', 'pack_25', 'pack_50', 'pack_100'] as const;

export default function BillingPage() {
  const api = useApi();
  const [me, setMe] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState('');

  useEffect(() => {
    api.get<Billing>('/billing/me').then(setMe).catch(() => setMe(null));
  }, []);

  // The API 400s `unknown_plan_or_unconfigured` when the operator hasn't set
  // the PayPal plan IDs — an unhandled rejection here was a silent dead button.
  function checkoutErrText(e: Error): string {
    return /unknown_plan_or_unconfigured/.test(e.message)
      ? 'Billing isn’t configured yet — set the PayPal plan IDs on the API service.'
      : e.message.slice(0, 200);
  }
  async function subscribe(plan: Billing['plan']) {
    setCheckoutErr('');
    try {
      const res = await api.post<{ url: string }>('/billing/checkout/subscribe', { plan });
      window.location.href = res.url;
    } catch (e) {
      setCheckoutErr(checkoutErrText(e as Error));
    }
  }
  async function topup(pack: (typeof PACKS)[number]) {
    setCheckoutErr('');
    try {
      const res = await api.post<{ url: string }>('/billing/checkout/credits', { pack });
      window.location.href = res.url;
    } catch (e) {
      setCheckoutErr(checkoutErrText(e as Error));
    }
  }
  async function cancelSub() {
    if (!confirm('Cancel your PayPal subscription? Your plan will downgrade to Starter at the end of the period.')) return;
    setBusy(true);
    try {
      await api.post('/billing/subscription/cancel', {});
      const fresh = await api.get<Billing>('/billing/me');
      setMe(fresh);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-4xl">Billing</h1>
      <p className="mt-2 text-sm text-slate-400">
        {me ? (
          <>
            Plan <b className="text-slate-200">{me.plan}</b> · credits{' '}
            <b className="text-afrobrand-400">{formatUsd(me.creditsCents)}</b>
            {me.paypalSubscriptionId && (
              <button
                onClick={() => void cancelSub()}
                disabled={busy}
                className="ml-4 rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-red-500 disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            )}
          </>
        ) : (
          'Loading…'
        )}
      </p>
      <p className="mt-1 text-xs text-slate-500">Payments processed by PayPal.</p>

      {checkoutErr && (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{checkoutErr}</div>
      )}

      <h2 className="mt-10 font-display text-2xl">Plans</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        {PLANS.map((p) => {
          const isCurrent = me?.plan === p.key && !!me?.paypalSubscriptionId;
          return (
            <div key={p.key} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="font-display text-xl">{p.key}</div>
              <div className="mt-1 text-sm text-afrobrand-400">{p.price}</div>
              <ul className="mt-3 space-y-1 text-sm text-slate-300">
                {p.perks.map((perk) => (
                  <li key={perk}>• {perk}</li>
                ))}
              </ul>
              <button
                onClick={() => void subscribe(p.key)}
                disabled={isCurrent}
                className="mt-4 w-full rounded-full bg-afrobrand-500 px-3 py-2 text-sm text-ink hover:bg-afrobrand-400 disabled:opacity-50"
              >
                {isCurrent ? 'Current plan' : 'Subscribe with PayPal'}
              </button>
            </div>
          );
        })}
      </div>

      <h2 className="mt-10 font-display text-2xl">Credit packs</h2>
      {checkoutErr && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{checkoutErr}</div>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {PACKS.map((pack) => (
          <button
            key={pack}
            onClick={() => void topup(pack)}
            className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-left text-sm hover:border-afrobrand-500"
          >
            <div className="font-display text-lg">${pack.split('_')[1]}</div>
            <div className="text-slate-400">credit pack · PayPal</div>
          </button>
        ))}
      </div>
    </div>
  );
}
