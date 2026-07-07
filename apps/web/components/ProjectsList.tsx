'use client';

/**
 * Projects list with HONEST delete: optimistic removal that reverts + reports if
 * the server refuses (a silently-failed delete is how "it always comes back").
 */

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Trash2 } from 'lucide-react';

export interface ProjectRow {
  id: string;
  title: string;
  genre: string;
  bpm: number | null;
  artist: { stageName: string };
  _count: { songs: number };
  updatedAt: string;
}

export default function ProjectsList({ initial }: { initial: ProjectRow[] }) {
  const api = useApi();
  const [projects, setProjects] = useState(initial);
  const [armedDelete, setArmedDelete] = useState('');
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  async function remove(p: ProjectRow) {
    if (armedDelete !== p.id) {
      setArmedDelete(p.id);
      setTimeout(() => setArmedDelete((cur) => (cur === p.id ? '' : cur)), 4000);
      return;
    }
    setArmedDelete('');
    const before = projects;
    setProjects((arr) => arr.filter((x) => x.id !== p.id));
    try {
      await api.del(`/projects/${p.id}`);
      flash('Deleted.');
    } catch (e) {
      setProjects(before);
      flash(`Couldn’t delete: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur">{toast}</div>
      )}
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <li key={p.id} className="group rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/projects/${p.id}`} className="font-display text-2xl">
                {p.title}
              </Link>
              <span className="text-xs uppercase tracking-widest text-slate-400">{p.genre.replace(/_/g, ' ')}</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {p.artist.stageName} · {p.bpm ? `${p.bpm} bpm` : 'no BPM'} · {p._count.songs} song{p._count.songs === 1 ? '' : 's'}
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm">
              <Link className="text-afrobrand-400 hover:underline" href={`/studio?project=${p.id}`}>
                Open in Studio Chat →
              </Link>
              <button
                onClick={() => void remove(p)}
                className="ml-auto rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-red-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10"
                title="Delete project"
              >
                <Trash2 className="inline h-3.5 w-3.5" /> {armedDelete === p.id ? 'Really delete?' : 'Delete'}
              </button>
            </div>
          </li>
        ))}
        {projects.length === 0 && (
          <li className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            No projects yet. Create one or jump into Studio Chat.
          </li>
        )}
      </ul>
    </>
  );
}
