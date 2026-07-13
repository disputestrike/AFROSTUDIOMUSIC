'use client';

/**
 * WORKSPACE LIBRARY — the right column of the create console (T2, console layout).
 * Your latest songs, always in reach: click ▶ and it plays in the console
 * player under the Create button (the parent owns playback). Auto-refreshes
 * while a render is cooking so new songs appear without a reload.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

export interface LibSong {
  id: string;
  title: string;
  genre: string;
  audioUrl: string | null;
  coverUrl: string | null;
  hitScore: number | null;
  createdAt: string;
}

export default function WorkspaceLibrary({ onPlay, refreshKey, playingUrl }: { onPlay: (s: { title: string; url: string }) => void; refreshKey?: number; playingUrl?: string | null }) {
  const api = useApi();
  const router = useRouter();
  const [songs, setSongs] = useState<LibSong[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.get<LibSong[]>('/songs');
      setSongs(rows.slice(0, 15));
    } catch { /* API not reachable — leave list as-is */ }
    setLoaded(true);
  }, [api]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  // Gentle refresh so a song that finishes in the background shows up.
  useEffect(() => {
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <aside className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">My Workspace</h2>
        <button onClick={() => router.push('/catalog')} className="text-xs text-slate-400 hover:text-slate-200">Open Catalog →</button>
      </div>
      <div className="mt-3 space-y-2">
        {!loaded && <p className="text-sm text-slate-500">Loading your songs…</p>}
        {loaded && songs.length === 0 && <p className="text-sm text-slate-500">No songs yet — create your first on the left.</p>}
        {songs.map((s) => (
          <div key={s.id} className="group flex items-center gap-3 rounded-xl border border-transparent p-2 hover:border-slate-700 hover:bg-slate-900/60">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-800">
              { }
              {s.coverUrl ? <img src={s.coverUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-slate-600">♪</div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-200">{s.title}</div>
              <div className="truncate text-xs text-slate-500 capitalize">{s.genre.replace(/_/g, ' ')}{s.hitScore != null ? ` · ${s.hitScore}/100` : ''}</div>
            </div>
            {s.audioUrl ? (
              // Toggle: playing this row shows ⏹ and clicking STOPS it (the
              // parent clears the console player) — play must always be stoppable.
              <button onClick={() => onPlay({ title: s.title, url: s.audioUrl! })} title={playingUrl === s.audioUrl ? 'Stop' : 'Play'}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${playingUrl === s.audioUrl ? 'border border-white/25 text-slate-200' : 'bg-brand-gradient text-ink shadow-glow'}`}>
                {playingUrl === s.audioUrl ? '⏹' : '▶'}
              </button>
            ) : (
              <span className="shrink-0 text-[10px] text-slate-500">cooking…</span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
