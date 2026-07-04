import Link from 'next/link';

export default async function BillingCancel({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="font-display text-4xl">Payment cancelled</h1>
      <p className="mt-3 text-slate-300">
        No charge was made.{' '}
        {reason && <span className="text-slate-500">({reason})</span>}
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/billing" className="rounded-full bg-afrobrand-500 px-5 py-2 text-sm text-ink hover:bg-afrobrand-400">
          Back to billing
        </Link>
      </div>
    </div>
  );
}
