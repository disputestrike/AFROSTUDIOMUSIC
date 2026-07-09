export const metadata = { title: 'Pricing — AfroHit Studio' };
const TIERS = [
  { name: 'Free', price: '$0', tag: 'Start here', feats: ['5 own-engine songs / month', '~30 Zap identifies', 'Stream-share your songs', 'Lane report on every take'] },
  { name: 'Starter', price: '$19', tag: 'For writers', feats: ['Hooks, lyrics & covers', 'Song downloads', 'Word-bank palettes', 'Everything in Free'] },
  { name: 'Creator', price: '$49', tag: 'Most popular', feats: ['Premium engine renders', 'Speed & key transform', 'Adjust + repair tools', 'Exports & snippets'] },
  { name: 'Pro Artist', price: '$149', tag: 'Release-ready', feats: ['Voice profile (with consent)', 'Stems & mixer', 'Blueprint structure-clone', 'Release kits & share pages'] },
  { name: 'Studio', price: '$399', tag: 'Teams & labels', feats: ['Seats for your team', 'Bulk generation', 'Priority rendering', 'Everything in Pro'] },
];
export default function Pricing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-center text-3xl font-semibold text-slate-100">Songs with receipts.</h1>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-400">Every plan runs on an engine we own — commercially clean output, measured against the real sound of your lane. Cancel anytime.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {TIERS.map((t) => (
          <div key={t.name} className={`rounded-xl border p-5 ${t.tag === 'Most popular' ? 'border-sky-500 bg-sky-950/30' : 'border-slate-800 bg-slate-950/60'}`}>
            <div className="text-xs uppercase tracking-wide text-slate-500">{t.tag}</div>
            <div className="mt-1 text-lg font-semibold text-slate-100">{t.name}</div>
            <div className="mt-1 text-2xl font-bold text-slate-100">{t.price}<span className="text-sm font-normal text-slate-500">/mo</span></div>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              {t.feats.map((f) => (<li key={f} className="flex gap-2"><span className="text-sky-400">•</span>{f}</li>))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-slate-500">Billing via PayPal at launch · regional pricing for Nigeria, Kenya & South Africa coming · prices USD</p>
    </main>
  );
}
