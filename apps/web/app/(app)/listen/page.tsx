'use client';

/**
 * Listen — the Shazam-style front door. Play a track you have the rights to,
 * the AI hears it (BPM/key/genre/mood/instruments), then makes a FRESH original
 * in that vibe. A scratch project is created on arrival so it works standalone.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { ReferenceListen } from '@/components/ReferenceListen';
import { LearnMySound } from '@/components/LearnMySound';

export default function ListenPage() {
  const api = useApi();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // REUSE one persistent listen project — creating a fresh "Reference
        // session" on every visit littered the Projects page (and made deleted
        // junk look like it "came back"). Validate the remembered one still
        // exists (it may have been deleted — deletes must STICK).
        const KEY = 'afrohit.listenProject';
        const remembered = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
        if (remembered) {
          try {
            await api.get(`/projects/${remembered}`);
            if (!cancelled) setProjectId(remembered);
            return;
          } catch {
            localStorage.removeItem(KEY); // deleted or gone — start fresh
          }
        }
        const p = await api.post<{ id: string }>('/projects', { title: '🎧 Listen sessions', genre: 'afrobeats', bpm: 103 });
        localStorage.setItem(KEY, p.id);
        if (!cancelled) setProjectId(p.id);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl">
        Play a track — <span className="text-gradient">the AI listens</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm text-slate-400">
        Like Shazam, but it creates. Play a song out loud from any phone, speaker or device and tap <span className="text-slate-200">Listen now</span> —
        the AI hears it through your mic (or drop a file), reads its BPM, key, genre, mood and instruments, then builds a
        <span className="text-slate-200"> fresh original</span> in that vibe — never a copy.
      </p>

      {err && <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Couldn’t start a session: {err}</div>}
      {!projectId && !err && <div className="mt-8 text-sm text-slate-500">Setting up your session…</div>}
      {projectId && <ReferenceListen projectId={projectId} />}
      {projectId && <LearnMySound projectId={projectId} />}
    </div>
  );
}
