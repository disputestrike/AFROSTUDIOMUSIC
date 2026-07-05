'use client';

/**
 * Audio solo — only one track plays at a time, app-wide.
 *
 * Every <audio>/<video> across the catalog, create, and project pages plays
 * independently by default; starting one used to leave the previous one going.
 * This installs a single capture-phase 'play' listener that pauses every OTHER
 * media element the moment one starts. No per-component wiring needed.
 */
import { useEffect } from 'react';

export function AudioSolo() {
  useEffect(() => {
    const onPlay = (e: Event) => {
      const target = e.target as HTMLMediaElement | null;
      if (!target || !('pause' in target)) return;
      document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => {
        if (el !== target && !el.paused) el.pause();
      });
    };
    // Capture phase so we catch play events from any element, including
    // ones added after mount.
    document.addEventListener('play', onPlay, true);
    return () => document.removeEventListener('play', onPlay, true);
  }, []);
  return null;
}
