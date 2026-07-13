'use client';

/**
 * MUMBLE BOOTH — Benjamin's own creation method, productized:
 * "I always start with mumbles and random words when hearing a beat. After I
 * get a vibe I go in and make those mumbles into words."
 *
 * Record (or upload) a hummed/mumbled take → the AI hears the phonetics and
 * the rhythm → converts them into THREE lyric directions that PRESERVE the
 * take's flow (syllables, stresses, line lengths) → pick one → it flows into
 * the from-lyrics production path. Idea first, language after — the proven
 * cure for writer's block.
 */

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Mic, Square, Loader2, UploadCloud, Sparkles } from 'lucide-react';

interface Candidate { title: string; hookLine: string; lyric: string; flowNotes: string }
interface MumbleResult { heard: { transcript: string; bpm: number | null; mood: string | null; genre: string | null }; candidates: Candidate[] }

export function MumbleBooth({ onPick }: { onPick: (lyric: string, title: string) => void }) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micAvailable, setMicAvailable] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MumbleResult | null>(null);
  const MAX_SECS = 30;

  useEffect(() => {
    setMicAvailable(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function scratchProject(): Promise<string> {
    const KEY = 'afrohit.mumbleProject';
    let pid = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (pid) { try { await api.get(`/projects/${pid}`); return pid; } catch { pid = null; } }
    const p = await api.post<{ id: string }>('/projects', { title: '🎤 Mumble booth', genre: 'afrobeats', bpm: 103 });
    localStorage.setItem(KEY, p.id);
    return p.id;
  }

  async function convert(src: Blob | File) {
    setBusy(true);
    setResult(null);
    try {
      const pid = await scratchProject();
      setStatus('Uploading your take…');
      const { publicUrl } = await api.uploadAudioDirect(src as File, 'reference');
      setStatus('🎧 Hearing the rhythm and the phonetics…');
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${pid}/analyze`, { url: publicUrl });
      let heard = false;
      for (let i = 0; i < 72; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const job = await api.get<{ status: string; errorJson?: unknown }>(`/jobs/${jobId}`);
        if (job.status === 'SUCCEEDED') { heard = true; break; }
        if (job.status === 'FAILED') throw new Error(typeof job.errorJson === 'string' ? job.errorJson : 'could not hear the take');
        if (i > 20) setStatus('🎧 Still listening (model warming up)…');
      }
      if (!heard) throw new Error('listening timed out — the model is cold; try again in a minute');
      setStatus('✍️ Turning your mumbles into words (keeping YOUR flow)…');
      const res = await api.post<MumbleResult>(`/projects/${pid}/lyrics/from-mumble`, { analyzeJobId: jobId });
      setResult(res);
      setStatus('');
    } catch (e) {
      setStatus(`Couldn’t convert: ${(e as Error).message.slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (recording || busy) return;
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      mediaRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 2000) void convert(new File([blob], 'mumble.webm', { type: blob.type }));
        else setStatus('Take too short — hum for at least ~8 seconds.');
      };
      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= MAX_SECS) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      setStatus('Mic unavailable — allow microphone access or upload a file.');
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
  }

  return (
    <div className="rounded-2xl glass p-4">
      <p className="text-sm text-slate-400">
        Play your beat out loud (or just feel it), hit record, and <span className="text-slate-200">mumble the melody</span> —
        real words optional. The AI keeps <span className="text-slate-200">your exact flow</span> and offers three ways to turn it into words.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {micAvailable && !recording && (
          <button onClick={() => void startRecording()} disabled={busy} className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50">
            <Mic className="h-4 w-4" /> Record my mumble
          </button>
        )}
        {recording && (
          <button onClick={stopRecording} className="flex items-center gap-2 rounded-full bg-red-500/90 px-5 py-2.5 text-sm font-medium text-white">
            <Square className="h-4 w-4" /> Stop ({MAX_SECS - elapsed}s left)
          </button>
        )}
        <input ref={fileRef} type="file" accept="audio/*,audio/mpeg,.mp3,.wav,.m4a,.ogg,.mpeg,.mpg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void convert(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || recording} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50">
          <UploadCloud className="h-4 w-4" /> or upload a take
        </button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-afrobrand-400" />}
      </div>
      {status && <div className="mt-2 text-xs text-afrobrand-300">{status}</div>}

      {result && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <div className="text-xs text-slate-500">
            Heard: {result.heard.bpm ? `${result.heard.bpm}bpm · ` : ''}{result.heard.mood ?? ''} {result.heard.genre ? `· ${result.heard.genre.replace(/_/g, ' ')}` : ''}
            {result.heard.transcript && <span className="ml-1 italic">“{result.heard.transcript.slice(0, 90)}…”</span>}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {result.candidates.map((c, i) => (
              <div key={i} className="flex flex-col rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-medium text-slate-200">{c.title}</div>
                <div className="mt-1 text-xs text-afrobrand-300">“{c.hookLine}”</div>
                <pre className="mt-2 max-h-36 flex-1 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{c.lyric}</pre>
                <div className="mt-1.5 text-[10px] text-slate-500">{c.flowNotes}</div>
                <button onClick={() => onPick(c.lyric, c.title)} className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-brand-gradient px-3 py-1.5 text-xs font-medium text-ink">
                  <Sparkles className="h-3 w-3" /> Use this — make the song
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
