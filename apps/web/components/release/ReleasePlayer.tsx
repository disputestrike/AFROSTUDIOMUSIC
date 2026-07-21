'use client';

/**
 * Release-page hero player — the cover IS the play button. One tap on the art
 * starts the master; the progress bar tracks the record. No app shell, no login;
 * this is the public destination a short/social link drives traffic to, so the
 * first tap has to just work.
 */
import { useEffect, useRef, useState } from 'react';

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ReleasePlayer({
  audioUrl,
  coverUrl,
  title,
}: {
  audioUrl: string | null;
  coverUrl: string | null;
  title: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Pause every OTHER media element the moment this one starts — one sound at a
  // time on the page (the clips and the visual never fight the master).
  useEffect(() => {
    const onPlay = (e: Event) => {
      const target = e.target as HTMLMediaElement | null;
      if (!target) return;
      document
        .querySelectorAll<HTMLMediaElement>('audio, video')
        .forEach((el) => el !== target && !el.paused && el.pause());
    };
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = (Number(e.target.value) / 1000) * duration;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={!audioUrl}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
        className="group relative block aspect-square w-full overflow-hidden rounded-3xl border border-white/10 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-afrobrand-500 disabled:cursor-default"
      >
        {coverUrl ? (
          <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-brand-gradient font-display text-7xl text-ink">
            {title.slice(0, 1)}
          </span>
        )}
        {audioUrl && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-100 transition-opacity duration-300 group-hover:bg-black/40 motion-safe:group-hover:opacity-100">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-ink shadow-glow backdrop-blur transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              {playing ? (
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="ml-1 h-9 w-9" fill="currentColor" aria-hidden>
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.4-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14Z" />
                </svg>
              )}
            </span>
          </span>
        )}
      </button>

      {audioUrl && (
        <div className="mt-4 flex items-center gap-3">
          <span className="w-10 text-right font-grotesk text-xs tabular-nums text-slate-400">{fmt(current)}</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={duration ? Math.round((current / duration) * 1000) : 0}
            onChange={seek}
            aria-label="Seek"
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-afrobrand-500"
          />
          <span className="w-10 font-grotesk text-xs tabular-nums text-slate-400">{fmt(duration)}</span>
        </div>
      )}

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          className="hidden"
        />
      )}
    </div>
  );
}
