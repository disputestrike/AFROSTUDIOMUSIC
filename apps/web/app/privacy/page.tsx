export const metadata = { title: 'Privacy Policy — AfroHit Studio' };
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-300">
      <h1 className="mb-2 text-2xl font-semibold text-slate-100">Privacy Policy</h1>
      <p className="mb-6 text-xs text-slate-500">AfroHit Studio · Effective on public launch</p>
      <p className="mb-6 rounded border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-300">Template for review — not legal advice. Counsel review required before public launch.</p>
      <h2 className="mt-6 mb-2 font-semibold text-slate-100">What we store</h2>
      <p>Account details; your uploads and generated songs; audio MEASUREMENTS (tempo, groove, instrumentation statistics) derived from your uploads; transcripts of your own uploads; usage events that personalize your studio. Payment details live with our payment processors, never on our servers.</p>
      <h2 className="mt-6 mb-2 font-semibold text-slate-100">What we never do</h2>
      <p>We do not train generative models on other artists&apos; recordings. We do not analyze identification previews. We do not share one account&apos;s learned sound, uploads, or measurements with any other account. Optional community contributions (e.g. language word-bank) are opt-in and clearly labeled.</p>
      <h2 className="mt-6 mb-2 font-semibold text-slate-100">Deletion</h2>
      <p>Delete a project and its media, measurements, and transcripts are removed from active systems within 30 days; account deletion removes everything tied to you except records law requires us to keep.</p>
      <h2 className="mt-6 mb-2 font-semibold text-slate-100">Processors & contact</h2>
      <p>We use cloud hosting, storage, model, and payment providers under data-processing terms. Questions: <span className="text-slate-100">privacy@afrohit.studio</span>.</p>
    </main>
  );
}
