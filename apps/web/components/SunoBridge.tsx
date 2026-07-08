'use client';

/**
 * SUNO BRIDGE — use your own Suno account (top-tier audio, clean rights) without
 * an API. AfroHit wrote the song; this hands you the Suno-ready Style + Lyrics to
 * paste, then takes the finished file back and masters + scores it.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { X, Copy, Check, ExternalLink, UploadCloud, Loader2 } from 'lucide-react';

interface Props {
  songId: string;
  projectId: string;
  onClose: () => void;
  onDone?: () => void;
}

interface Export {
  title: string;
  stylePrompt: string;
  lyricsForSuno: string;
  hasLyrics: boolean;
  tips: string;
}

export function SunoBridge({ songId, projectId, onClose, onDone }: Props) {
  const api = useApi();
  const [data, setData] = useState<Export | null>(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get<Export>(`/songs/${songId}/suno-export`).then(setData).catch(() => setErr('Could not load the Suno export.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  }

  async function bringBack(file: File | undefined) {
    if (!file) return;
    setPhase('uploading');
    setMsg('Uploading your Suno file…');
    try {
      const { key } = await api.uploadToStorage(file, 'beat');
      await api.post(`/projects/${projectId}/mixes/upload`, { key, songId, autoMaster: true });
      setPhase('done');
      setMsg('Got it — mastering (competitive −9) + running Will-it-hit now. It updates in your Catalog in ~1 min.');
      onDone?.();
    } catch (e) {
      setPhase('error');
      setMsg((e as Error).message.slice(0, 160) || 'Upload failed — try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mt-8 w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0b12] p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl">Take to Suno</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {err && <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{err}</div>}
        {!data && !err && <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Preparing your Suno pack…</div>}

        {data && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Generate <span className="text-slate-200">“{data.title}”</span> in your own Suno account — best audio, and the rights stay yours. Paste these two fields, then bring the file back to master + score it.
            </p>

            {/* Style */}
            <Field label="Style of Music" value={data.stylePrompt} copied={copied === 'style'} onCopy={() => copy(data.stylePrompt, 'style')} />
            {/* Lyrics */}
            {data.hasLyrics ? (
              <Field label="Lyrics" value={data.lyricsForSuno} multiline copied={copied === 'lyrics'} onCopy={() => copy(data.lyricsForSuno, 'lyrics')} />
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-200">No lyrics on this song yet — write them first, then take it to Suno.</div>
            )}

            <a href="https://suno.com/create" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
              Open Suno <ExternalLink className="h-3.5 w-3.5" />
            </a>

            <p className="rounded-lg bg-white/5 p-2.5 text-[11px] leading-relaxed text-slate-400">{data.tips}</p>

            {/* Bring it back */}
            <div className="border-t border-white/10 pt-4">
              <div className="mb-2 text-sm font-medium text-slate-200">Bring it back from Suno</div>
              {phase === 'done' ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-300">{msg}</div>
              ) : (
                <>
                  <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-5 text-sm text-slate-300 hover:bg-white/10 ${phase === 'uploading' ? 'pointer-events-none opacity-60' : ''}`}>
                    {phase === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-5 w-5 text-afrobrand-400" />}
                    {phase === 'uploading' ? 'Uploading…' : 'Drop the Suno file (mp3/wav) — masters + scores it'}
                    <input type="file" accept="audio/*" className="hidden" disabled={phase === 'uploading'} onChange={(e) => bringBack(e.target.files?.[0])} />
                  </label>
                  {phase === 'error' && <div className="mt-2 text-xs text-red-400">{msg}</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, multiline, copied, onCopy }: { label: string; value: string; multiline?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <button onClick={onCopy} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300 hover:bg-white/10">
          {copied ? <><Check className="h-3 w-3 text-emerald-400" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
        </button>
      </div>
      <div className={`whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2.5 text-xs text-slate-200 ${multiline ? 'max-h-52 overflow-y-auto' : ''}`}>{value}</div>
    </div>
  );
}
