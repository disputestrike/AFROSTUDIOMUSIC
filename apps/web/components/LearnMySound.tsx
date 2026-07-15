'use client';

/**
 * LEARN MY SOUND — the onboarding wedge.
 *
 * Drop 3–10 of YOUR OWN songs (you must own or license them). The studio
 * deep-listens to each (drums, groove, bass, vocal, arrangement), stores every
 * one as a SoundReference, and from then on every generated song pulls toward
 * YOUR sound. The Sound Profile card shows exactly what it has learned so far —
 * proof, not promises. Files are analyzed sequentially so provider load stays
 * gentle; each file's status is visible the whole way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Loader2, Check, X, UploadCloud, Brain } from 'lucide-react';
import { OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION } from '@afrohit/shared';

interface QueueItem {
  name: string;
  file: File;
  status: 'waiting' | 'uploading' | 'listening' | 'learned' | 'failed';
  note?: string;
}

interface SoundProfile {
  totalReferences: number;
  genres: Array<{ genre: string; count: number }>;
  traits: Array<{ genre: string; trait: string; learnedAt: string }>;
  lastLearnedAt: string | null;
}

export function LearnMySound({ projectId }: { projectId: string }) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [profile, setProfile] = useState<SoundProfile | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await api.get<SoundProfile>('/taste/sound-profile'));
    } catch {
      /* profile is best-effort */
    }

  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  function setItem(i: number, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function pollJob(jobId: string): Promise<void> {
    for (let i = 0; i < 72; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const job = await api.get<{ status: string; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') return;
      if (job.status === 'FAILED') throw new Error(typeof job.errorJson === 'string' ? job.errorJson : 'listen failed');
    }
    throw new Error('timed out — the model is warming up; this file can be retried');
  }

  async function runQueue(items: QueueItem[]) {
    if (!rightsConfirmed) return;
    setRunning(true);
    for (let i = 0; i < items.length; i++) {
      try {
        setItem(i, { status: 'uploading' });
        const { publicUrl } = await api.uploadAudioDirect(items[i]!.file, 'reference');
        setItem(i, { status: 'listening' });
        const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/analyze`, {
          url: publicUrl,
          rightsConfirmation: {
            version: OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION,
            confirmed: true,
          },
        });
        await pollJob(jobId);
        setItem(i, { status: 'learned' });
        void loadProfile(); // profile grows live as each song lands
      } catch (e) {
        setItem(i, { status: 'failed', note: (e as Error).message.slice(0, 140) });
      }
    }
    setRunning(false);
    void loadProfile();
  }

  function onFiles(list: FileList | null) {
    if (!list?.length || running || !rightsConfirmed) return;
    const items: QueueItem[] = [...list].slice(0, 10).map((f) => ({ name: f.name, file: f, status: 'waiting' }));
    setQueue(items);
    void runQueue(items);
  }

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-display text-2xl">
        <Brain className="h-6 w-6 text-afrobrand-400" /> Learn <span className="text-gradient">my</span> sound
      </h2>
      <p className="mt-1 max-w-xl text-sm text-slate-400">
        Drop 3–10 of <span className="text-slate-200">your own songs</span> (yours or licensed — never someone else&apos;s).
        The studio deep-listens to each one — drums, groove, bass, vocal, arrangement — and from then on,
        <span className="text-slate-200"> every new song pulls toward your sound</span>. It compounds: the more you feed it, the more it sounds like you.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <input ref={fileRef} type="file" multiple accept="audio/*,audio/mpeg,.wav,.mp3,.m4a,.ogg,.flac,.mpeg,.mpg" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <label className="mb-3 flex items-start gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            disabled={running}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
          />
          <span>
            I confirm I own or control the rights needed to use every selected recording for sound learning (confirmation v{OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION}).
          </span>
        </label>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={running || !rightsConfirmed}
          className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          <UploadCloud className="h-4 w-4" /> {running ? 'Learning…' : 'Upload my songs'}
        </button>

        {queue.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {queue.map((it, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                {it.status === 'learned' ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  : it.status === 'failed' ? <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  : it.status === 'waiting' ? <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-600" />
                  : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-afrobrand-400" />}
                <span className="truncate text-slate-300">{it.name}</span>
                <span className="ml-auto shrink-0 text-slate-500">
                  {it.status === 'uploading' ? 'uploading…' : it.status === 'listening' ? '🎧 listening…' : it.status === 'learned' ? 'learned ✓' : it.status === 'failed' ? (it.note || 'failed') : 'queued'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* The proof: what it knows about YOUR sound so far. */}
        {profile && profile.totalReferences > 0 && (
          <div className="mt-5 border-t border-white/5 pt-4">
            <div className="text-xs font-medium uppercase tracking-widest text-slate-500">Your sound profile</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-afrobrand-500/15 px-2.5 py-1 text-xs text-afrobrand-300">{profile.totalReferences} song{profile.totalReferences === 1 ? '' : 's'} learned</span>
              {profile.genres.slice(0, 6).map((g) => (
                <span key={g.genre} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{g.genre.replace(/_/g, ' ')} × {g.count}</span>
              ))}
            </div>
            {profile.traits.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {profile.traits.slice(0, 4).map((t, i) => (
                  <li key={i} className="rounded-lg border border-white/10 bg-black/20 p-2.5 text-xs text-slate-300">
                    <span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{t.genre.replace(/_/g, ' ')}</span>
                    {t.trait}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">Every generation now blends these learned traits into the beat, lyrics and vocal arrangement.</p>
          </div>
        )}
      </div>
    </section>
  );
}
