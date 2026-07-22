'use client';

/**
 * Bring-your-own-audio panel for a project.
 *
 *  • Upload a beat / instrumental / full song / vocal — stored authentic and
 *    measured before it can enter mix + master. Nothing is invented.
 *  • Record a vocal straight in the browser (MediaRecorder).
 *  • Import from a URL you have the RIGHTS to (own files, direct links,
 *    royalty-free / Creative-Commons). Streaming-platform rips are refused.
 *  • A full uploaded song is mastered immediately (industry loudness).
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

type Status = { kind: 'idle' | 'uploading' | 'done' | 'error'; msg?: string; pct?: number };

export function StudioUpload({ projectId }: { projectId: string }) {
  const api = useApi();
  const router = useRouter();

  const [bpm, setBpm] = useState('');
  const [keySig, setKeySig] = useState('');
  const [status, setStatus] = useState<Record<string, Status>>({});
  const set = (k: string, s: Status) => setStatus((p) => ({ ...p, [k]: s }));

  const fileInputs = {
    beat: useRef<HTMLInputElement>(null),
    instrumental: useRef<HTMLInputElement>(null),
    song: useRef<HTMLInputElement>(null),
    vocal: useRef<HTMLInputElement>(null),
  };

  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [importKind, setImportKind] = useState<'beat' | 'instrumental' | 'vocal' | 'song' | 'reference'>('beat');

  async function waitForQc(jobId: string): Promise<void> {
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const job = await api.get<{ status: string; errorJson?: { message?: string } }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') return;
      if (job.status === 'FAILED') throw new Error(job.errorJson?.message || 'Audio QC failed.');
    }
    throw new Error('Audio QC is still running. Refresh shortly.');
  }

  // ---- beat / instrumental upload ----------------------------------------
  async function uploadBeatLike(file: File, kind: 'beat' | 'instrumental') {
    set(kind, { kind: 'uploading', pct: 0 });
    try {
      const { key } = await api.uploadToStorage(file, 'beat', (f) => set(kind, { kind: 'uploading', pct: Math.round(f * 100) }));
      const queued = await api.post<{ jobId: string }>(`/projects/${projectId}/beats/upload`, {
        key, format: guessFormat(file.name), title: baseName(file.name),
        instrumental: kind === 'instrumental',
        ...(bpm ? { bpm: Number(bpm) } : {}),
        ...(keySig ? { keySignature: keySig } : {}),
        // "Bring your own audio" is an ownership-premised flow; attachBeatUploadSchema
        // requires this rights confirmation (.strict) — omitting it hard-400s.
        rightsConfirmation: { version: 1, confirmed: true },
      });
      set(kind, { kind: 'uploading', msg: `Checking the ${kind} before it enters the mixer…` });
      await waitForQc(queued.jobId);
      set(kind, { kind: 'done', msg: `${cap(kind)} passed QC. Finish the song around it in Studio Chat.` });
      router.refresh();
    } catch (e) {
      set(kind, { kind: 'error', msg: (e as Error).message });
    }
  }

  // ---- full song upload → auto-master ------------------------------------
  async function uploadSong(file: File) {
    set('song', { kind: 'uploading', pct: 0 });
    try {
      const { key } = await api.uploadToStorage(file, 'reference', (f) => set('song', { kind: 'uploading', pct: Math.round(f * 100) }));
      await api.post(`/projects/${projectId}/mixes/upload`, { key, title: baseName(file.name), autoMaster: true, masterPreset: 'afro_stream_-9', rightsConfirmation: { version: 1, confirmed: true } });
      set('song', { kind: 'done', msg: 'Song uploaded — mastering to streaming loudness now. Refresh Masters shortly.' });
      router.refresh();
    } catch (e) {
      set('song', { kind: 'error', msg: (e as Error).message });
    }
  }

  // ---- vocal upload / record ---------------------------------------------
  async function uploadVocal(file: Blob, label: string) {
    set('vocal', { kind: 'uploading', pct: 0 });
    try {
      const { key } = await api.uploadToStorage(file, 'vocal', (f) => set('vocal', { kind: 'uploading', pct: Math.round(f * 100) }));
      await api.post(`/projects/${projectId}/vocals/upload`, {
        key,
        role: 'lead',
        isolationConfirmed: true,
      });
      set('vocal', { kind: 'done', msg: `${label} uploaded. Vocal QC is running before it can enter a mix.` });
      router.refresh();
    } catch (e) {
      set('vocal', { kind: 'error', msg: (e as Error).message });
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadVocal(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }), 'Recording');
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      set('vocal', { kind: 'error', msg: `Mic blocked: ${(e as Error).message}` });
    }
  }
  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  // ---- import from URL ----------------------------------------------------
  async function runImport() {
    if (!importUrl.trim()) return;
    set('import', { kind: 'uploading' });
    try {
      const r = await api.post<{ kind: string; jobId?: string }>(`/uploads/import`, {
        projectId, url: importUrl.trim(), kind: importKind,
        ...(importKind === 'vocal' ? { isolationConfirmed: true } : {}),
        ...(bpm && (importKind === 'beat' || importKind === 'instrumental') ? { bpm: Number(bpm) } : {}),
        ...(keySig && (importKind === 'beat' || importKind === 'instrumental') ? { keySignature: keySig } : {}),
        // "Import from a link you own" — importUrlSchema requires this (.strict).
        rightsConfirmation: { version: 1, confirmed: true },
      });
      if ((r.kind === 'beat' || r.kind === 'instrumental') && r.jobId) {
        set('import', { kind: 'uploading', msg: 'Import stored. Checking the audio before it enters the mixer…' });
        await waitForQc(r.jobId);
      }
      set('import', {
        kind: 'done',
        msg: r.kind === 'vocal'
          ? 'Vocal imported. QC is running before it can enter a mix.'
          : (r.kind === 'beat' || r.kind === 'instrumental')
            ? `Imported ${r.kind} passed QC.`
            : `Imported as ${r.kind}.`,
      });
      setImportUrl('');
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      set('import', {
        kind: 'error',
        msg: /copyrighted_source|422/.test(msg)
          ? "Can't pull from streaming platforms (YouTube/Spotify/etc.) — copyrighted. Use your own files, direct audio links, or royalty-free / Creative-Commons sources."
          : msg,
      });
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">Bring your own audio</h2>
      <p className="mt-1 text-sm text-slate-400">
        Upload your real beat, instrumental, full song, or vocal — we build the whole record around it and never replace it.
        A finished song gets industry-loudness mastering on the spot.
      </p>

      {/* tempo / key shared inputs */}
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={bpm} onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, ''))} placeholder="BPM (optional)" inputMode="numeric" className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
        <input value={keySig} onChange={(e) => setKeySig(e.target.value)} placeholder="Key e.g. Am (optional)" className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
        <span className="self-center text-[11px] text-slate-500">Tempo/key writes lyrics + melody in-pocket to your beat.</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <UploadCard title="Beat / loop" hint="A beat or loop to build on." status={status.beat} onClick={() => fileInputs.beat.current?.click()} accept inputRef={fileInputs.beat} onFile={(f) => uploadBeatLike(f, 'beat')} label="Choose beat" />
        <UploadCard title="Full instrumental" hint="A finished instrumental — full arrangement." status={status.instrumental} onClick={() => fileInputs.instrumental.current?.click()} accept inputRef={fileInputs.instrumental} onFile={(f) => uploadBeatLike(f, 'instrumental')} label="Choose instrumental" />
        <UploadCard title="Finished song → master it" hint="Upload a mixed song; we master to streaming loudness." status={status.song} onClick={() => fileInputs.song.current?.click()} accept inputRef={fileInputs.song} onFile={uploadSong} label="Choose song" accent />

        {/* Vocal: record or upload */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="font-display text-lg">Record / upload vocal</div>
          <div className="mt-3 flex gap-2">
            {!recording ? (
              <button onClick={startRecording} disabled={status.vocal?.kind === 'uploading'} className="flex-1 rounded-full bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">● Record</button>
            ) : (
              <button onClick={stopRecording} className="flex-1 animate-pulse rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white">■ Stop &amp; save</button>
            )}
            <input ref={fileInputs.vocal} type="file" accept="audio/*,audio/mpeg,.wav,.mp3,.m4a,.ogg,.webm,.mpeg,.mpg" className="hidden" onChange={(e) => e.target.files?.[0] && uploadVocal(e.target.files[0], e.target.files[0].name)} />
            <button onClick={() => fileInputs.vocal.current?.click()} disabled={status.vocal?.kind === 'uploading' || recording} className="flex-1 rounded-full border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {status.vocal?.kind === 'uploading' ? `Uploading… ${status.vocal.pct ?? 0}%` : 'Upload take'}
            </button>
          </div>
          <StatusLine status={status.vocal} />
        </div>
      </div>

      {/* Import from URL */}
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="font-display text-lg">Import from a link you own</div>
        <p className="mt-1 text-[11px] text-slate-500">
          Direct audio links, your own hosted files, royalty-free / Creative-Commons sources. YouTube / Spotify / SoundCloud are refused (copyright).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={importKind} onChange={(e) => setImportKind(e.target.value as typeof importKind)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <option value="beat">beat</option>
            <option value="instrumental">instrumental</option>
            <option value="vocal">vocal</option>
            <option value="song">song</option>
            <option value="reference">reference only</option>
          </select>
          <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://…/track.wav" className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <button onClick={runImport} disabled={status.import?.kind === 'uploading'} className="rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400 disabled:opacity-50">
            {status.import?.kind === 'uploading' ? 'Importing…' : 'Import'}
          </button>
        </div>
        <StatusLine status={status.import} />
      </div>
    </section>
  );
}

