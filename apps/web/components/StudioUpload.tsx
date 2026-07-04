'use client';

/**
 * Bring-your-own-audio panel for a project.
 *
 *  • Upload your own beat / instrumental (WAV/MP3/…) — it's stored authentic,
 *    auto-approved, and used verbatim through mix + master. Nothing is invented.
 *  • Record a vocal straight in the browser (MediaRecorder) or upload a take.
 *
 * Files go straight to object storage via a presigned PUT, then we register the
 * asset against the project. Refreshes the page so the new asset shows up.
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
  const [beatStatus, setBeatStatus] = useState<Status>({ kind: 'idle' });
  const [vocalStatus, setVocalStatus] = useState<Status>({ kind: 'idle' });
  const beatInput = useRef<HTMLInputElement>(null);
  const vocalInput = useRef<HTMLInputElement>(null);

  // ---- recording ----------------------------------------------------------
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function uploadBeat(file: File) {
    setBeatStatus({ kind: 'uploading', pct: 0 });
    try {
      const { key } = await api.uploadToStorage(file, 'beat', (f) =>
        setBeatStatus({ kind: 'uploading', pct: Math.round(f * 100) })
      );
      await api.post(`/projects/${projectId}/beats/upload`, {
        key,
        format: guessFormat(file.name),
        title: file.name.replace(/\.[^.]+$/, ''),
        ...(bpm ? { bpm: Number(bpm) } : {}),
        ...(keySig ? { keySignature: keySig } : {}),
      });
      setBeatStatus({ kind: 'done', msg: 'Beat added — authentic, auto-approved. Open Studio Chat to finish the song around it.' });
      router.refresh();
    } catch (e) {
      setBeatStatus({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function uploadVocal(file: Blob, label: string) {
    setVocalStatus({ kind: 'uploading', pct: 0 });
    try {
      const { key } = await api.uploadToStorage(file, 'vocal', (f) =>
        setVocalStatus({ kind: 'uploading', pct: Math.round(f * 100) })
      );
      await api.post(`/projects/${projectId}/vocals/upload`, { key, role: 'lead' });
      setVocalStatus({ kind: 'done', msg: `${label} added as lead vocal — mix will use it verbatim.` });
      router.refresh();
    } catch (e) {
      setVocalStatus({ kind: 'error', msg: (e as Error).message });
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
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        void uploadVocal(blob, 'Recording');
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      setVocalStatus({ kind: 'error', msg: `Mic blocked: ${(e as Error).message}` });
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">Bring your own audio</h2>
      <p className="mt-1 text-sm text-slate-400">
        Upload your real beat or instrumental — we build the whole song around it and never replace it.
        Record or upload your own vocal too. Industry-loudness mastering runs on the finished mix.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Beat / instrumental */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="font-display text-lg">Upload beat / instrumental</div>
          <div className="mt-3 flex gap-2">
            <input
              value={bpm}
              onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="BPM (optional)"
              inputMode="numeric"
              className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              value={keySig}
              onChange={(e) => setKeySig(e.target.value)}
              placeholder="Key e.g. Am (optional)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Telling us the tempo/key writes the lyrics + melody in-pocket to your beat.
          </p>
          <input
            ref={beatInput}
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.aiff,.m4a,.ogg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadBeat(e.target.files[0])}
          />
          <button
            onClick={() => beatInput.current?.click()}
            disabled={beatStatus.kind === 'uploading'}
            className="mt-3 w-full rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400 disabled:opacity-50"
          >
            {beatStatus.kind === 'uploading' ? `Uploading… ${beatStatus.pct ?? 0}%` : 'Choose beat file'}
          </button>
          <StatusLine status={beatStatus} />
        </div>

        {/* Vocal */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="font-display text-lg">Record / upload vocal</div>
          <div className="mt-3 flex gap-2">
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={vocalStatus.kind === 'uploading'}
                className="flex-1 rounded-full bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                ● Record vocal
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex-1 animate-pulse rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                ■ Stop & save
              </button>
            )}
            <input
              ref={vocalInput}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadVocal(e.target.files[0], e.target.files[0].name)}
            />
            <button
              onClick={() => vocalInput.current?.click()}
              disabled={vocalStatus.kind === 'uploading' || recording}
              className="flex-1 rounded-full border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {vocalStatus.kind === 'uploading' ? `Uploading… ${vocalStatus.pct ?? 0}%` : 'Upload take'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Recorded/uploaded as the lead vocal. Approve a beat + this vocal, then mix &amp; master.
          </p>
          <StatusLine status={vocalStatus} />
        </div>
      </div>
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  const color =
    status.kind === 'error'
      ? 'text-red-400'
      : status.kind === 'done'
        ? 'text-emerald-400'
        : 'text-slate-400';
  return <div className={`mt-2 text-xs ${color}`}>{status.msg ?? '…'}</div>;
}

function guessFormat(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ['wav', 'mp3', 'flac', 'aiff', 'm4a', 'ogg'].includes(ext ?? '') ? ext! : 'wav';
}
