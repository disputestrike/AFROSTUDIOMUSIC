'use client';

/**
 * MY WORKSPACE PANE (USERSHELL) — the right half of the consumer Create
 * console: "Workspaces › My Workspace". The user's songs from the SAME
 * catalog API the operator console uses (GET /songs), with search, sort and
 * pagination on top. Rows play through the persistent bottom player.
 *
 * HONESTY: rows show only fields the API actually returns (genre, kind,
 * status, hit score, cover). No engine badge — the songs list does not carry
 * engine class per song, and §1.11 forbids inventing one. No like/share
 * icons — no reaction backend exists.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownWideNarrow, ChevronLeft, ChevronRight, LayoutGrid, Pause, Play, Search, SlidersHorizontal } from 'lucide-react';
import { useApi } from '@/lib/api';
import { usePlayerOptional, type PlayerTrack } from './PlayerContext';

interface PaneSong {
  id: string;
  title: string;
  genre: string;
  artist: string;
  kind?: string;
  status: string;
  projectId: string;
  audioUrl: string | null;
  coverUrl: string | null;
  hitScore?: number | null;
  createdAt: string;
}

const PAGE_SIZE = 8;
type SortKey = 'newest' | 'oldest' | 'title';

function prettyGenre(genre: string): string {
  return genre.replace(/_/g, ' ');
}

export function MyWorkspacePane({ refreshKey }: { refreshKey?: number }) {
  const api = useApi();
  const player = usePlayerOptional();
  const [songs, setSongs] = useState<PaneSong[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      setSongs(await api.get<PaneSong[]>('/songs'));
    } catch {
      /* keep whatever we had — the pane is a convenience view */
      setSongs((cur) => cur ?? []);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  // Gentle refresh so a song that finishes in the background shows up.
  useEffect(() => {
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);

  const needle = q.trim().toLowerCase();
  const filtered = (songs ?? []).filter(
    (s) => !needle || s.title.toLowerCase().includes(needle) || prettyGenre(s.genre).toLowerCase().includes(needle)
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    const d = +new Date(a.createdAt) - +new Date(b.createdAt);
    return sort === 'oldest' ? d : -d;
  });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const tracks: PlayerTrack[] = sorted
    .filter((s) => s.audioUrl)
    .map((s) => ({ id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, url: s.audioUrl!, projectId: s.projectId }));

  return (
    <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate font-grotesk text-sm text-slate-400">
          Workspaces <span className="text-slate-600">›</span> <span className="text-slate-100">My Workspace</span>
        </h2>
        <Link href="/library" className="shrink-0 text-xs text-slate-400 hover:text-slate-200">
          Open Library
        </Link>
      </div>

      {/* Search + sort */}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Search your songs"
            aria-label="Search your songs"
            className="min-w-0 flex-1 bg-transparent py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
        </div>
        <div className="relative shrink-0">
          <ArrowDownWideNarrow className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" aria-hidden />
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(0);
            }}
            aria-label="Sort songs"
            className="appearance-none rounded-lg border border-white/10 bg-black/30 py-2 pl-7 pr-2 text-xs text-slate-300 focus:outline-none"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="title">Title</option>
          </select>
        </div>
      </div>

      {/* Rows */}
      <div className="mt-3 space-y-1.5">
        {songs === null && <p className="py-4 text-center text-xs text-slate-500">Loading your songs…</p>}
        {songs !== null && visible.length === 0 && (
          <p className="py-4 text-center text-xs leading-relaxed text-slate-500">
            {needle ? 'Nothing matches that search.' : 'No songs yet — create your first on the left.'}
          </p>
        )}
        {visible.map((s) => {
          const track = tracks.find((t) => t.id === s.id) ?? null;
          const active = player && track && player.current?.id === track.id && player.playing;
          return (
            <div key={s.id} className="group flex items-center gap-2.5 rounded-xl border border-transparent p-1.5 transition-colors hover:border-white/10 hover:bg-white/[0.04]">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-night-800">
                {s.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-display text-base text-slate-500">
                    {s.title.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200">{s.title}</div>
                <div className="truncate text-[11px] capitalize text-slate-500">
                  {prettyGenre(s.genre)}
                  {s.kind === 'instrumental' ? ' · instrumental' : s.kind === 'film_sound' ? ' · scene sound' : ''}
                  {s.hitScore != null ? ` · ${s.hitScore}/100` : ''}
                </div>
              </div>
              <Link
                href={`/projects/${s.projectId}`}
                title="Open project"
                aria-label={`Open the project for ${s.title}`}
                className="shrink-0 text-slate-600 opacity-0 transition-all hover:text-slate-200 group-hover:opacity-100"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              </Link>
              {player && track ? (
                <button
                  type="button"
                  onClick={() => player.play(track, tracks)}
                  aria-label={active ? `Pause ${s.title}` : `Play ${s.title}`}
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-white/15 text-white' : 'bg-brand-gradient text-ink shadow-glow'
                  }`}
                >
                  {active ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="ml-px h-3 w-3" aria-hidden />}
                </button>
              ) : (
                <span className="shrink-0 text-[10px] text-slate-600">{track ? '' : 'cooking…'}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="text-[11px] tabular-nums text-slate-500">
            {safePage + 1} / {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={safePage >= pages - 1}
            aria-label="Next page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 transition-colors hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <Link
        href="/catalog"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10"
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Manage everything in Catalog
      </Link>
    </aside>
  );
}
