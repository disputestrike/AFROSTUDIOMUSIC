'use client';

/**
 * LIBRARY (USERSHELL) — the user's songs + albums inside the consumer shell.
 * Same data the Catalog and Albums pages already serve (GET /songs, GET
 * /albums); rows play through the persistent bottom player. Heavy management
 * (delete, stems, video, release) stays on Catalog/Albums — linked, not
 * duplicated.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Disc3, LayoutGrid, Music2, Pause, Play, SlidersHorizontal } from 'lucide-react';
import { useApi } from '@/lib/api';
import { usePlayerOptional, type PlayerTrack } from '@/components/consumer/PlayerContext';

interface MySong {
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

interface AlbumRow {
  id: string;
  title: string;
  styleBrief: string | null;
  songs: Array<{ id: string; title: string }>;
}

function prettyGenre(genre: string): string {
  return genre.replace(/_/g, ' ');
}

export default function LibraryPage() {
  const api = useApi();
  const player = usePlayerOptional();
  const [tab, setTab] = useState<'songs' | 'albums'>('songs');
  const [songs, setSongs] = useState<MySong[] | null | 'error'>(null);
  const [albums, setAlbums] = useState<AlbumRow[] | null | 'error'>(null);

  useEffect(() => {
    let active = true;
    api
      .get<MySong[]>('/songs')
      .then((rows) => {
        if (active) setSongs(rows);
      })
      .catch(() => {
        if (active) setSongs('error');
      });
    api
      .get<AlbumRow[]>('/albums')
      .then((rows) => {
        if (active) setAlbums(rows);
      })
      .catch(() => {
        if (active) setAlbums('error');
      });
    return () => {
      active = false;
    };
  }, [api]);

  const tracks: PlayerTrack[] = Array.isArray(songs)
    ? songs.filter((s) => s.audioUrl).map((s) => ({ id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, url: s.audioUrl!, projectId: s.projectId }))
    : [];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl">Library</h1>
        <div className="flex gap-2">
          {(
            [
              { id: 'songs' as const, label: 'Songs' },
              { id: 'albums' as const, label: 'Albums' },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                tab === t.id
                  ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
                  : 'border border-white/10 text-slate-400 hover:bg-white/5'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'songs' && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Everything you&apos;ve made — newest first.</p>
            <Link href="/catalog" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Manage in Catalog
            </Link>
          </div>
          <div className="mt-4 space-y-1.5">
            {songs === null && <p className="text-sm text-slate-500">Loading your songs…</p>}
            {songs === 'error' && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
                Couldn&apos;t load your songs — the studio API isn&apos;t reachable right now. Your music is safe; refresh in a moment.
              </div>
            )}
            {Array.isArray(songs) && songs.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
                <Music2 className="mx-auto h-6 w-6 text-slate-600" aria-hidden />
                <p className="mt-3 text-sm text-slate-400">
                  No songs yet —{' '}
                  <Link href="/create" className="text-afrobrand-300 hover:text-afrobrand-200">
                    make your first record
                  </Link>
                  .
                </p>
              </div>
            )}
            {Array.isArray(songs) &&
              songs.map((s) => {
                const track = tracks.find((t) => t.id === s.id) ?? null;
                const active = player && track && player.current?.id === track.id && player.playing;
                return (
                  <div
                    key={s.id}
                    className="group flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-night-800">
                      {s.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-display text-lg text-slate-500">
                          {s.title.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{s.title}</div>
                      <div className="truncate text-xs capitalize text-slate-500">
                        {prettyGenre(s.genre)}
                        {s.kind === 'instrumental' ? ' · instrumental' : s.kind === 'film_sound' ? ' · scene sound' : ''}
                        {s.hitScore != null ? ` · ${s.hitScore}/100` : ''}
                        {!s.audioUrl ? ' · still cooking' : ''}
                      </div>
                    </div>
                    <Link
                      href={`/projects/${s.projectId}`}
                      title="Open project"
                      aria-label={`Open the project for ${s.title}`}
                      className="hidden shrink-0 text-slate-500 transition-colors hover:text-slate-200 sm:block"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden />
                    </Link>
                    {player && track && (
                      <button
                        type="button"
                        onClick={() => player.play(track, tracks)}
                        aria-label={active ? `Pause ${s.title}` : `Play ${s.title}`}
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                          active ? 'bg-white/15 text-white' : 'bg-brand-gradient text-ink shadow-glow sm:opacity-0 sm:group-hover:opacity-100'
                        }`}
                      >
                        {active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden />}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {tab === 'albums' && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Each album grows inside one song&apos;s sound.</p>
            <Link href="/albums" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
              <Disc3 className="h-3.5 w-3.5" aria-hidden /> Manage in Albums
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {albums === null && <p className="text-sm text-slate-500">Loading albums…</p>}
            {albums === 'error' && <p className="text-sm text-slate-500">Couldn&apos;t load albums right now — refresh in a moment.</p>}
            {Array.isArray(albums) && albums.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center sm:col-span-2 lg:col-span-3">
                <Disc3 className="mx-auto h-6 w-6 text-slate-600" aria-hidden />
                <p className="mt-3 text-sm text-slate-400">
                  No albums yet — start one in{' '}
                  <Link href="/albums" className="text-afrobrand-300 hover:text-afrobrand-200">
                    Albums
                  </Link>
                  .
                </p>
              </div>
            )}
            {Array.isArray(albums) &&
              albums.map((a) => (
                <Link
                  key={a.id}
                  href="/albums"
                  className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:-translate-y-0.5 hover:border-afrobrand-500/40 hover:bg-white/[0.06]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-afrobrand-500/15 text-afrobrand-300">
                    <Disc3 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="mt-3 truncate font-display text-lg">{a.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {a.songs.length} {a.songs.length === 1 ? 'track' : 'tracks'}
                  </div>
                  {a.styleBrief && <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">{a.styleBrief}</div>}
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
