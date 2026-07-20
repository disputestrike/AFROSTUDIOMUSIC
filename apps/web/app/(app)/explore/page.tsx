'use client';

/**
 * EXPLORE (USERSHELL) — card-grid discovery over REAL records only:
 * the public house wall (owner-featured + release-ready drops) and the
 * user's own catalog. The search bar filters those real sets client-side —
 * its placeholder promises exactly what it can do, nothing more.
 * HONESTY: no fabricated play/like/comment counts anywhere — the API does
 * not track them yet, so no stat is shown at all.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Pause, Play, Search, SquareArrowOutUpRight } from 'lucide-react';
import { useApi } from '@/lib/api';
import { usePlayerOptional, type PlayerTrack } from '@/components/consumer/PlayerContext';

interface WallSong {
  id: string;
  title: string;
  artist: string;
  genre: string;
  coverUrl: string | null;
  streamUrl: string;
}

interface MySong {
  id: string;
  title: string;
  genre: string;
  artist: string;
  projectId: string;
  kind?: string;
  audioUrl: string | null;
  coverUrl: string | null;
  releaseReady?: boolean;
  createdAt: string;
}

function prettyGenre(genre: string): string {
  return genre.replace(/_/g, ' ');
}

export default function ExplorePage() {
  const api = useApi();
  const player = usePlayerOptional();
  const [q, setQ] = useState('');
  const [house, setHouse] = useState<WallSong[] | null | 'error'>(null);
  const [mine, setMine] = useState<MySong[] | null | 'error'>(null);

  useEffect(() => {
    let active = true;
    fetch('/backend/public/trending', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { songs: WallSong[] }) => {
        if (active) setHouse(data.songs);
      })
      .catch(() => {
        if (active) setHouse('error');
      });
    api
      .get<MySong[]>('/songs')
      .then((rows) => {
        if (active) setMine(rows);
      })
      .catch(() => {
        if (active) setMine('error');
      });
    return () => {
      active = false;
    };
  }, [api]);

  const needle = q.trim().toLowerCase();
  const match = (s: { title: string; artist?: string; genre: string }) =>
    !needle ||
    s.title.toLowerCase().includes(needle) ||
    (s.artist ?? '').toLowerCase().includes(needle) ||
    prettyGenre(s.genre).toLowerCase().includes(needle);

  const houseFiltered = Array.isArray(house) ? house.filter(match) : [];
  const mineFiltered = Array.isArray(mine) ? mine.filter(match) : [];

  const houseTracks: PlayerTrack[] = houseFiltered.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    coverUrl: s.coverUrl,
    url: s.streamUrl,
  }));
  const mineTracks: PlayerTrack[] = mineFiltered
    .filter((s) => s.audioUrl)
    .map((s) => ({ id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, url: s.audioUrl!, projectId: s.projectId }));

  const card = (opts: {
    key: string;
    title: string;
    subtitle: string;
    coverUrl: string | null;
    badge?: string | null;
    track: PlayerTrack | null;
    queue: PlayerTrack[];
    releaseHref?: string | null;
  }) => {
    const active = player && opts.track && player.current?.id === opts.track.id && player.playing;
    return (
      <div key={opts.key} className="group glass rounded-2xl p-3 transition-all duration-300 hover:-translate-y-1 hover:border-afrobrand-500/40">
        <div className="relative aspect-square overflow-hidden rounded-xl">
          {opts.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={opts.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-gradient">
              <span className="font-display text-5xl text-ink/80">{opts.title.slice(0, 1).toUpperCase()}</span>
            </div>
          )}
          {player && opts.track && (
            <button
              type="button"
              onClick={() => player.play(opts.track!, opts.queue)}
              aria-label={active ? `Pause ${opts.title}` : `Play ${opts.title}`}
              className={`absolute inset-0 flex items-center justify-center bg-ink/40 transition-opacity duration-200 ${
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
                {active ? <Pause className="h-5 w-5 text-ink" aria-hidden /> : <Play className="ml-0.5 h-5 w-5 text-ink" aria-hidden />}
              </span>
            </button>
          )}
          {opts.badge && (
            <span className="absolute left-2 top-2 rounded-full border border-white/15 bg-ink/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 backdrop-blur">
              {opts.badge}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{opts.title}</div>
            <div className="mt-0.5 truncate text-xs capitalize text-slate-400">{opts.subtitle}</div>
          </div>
          {opts.releaseHref && (
            <Link
              href={opts.releaseHref}
              title="Open the public release page"
              aria-label={`Open the release page for ${opts.title}`}
              className="mt-0.5 shrink-0 text-slate-500 transition-colors hover:text-slate-200"
            >
              <SquareArrowOutUpRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      {/* Search — filters the REAL sets below, and says so. */}
      <div className="glass flex items-center gap-3 rounded-full px-4 py-1">
        <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search songs, artists, or genres in the studio"
          aria-label="Search songs, artists, or genres"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      {/* Fresh from the house */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Fresh from the house</h2>
        </div>
        {house === null && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass rounded-2xl p-3">
                <div className="aspect-square animate-pulse rounded-xl bg-white/5" />
                <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        )}
        {house === 'error' && <p className="mt-4 text-sm text-slate-500">Couldn&apos;t reach the house wall right now — refresh in a moment.</p>}
        {Array.isArray(house) && houseFiltered.length === 0 && (
          <p className="mt-4 text-sm leading-relaxed text-slate-500">
            {needle ? 'No house records match that search.' : 'No house records up right now — only real, finished drops show here.'}
          </p>
        )}
        {houseFiltered.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {houseFiltered.map((s) =>
              card({
                key: s.id,
                title: s.title,
                subtitle: `${s.artist} · ${prettyGenre(s.genre)}`,
                coverUrl: s.coverUrl,
                badge: 'House pick',
                track: houseTracks.find((t) => t.id === s.id) ?? null,
                queue: houseTracks,
              })
            )}
          </div>
        )}
      </section>

      {/* Your songs */}
      <section className="mt-10 pb-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Your songs</h2>
          <Link href="/library" className="text-xs text-slate-400 hover:text-slate-200">
            See all
          </Link>
        </div>
        {mine === null && <p className="mt-4 text-sm text-slate-500">Loading your songs…</p>}
        {mine === 'error' && <p className="mt-4 text-sm text-slate-500">Couldn&apos;t load your songs right now — refresh in a moment.</p>}
        {Array.isArray(mine) && mineFiltered.length === 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
            {needle ? (
              'None of your songs match that search.'
            ) : (
              <>
                Nothing here yet —{' '}
                <Link href="/create" className="text-afrobrand-300 hover:text-afrobrand-200">
                  make your first record
                </Link>
                .
              </>
            )}
          </div>
        )}
        {mineFiltered.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {mineFiltered.slice(0, 12).map((s) =>
              card({
                key: s.id,
                title: s.title,
                subtitle: prettyGenre(s.genre) + (s.audioUrl ? '' : ' · still cooking'),
                coverUrl: s.coverUrl,
                badge: s.kind === 'instrumental' ? 'Instrumental' : s.kind === 'film_sound' ? 'Scene sound' : null,
                track: mineTracks.find((t) => t.id === s.id) ?? null,
                queue: mineTracks,
                releaseHref: s.releaseReady ? `/r/${s.id}` : null,
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}
