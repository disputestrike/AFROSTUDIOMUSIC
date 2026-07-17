'use client';

/**
 * LANDING SONG WALL — the studio demos itself.
 *
 * Renders REAL records from GET /public/trending — owner-featured pins first,
 * then releaseReady drops. Honesty laws: no fabricated play counts, no
 * placeholder songs — if the studio hasn't put a record up yet, the wall says
 * so instead of faking one.
 *
 * Audio is lazy (an <audio> element is created only on first play) and solo —
 * pressing play on one card pauses whichever card was playing.
 */
import { useEffect, useRef, useState } from 'react';

interface WallSong {
  id: string;
  title: string;
  artist: string;
  genre: string;
  coverUrl: string | null;
  streamUrl: string;
}

function prettyGenre(genre: string): string {
  return genre.replace(/_/g, ' ');
}

function EqBars({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-3.5 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[3px] origin-bottom rounded-full bg-ink ${playing ? 'animate-eq' : 'scale-y-[0.3]'}`}
          style={{ height: '100%', animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </span>
  );
}

export function LandingSongWall() {
  const [songs, setSongs] = useState<WallSong[] | null | 'error'>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/backend/public/trending', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { songs: WallSong[] }) => {
        if (active) setSongs(data.songs);
      })
      .catch(() => {
        if (active) setSongs('error');
      });
    return () => {
      active = false;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function toggle(song: WallSong) {
    if (playingId === song.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(song.streamUrl);
    audio.preload = 'none';
    audio.onended = () => setPlayingId((id) => (id === song.id ? null : id));
    audio.onerror = () => setPlayingId((id) => (id === song.id ? null : id));
    audioRef.current = audio;
    setPlayingId(song.id);
    void audio.play().catch(() => setPlayingId((id) => (id === song.id ? null : id)));
  }

  // Loading — obvious skeletons, never fake songs.
  if (songs === null) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass rounded-2xl p-3">
            <div className="aspect-square animate-pulse rounded-xl bg-white/5" />
            <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-white/5" />
            <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  // Empty or unreachable — the honest state. No placeholder records, ever.
  if (songs === 'error' || songs.length === 0) {
    return (
      <div className="glass border-gradient relative mx-auto max-w-2xl rounded-3xl p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-ink" aria-hidden>
            <path d="M9 18V6l11-2v12" stroke="currentColor" strokeWidth="0" />
            <path d="M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 6l11-2v3L9 9V6Z" />
          </svg>
        </div>
        <h3 className="mt-5 font-display text-3xl tracking-tight">First records dropping soon</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
          This wall only shows real records off the studio floor — measured, mastered and
          hand-picked by the house. No demo filler, no fake plays. The first drops are in the
          pipeline now.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {songs.map((song) => {
        const isPlaying = playingId === song.id;
        return (
          <button
            key={song.id}
            type="button"
            onClick={() => toggle(song)}
            aria-pressed={isPlaying}
            aria-label={`${isPlaying ? 'Pause' : 'Play'} ${song.title} by ${song.artist}`}
            className={`group glass rounded-2xl p-3 text-left transition-all duration-300 hover:-translate-y-1 hover:border-afrobrand-500/40 ${
              isPlaying ? 'border-afrobrand-500/50 shadow-glow' : ''
            }`}
          >
            <div className="relative aspect-square overflow-hidden rounded-xl">
              {song.coverUrl ? (
                <img
                  src={song.coverUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-brand-gradient">
                  <span className="font-display text-5xl text-ink/80">{song.title.slice(0, 1).toUpperCase()}</span>
                </div>
              )}
              <div
                className={`absolute inset-0 flex items-center justify-center bg-ink/40 transition-opacity duration-200 ${
                  isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
                  {isPlaying ? (
                    <EqBars playing />
                  ) : (
                    <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-ink" aria-hidden>
                      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
                    </svg>
                  )}
                </span>
              </div>
            </div>
            <div className="mt-3 truncate text-sm font-medium text-slate-100">{song.title}</div>
            <div className="mt-0.5 truncate text-xs text-slate-400">
              {song.artist} · <span className="capitalize">{prettyGenre(song.genre)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
