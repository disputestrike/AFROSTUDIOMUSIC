'use client';

/**
 * MATERIALS — the studio's shelf of real, owned musical material.
 *
 * Forge a genre kit (isolated loops: drums / log drum / bass / percussion /
 * chord bed, melodic ones in key), watch them land, play each loop, then
 * ASSEMBLE: Claude arranges the exact beat from the shelf — deterministic,
 * never a hallucination. This is the "exact beat" surface.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { Loader2, Hammer, Layers, Play } from 'lucide-react';

const GENRES = [
  { value: 'afrobeats', label: 'Afrobeats' }, { value: 'afro_fusion', label: 'Afro-fusion' },
  { value: 'amapiano', label: 'Amapiano' }, { value: 'afro_dancehall', label: 'Afro-dancehall' },
  { value: 'street_pop', label: 'Street-pop / Zanku' }, { value: 'afro_rnb', label: 'Afro R&B' },
  { value: 'afro_pop', label: 'Afropop' }, { value: 'highlife', label: 'Highlife' },
  { value: 'gospel', label: 'Gospel' }, { value: 'hip_hop', label: 'Hip-hop' }, { value: 'reggae', label: 'Reggae' },
  { value: 'pop', label: 'Pop' }, { value: 'rnb', label: 'R&B' },
  { value: 'dancehall', label: 'Dancehall' }, { value: 'drill', label: 'Drill' },
  { value: 'trap', label: 'Trap' }, { value: 'house', label: 'House' },
  { value: 'edm', label: 'EDM' }, { value: 'reggaeton', label: 'Reggaeton' },
  { value: 'latin_pop', label: 'Latin pop' }, { value: 'country', label: 'Country' },
  { value: 'rock', label: 'Rock' }, { value: 'soul', label: 'Soul' },
];

interface Material {
  id: string;
  role: string;
  genre: string | null;
  bpm: number | null;
  keySignature: string | null;
  bars: number | null;
  source: string;
  /** TRUE origin: forged (real engine) / synth (owned bridge) / artist_stem / provider_stem. */
  origin?: string;
  /** ≥2 = a deliberately DIFFERENT take of the same role (variation B/C/D…). */
  variant?: number | null;
  url: string;
}

/** The API's truth receipt for the shelf — counted from the same rows it returns. */
interface Integrity {
  totalLoops: number;
  distinctFiles: number;
  duplicates: number;
  byOrigin: Record<string, number>;
}

const ORIGIN_LABEL: Record<string, string> = { forged: 'forged', synth: 'synth', artist_stem: 'your stems', provider_stem: 'provider stems' };

