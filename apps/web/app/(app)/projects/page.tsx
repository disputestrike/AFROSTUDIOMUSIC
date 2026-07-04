import Link from 'next/link';
import { apiServer } from '@/lib/api-server';

interface ProjectRow {
  id: string;
  title: string;
  genre: string;
  bpm: number | null;
  artist: { stageName: string };
  _count: { songs: number };
  updatedAt: string;
}

export default async function ProjectsPage() {
  const projects = await apiServer<ProjectRow[]>('/projects').catch(() => [] as ProjectRow[]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400"
        >
          New project
        </Link>
      </div>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <li key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between">
              <Link href={`/projects/${p.id}`} className="font-display text-2xl">
                {p.title}
              </Link>
              <span className="text-xs uppercase tracking-widest text-slate-400">{p.genre.replace('_', ' ')}</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {p.artist.stageName} · {p.bpm ? `${p.bpm} bpm` : 'no BPM'} · {p._count.songs} songs
            </div>
            <div className="mt-4 flex gap-3 text-sm">
              <Link className="text-afrobrand-400 hover:underline" href={`/studio?project=${p.id}`}>
                Open in Studio Chat →
              </Link>
            </div>
          </li>
        ))}
        {projects.length === 0 && (
          <li className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            No projects yet. Create one or jump into Studio Chat.
          </li>
        )}
      </ul>
    </div>
  );
}
