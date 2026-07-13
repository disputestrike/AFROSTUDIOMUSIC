'use client';

/**
 * TRAINING SESSION — the 1-2 HOUR data-lake feeder.
 *
 * Press start, play songs out loud (a playlist, a set, your crates) for up to
 * two hours. The studio records in ~3.5-minute chunks and, for each chunk:
 *   1. deep-listens (drums, groove, bass, vocal, arrangement → SoundReference)
 *   2. studies the WORDS' craft — storytelling shape, vocabulary registers,
 *      hook mechanics (patterns only, NEVER the words themselves)
 *   3. PURGES the recording — the lake keeps what it learned, never a copy
 *      of anyone's audio.
 * Chunks process in the background while recording continues; the lake grows
 * live on screen. This is the fix for "small words, same words every song".
 */

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Radio, Square, Loader2, Check, X } from 'lucide-react';

interface ChunkRow { n: number; status: 'listening' | 'learning' | 'done' | 'skipped' | 'failed'; note?: string }

const CHUNK_SECS = 210; // ~3.5 min — one song per chunk, Whisper-friendly
const MAX_CHUNKS = 34; // ~2 hours

export function TrainingSession({ projectId }: { projectId: string }) {
  const api = useApi();
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [sounds, setSounds] = useState(0);
  const [words, setWords] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const chunkNoRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stop(), []);

  function setChunk(n: number, patch: Partial<ChunkRow>) {
    setChunks((c) => c.map((x) => (x.n === n ? { ...x, ...patch } : x)));
  }

  async function processChunk(blob: Blob, n: number) {
    try {
      const file = new File([blob], `training-${n}.webm`, { type: blob.type || 'audio/webm' });
      const { publicUrl } = await api.uploadAudioDirect(file, 'reference');
      // purgeAfter: the worker deletes this recording once the recipe is out.
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/analyze`, { url: publicUrl, purgeAfter: true });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const job = await api.get<{ status: string }>(`/jobs/${jobId}`);
        if (job.status === 'SUCCEEDED') break;
        if (job.status === 'FAILED') throw new Error('listen failed');
      }
      setSounds((v) => v + 1);
      setChunk(n, { status: 'learning' });
      const lfa = await api.post<{ learned: boolean; reason?: string; craftTitle?: string }>(`/projects/${projectId}/lyrics/learn-from-analysis`, { analyzeJobId: jobId });
      if (lfa.learned) {
        setWords((v) => v + 1);
        setChunk(n, { status: 'done', note: lfa.craftTitle ?? 'sound + words learned' });
      } else {
        setChunk(n, { status: 'done', note: 'sound learned (no clear vocal in this stretch)' });
      }
    } catch (e) {
      setChunk(n, { status: 'failed', note: (e as Error).message.slice(0, 80) });
    }
  }

  function recordNextChunk() {
    if (!runningRef.current || !streamRef.current || chunkNoRef.current >= MAX_CHUNKS) {
      if (chunkNoRef.current >= MAX_CHUNKS) stop();
      return;
    }
    const n = ++chunkNoRef.current;
    setChunks((c) => [...c, { n, status: 'listening' }]);
    const chunksBuf: Blob[] = [];
    const rec = new MediaRecorder(streamRef.current);
    recRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunksBuf.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksBuf, { type: rec.mimeType || 'audio/webm' });
      if (blob.size > 20_000) void processChunk(blob, n); // skip near-silent chunks
      else setChunk(n, { status: 'skipped', note: 'too quiet — was music playing?' });
      recordNextChunk(); // keep the tape rolling while the last chunk processes
    };
    rec.start();
    setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, CHUNK_SECS * 1000);
  }

  async function start() {
    if (running) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      runningRef.current = true;
      chunkNoRef.current = 0;
      setChunks([]);
      setSounds(0);
      setWords(0);
      setElapsed(0);
      setRunning(true);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      recordNextChunk();
    } catch {
      setChunks([{ n: 0, status: 'failed', note: 'Mic unavailable — allow microphone access.' }]);
    }
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (recRef.current?.state === 'recording') recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const mins = Math.floor(elapsed / 60);

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-display text-2xl">
        <Radio className="h-6 w-6 text-afrobrand-400" /> Training <span className="text-gradient">session</span>
        <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-normal text-slate-400">1–2 hours</span>
      </h2>
      <p className="mt-1 max-w-xl text-sm text-slate-400">
        Press start and <span className="text-slate-200">play songs out loud for an hour or two</span> — a playlist, a DJ set, your crates.
        The studio listens in ~3½-minute stretches and learns BOTH sides of every record: the <span className="text-slate-200">sound</span> (drums,
        groove, bass, vocal) and the <span className="text-slate-200">words</span> (storytelling shape, vocabulary, hook craft — patterns only, never the lines).
        Recordings are <span className="text-slate-200">deleted right after learning</span>; only the lessons stay.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <button onClick={() => void start()} className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">
              <Radio className="h-4 w-4" /> Start the session
            </button>
          ) : (
            <button onClick={stop} className="flex items-center gap-2 rounded-full bg-red-500/90 px-5 py-2.5 text-sm font-medium text-white">
              <Square className="h-4 w-4" /> Stop ({mins}m in)
            </button>
          )}
          {running && <span className="flex items-center gap-1.5 text-xs text-afrobrand-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> listening… keep the music playing</span>}
          {(sounds > 0 || words > 0) && (
            <span className="ml-auto flex gap-2 text-xs">
              <span className="rounded-full bg-afrobrand-500/15 px-2.5 py-1 text-afrobrand-300">{sounds} sound{sounds === 1 ? '' : 's'} learned</span>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">{words} word-craft lesson{words === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>

        {chunks.length > 0 && (
          <ul className="mt-4 max-h-56 space-y-1.5 overflow-y-auto">
            {[...chunks].reverse().map((c) => (
              <li key={c.n} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                {c.status === 'done' ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  : c.status === 'failed' ? <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  : c.status === 'skipped' ? <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-600" />
                  : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-afrobrand-400" />}
                <span className="text-slate-300">Stretch {c.n}</span>
                <span className="ml-auto truncate text-slate-500">
                  {c.status === 'listening' ? 'recording + deep-listening…' : c.status === 'learning' ? 'studying the words…' : c.note ?? c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Runs up to 2 hours (≈34 stretches). Each stretch costs a listen + a study (~$0.05). Check the Data Lake page after — everything lands there.</p>
      </div>
    </section>
  );
}
