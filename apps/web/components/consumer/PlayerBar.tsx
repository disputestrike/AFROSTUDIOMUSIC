'use client';

/**
 * BOTTOM PLAYER BAR (USERSHELL) — persistent on every consumer page.
 *
 * Left: cover + title + artist. Center: transport (shuffle, prev, play/pause,
 * next, repeat) + seek bar with elapsed/total. Right: queue, volume, open.
 * Honesty: only controls that DO something render — there are no dead
 * like/comment/share buttons because no consumer reaction backend exists yet.
 */

import Link from 'next/link';
import { useState } from 'react';
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat1,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  SquareArrowOutUpRight,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { usePlayer } from './PlayerContext';

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PlayerBar() {
  const p = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);

  const track = p.current;

  return (
    <div className="relative z-30 shrink-0 border-t border-white/10 glass-strong">
      <div className="mx-auto flex h-[72px] max-w-[1600px] items-center gap-3 px-3 sm:gap-4 sm:px-4">
        {/* Now playing */}
        <div className="flex w-[38%] min-w-0 items-center gap-3 sm:w-[26%]">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-night-800">
            {track?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <Music2 className="h-4 w-4" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0">
            {track ? (
              <>
                <div className="truncate text-sm font-medium text-slate-100">{track.title}</div>
                {track.artist && <div className="truncate text-xs text-slate-500">{track.artist}</div>}
              </>
            ) : (
              <div className="text-xs text-slate-500">Nothing playing yet — press play on any song.</div>
            )}
          </div>
        </div>

        {/* Transport + seek */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={p.toggleShuffle}
              aria-label={p.shuffle ? 'Shuffle on' : 'Shuffle off'}
              aria-pressed={p.shuffle}
              disabled={p.queue.length < 2}
              className={`hidden h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-30 sm:inline-flex ${
                p.shuffle ? 'text-afrobrand-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Shuffle className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={p.prev}
              aria-label="Previous"
              disabled={!track}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:text-white disabled:opacity-30"
            >
              <SkipBack className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={p.toggle}
              aria-label={p.playing ? 'Pause' : 'Play'}
              disabled={!track}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-gradient text-ink shadow-glow transition-transform hover:scale-105 disabled:opacity-40"
            >
              {p.playing ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="ml-0.5 h-5 w-5" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={p.next}
              aria-label="Next"
              disabled={!track}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:text-white disabled:opacity-30"
            >
              <SkipForward className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={p.toggleRepeat}
              aria-label={p.repeat === 'one' ? 'Repeat one' : 'Repeat off'}
              aria-pressed={p.repeat !== 'off'}
              disabled={!track}
              className={`hidden h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-30 sm:inline-flex ${
                p.repeat !== 'off' ? 'text-afrobrand-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.repeat === 'one' ? <Repeat1 className="h-4 w-4" aria-hidden /> : <Repeat className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          <div className="hidden w-full max-w-xl items-center gap-2 sm:flex">
            <span className="w-10 text-right font-mono text-[10px] tabular-nums text-slate-500">{fmt(p.position)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(p.duration))}
              value={Math.min(Math.floor(p.position), Math.floor(p.duration) || 0)}
              onChange={(e) => p.seek(Number(e.target.value))}
              disabled={!track || !p.duration}
              aria-label="Seek"
              className="h-1 w-full accent-afrobrand-500 disabled:opacity-30"
            />
            <span className="w-10 font-mono text-[10px] tabular-nums text-slate-500">{fmt(p.duration)}</span>
          </div>
        </div>

        {/* Right cluster */}
        <div className="flex w-auto items-center justify-end gap-1 sm:w-[26%] sm:gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setQueueOpen((o) => !o)}
              aria-label="Queue"
              aria-expanded={queueOpen}
              disabled={!p.queue.length}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                queueOpen ? 'text-afrobrand-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListMusic className="h-4 w-4" aria-hidden />
            </button>
            {queueOpen && p.queue.length > 0 && (
              <>
                <button type="button" aria-hidden tabIndex={-1} onClick={() => setQueueOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div className="absolute bottom-11 right-0 z-50 max-h-72 w-72 overflow-y-auto rounded-2xl border border-white/10 bg-ink/95 p-1.5 shadow-xl backdrop-blur">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Up next</div>
                  {p.queue.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => p.play(t)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm ${
                        p.current?.id === t.id ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      {t.artist && <span className="shrink-0 truncate text-xs text-slate-500">{t.artist}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setVolOpen((o) => !o)}
              aria-label="Volume"
              aria-expanded={volOpen}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-200"
            >
              {p.volume === 0 ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
            </button>
            {volOpen && (
              <>
                <button type="button" aria-hidden tabIndex={-1} onClick={() => setVolOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div className="absolute bottom-11 right-0 z-50 rounded-2xl border border-white/10 bg-ink/95 px-4 py-3 shadow-xl backdrop-blur">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(p.volume * 100)}
                    onChange={(e) => p.setVolume(Number(e.target.value) / 100)}
                    aria-label="Volume level"
                    className="h-1 w-28 accent-afrobrand-500"
                  />
                </div>
              </>
            )}
          </div>
          {track?.projectId && (
            <Link
              href={`/projects/${track.projectId}`}
              aria-label="Open this song's project"
              title="Open project"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-200"
            >
              <SquareArrowOutUpRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