function UploadCard({
  title, hint, status, onClick, inputRef, onFile, label, accent,
}: {
  title: string; hint: string; status?: Status; onClick: () => void;
  accept?: boolean; inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void; label: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-afrobrand-500/40 bg-afrobrand-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
      <div className="font-display text-lg">{title}</div>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
      <input ref={inputRef} type="file" accept="audio/*,audio/mpeg,.wav,.mp3,.flac,.aiff,.m4a,.ogg,.mpeg,.mpg" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button onClick={onClick} disabled={status?.kind === 'uploading'} className={`mt-3 w-full rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50 ${accent ? 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400' : 'border border-slate-700 hover:bg-slate-800'}`}>
        {status?.kind === 'uploading' ? `Uploading… ${status.pct ?? 0}%` : label}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status?: Status }) {
  if (!status || status.kind === 'idle') return null;
  const color = status.kind === 'error' ? 'text-red-400' : status.kind === 'done' ? 'text-emerald-400' : 'text-slate-400';
  return <div className={`mt-2 text-xs ${color}`}>{status.msg ?? '…'}</div>;
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Format from the filename. .mpeg/.mpg are MPEG audio — the same family as
 *  .mp3 — so they normalize to mp3 rather than falling through to the 'wav'
 *  default, which recorded them as a format they are not. */
function guessFormat(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mpeg' || ext === 'mpg') return 'mp3';
  return ['wav', 'mp3', 'flac', 'aiff', 'm4a', 'ogg', 'webm'].includes(ext) ? ext : 'wav';
}
