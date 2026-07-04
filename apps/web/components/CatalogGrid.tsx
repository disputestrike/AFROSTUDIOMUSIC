'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api';
import { Trash2 } from 'lucide-react';

export interface SongRow {
  id: string;
  title: string;
  status: string;
  artist: string;
  projectId: string;
  projectTitle: string;
  genre: string;
  bpm: number | null;
  audioUrl: string | null;
  coverUrl: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  SKETCH: 'Sketch', DEMO: 'Demo', FULL: 'Full', MIXED: 'Mixed', MASTERED: 'Mastered', RELEASED: 'Released',
};

export default function CatalogGrid({ initial }: { initial: SongRow[] }) {
  const api = useApi();
  const [songs, setSongs] = useState<SongRow[]>(initial);

  async function remove(id: string) {
    if (!confirm('Delete this song?')) return;
    setSongs((s) => s.filter((x) => x.id !== id));
    try {
      await api.del(`/songs/${id}`);
    } catch {
      /* best-effort */
    }
  }

  if (songs.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
        No songs yet. Head to <span className="text-afrobrand-400">Studio Chat</span> and make one.
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {songs.map((s) => (
        <div key={s.id} className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
          <button
            onClick={() => void remove(s.id)}
            title="Delete song"
            className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-slate-300 opacity-0 hover:text-red-400 group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="aspect-square w-full bg-slate-800">
            {s.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.coverUrl} alt={s.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center font-display text-5xl text-slate-700">♪</div>
            )}
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="font-display text-lg leading-tight">{s.title}</div>
              <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                {STATUS_LABEL[s.status] ?? s.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {s.artist} · {s.genre.replace('_', ' ')}{s.bpm ? ` · ${s.bpm} bpm` : ''}
            </div>
            {s.audioUrl ? (
              <audio controls className="mt-3 w-full" src={s.audioUrl} />
            ) : (
              <div className="mt-3 text-xs text-slate-600">No audio rendered yet.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
