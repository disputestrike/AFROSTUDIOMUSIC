'use client';

/**
 * The mixer console — hands-on, DAW-style control.
 *
 * One channel strip per track (beat + vocals): fader, pan, mute/solo, a 3-band
 * EQ, a compressor, and reverb. Drive it yourself, or hit "AI mix it" and the
 * model proposes a full set of channel settings you can then tweak. Render sums
 * it to a real mix you can play; master it from the project page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface Track {
  id: string;
  kind: 'beat' | 'vocal';
  label?: string;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number };
  comp: { on: boolean; threshold: number; ratio: number };
  reverb: number;
}

type Status = { kind: 'idle' | 'loading' | 'ai' | 'rendering' | 'done' | 'error'; msg?: string };

export function Mixer({ projectId }: { projectId: string }) {
  const api = useApi();
  const [songId, setSongId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [mixUrl, setMixUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const r = await api.get<{ songId: string | null; tracks: Track[]; message?: string }>(
        `/projects/${projectId}/mixer`
      );
      setSongId(r.songId);
      setTracks(r.tracks ?? []);
      setStatus({ kind: r.songId ? 'idle' : 'error', msg: r.message });
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }, [api, projectId]);

  useEffect(() => {
    if (open && status.kind === 'loading') void load();
  }, [open, status.kind, load]);

  const patch = (id: string, up: Partial<Track>) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...up } : t)));
  const patchEq = (id: string, band: 'low' | 'mid' | 'high', v: number) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, eq: { ...t.eq, [band]: v } } : t)));
  const patchComp = (id: string, up: Partial<Track['comp']>) =>
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, comp: { ...t.comp, ...up } } : t)));

  async function aiMix() {
    if (!songId) return;
    setStatus({ kind: 'ai', msg: 'AI is dialing in the mix…' });
    try {
      const r = await api.post<{ tracks: Track[] }>(`/projects/${projectId}/mixer/ai`, { songId });
      setTracks(r.tracks);
      setStatus({ kind: 'idle', msg: 'AI mix loaded — tweak anything, then render.' });
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function render() {
    if (!songId) return;
    setStatus({ kind: 'rendering', msg: 'Rendering mix…' });
    setMixUrl(null);
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/mixer/render`, { songId, tracks });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const job = await api.get<{ status: string; outputJson?: { url?: string } }>(`/jobs/${jobId}`);
        if (job.status === 'SUCCEEDED' && job.outputJson?.url) {
          setMixUrl(job.outputJson.url);
          setStatus({ kind: 'done', msg: 'Mix rendered. Master it from the pipeline above.' });
          return;
        }
        if (job.status === 'FAILED') {
          setStatus({ kind: 'error', msg: 'Render failed — check the worker logs.' });
          return;
        }
      }
      setStatus({ kind: 'error', msg: 'Render is taking a while — refresh Mixes shortly.' });
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }

  const busy = status.kind === 'rendering' || status.kind === 'ai' || status.kind === 'loading';

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl">Mixer console</h2>
          <p className="mt-1 text-sm text-slate-400">
            Your hands on the faders — or let AI dial it in. EQ, compression, pan &amp; reverb per track.
          </p>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
        >
          {open ? 'Hide console' : 'Open console'}
        </button>
      </div>

      {open && (
        <div className="mt-4 rounded-2xl glass p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={aiMix}
              disabled={busy || !songId}
              className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
            >
              {status.kind === 'ai' ? 'AI mixing…' : '🎚️ AI mix it'}
            </button>
            <button
              onClick={render}
              disabled={busy || !songId || tracks.length === 0}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              {status.kind === 'rendering' ? 'Rendering…' : 'Render mix'}
            </button>
            <button onClick={load} disabled={busy} className="rounded-full px-3 py-2 text-xs text-slate-400 hover:text-slate-200">
              Reset
            </button>
            {status.msg && (
              <span className={`text-xs ${status.kind === 'error' ? 'text-red-400' : 'text-slate-400'}`}>{status.msg}</span>
            )}
          </div>

          {tracks.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {tracks.map((t) => (
                <ChannelStrip
                  key={t.id}
                  t={t}
                  onPatch={(up) => patch(t.id, up)}
                  onEq={(b, v) => patchEq(t.id, b, v)}
                  onComp={(up) => patchComp(t.id, up)}
                />
              ))}
              <MasterStrip />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">
              {status.kind === 'loading' ? 'Loading tracks…' : 'No tracks yet — generate or upload a beat + vocal first.'}
            </div>
          )}

          {mixUrl && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="mb-1 text-xs text-slate-400">Rendered mix</div>
              <audio controls className="w-full" src={mixUrl} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ChannelStrip({
  t,
  onPatch,
  onEq,
  onComp,
}: {
  t: Track;
  onPatch: (up: Partial<Track>) => void;
  onEq: (band: 'low' | 'mid' | 'high', v: number) => void;
  onComp: (up: Partial<Track['comp']>) => void;
}) {
  return (
    <div className="flex w-[132px] shrink-0 flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="w-full truncate text-center text-xs font-medium" title={t.label}>
        {t.label ?? t.kind}
      </div>
      <div className={`rounded-full px-2 py-0.5 text-[10px] ${t.kind === 'beat' ? 'bg-afrobrand-500/20 text-afrobrand-300' : 'bg-magenta/20 text-pink-300'}`}>
        {t.kind}
      </div>

      {/* EQ */}
      <div className="w-full space-y-1">
        {(['high', 'mid', 'low'] as const).map((band) => (
          <Knob key={band} label={band.toUpperCase()} value={t.eq[band]} min={-12} max={12} step={1} unit="dB" onChange={(v) => onEq(band, v)} />
        ))}
      </div>

      {/* Comp + reverb */}
      <button
        onClick={() => onComp({ on: !t.comp.on })}
        className={`w-full rounded px-2 py-1 text-[10px] ${t.comp.on ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-slate-400'}`}
      >
        COMP {t.comp.on ? 'ON' : 'off'}
      </button>
      <Knob label="VERB" value={t.reverb} min={0} max={1} step={0.05} onChange={(v) => onPatch({ reverb: v })} />

      {/* Pan */}
      <Knob label="PAN" value={t.pan} min={-1} max={1} step={0.1} onChange={(v) => onPatch({ pan: v })} fmt={(v) => (v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} />

      {/* Fader */}
      <div className="flex flex-col items-center">
        <input
          type="range"
          min={-24}
          max={12}
          step={1}
          value={t.gainDb}
          onChange={(e) => onPatch({ gainDb: Number(e.target.value) })}
          className="cursor-pointer accent-afrobrand-500"
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '112px', width: '22px' } as React.CSSProperties}
        />
        <div className="mt-1 text-[10px] tabular-nums text-slate-400">{t.gainDb > 0 ? `+${t.gainDb}` : t.gainDb} dB</div>
      </div>

      {/* Mute / solo */}
      <div className="flex w-full gap-1">
        <button onClick={() => onPatch({ mute: !t.mute })} className={`flex-1 rounded py-1 text-[10px] font-semibold ${t.mute ? 'bg-red-500/80 text-white' : 'bg-white/5 text-slate-400'}`}>M</button>
        <button onClick={() => onPatch({ solo: !t.solo })} className={`flex-1 rounded py-1 text-[10px] font-semibold ${t.solo ? 'bg-gold text-ink' : 'bg-white/5 text-slate-400'}`}>S</button>
      </div>
    </div>
  );
}

function MasterStrip() {
  return (
    <div className="flex w-[120px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-afrobrand-500/30 bg-afrobrand-500/5 p-3 text-center">
      <div className="font-display text-lg">MASTER</div>
      <p className="text-[11px] text-slate-400">
        Sum of all channels. Render here, then master to streaming loudness from the pipeline above.
      </p>
    </div>
  );
}

function Knob({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="flex w-full items-center justify-between gap-1 text-[10px] text-slate-400">
      <span className="w-8 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 flex-1 accent-afrobrand-500" />
      <span className="w-8 shrink-0 text-right tabular-nums text-slate-300">{fmt ? fmt(value) : `${value}${unit ?? ''}`}</span>
    </label>
  );
}
