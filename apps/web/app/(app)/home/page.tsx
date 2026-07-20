'use client';

/**
 * HOME (USERSHELL) — the consumer front room, Suno-shaped, AfroHit-voiced.
 *
 * Laws:
 * - The describe box PREFILLS /create?vibe=… — the same mechanism the landing
 *   hero chat uses. It NEVER auto-fires a paid render (no ?produce=1, ever).
 * - Every section is backed by REAL data (the public trending wall, the
 *   user's own songs and albums) or an honest empty state. No fake counts,
 *   no placeholder records.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AudioLines, Disc3, Ear, Music2, Pause, Play, Video } from 'lucide-react';
import { useApi } from '@/lib/api';
import { usePlayerOptional, type PlayerTrack } from '@/components/consumer/PlayerContext';

const VIBE_MAX = 200;

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
  audioUrl: string | null;
  coverUrl: string | null;
  createdAt: string;
}

interface AlbumRow {
  id: string;
  title: string;
  songs: Array<{ id: string }>;
}

// Real production lanes — each card prefills /create?genre=… (the create page
// already reads ?genre= into the picker). Prefill only; nothing renders.
const LANES: Array<{ genre: string; label: string; line: string }> = [
  { genre: 'afrobeats', label: 'Afrobeats', line: 'The heartbeat lane' },
  { genre: 'amapiano', label: 'Amapiano', line: 'Log drums and space' },
  { genre: 'afro_gospel', label: 'Afro-gospel', line: 'Praise with a pocket' },
  { genre: 'street_pop', label: 'Street-pop', line: 'Zanku energy' },
  { genre: 'afro_rnb', label: 'Afro R&B', line: 'Smooth and intimate' },
  { genre: 'highlife', label: 'Highlife', line: 'Guitars that smile' },
  { genre: 'afro_house', label: 'Afro house', line: 'For the floor' },
  { genre: 'hip_hop', label: 'Hip-hop', line: 'Bars first' },
];

function prettyGenre(genre: string): string {
  return genre.replace(/_/g, ' ');
}

export default function HomePage() {
  const api = useApi();
  const router = useRouter();
  // Optional: an operator deep-linking here lives in the old shell (no
  // player bar) — rows simply render without inline play there.
  const player = usePlayerOptional();
  const [vibe, setVibe] = useState('');
  const [house, setHouse] = useState<WallSong[] | null | 'error'>(null);
  const [mine, setMine] = useState<MySong[] | null | 'error'>(null);
  const [albums, setAlbums] = useState<AlbumRow[] | null | 'error'>(null);

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

  function submitVibe() {
    const clean = vibe.replace(/\s+/g, ' ').trim().slice(0, VIBE_MAX);
    router.push(clean ? `/create?vibe=${encodeURIComponent(clean)}` : '/create');
  }

  const houseTracks: PlayerTrack[] = Array.isArray(house)
    ? house.map((s) => ({ id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, url: s.streamUrl }))
    : [];
  const mineTracks: PlayerTrack[] = Array.isArray(mine)
    ? mine.filter((s) => s.audioUrl).map((s) => ({ id: s.id, title: s.title, artist: s.artist, coverUrl: s.coverUrl, url: s.audioUrl!, projectId: s.projectId }))
    : [];

  const rowPlayButton = (track: PlayerTrack | null) => {
    if (!track || !player) return null;
    const active = player.current?.id === track.id && player.playing;
    return (
      <button
        type="button"
        onClick={() => player.play(track, track.projectId ? mineTracks : houseTracks)}
        aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
          active ? 'bg-white/15 text-white' : 'bg-brand-gradient text-ink opacity-0 shadow-glow group-hover:opacity-100'
        }`}
      >
        {active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden />}
      </button>
    );
  };

  const thumb = (coverUrl: string | null | undefined, title: string) => (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-night-800">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-afrobrand-500/15 font-display text-lg text-slate-400">
          {title.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      {/* Hero + describe box */}
      <section className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          Make the record you <span className="text-gradient">hear in your head</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
          Describe it — the studio writes, sings, produces and masters it. Nothing renders or spends credits until you review and confirm.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitVibe();
          }}
          className="glass border-gradient mx-auto mt-6 flex w-full max-w-2xl items-center gap-2 rounded-full p-1.5 pl-4 shadow-card transition-all focus-within:shadow-glow sm:p-2 sm:pl-6"
        >
          <input
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            maxLength={VIBE_MAX}
            placeholder='Tell the studio what to make — "a smooth amapiano song about moving to Lagos"'
            aria-label="Describe the record you want to make"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-afrobrand-500 px-5 py-2.5 text-sm font-semibold text-ink shadow-glow transition-all hover:bg-afrobrand-400 sm:px-6"
          >
            Create
          </button>
        </form>
      </section>

      {/* Two wide feature banners — real doors, real pages. */}
      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Link
          href="/create"
          className="group glass border-gradient relative overflow-hidden rounded-3xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-glow"
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-afrobrand-300">
            <Video className="h-4 w-4" aria-hidden /> Music videos
          </div>
          <h2 className="mt-2 font-display text-2xl">Bring a finished song — leave with its video</h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-400">
            Upload the record exactly as it is; the studio builds the treatment, scenes and the finished cut. Every paid scene render is approved by you.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-afrobrand-300 group-hover:gap-2.5 transition-all">
            Open the video door <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </Link>
        <Link
          href="/listen?onboarding=sound"
          className="group glass border-gradient relative overflow-hidden rounded-3xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-glow"
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-afrobrand-300">
            <Ear className="h-4 w-4" aria-hidden /> Your sound
          </div>
          <h2 className="mt-2 font-display text-2xl">Teach the studio your sound</h2>
          <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-400">
            Play it your records — with your consent, on your rights — and every new render leans closer to the way you actually sound.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-afrobrand-300 group-hover:gap-2.5 transition-all">
            Start listening <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        </Link>
      </section>

      {/* Three list columns */}
      <section className="mt-12 grid gap-8 md:grid-cols-3">
        {/* Fresh from the house */}
        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-xl">Fresh from the house</h3>
            <Link href="/explore" className="text-xs text-slate-400 hover:text-slate-200">
              See more
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {house === null && <p className="text-sm text-slate-500">Loading…</p>}
            {(house === 'error' || (Array.isArray(house) && house.length === 0)) && (
              <p className="text-sm leading-relaxed text-slate-500">No house records up right now — only real, finished drops show here.</p>
            )}
            {Array.isArray(house) &&
              house.slice(0, 3).map((s) => {
                const track = houseTracks.find((t) => t.id === s.id) ?? null;
                return (
                  <div key={s.id} className="group flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-white/10 hover:bg-white/[0.04]">
                    {thumb(s.coverUrl, s.title)}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{s.title}</div>
                      <div className="truncate text-xs capitalize text-slate-500">
                        {s.artist} · {prettyGenre(s.genre)}
                      </div>
                    </div>
                    {rowPlayButton(track)}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Your latest */}
        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-xl">Your latest</h3>
            <Link href="/library" className="text-xs text-slate-400 hover:text-slate-200">
              See more
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {mine === null && <p className="text-sm text-slate-500">Loading…</p>}
            {mine === 'error' && <p className="text-sm text-slate-500">Couldn&apos;t load your songs right now — refresh in a moment.</p>}
            {Array.isArray(mine) && mine.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                Nothing here yet.{' '}
                <Link href="/create" className="text-afrobrand-300 hover:text-afrobrand-200">
                  Make your first record
                </Link>
                .
              </div>
            )}
            {Array.isArray(mine) &&
              mine.slice(0, 3).map((s) => {
                const track = mineTracks.find((t) => t.id === s.id) ?? null;
                return (
                  <div key={s.id} className="group flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-white/10 hover:bg-white/[0.04]">
                    {thumb(s.coverUrl, s.title)}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{s.title}</div>
                      <div className="truncate text-xs capitalize text-slate-500">{prettyGenre(s.genre)}{!s.audioUrl ? ' · still cooking' : ''}</div>
                    </div>
                    {track ? (
                      rowPlayButton(track)
                    ) : (
                      <AudioLines className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Your albums */}
        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-xl">Your albums</h3>
            <Link href="/albums" className="text-xs text-slate-400 hover:text-slate-200">
              See more
            </Link>
          </div>
          <div className="mt-3 space-y-1.5">
            {albums === null && <p className="text-sm text-slate-500">Loading…</p>}
            {albums === 'error' && <p className="text-sm text-slate-500">Couldn&apos;t load albums right now.</p>}
            {Array.isArray(albums) && albums.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                No albums yet — anchor one to a song you love in{' '}
                <Link href="/albums" className="text-afrobrand-300 hover:text-afrobrand-200">
                  Albums
                </Link>
                .
              </div>
            )}
            {Array.isArray(albums) &&
              albums.slice(0, 3).map((a) => (
                <Link
                  key={a.id}
                  href="/albums"
                  className="group flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-night-800 text-slate-500">
                    <Disc3 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">{a.title}</div>
                    <div className="truncate text-xs text-slate-500">
                      {a.songs.length} {a.songs.length === 1 ? 'track' : 'tracks'}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              ))}
          </div>
        </div>
      </section>

      {/* Start in a lane — horizontal card row (prefill only, never renders). */}
      <section className="mt-12 pb-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-xl">Start in a lane</h3>
          <span className="text-xs text-slate-500">Prefills Create — nothing renders until you confirm</span>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {LANES.map((lane) => (
            <Link
              key={lane.genre}
              href={`/create?genre=${lane.genre}`}
              className="group w-40 shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:-translate-y-0.5 hover:border-afrobrand-500/40 hover:bg-white/[0.06]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-afrobrand-500/15 text-afrobrand-300">
                <Music2 className="h-4 w-4" aria-hidden />
              </div>
              <div className="mt-3 font-display text-base">{lane.label}</div>
              <div className="mt-0.5 text-xs text-slate-500">{lane.line}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
