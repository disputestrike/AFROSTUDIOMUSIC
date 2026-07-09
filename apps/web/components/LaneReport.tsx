'use client';

/**
 * §9 — SURFACE THE PRODUCER BRAIN. The block the FINAL INSTRUCTION mandates on
 * Release Readiness: lane distribution, target, score + honest coverage, what
 * ranked the shipped take, the engine (and whether the ENGINE is the ceiling),
 * strongest/weakest, keep/replace, repair route, gate verdict — and for every
 * detector that could not run, the REASON. Never `BPM, mood, energy` alone;
 * never a blank; never a guess.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface Dist { lane: string; overall: number; coverage: number; pct: number }
interface Check { name: string; ok: boolean; status: string; detail?: string }
export interface Report {
  available: boolean;
  reason?: string;
  targetLane?: string;
  distribution?: Dist[];
  unprofiledLanes?: string[];
  laneScore?: number | null;
  coverage?: string;
  rankedBy?: string | null;
  blueprintMatch?: number | null;
  profileTier?: string;
  authenticRefs?: number;
  engine?: { name: string; adequate: boolean; note?: string; recommended?: string };
  strongest?: Array<{ key: string; match: number }>;
  weakest?: Array<{ key: string; match: number; critical: boolean }>;
  keep?: string[];
  replace?: string[];
  repairSummary?: string;
  unknowns?: Array<{ field: string; reason: string }>;
  releaseGate?: { creative: { blocked: boolean; checks: Check[] }; hitmaker: { blocked: boolean; checks: Check[] } };
  lexiconUnseeded?: string[];
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-xs"><span className="w-28 shrink-0 text-slate-500">{k}</span><span className="min-w-0 flex-1 text-slate-300">{children}</span></div>
);

export function LaneReport({ songId, refreshKey = 0 }: { songId: string; refreshKey?: number }) {
  const api = useApi();
  const [r, setR] = useState<Report | null>(null);
  const load = useCallback(async () => {
    try { setR(await api.get<Report>(`/songs/${songId}/lane-report`)); } catch { setR(null); }
  }, [api, songId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!r) return null;
  if (!r.available) {
    return (
      <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-3">
        <div className="text-xs font-semibold text-slate-300">Producer brain</div>
        <p className="mt-1 text-xs text-slate-500">Not scored — {r.reason}. What was not measured cannot fail the gate, and cannot certify it either.</p>
        {!!r.lexiconUnseeded?.length && <p className="mt-1 text-xs text-amber-300">Lane lexicon unseeded: {r.lexiconUnseeded.join(', ')} — Hit Maker certification is blocked until seeded.</p>}
      </div>
    );
  }
  const hit = r.releaseGate?.hitmaker;
  const failedGate = hit?.checks.filter((c) => c.status === 'fail') ?? [];
  return (
    <div className="mt-3 space-y-1.5 rounded border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-300">Producer brain</div>
        {r.rankedBy && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">ranked by {r.rankedBy}</span>}
      </div>
      {!!r.distribution?.length && (
        <Row k="Current lane">{r.distribution.slice(0, 3).map((d) => `${d.pct}% ${d.lane}`).join(' · ')}</Row>
      )}
      <Row k="Target lane">{r.targetLane}</Row>
      {r.blueprintMatch != null && <Row k="Structure">{Math.round(r.blueprintMatch * 100)}% skeleton match vs source blueprint</Row>}
      <Row k="Lane score">{r.laneScore ?? '—'} <span className="text-slate-500">({r.coverage})</span></Row>
      {r.profileTier === 'self-trained' && (
        <Row k="Profile"><span className="text-amber-300">self-trained ({r.authenticRefs ?? 0}/3 authentic refs) — steering works, certification needs real tracks</span></Row>
      )}
      {r.engine && (
        <Row k="Engine">
          {r.engine.name} {r.engine.adequate ? <span className="text-emerald-400">(adequate for this lane)</span> : <span className="text-amber-300">— this engine cannot reliably perform this lane; the score reflects the engine&apos;s limit, not your brief{r.engine.recommended ? ` (use ${r.engine.recommended})` : ''}</span>}
        </Row>
      )}
      {!!r.strongest?.length && <Row k="Strongest">{r.strongest.map((s) => `${s.key} (${s.match})`).join(', ')}</Row>}
      {!!r.weakest?.length && <Row k="Weakest">{r.weakest.map((w) => `${w.key} (${w.match}${w.critical ? ', CRITICAL' : ''})`).join(', ')}</Row>}
      {!!r.keep?.length && <Row k="Keep">{r.keep.join(', ')}</Row>}
      {!!r.replace?.length && <Row k="Replace">{r.replace.join(', ')}</Row>}
      {r.repairSummary && <Row k="Repair route">{r.repairSummary}</Row>}
      {hit && (
        <Row k="Hit Maker gate">{hit.blocked ? <span className="text-rose-300">BLOCKED — {failedGate.map((c) => `${c.name}: ${c.detail}`).join(' · ')}</span> : <span className="text-emerald-400">certifiable</span>}</Row>
      )}
      {!!r.lexiconUnseeded?.length && <Row k="Lane lexicon"><span className="text-amber-300">unseeded: {r.lexiconUnseeded.join(', ')}</span></Row>}
      {!!r.unknowns?.length && (
        <Row k="Not scored">{r.unknowns.slice(0, 4).map((u) => `${u.field} — ${u.reason}`).join(' · ')}</Row>
      )}
      {!!r.unprofiledLanes?.length && (
        <p className="pt-1 text-[10px] text-slate-600">{r.unprofiledLanes.length} lane(s) unprofiled — the ear cannot judge a lane with fewer than 3 measured references.</p>
      )}
    </div>
  );
}
