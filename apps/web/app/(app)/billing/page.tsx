'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { formatUsd } from '@/lib/utils';

interface Billing {
  plan: 'STARTER' | 'CREATOR' | 'PRO' | 'STUDIO';
  creditsCents: number;
  paypalSubscriptionId: string | null;
}

const PLANS: Array<{ key: Billing['plan']; price: string; perks: string[] }> = [
  { key: 'STARTER', price: '$19/mo', perks: ['Hooks + lyrics', '5 cover-art renders'] },
  { key: 'CREATOR', price: '$49/mo', perks: ['20 demos', 'MP3 exports', 'Brand kit'] },
  { key: 'PRO', price: '$149/mo', perks: ['60 demos', 'Voice profile', 'Release kits', 'Collab'] },
  { key: 'STUDIO', price: '$399/mo', perks: ['Team seats', 'Bulk gen', 'Priority queue'] },
];

const PACKS = ['pack_10', 'pack_25', 'pack_50', 'pack_100'] as const;

export default function BillingPage() {
  const api = useApi();
  const [me, setMe] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Billing>('/billing/me').then(setMe).catch(() => setMe(null));
  }, []);

  async function subscribe(plan: Billing['plan']) {
    const res = await api.post<{ url: string }>('/billing/checkout/subscribe', { plan });
    window.location.href = res.url;
  }
  async function topup(pack: (typeof PACKS)[number]) {
    const res = await api.post<{ url: string }>('/billing/checkout/credits', { pack });
    window.location.href = res.url;
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
