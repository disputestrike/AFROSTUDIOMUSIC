'use client';

/**
 * DATA LAKE — the studio's whole memory, visible and manageable.
 *
 * What it has learned (heard songs, studied lyric craft, trend snapshots,
 * self-training), the material shelf, exactly WHERE each kind feeds
 * generation, ways to ADD to the lake, and admin curation (delete a bad
 * lesson — it sticks).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Database, Trash2, Loader2, Music2, BookOpenText, TrendingUp, Sparkles, Radar, Wand2 } from 'lucide-react';

interface LakeRow { id: string; title: string | null; genre: string | null; kind: string; summary: string; at: string }
interface Lake {
  soundReferences: {
    total: number;
    byKind: Record<string, number>;
    genresByKind: Record<string, Record<string, number>>;
    latest: LakeRow[];
  };
  materials: { total: number; shelf: Array<{ genre: string | null; role: string; count: number }> };
  songs: number;
  approvedLyrics: number;
  hooks: number;
  tasteScores: number;
  tasteEvents: number;
  orchestration: Record<string, string>;
}

/**
 * TRAINING UTILIZATION — the owner's question, per reference: has it been USED
 * or not, and if not, why (unmeasured? wrong lane? no material?). Every column
 * is honest: harvested "?" means unknown, never a fake ✗.
 */
interface UtilRow {
  id: string;
  title: string | null;
  genre: string | null;
  origin: 'owned-upload' | 'facts-only' | 'self-generated' | 'zap';
  measured: boolean;
  deepMeasured: boolean;
  usedInRenders: number;
  lastUsedAt: string | null;
  harvested: boolean | null;
  needsBackfill: boolean;
  genreMismatch: { detected: string; filed: string | null } | null;
  learnedAt: string;
}

const ORIGIN_LABEL: Record<UtilRow['origin'], string> = {
  'owned-upload': 'owned upload',
  'facts-only': 'facts only',
  'self-generated': 'self-generated',
  zap: 'zap',
};

