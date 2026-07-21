'use client';

/**
 * The primary visual — the music video when the song has one, otherwise the
 * auto-generated visualizer. It autoplays muted and loops (the modern release-
 * page behaviour that survives every browser's autoplay policy); one tap turns
 * the sound on. The poster is the cover so the frame is never black while it
 * loads.
 */
import { useRef, useState } from 'react';

export function PrimaryVisual({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string | null;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  const unmute = () => {
    const el = videoRef.current;
    if (!el) return;
    const next = !muted;
    el.muted = next;
    setMuted(next);
    if (!next && el.paused) void el.play();
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 shadow-card">
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onClick={unmute}
        className="aspect-[9/16] w-full cursor-pointer bg-black object-cover sm:aspect-video"
      />
      <button
        type="button"
        onClick={unmute}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/80"
      >
        {muted ? (
          <>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              <path d="m16 9 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
            Tap for sound
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
            Sound on
          </>
        )}
      </button>
      <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-[11px] uppercase tracking-wide text-white/90 backdrop-blur">
        {label}
      </span>
    </div>
  );
}