interface Project { id: string; title: string; genre: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROLE_LABEL: Record<string, string> = { drums: '🥁 Drums', log_drum: '🪵 Log drum', bass: '🎸 Bass', percussion: '🪘 Percussion', chords: '🎹 Chords', other: '🎛 Other' };

export default function MaterialsPage() {
  const api = useApi();
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [genre, setGenre] = useState('amapiano');
  const [bpm, setBpm] = useState(112);
  const [forging, setForging] = useState<string>(''); // status line
  const [forgeErr, setForgeErr] = useState('');
  const [forgeNote, setForgeNote] = useState(''); // informational, not an error
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [assembling, setAssembling] = useState('');
  const [assembleErr, setAssembleErr] = useState('');
  const [beatUrl, setBeatUrl] = useState('');
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [autoPicked, setAutoPicked] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ materials: Material[]; integrity?: Integrity }>('/materials');
      setMaterials(res.materials);
      setIntegrity(res.integrity ?? null);
      setLoadErr('');
      return res.materials;
    } catch (e) {
      setMaterials(null);
      setLoadErr((e as Error).message.slice(0, 160));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Land where the shelf already has material: pick the fullest genre and
    // its median bpm, so Assemble works on arrival instead of defaulting into
    // a guaranteed "not enough material".
    void load().then((mats) => {
      if (!mats?.length || autoPicked) return;
      const byGenre = new Map<string, Material[]>();
      for (const m of mats) if (m.genre) byGenre.set(m.genre, [...(byGenre.get(m.genre) ?? []), m]);
      const best = [...byGenre.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      if (best) {
        setGenre(best[0]);
        const bpms = best[1].map((m) => m.bpm).filter((b): b is number => !!b).sort((a, b) => a - b);
        if (bpms.length) setBpm(bpms[Math.floor(bpms.length / 2)]!);
      }
      setAutoPicked(true);
    });
    api.get<Project[]>('/projects').then((p) => {
      setProjects(p);
      if (p[0]) setProjectId(p[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function jobError(errorJson: unknown): string {
    if (typeof errorJson === 'string') return errorJson;
    const o = errorJson as { message?: string; error?: string } | null;
    return o?.message || o?.error || 'job failed';
  }

  async function pollJob(jobId: string, tries = 60): Promise<Record<string, unknown>> {
    for (let i = 0; i < tries; i++) {
      await sleep(6000);
      const job = await api.get<{ status: string; outputJson?: Record<string, unknown>; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') return job.outputJson ?? {};
      if (job.status === 'FAILED') throw new Error(jobError(job.errorJson));
    }
    throw new Error('timed out — it may still land on the shelf in a few minutes');
  }

  async function forgeKit() {
    if (forging) return;
    setForging('Starting the forge…');
    setForgeErr('');
    setForgeNote('');
    try {
      const res = await api.post<{ forging: Array<{ role: string; jobId: string }>; keySignature?: string; note?: string }>('/materials/forge', { genre, bpm });
      const total = res.forging.length;
      // Already-stocked kit: the API returns no jobs (and no key) plus a note —
      // relay that, never "Forging 0 loops in undefined".
      if (!total) {
        setForging('');
        setForgeNote(res.note ?? 'Kit already stocked — assembling from the shelf.');
        void load();
        return;
      }
      let ok = 0;
      const failed: string[] = [];
      setForging(`Forging ${total} loops${res.keySignature ? ` in ${res.keySignature}` : ''} — they land one at a time (rate-limit spacing)…`);
      await Promise.allSettled(res.forging.map(async (f) => {
        try {
          await pollJob(f.jobId, 80);
          ok += 1;
        } catch (e) {
          failed.push(`${f.role}: ${(e as Error).message.slice(0, 80)}`);
        }
        setForging(`${ok + failed.length}/${total} finished (${ok} on the shelf${failed.length ? `, ${failed.length} failed` : ''})…`);
        void load();
      }));
      setForging('');
      // Honest ending — a failed loop is reported, never counted as forged.
      if (failed.length) setForgeErr(`${ok}/${total} loops landed. Failed: ${failed.join(' · ')}`);
      void load();
    } catch (e) {
      setForging('');
      setForgeErr(`${(e as Error).message.slice(0, 160)} — any loops already queued may still arrive; the shelf refreshes below.`);
      void load();
    }
  }

  function friendlyAssembleError(msg: string): string {
    if (/not_enough_material/.test(msg)) return `Not enough ${genre.replace(/_/g, ' ')} loops near ${bpm}bpm on the shelf — forge a kit at this bpm first.`;
    if (/insufficient_credits/.test(msg)) return 'Daily generation cap reached — try again tomorrow or raise the cap in Settings.';
    return msg.slice(0, 200);
  }

  async function assemble() {
    if (assembling || !projectId) return;
    setAssembling('Arranging your material…');
    setAssembleErr('');
    setBeatUrl('');
    setArrangement([]);
    try {
      const res = await api.post<{ jobId: string; arrangement: string[] | string }>('/materials/assemble', { projectId, genre, bpm });
      if (Array.isArray(res.arrangement)) setArrangement(res.arrangement);
      setAssembling('Placing the loops (time-stretch, layer, build)…');
      const out = await pollJob(res.jobId, 40);
      setBeatUrl(String(out.url ?? ''));
      setAssembling('');
    } catch (e) {
      setAssembling('');
      setAssembleErr(friendlyAssembleError((e as Error).message));
    }
  }

  const shelf = new Map<string, Material[]>();
  for (const m of materials ?? []) {
    const g = m.genre ?? 'unknown';
    shelf.set(g, [...(shelf.get(g) ?? []), m]);
  }
  // Can the CURRENT genre+bpm actually assemble? (≥2 roles within ±15% bpm —
  // same rule as the API, so the button never invites a guaranteed 400.)
  const usable = (materials ?? []).filter((m) => m.genre === genre && m.bpm && Math.abs(m.bpm - bpm) / bpm <= 0.15);
  const usableRoles = new Set(usable.map((m) => m.role));
  const canAssemble = usableRoles.size >= 2;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-3xl">
        Material <span className="text-gradient">shelf</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Real, owned loops — forged in isolation (and in key) or harvested from your own stems. When you assemble,
        <span className="text-slate-200"> the studio arranges the exact beat from this shelf</span>: same loops in, same beat out. No hallucination — and the
        assembly itself never needs the AI brain or its credits (Claude only suggests a smarter arrangement when it&apos;s reachable).
      </p>
      {/* TRUTH RECEIPT — the shelf counted honestly: every loop, every unique file,
          every duplicate, and who made what. Duplicates flag amber, never hidden. */}
      {integrity && integrity.totalLoops > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          <span className="text-slate-300">{integrity.totalLoops} loop{integrity.totalLoops === 1 ? '' : 's'}</span>
          {' · '}{integrity.distinctFiles} distinct file{integrity.distinctFiles === 1 ? '' : 's'}
          {' · '}<span className={integrity.duplicates > 0 ? 'text-amber-400' : 'text-emerald-400'}>{integrity.duplicates} duplicate{integrity.duplicates === 1 ? '' : 's'}</span>
          {' — '}{Object.entries(integrity.byOrigin).map(([o, n]) => `${ORIGIN_LABEL[o] ?? o} ${n}`).join(' / ')}
        </p>
      )}

      {/* Forge + assemble controls */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl glass p-4">
          <div className="flex items-center gap-2 font-grotesk text-sm font-medium text-slate-200"><Hammer className="h-4 w-4 text-afrobrand-400" /> Forge a kit</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
              {GENRES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
            <input type="number" value={bpm} min={60} max={180} onChange={(e) => setBpm(Number(e.target.value) || 108)} className="w-24 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200" />
            <span className="text-xs text-slate-500">bpm</span>
            <button onClick={() => void forgeKit()} disabled={!!forging} className="flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50">
              {forging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />} Forge kit
            </button>
          </div>
          {forging && <div className="mt-2 text-xs text-afrobrand-300">{forging}</div>}
          {forgeNote && <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">{forgeNote}</div>}
          {forgeErr && <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">{forgeErr}</div>}
          <p className="mt-2 text-[11px] text-slate-500">One isolated loop per role (~$0.10 each). Loops arrive ~30s apart — the provider rate-limits, we pace it.</p>
        </div>

        <div className="rounded-2xl glass p-4">
          <div className="flex items-center gap-2 font-grotesk text-sm font-medium text-slate-200"><Layers className="h-4 w-4 text-afrobrand-400" /> Assemble the exact beat</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="max-w-[220px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button onClick={() => void assemble()} disabled={!!assembling || !projectId || !canAssemble} className="flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50">
              {assembling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Assemble
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">
            Uses the genre + bpm from the Forge card.{' '}
            {canAssemble
              ? <span className="text-emerald-400">{usableRoles.size} roles ready at {bpm}bpm: {[...usableRoles].join(', ')}</span>
              : <span className="text-amber-400">needs 2+ roles near {bpm}bpm — forge a {genre.replace(/_/g, ' ')} kit first</span>}
          </div>
          {assembling && <div className="mt-2 text-xs text-afrobrand-300">{assembling}</div>}
          {assembleErr && <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{assembleErr}</div>}
          {arrangement.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {arrangement.map((s, i) => <span key={i} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{s}</span>)}
            </div>
          )}
          {beatUrl && (
            <div className="mt-3">
              <div className="text-xs text-emerald-400">Your exact beat — assembled from the shelf:</div>
              <audio controls preload="none" src={beatUrl} className="mt-1.5 w-full" />
            </div>
          )}
        </div>
      </div>

      {/* The shelf */}
      {loadErr && <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{loadErr}</div>}
      {materials === null && !loadErr && <div className="mt-8 text-sm text-slate-500">Loading the shelf…</div>}
      {materials !== null && materials.length === 0 && (
        <div className="mt-8 rounded-2xl glass p-6 text-sm text-slate-400">The shelf is empty — forge your first kit above.</div>
      )}
      {[...shelf.entries()].map(([g, items]) => (
        <section key={g} className="mt-8">
          <h2 className="font-grotesk text-lg font-medium text-slate-200">{g.replace(/_/g, ' ')} <span className="text-xs text-slate-500">({items.length} loop{items.length === 1 ? '' : 's'})</span></h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((m) => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between text-sm text-slate-200">
                  <span className="flex items-center gap-1.5">
                    {ROLE_LABEL[m.role] ?? m.role}
                    {/* Variant chip — this loop is a deliberately DIFFERENT take of its role. */}
                    {(m.variant ?? 0) >= 2 && <span className="rounded bg-white/10 px-1 py-px text-[9px] font-medium text-afrobrand-300">v{m.variant}</span>}
                  </span>
                  {/* TRUE origin badge — synth-bridge loops say SYNTH, never FORGED;
                      stems say whose they really are. */}
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {(() => {
                      const o = m.origin ?? (m.source === 'artist_stem' ? 'artist_stem' : m.source === 'provider_stem' ? 'provider_stem' : 'forged');
                      return o === 'artist_stem' ? 'your stem' : o === 'provider_stem' ? 'provider stem' : o === 'synth' ? 'synth' : 'forged';
                    })()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {m.bpm ? `${m.bpm}bpm` : ''}{m.keySignature ? ` · ${m.keySignature}` : ''}{m.bars ? ` · ${m.bars} bars` : ''}
                </div>
                <audio controls src={m.url} className="mt-2 w-full" preload="none" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
