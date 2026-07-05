'use client';

/**
 * Play a track → the AI listens → understands it → you create from it.
 *
 * Two ways in, like a real Shazam:
 *  1. LISTEN NOW — record from the mic whatever is playing in the room (off a
 *     phone, a speaker, in the air). The AI hears it and creates a fresh original.
 *  2. Choose a file — drop in audio you have the rights to.
 * Either way we only extract BPM/key/genre/mood and make an ORIGINAL — never a copy.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { GENRES } from '@afrohit/shared';

/** Map a free-text detected genre to one of our supported lanes. */
function matchGenre(detected?: string | null): string {
  const d = (detected ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!d) return 'afrobeats';
  const hit = GENRES.find((g) => d.includes(g.replace(/_/g, '')) || g.replace(/_/g, '').includes(d));
  if (hit) return hit;
  if (d.includes('piano')) return 'amapiano';
  if (d.includes('dancehall') || d.includes('reggae')) return 'afro_dancehall';
  if (d.includes('rnb') || d.includes('soul')) return 'afro_rnb';
  if (d.includes('gospel')) return 'gospel';
  if (d.includes('hiphop') || d.includes('rap') || d.includes('trap')) return 'hip_hop';
  return 'afrobeats';
}

interface Profile {
  bpm: number | null;
  key: string | null;
  genre: string | null;
  mood: string | null;
  energy: string | null;
  instruments: string[];
  vibe: string;
  suggestedVibePrompt: string;
  raw: string;
}

export function ReferenceListen({ projectId }: { projectId: string }) {
  const api = useApi();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Mic capture (the Shazam "listen to the room" path).
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micAvailable, setMicAvailable] = useState(false);
  const MAX_SECS = 40; // long enough to catch a verse + the chorus

  useEffect(() => {
    setMicAvailable(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function poll(jobId: string): Promise<Profile> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const job = await api.get<{ status: string; outputJson?: { profile?: Profile }; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED' && job.outputJson?.profile) return job.outputJson.profile;
      if (job.status === 'FAILED') throw new Error(JSON.stringify(job.errorJson ?? 'analyze failed'));
    }
    throw new Error('Timed out listening to the track.');
  }

  async function analyzeSource(src: Blob) {
    setBusy(true);
    setProfile(null);
    setStatus('Uploading what I heard…');
    try {
      // Proxy through our API (no R2 CORS needed) for the recording/reference.
      const { publicUrl } = await api.uploadAudioDirect(src, 'reference');
      setStatus('🎧 The AI is listening…');
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/analyze`, { url: publicUrl });
      const p = await poll(jobId);
      setProfile(p);
      setStatus('Here’s what the AI heard:');
    } catch (e) {
      setStatus(`Couldn’t analyze: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function onFile(file: File) {
    void analyzeSource(file);
  }

  // Record ambient audio from the mic (music playing off any device / in the air).
  async function startListening() {
    if (recording || busy) return;
    setProfile(null);
    setStatus('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const mt = mr.mimeType || 'audio/webm';
        const ext = mt.includes('ogg') ? 'ogg' : mt.includes('mp4') ? 'mp4' : 'webm';
        const file = new File(chunksRef.current, `listen.${ext}`, { type: `audio/${ext}` });
        if (file.size < 2000) { setStatus('Didn’t catch enough audio — try again with the song playing.'); return; }
        void analyzeSource(file);
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setElapsed(0);
      setStatus('🎙️ Listening to the room — play the song now…');
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          const n = s + 1;
          if (n >= MAX_SECS) stopListening();
          return n;
        });
      }, 1000);
    } catch (e) {
      setStatus(`I need mic access to listen to the room: ${(e as Error).message}`);
    }
  }

  function stopListening() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }

  async function makeBeat() {
    if (!profile) return;
    setBusy(true);
    setStatus('Making a fresh beat in this vibe…');
    try {
      const bpm = Math.min(Math.max(profile.bpm ?? 103, 60), 180);
      await api.post(`/projects/${projectId}/beats/generate`, {
        genre: matchGenre(profile.genre),
        bpm,
        ...(profile.key ? { keySignature: profile.key } : {}),
        vibePrompt: `${profile.genre ? profile.genre + ' — ' : ''}${profile.suggestedVibePrompt}`,
        withStems: false,
      });
      setStatus('✅ A fresh beat is generating in this vibe. Opening the studio…');
      setTimeout(() => router.push(`/projects/${projectId}`), 1200);
    } catch (e) {
      setStatus(`Couldn’t generate: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function makeFullSong() {
    if (!profile) return;
    setBusy(true);
    setStatus('Writing + producing a full original song in this vibe…');
    try {
      const bpm = Math.min(Math.max(profile.bpm ?? 103, 60), 180);
      const genre = matchGenre(profile.genre);
      const theme = `A fresh ${genre.replace(/_/g, ' ')} song in the vibe of: ${profile.suggestedVibePrompt || profile.vibe}. Catchy, original, never a copy.`;
      await api.post(`/projects/${projectId}/drop`, { theme, count: 1, genre, bpm, withVocals: true });
      setStatus('✅ Full song is being produced (hook → lyrics → sung song). Opening the studio…');
      setTimeout(() => router.push(`/projects/${projectId}`), 1200);
    } catch (e) {
      setStatus(`Couldn’t generate: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">🎧 Play a track — the AI listens</h2>
      <p className="mt-1 text-sm text-slate-400">
        Tap <span className="text-slate-200">Listen now</span> and play the song out loud from any device — the AI hears it through your mic (like Shazam),
        tells you what it hears, then makes a <span className="text-slate-200">fresh original</span> in that vibe — never a copy. Or choose a file.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />

        {/* PRIMARY: listen to whatever is playing in the room / on another device */}
        {recording ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-afrobrand-300">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              Listening… {elapsed}s / {MAX_SECS}s
            </span>
            <button onClick={stopListening} className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
              Stop &amp; analyze
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {micAvailable && (
              <button
                onClick={() => void startListening()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
              >
                🎙️ {busy ? 'Working…' : 'Listen now'}
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
            >
              or choose a file
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Play the song out loud from any phone, speaker, or device — hold your mic near it. The AI listens to the air (like Shazam), then builds a fresh original in that vibe.
        </p>
        {status && <div className="mt-3 text-xs text-slate-400">{status}</div>}

        {profile && (
          <div className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label="BPM" value={profile.bpm ?? '—'} />
              <Stat label="Key" value={profile.key ?? '—'} />
              <Stat label="Genre" value={profile.genre ?? '—'} />
              <Stat label="Mood" value={profile.mood ?? '—'} />
              <Stat label="Energy" value={profile.energy ?? '—'} />
              <Stat label="Instruments" value={profile.instruments?.join(', ') || '—'} />
            </div>
            {profile.vibe && <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-300">“{profile.vibe}”</div>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={makeFullSong}
                disabled={busy}
                className="w-fit rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
              >
                🎤 Make the full sung song in this vibe
              </button>
              <button
                onClick={makeBeat}
                disabled={busy}
                className="w-fit rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-4 py-2 text-sm font-medium text-afrobrand-300 hover:bg-afrobrand-500/20 disabled:opacity-50"
              >
                🎼 Just the beat
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-slate-200" title={String(value)}>{value}</div>
    </div>
  );
}
