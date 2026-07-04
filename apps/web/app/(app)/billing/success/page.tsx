import Link from 'next/link';

export default async function BillingSuccess({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const { type, status } = await searchParams;
  const t = type ?? 'payment';
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="font-display text-4xl">You&apos;re in.</h1>
      <p className="mt-3 text-slate-300">
        PayPal {t === 'subscription' ? 'subscription' : 'order'} status: <b>{status ?? 'received'}</b>.
        We&apos;ll finalize on the webhook within a few seconds.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/studio" className="rounded-full bg-afrobrand-500 px-5 py-2 text-sm text-ink hover:bg-afrobrand-400">
          Back to Studio
        </Link>
        <Link href="/billing" className="rounded-full border border-slate-700 px-5 py-2 text-sm hover:border-slate-500">
          Billing
        </Link>
      </div>
    </div>
  );
}
