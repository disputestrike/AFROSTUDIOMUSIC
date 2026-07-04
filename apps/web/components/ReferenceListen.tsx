'use client';

/**
 * Play a track → the AI listens → understands it → you create from it.
 * Upload a song you have the rights to; the AI hears its BPM/key/genre/mood/
 * energy/instruments, then one tap makes a FRESH original in that vibe.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

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

  async function poll(jobId: string): Promise<Profile> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const job = await api.get<{ status: string; outputJson?: { profile?: Profile }; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED' && job.outputJson?.profile) return job.outputJson.profile;
      if (job.status === 'FAILED') throw new Error(JSON.stringify(job.errorJson ?? 'analyze failed'));
    }
    throw new Error('Timed out listening to the track.');
  }

  async function onFile(file: File) {
    setBusy(true);
    setProfile(null);
    setStatus('Uploading…');
    try {
      const { publicUrl } = await api.uploadToStorage(file, 'reference', (f) =>
        setStatus(`Uploading… ${Math.round(f * 100)}%`)
      );
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

  async function makeFromVibe() {
    if (!profile) return;
    setBusy(true);
    setStatus('Making a fresh original in this vibe…');
    try {
      const bpm = Math.min(Math.max(profile.bpm ?? 103, 60), 180);
      await api.post(`/projects/${projectId}/beats/generate`, {
        genre: 'afrobeats',
        bpm,
        ...(profile.key ? { keySignature: profile.key } : {}),
        vibePrompt: `${profile.genre ? profile.genre + ' — ' : ''}${profile.suggestedVibePrompt}`,
        withStems: false,
      });
      setStatus('✅ A fresh beat is generating in this vibe — check the Beats section shortly.');
      router.refresh();
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
        Drop in a song you have the rights to. The AI actually listens, tells you what it hears, then makes a
        <span className="text-slate-200"> fresh original</span> in that vibe — never a copy.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Choose a track to analyze'}
        </button>
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
            <button
              onClick={makeFromVibe}
              disabled={busy}
              className="w-fit rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-4 py-2 text-sm font-medium text-afrobrand-300 hover:bg-afrobrand-500/20 disabled:opacity-50"
            >
              🎼 Make a fresh song in this vibe
            </button>
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
