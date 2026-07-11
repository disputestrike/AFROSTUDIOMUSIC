'use client';

/**
 * /projects/new — a real route. Without this page Next resolved the "New
 * project" link into projects/[id] with id='new' and the server fetch 500'd.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GENRES } from '@afrohit/shared';
import { useApi } from '@/lib/api';

export default function NewProjectPage() {
  const api = useApi();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('afrobeats');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      const p = await api.post<{ id: string }>('/projects', { title: title.trim().slice(0, 160), genre });
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setErr((e as Error).message.slice(0, 200));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <h1 className="font-display text-4xl">New project</h1>
      <p className="mt-2 text-sm text-slate-400">Name it and pick the lane — the studio opens ready to produce.</p>

      <label className="mb-1 mt-6 block text-sm text-slate-300">Project name</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
        maxLength={160}
        autoFocus
        placeholder="e.g. Midnight in Lekki EP"
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600"
      />

      <label className="mb-1 mt-5 block text-sm text-slate-300">Genre</label>
      <select
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100"
      >
        {GENRES.map((g) => (
          <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>
        ))}
      </select>

      {err && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          Couldn&apos;t create the project: {err}
        </div>
      )}

      <button
        onClick={() => void create()}
        disabled={busy || !title.trim()}
        className="mt-6 rounded-full bg-afrobrand-500 px-5 py-2.5 text-sm font-medium text-ink hover:bg-afrobrand-400 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create project'}
      </button>
    </div>
  );
}
