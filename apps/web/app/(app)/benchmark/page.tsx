'use client';

/**
 * LISTENING BENCHMARK — the ear-vs-machine ground truth (Feature 4).
 *
 * Listen to recent renders, rate each 1–5, and see per genre whether the lane
 * score matches your ear (earVsLaneGap) and whether we beat a reference. This is
 * the app's real improvement loop — no more trusting a score the ear disagrees
 * with. Paste a reference URL + rate it to build an A/B ground truth.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface QItem { songId: string | null; url: string; genre: string; engine: string | null; laneScore: number | null }
interface GenreRow { genre: string; ratings: number; avgHuman: number; avgLaneScore: number | null; earVsLaneGap: number | null; avgOurs: number | null; avgReference: number | null; beatsReference: boolean | null }

export default function BenchmarkPage() {
  const api = useApi();
  const [queue, setQueue] = useState<QItem[]>([]);
  const [summary, setSummary] = useState<GenreRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [refUrl, setRefUrl] = useState('');
  const [refGenre, setRefGenre] = useState('afrobeats');

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([
        api.get<QItem[]>('/benchmark/queue'),
        api.get<{ genres: GenreRow[] }>('/benchmark/summary'),
      ]);
      setQueue(q);
      setSummary(s.genres);
    } catch { /* empty */ }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function rate(item: QItem, source: 'afrohit' | 'reference', humanRating: number, extra?: Partial<QItem> & { url?: string; genre?: string }) {
    setBusy(true);
    try {
      await api.post('/benchmark/rate', {
        genre: extra?.genre ?? item.genre,
        audioUrl: extra?.url ?? item.url,
        humanRating,
        source,
        songId: item.songId ?? undefined,
        engine: item.engine ?? undefined,
        laneScore: item.laneScore ?? undefined,
      });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="font-display text-2xl text-gradient">Listening Benchmark</h1>
        <p className="text-sm text-slate-400">Rate what you hear 1–5. The table below shows where the machine&apos;s lane score disagrees with your ear — that gap is the truth.</p>
      </div>

      {/* Per-genre truth table */}
      <div className="overflow-x-auto rounded-2xl border-gradient glass p-4">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-400">
            <tr><th className="p-2">Genre</th><th className="p-2">Ratings</th><th className="p-2">Your ear (avg/5)</th><th className="p-2">Lane score</th><th className="p-2">Ear vs Lane</th><th className="p-2">Beats reference?</th></tr>
          </thead>
          <tbody>
            {summary.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-500">No ratings yet — rate a few below.</td></tr>}
            {summary.map((g) => (
              <tr key={g.genre} className="border-t border-white/5">
                <td className="p-2 capitalize">{g.genre.replace(/_/g, ' ')}</td>
                <td className="p-2">{g.ratings}</td>
                <td className="p-2">{g.avgHuman}</td>
                <td className="p-2">{g.avgLaneScore ?? '—'}</td>
                <td className={`p-2 ${g.earVsLaneGap != null && g.earVsLaneGap < -15 ? 'text-red-400' : g.earVsLaneGap != null && g.earVsLaneGap > 10 ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {g.earVsLaneGap == null ? '—' : g.earVsLaneGap > 0 ? `+${g.earVsLaneGap}` : g.earVsLaneGap}
                </td>
                <td className="p-2">{g.beatsReference == null ? '—' : g.beatsReference ? '✅' : '❌'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Big negative &quot;Ear vs Lane&quot; = the machine rates it higher than you do — its confidence is inflated for that genre. That&apos;s where to focus.</p>
      </div>

      {/* Add a reference to A/B against */}
      <div className="rounded-2xl border-gradient glass p-4">
        <h2 className="font-display text-lg">Add a reference track (to beat)</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://…/reference.mp3" className="min-w-[280px] flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm" />
          <input value={refGenre} onChange={(e) => setRefGenre(e.target.value)} className="w-40 rounded-lg bg-white/5 px-3 py-2 text-sm" />
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} disabled={busy || !refUrl} onClick={() => rate({ songId: null, url: refUrl, genre: refGenre, engine: 'reference', laneScore: null }, 'reference', n, { url: refUrl, genre: refGenre })}
              className="rounded-full border border-white/15 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40">{n}</button>
          ))}
        </div>
      </div>

      {/* The queue to rate */}
      <div className="space-y-3">
        <h2 className="font-display text-lg">Rate recent renders ({queue.length})</h2>
        {queue.length === 0 && <p className="text-sm text-slate-500">Nothing to rate — make some songs first.</p>}
        {queue.map((item, i) => (
          <div key={i} className="rounded-xl border-gradient glass p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize text-slate-300">{item.genre.replace(/_/g, ' ')} · <span className="text-slate-500">{item.engine ?? 'engine?'}{item.laneScore != null ? ` · lane ${item.laneScore}` : ''}</span></span>
            </div>
            <audio controls src={item.url} className="mt-2 w-full" />
            <div className="mt-2 flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} disabled={busy} onClick={() => rate(item, 'afrohit', n)}
                  className="rounded-full border border-white/15 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40">{n}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
