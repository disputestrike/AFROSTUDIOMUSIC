'use client';
import { SongChat } from './SongChat';

/**
 * §10 — ADJUST SONG. The workflow, in order and on one card:
 * hear → classify (all lanes) → CONFIRM (your ear outranks the machine's — you
 * can override the target lane) → the full repair plan BEFORE any spend → execute
 * exactly ONE route (repairs only the failing layer, preserves what passed) →
 * compare in the versions panel. The dispatched endpoint is always disclosed.
 */

import { useState } from 'react';
import { useApi } from '@/lib/api';
import type { Report } from './LaneReport';

interface Route { route: string; reason: string; preserves: string[]; endpoint: string }
interface Plan { report: Report; routes: Route[]; spend: string }

const LABEL: Record<string, string> = {
  rebuild_beat_material: 'Rebuild beat from real material',
  rerender_steered: 'Re-render with repair steering',
  remix_only: 'Fix the mix/master only',
  rewrite_hook: 'Rewrite the hook only',
};

export function AdjustSong({ songId, onDispatched }: { songId: string; onDispatched?: () => void }) {
  const api = useApi();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [laneOverride, setLaneOverride] = useState('');
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [tempo, setTempo] = useState('1.0');
  const [semis, setSemis] = useState('0');

  async function getPlan() {
    setBusy('plan'); setMsg('');
    try {
      const p = await api.post<Plan>(`/songs/${songId}/adjust/plan`, laneOverride ? { targetLane: laneOverride } : {});
      setPlan(p);
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  }

  async function execute(route: string) {
    setBusy(route); setMsg('');
    try {
      const r = await api.post<{ dispatched: string; next: string }>(`/songs/${songId}/adjust/execute`, { route, targetLane: laneOverride || undefined });
      setMsg(`Dispatched ${r.dispatched}. ${r.next}`);
      onDispatched?.();
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  }

  async function transform() {
    setBusy('transform'); setMsg('');
    try {
      const body: { tempo?: number; semitones?: number } = {};
      const t = parseFloat(tempo); const st = parseInt(semis, 10);
      if (!Number.isNaN(t) && Math.abs(t - 1) > 0.001) body.tempo = Math.min(1.5, Math.max(0.5, t));
      if (!Number.isNaN(st) && st !== 0) body.semitones = Math.min(6, Math.max(-6, st));
      if (!body.tempo && !body.semitones) { setMsg('Set a speed other than 1.0 and/or a key shift.'); setBusy(''); return; }
      const r = await api.post<{ note: string }>(`/songs/${songId}/transform`, body);
      setMsg(r.note); onDispatched?.();
    } catch (e) { setMsg((e as Error).message); }
    setBusy('');
  }

  return (
    <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold text-slate-300">Adjust this song</div>
        <input
          value={laneOverride}
          onChange={(e) => setLaneOverride(e.target.value)}
          placeholder="target lane (blank = detected)"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
        />
        <button onClick={getPlan} disabled={busy !== ''} className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50">
          {busy === 'plan' ? 'Hearing…' : 'Get repair plan (free)'}
        </button>
      </div>
      {plan && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-slate-500">{plan.spend} Your ear outranks the machine&apos;s — override the lane above and re-plan if the detection is wrong.</p>
          {plan.routes.map((r) => (
            <div key={r.route} className="flex flex-wrap items-center gap-2 rounded border border-slate-800 p-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-200">{LABEL[r.route] ?? r.route}</div>
                <div className="text-[10px] text-slate-500">{r.reason} · preserves: {r.preserves.join(', ')} · via {r.endpoint}</div>
              </div>
              <button onClick={() => execute(r.route)} disabled={busy !== ''} className="rounded bg-emerald-600/80 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50">
                {busy === r.route ? 'Dispatching…' : 'Run this repair'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
        <span className="text-xs font-semibold text-slate-300">Speed &amp; key</span>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">speed×
          <input value={tempo} onChange={(e) => setTempo(e.target.value)} className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">key±st
          <input value={semis} onChange={(e) => setSemis(e.target.value)} className="w-14 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" />
        </label>
        <button onClick={transform} disabled={busy !== ''} className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50">
          {busy === 'transform' ? 'Rendering…' : 'Apply (new version, free)'}
        </button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-slate-400">{msg}</p>}
      <SongChat songId={songId} onNewVersion={onDispatched} />
    </div>
  );
}
