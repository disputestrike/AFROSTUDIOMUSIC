import Link from 'next/link';

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex items-center justify-between">
        <div className="font-display text-3xl tracking-tight">AFROHIT STUDIO</div>
        <nav className="flex items-center gap-6 text-sm text-slate-300">
          <Link href="/projects">Projects</Link>
          <Link
            href="/create"
            className="rounded-full bg-afrobrand-500 px-4 py-2 font-medium text-ink hover:bg-afrobrand-400"
          >
            Make a song
          </Link>
        </nav>
      </div>

      <section className="mt-20 grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight md:text-7xl">
            From Lagos to <span className="text-afrobrand-400">global</span> — your AI production house.
          </h1>
          <p className="mt-6 text-lg text-slate-300">
            Pick your sound — Afrobeats, amapiano, dancehall, R&B, gospel and more. Bring your beat or your voice,
            or start from scratch. The studio produces, mixes, masters, makes a clip, and hands you a rights-clean release.
          </p>
          <div className="mt-8 flex gap-4">
            <Link
              href="/create"
              className="rounded-full bg-afrobrand-500 px-6 py-3 font-medium text-ink hover:bg-afrobrand-400"
            >
              Make a song
            </Link>
            <Link href="/billing" className="rounded-full border border-slate-700 px-6 py-3 hover:border-slate-500">
              See pricing
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
          <p className="text-sm font-medium uppercase tracking-widest text-slate-400">A typical session</p>
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-black/40 p-4 text-sm text-slate-200">
{`> Make me an Afro-fusion love song, 103 bpm,
  pidgin/yoruba, smooth wizkid lane.
  Give me 8 hooks, scored for viral potential.
  I pick one — it writes the lyrics, sings the
  full record, makes cover art and a TikTok clip.
  Then rights check and bundle the release.`}
          </pre>
        </div>
      </section>

      <section className="mt-20 grid gap-6 md:grid-cols-3">
        <Feature title="Taste over volume" body="Cheap text drafts first (hooks, lyrics). Expensive audio/video only after approval. No spam." />
        <Feature title="Your voice, your consent" body="A signed consent flow. Cloned only with your samples. Revocable any time." />
        <Feature title="Rights receipts" body="Every export carries a tamper-evident receipt: prompts, providers, approvals, and AI disclosure." />
      </section>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 p-6">
      <div className="font-display text-xl">{title}</div>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
    </div>
  );
}
