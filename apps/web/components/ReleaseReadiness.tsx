'use client';

/**
 * Release readiness — the green-light gate. Shows what's done vs. missing before
 * a song can go out, and an editable split-sheet (who gets paid). Saving a valid
 * 100% split auto-assigns ISRC/UPC codes.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface Split { name: string; role: string; share: number }
interface Check { name: string; ok: boolean; detail?: string }
interface Song { id: string; title: string; isrc: string | null; upc: string | null; splitSheet: Split[] | null; releaseReady: boolean; nativeReviewOk?: boolean }
interface Status { song: Song | null; greenLight: { ready: boolean; checks: Check[]; needsReview?: boolean } | null }

const ROLES = ['writer', 'composer', 'producer', 'performer', 'featured', 'other'];

export function ReleaseReadiness({ projectId }: { projectId: string }) {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [perf, setPerf] = useState<{ backingTrack: string | null; note: string; bpm: number | null; key: string | null } | null>(null);

  async function loadPerformance() {
    if (!status?.song) return;
    try {
      setPerf(await api.get(`/projects/${projectId}/release/${status.song.id}/performance`));
    } catch {
      /* ignore */
    }
  }

  const [distMsg, setDistMsg] = useState('');
  async function distribute() {
    if (!status?.song) return;
    setDistMsg('Submitting…');
    try {
      const r = await api.post<{ message: string }>(`/projects/${projectId}/release/${status.song.id}/distribute`, {});
      setDistMsg(r.message);
    } catch (e) {
      setDistMsg((e as Error).message);
    }
  }

  async function setNativeReview(ok: boolean) {
    if (!status?.song) return;
    try {
      const r = await api.patch<Status>(`/projects/${projectId}/release/${status.song.id}`, { nativeReviewOk: ok });
      setStatus(r);
    } catch {
      /* ignore */
    }
  }

  const load = useCallback(async () => {
    try {
      const s = await api.get<Status>(`/projects/${projectId}/release`);
      setStatus(s);
      setSplits(s.song?.splitSheet?.length ? s.song.splitSheet : [{ name: '', role: 'writer', share: 100 }]);
    } catch {
      /* ignore */
    }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);

  const total = splits.reduce((s, x) => s + (Number(x.share) || 0), 0);

  async function save() {
    if (!status?.song) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api.patch<Status>(`/projects/${projectId}/release/${status.song.id}`, { splitSheet: splits });
      setStatus(r);
      setMsg(r.song?.isrc ? `Saved. ISRC ${r.song.isrc}${r.song.upc ? ` · UPC ${r.song.upc}` : ''}` : 'Saved.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  if (!status.song) {
    return (
      <section className="mt-8">
        <h2 className="font-display text-2xl">✅ Release readiness</h2>
        <p className="mt-1 text-sm text-slate-500">Make a song first — then green-light it for distribution here.</p>
      </section>
    );
  }

  const gl = status.greenLight;

  return (
    <section className="mt-8">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl">✅ Release readiness</h2>
        <span className={`rounded-full px-3 py-1 text-xs ${gl?.ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {gl?.ready ? 'GREEN-LIT' : 'not ready'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">What a DSP needs before it accepts + pays out on “{status.song.title}”.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Green-light checklist */}
        <div className="rounded-2xl glass p-4">
          <div className="font-display text-lg">Green-light checks</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {gl?.checks.map((c) => (
              <li key={c.name} className="flex items-center gap-2">
                <span>{c.ok ? '✅' : '⬜'}</span>
                <span className={c.ok ? 'text-slate-300' : 'text-slate-400'}>{c.name}</span>
                {c.detail && <span className="text-xs text-slate-500">· {c.detail}</span>}
              </li>
            ))}
          </ul>
          {(status.song.isrc || status.song.upc) && (
            <div className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-400">
              {status.song.isrc && <div>ISRC: <span className="tabular-nums text-slate-300">{status.song.isrc}</span></div>}
              {status.song.upc && <div>UPC: <span className="tabular-nums text-slate-300">{status.song.upc}</span></div>}
            </div>
          )}
        </div>

        {/* Split-sheet editor */}
        <div className="rounded-2xl glass p-4">
          <div className="flex items-center justify-between">
            <div className="font-display text-lg">Split-sheet</div>
            <span className={`text-xs ${Math.abs(total - 100) < 0.5 ? 'text-emerald-400' : 'text-amber-400'}`}>{total}%</span>
          </div>
          <div className="mt-2 space-y-2">
            {splits.map((s, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={s.name} onChange={(e) => setSplits((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
                <select value={s.role} onChange={(e) => setSplits((p) => p.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input type="number" value={s.share} onChange={(e) => setSplits((p) => p.map((x, j) => (j === i ? { ...x, share: Number(e.target.value) } : x)))} className="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs tabular-nums" />
                <button onClick={() => setSplits((p) => p.filter((_, j) => j !== i))} className="px-1 text-slate-500 hover:text-red-400">×</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setSplits((p) => [...p, { name: '', role: 'writer', share: 0 }])} className="text-xs text-slate-400 hover:text-slate-200">+ add</button>
            <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-brand-gradient px-4 py-1.5 text-xs font-medium text-ink shadow-glow disabled:opacity-50">
              {busy ? 'Saving…' : 'Save & green-light'}
            </button>
          </div>
          {msg && <div className="mt-2 text-xs text-slate-400">{msg}</div>}
        </div>
      </div>

      {/* Native-language review gate (only when the song uses Yoruba/Igbo/Hausa) */}
      {gl?.needsReview && (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <input type="checkbox" checked={!!status.song.nativeReviewOk} onChange={(e) => void setNativeReview(e.target.checked)} className="mt-0.5 h-4 w-4 accent-afrobrand-500" />
          <span>A native speaker checked the Yoruba/Igbo/Hausa delivery (tone &amp; pronunciation). Off-tone native lyrics read as fake — don’t release without this.</span>
        </label>
      )}

      {/* Share + stage */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <a href={`/r/${status.song.id}`} target="_blank" rel="noreferrer" className="text-afrobrand-300 hover:text-afrobrand-200">
          🔗 Public release page ↗
        </a>
        <button onClick={() => void loadPerformance()} className="text-slate-400 hover:text-slate-200">
          🎤 Performance Pack
        </button>
        <button onClick={() => void distribute()} disabled={!gl?.ready} className="rounded-full bg-brand-gradient px-3 py-1 font-medium text-ink shadow-glow disabled:opacity-40" title={gl?.ready ? 'Send to your distributor' : 'Green-light the song first'}>
          🚀 Distribute
        </button>
        {perf && (
          <span className="text-slate-500">
            {perf.backingTrack ? (
              <a href={perf.backingTrack} download className="text-afrobrand-300 hover:text-afrobrand-200">⬇ backing track</a>
            ) : (
              perf.note
            )}
            {perf.bpm ? ` · ${perf.bpm} bpm` : ''}{perf.key ? ` · ${perf.key}` : ''}
          </span>
        )}
      </div>
      {distMsg && <div className="mt-2 text-xs text-slate-400">{distMsg}</div>}
    </section>
  );
}
