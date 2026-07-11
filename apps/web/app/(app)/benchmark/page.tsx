'use client';

/**
 * LISTENING BENCHMARK — the ear-vs-machine ground truth (Feature 4).
 *
 * Listen to recent renders, rate each 1–5, and see per genre whether the lane
 * score matches your ear (earVsLaneGap) and whether we beat a reference. This is
 * the app's real improvement loop — no more trusting a score the ear disagrees
 * with. Paste a reference URL + rate it to build an A/B ground truth.
 *
 * BLIND A/B (top section): two of your own renders, unlabeled — pick the better
 * one with the ear alone, say why, and only THEN see the titles. Which token
 * lands on "A" is shuffled client-side so nothing about the payload order leaks.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface QItem { songId: string | null; url: string; genre: string; engine: string | null; laneScore: number | null }
interface GenreRow { genre: string; ratings: number; avgHuman: number; avgLaneScore: number | null; earVsLaneGap: number | null; avgOurs: number | null; avgReference: number | null; beatsReference: boolean | null }
interface AbSide { token: string; url: string }
interface AbScore { songId: string; title: string; wins: number; losses: number }
interface AbSummary { picks: number; winners: AbScore[]; losers: AbScore[]; notes: Array<{ note: string; picked: string }> }

export default function BenchmarkPage() {
  const api = useApi();
  const [queue, setQueue] = useState<QItem[]>([]);
  const [summary, setSummary] = useState<GenreRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [refUrl, setRefUrl] = useState('');
  const [refGenre, setRefGenre] = useState('afrobeats');
  const [pair, setPair] = useState<{ a: AbSide; b: AbSide } | null>(null);
  const [abEmpty, setAbEmpty] = useState(false);
  const [abNote, setAbNote] = useState('');
  const [reveal, setReveal] = useState<{ a: string; b: string; picked: 'a' | 'b' } | null>(null);
  const [abSummary, setAbSummary] = useState<AbSummary | null>(null);
  const [abBusy, setAbBusy] = useState(false);

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

  const loadAbSummary = useCallback(async () => {
    try { setAbSummary(await api.get<AbSummary>('/benchmark/ab-summary')); } catch { /* empty */ }
  }, [api]);

  const loadPair = useCallback(async () => {
    setReveal(null);
    setAbNote('');
    try {
      const p = await api.get<{ a: AbSide | null; b: AbSide | null }>('/benchmark/pair');
      if (!p.a || !p.b) { setPair(null); setAbEmpty(true); return; }
      setAbEmpty(false);
      // Shuffle which token lands on "A" HERE — the server's order never decides.
      setPair(Math.random() < 0.5 ? { a: p.a, b: p.b } : { a: p.b, b: p.a });
    } catch { setPair(null); }
  }, [api]);
  useEffect(() => { void loadPair(); void loadAbSummary(); }, [loadPair, loadAbSummary]);

  async function pickSide(side: 'a' | 'b') {
    if (!pair) return;
    const other = side === 'a' ? 'b' : 'a';
    setAbBusy(true);
    try {
      await api.post('/benchmark/pick', { winner: pair[side].token, loser: pair[other].token, note: abNote.trim() || undefined });
      // Reveal AFTER the pick is stored — titles come from the catalog list.
      const songs = await api.get<Array<{ id: string; title: string }>>('/songs');
      const titleOf = (id: string) => songs.find((s) => s.id === id)?.title ?? 'unknown';
      setReveal({ a: titleOf(pair.a.token), b: titleOf(pair.b.token), picked: side });
      await loadAbSummary();
    } catch { /* empty */ } finally { setAbBusy(false); }
  }

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

      {/* Blind A/B — two of your renders, no names. The ear decides, then the titles reveal. */}
      <div className="rounded-2xl border-gradient glass p-4">
        <h2 className="font-display text-lg">Blind A/B</h2>
        <p className="text-sm text-slate-400">Two recent renders, unlabeled. Pick the one that sounds better — the titles only reveal after you commit.</p>
        {abEmpty && <p className="mt-3 text-sm text-slate-500">Need at least 2 songs with audio to run a blind test — make some songs first.</p>}
        {pair && (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['a', 'b'] as const).map((side) => (
                <div key={side} className="rounded-xl border border-white/10 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-display text-base">{side.toUpperCase()}</span>
                    {reveal && (
                      <span className={`text-xs ${reveal.picked === side ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {reveal[side]}{reveal.picked === side ? ' · your pick' : ''}
                      </span>
                    )}
                  </div>
                  <audio controls src={pair[side].url} className="mt-2 w-full" />
                  {!reveal && (
                    <button disabled={abBusy} onClick={() => void pickSide(side)}
                      className="mt-2 w-full rounded-full border border-white/15 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40">
                      Pick {side.toUpperCase()}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!reveal && (
              <input value={abNote} onChange={(e) => setAbNote(e.target.value)} maxLength={500}
                placeholder="Why? (optional — one line, stored with the pick)"
                className="mt-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm" />
            )}
            {reveal && (
              <button onClick={() => void loadPair()} className="mt-3 rounded-full border border-white/15 px-4 py-1 text-sm hover:bg-white/10">Next pair</button>
            )}
          </>
        )}
        {abSummary && abSummary.picks > 0 && (
          <div className="mt-4 border-t border-white/5 pt-3 text-xs">
            <p className="text-slate-500">{abSummary.picks} blind pick{abSummary.picks === 1 ? '' : 's'} so far</p>
            {abSummary.winners.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Ear favourites:</span>
                {abSummary.winners.slice(0, 6).map((s) => (
                  <span key={s.songId} className="rounded-full bg-white/5 px-2 py-1 text-slate-300">
                    {s.title} <span className="text-emerald-400">{s.wins}W</span>·<span className="text-red-400">{s.losses}L</span>
                  </span>
                ))}
              </div>
            )}
            {abSummary.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-slate-500">
                {abSummary.notes.map((n, i) => (
                  <li key={i}>&ldquo;{n.note}&rdquo; — picked <span className="text-slate-300">{n.picked}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
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
