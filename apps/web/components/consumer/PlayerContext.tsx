'use client';

/**
 * GLOBAL PLAYER (USERSHELL) — one audio element for the whole consumer app.
 *
 * The consumer shell keeps a persistent bottom player bar on every page; this
 * context owns the <audio> element so playback SURVIVES client-side
 * navigation inside the (app) group. Laws:
 * - HONESTY: it only ever plays real catalog/release URLs handed to it by a
 *   page — it never invents tracks, counts, or metadata.
 * - SOLO: the audio element lives in the DOM, so the existing <AudioSolo/>
 *   capture-listener applies — starting any inline preview pauses this
 *   player, and starting this player pauses everything else. No double audio.
 * - Queue semantics are CLIENT-ONLY conveniences (prev/next/shuffle/repeat
 *   over the list the page handed us) — no server state is implied.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface PlayerTrack {
  /** Stable id (song id where known) so the bar can mark the active row. */
  id: string;
  title: string;
  artist?: string | null;
  coverUrl?: string | null;
  url: string;
  /** Where "open" should land — the song's project page when known. */
  projectId?: string | null;
}

export type RepeatMode = 'off' | 'one';

interface PlayerState {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Start a track (optionally with the list it came from as the queue). */
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
}

const PlayerCtx = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerCtx);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}

/** Same hook, but safe outside the provider (returns null) — lets shared
 *  components play through the bar when it exists and fall back otherwise. */
export function usePlayerOptional(): PlayerState | null {
  return useContext(PlayerCtx);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  // Refs mirror the state the 'ended' handler needs — the <audio> element's
  // listeners are bound once and must always see the latest values.
  const queueRef = useRef(queue);
  const currentRef = useRef(current);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat);
  queueRef.current = queue;
  currentRef.current = current;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

  const startTrack = useCallback((track: PlayerTrack) => {
    const el = audioRef.current;
    if (!el) return;
    setCurrent(track);
    setPosition(0);
    setDuration(0);
    el.src = track.url;
    void el.play().catch(() => setPlaying(false));
  }, []);

  const pickNext = useCallback((direction: 1 | -1): PlayerTrack | null => {
    const q = queueRef.current;
    const cur = currentRef.current;
    if (!q.length || !cur) return null;
    const idx = q.findIndex((t) => t.id === cur.id);
    if (idx === -1) return q[0] ?? null;
    if (shuffleRef.current && q.length > 1) {
      let j = idx;
      while (j === idx) j = Math.floor(Math.random() * q.length);
      return q[j] ?? null;
    }
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= q.length) return null;
    return q[nextIdx] ?? null;
  }, []);

  const next = useCallback(() => {
    const track = pickNext(1);
    if (track) startTrack(track);
  }, [pickNext, startTrack]);

  const prev = useCallback(() => {
    const el = audioRef.current;
    // Standard transport behavior: early in a track, prev = previous track;
    // otherwise prev = restart the current one.
    if (el && el.currentTime > 4) {
      el.currentTime = 0;
      return;
    }
    const track = pickNext(-1);
    if (track) startTrack(track);
    else if (el) el.currentTime = 0;
  }, [pickNext, startTrack]);

  // Bind the audio element's listeners once.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime || 0);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeatRef.current === 'one') {
        el.currentTime = 0;
        void el.play().catch(() => setPlaying(false));
        return;
      }
      const track = pickNext(1);
      if (track) startTrack(track);
      else setPlaying(false);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [pickNext, startTrack]);

  const play = useCallback(
    (track: PlayerTrack, newQueue?: PlayerTrack[]) => {
      if (newQueue?.length) setQueue(newQueue.filter((t) => !!t.url));
      else setQueue((q) => (q.some((t) => t.id === track.id) ? q : [track]));
      const el = audioRef.current;
      // Same track: toggle instead of restarting.
      if (currentRef.current?.id === track.id && el?.src) {
        if (el.paused) void el.play().catch(() => setPlaying(false));
        else el.pause();
        return;
      }
      startTrack(track);
    },
    [startTrack]
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentRef.current) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
    setPosition(el.currentTime);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const toggleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'one' : 'off')), []);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      queue,
      playing,
      position,
      duration,
      volume,
      shuffle,
      repeat,
      play,
      toggle,
      next,
      prev,
      seek,
      setVolume,
      toggleShuffle,
      toggleRepeat,
    }),
    [current, queue, playing, position, duration, volume, shuffle, repeat, play, toggle, next, prev, seek, setVolume, toggleShuffle, toggleRepeat]
  );

  return (
    <PlayerCtx.Provider value={value}>
      {children}
      {/* The one real audio element — in the DOM so AudioSolo governs it. */}
      <audio ref={audioRef} preload="none" className="hidden" />
    </PlayerCtx.Provider>
  );
}