function Utilization() {
  const api = useApi();
  const [rows, setRows] = useState<UtilRow[] | null>(null);
  const [note, setNote] = useState('');
  const [uErr, setUErr] = useState('');

  useEffect(() => {
    api.get<{ rows: UtilRow[]; note: string }>('/taste/utilization')
      .then((d) => { setRows(d.rows); setNote(d.note); })
      .catch((e) => setUErr((e as Error).message.slice(0, 140)));

  }, []);

  if (uErr) return <div className="mt-6 rounded-2xl glass p-4 text-xs text-red-300">Training utilization unavailable: {uErr}</div>;
  if (!rows) return null;

  const unused = rows.filter((r) => r.usedInRenders === 0).length;
  return (
    <div className="mt-6 rounded-2xl glass p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="font-grotesk text-sm font-medium text-slate-200">Training utilization</div>
        <span className="text-[11px] text-slate-500">{rows.length} references · {unused} unused</span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        References with 0 uses in their lane are usually either unmeasured (run Measure backfill on the Admin page) or filed in the wrong genre (check Re-file review).
      </p>
      {rows.length === 0 ? (
        <div className="mt-3 text-xs text-slate-500">Nothing to show yet — teach it a song first.</div>
      ) : (
        <div className="mt-3 max-h-96 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink/90 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="py-1.5 pr-2">Reference</th>
                <th className="pr-2">Origin</th>
                <th className="pr-2">Measured</th>
                <th className="pr-2">Used</th>
                <th className="pr-2">Harvested</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="max-w-[220px] truncate py-1.5 pr-2 text-slate-300" title={r.title ?? undefined}>
                    {r.title || '(untitled)'} {r.genre && <span className="text-slate-500">· {r.genre.replace(/_/g, ' ')}</span>}
                  </td>
                  <td className="pr-2"><span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{ORIGIN_LABEL[r.origin]}</span></td>
                  <td className="pr-2">
                    {r.measured
                      ? <span className="text-emerald-300">✓{r.deepMeasured ? ' deep' : ''}</span>
                      : <span className="text-slate-500">✗</span>}
                  </td>
                  <td className="pr-2">
                    {r.usedInRenders > 0
                      ? <span className="text-emerald-300">{r.usedInRenders} render{r.usedInRenders === 1 ? '' : 's'}</span>
                      : <span className="text-red-400">0</span>}
                  </td>
                  <td className="pr-2" title={r.harvested === null ? 'unknown — harvest rows don’t carry a reference id' : undefined}>
                    {r.harvested === true ? <span className="text-emerald-300">✓</span> : r.harvested === false ? <span className="text-slate-600">—</span> : <span className="text-slate-500">?</span>}
                  </td>
                  <td className="space-x-1">
                    {r.needsBackfill && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">⚠ needs backfill</span>}
                    {r.genreMismatch && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300" title="the recipe's detected genre disagrees with the filed lane">
                        filed {(r.genreMismatch.filed ?? '?').replace(/_/g, ' ')} · ear says {r.genreMismatch.detected.replace(/_/g, ' ')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="mt-2 text-[10px] leading-snug text-slate-600">{note}</p>}
    </div>
  );
}

const KIND_META: Record<string, { label: string; icon: React.ReactNode; hint: string }> = {
  heardSongs: { label: 'Heard songs', icon: <Music2 className="h-4 w-4" />, hint: 'deep-listened references (uploads + listens)' },
  lyricCraft: { label: 'Lyric craft', icon: <BookOpenText className="h-4 w-4" />, hint: 'studied lessons — patterns, never words' },
  trendSnapshots: { label: 'Trend snapshots', icon: <TrendingUp className="h-4 w-4" />, hint: 'daily what-is-popping digests' },
  selfTraining: { label: 'Self-training', icon: <Sparkles className="h-4 w-4" />, hint: 'the studio learning from its own QC-passed renders' },
  zapped: { label: 'Zapped', icon: <Radar className="h-4 w-4" />, hint: 'songs you Zapped + the daily radar — the craft of what’s charting, as reference lanes' },
};

export default function LakePage() {
  const api = useApi();
  const router = useRouter();
  const [lake, setLake] = useState<Lake | null>(null);
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState<string>('');
  const [preparing, setPreparing] = useState<string>('');

  // Make a fresh song in this reference's LANE — starts producing immediately, with
  // the reference's real genre/tempo/mood/LANGUAGES (backfilled by /zap/lane-brief).
  async function makeInLane(r: LakeRow) {
    setPreparing(r.id);
    const p: Record<string, string> = {
      genre: r.genre || 'afrobeats',
      produce: '1',
      languages: 'pcm,en',
      vibe: (r.summary || `a fresh original in the lane of ${r.title || 'this reference'}`).slice(0, 240),
    };
    try {
      const b = await api.post<{ genre: string; bpm: number; mood: string | null; languages: string[]; influence: string | null; vibe: string }>('/zap/lane-brief', { referenceId: r.id });
      p.genre = b.genre || p.genre;
      p.languages = (b.languages?.length ? b.languages : ['pcm', 'en']).join(',');
      p.vibe = (b.vibe || p.vibe).slice(0, 240);
      if (b.bpm) p.bpm = String(b.bpm);
      if (b.mood) p.mood = b.mood;
      if (b.influence) p.influence = b.influence;
    } catch { /* fall back to genre/vibe defaults */ }
    setPreparing('');
    router.push(`/create?${new URLSearchParams(p).toString()}`);
  }

  const load = useCallback(async () => {
    try {
      setLake(await api.get<Lake>('/taste/data-lake'));
      setErr('');
    } catch (e) {
      setErr((e as Error).message.slice(0, 160));
    }

  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(id: string) {
    if (deleting) return;
    setDeleting(id);
    try {
      await api.del(`/taste/references/${id}`);
      await load();
    } catch (e) {
      setErr(`Delete failed: ${(e as Error).message.slice(0, 120)}`);
    } finally {
      setDeleting('');
    }
  }

  const byKind = lake?.soundReferences.byKind ?? {};

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="flex items-center gap-2.5 font-display text-3xl">
        <Database className="h-7 w-7 text-afrobrand-400" /> The data <span className="text-gradient">lake</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Everything the studio has learned, in one place — and every song it makes reads from here.
        Add to it below; delete anything that shouldn&apos;t be teaching it.
      </p>

      {err && <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{err}</div>}
      {!lake && !err && <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the lake…</div>}

      <Utilization />

      {lake && (
        <>
          {/* What's in it */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(KIND_META).map(([k, meta]) => (
              <div key={k} className="rounded-2xl glass p-4">
                <div className="flex items-center gap-2 text-afrobrand-400">{meta.icon}<span className="font-grotesk text-sm text-slate-200">{meta.label}</span></div>
                <div className="mt-1 font-display text-3xl">{byKind[k] ?? 0}</div>
                <div className="mt-1 text-[11px] leading-snug text-slate-500">{meta.hint}</div>
                {lake.soundReferences.genresByKind[k] && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(lake.soundReferences.genresByKind[k]!).slice(0, 4).map(([g, n]) => (
                      <span key={g} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{g.replace(/_/g, ' ')} ×{n}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add to the lake */}
          <div className="mt-6 rounded-2xl glass p-4">
            <div className="font-grotesk text-sm font-medium text-slate-200">Add to the lake</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link href="/listen" className="rounded-full bg-brand-gradient px-4 py-2 font-medium text-ink shadow-glow">🎧 Learn from a song</Link>
              <Link href="/listen" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10">📝 Learn from a lyric</Link>
              <Link href="/materials" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10">🔨 Forge material</Link>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Self-training and trend snapshots add themselves — every QC-passed song and every day&apos;s chart digest lands here automatically.</p>
          </div>

          {/* Material shelf summary */}
          <div className="mt-6 rounded-2xl glass p-4">
            <div className="font-grotesk text-sm font-medium text-slate-200">Material shelf — {lake.materials.total} loop{lake.materials.total === 1 ? '' : 's'}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lake.materials.shelf.map((m, i) => (
                <span key={i} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{(m.genre ?? '?').replace(/_/g, ' ')} · {m.role} ×{m.count}</span>
              ))}
              {lake.materials.shelf.length === 0 && <span className="text-xs text-slate-500">empty — forge a kit on the Materials page</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span>{lake.songs} songs</span><span>{lake.approvedLyrics} approved lyrics</span><span>{lake.hooks} hooks written</span><span>{lake.tasteEvents} taste events</span>
            </div>
          </div>

          {/* How it feeds generation */}
          <div className="mt-6 rounded-2xl glass p-4">
            <div className="font-grotesk text-sm font-medium text-slate-200">Where each kind feeds generation</div>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-400">
              {Object.entries(lake.orchestration).map(([k, v]) => (
                <li key={k} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-afrobrand-300">{KIND_META[k]?.label ?? k}</span>
                  {v}
                </li>
              ))}
            </ul>
          </div>

          {/* Browse + curate */}
          <div className="mt-6 rounded-2xl glass p-4">
            <div className="font-grotesk text-sm font-medium text-slate-200">Latest in the lake</div>
            <ul className="mt-3 space-y-2">
              {lake.soundReferences.latest.map((r) => (
                <li key={r.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <span className="mt-0.5 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{KIND_META[r.kind]?.label ?? r.kind}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{r.title || '(untitled)'} {r.genre && <span className="text-xs text-slate-500">· {r.genre.replace(/_/g, ' ')}</span>}</div>
                    {r.summary && <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{r.summary}</div>}
                  </div>
                  <button
                    onClick={() => void makeInLane(r)}
                    disabled={preparing === r.id}
                    title="Make a fresh song in this lane — starts making immediately (never a copy)"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20 disabled:opacity-60"
                  >
                    {preparing === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Make in this lane
                  </button>
                  <button
                    onClick={() => void remove(r.id)}
                    disabled={!!deleting}
                    title="Remove from the lake (it will stop teaching the studio)"
                    className="shrink-0 rounded-lg border border-white/10 p-1.5 text-slate-500 hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
                  >
                    {deleting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </li>
              ))}
              {lake.soundReferences.latest.length === 0 && <li className="text-xs text-slate-500">Nothing yet — feed it a song or a lyric.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
