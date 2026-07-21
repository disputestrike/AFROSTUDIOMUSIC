'use client';

/**
 * Listen — the Shazam-style front door. Play a track you have the rights to,
 * the AI hears it (BPM/key/genre/mood/instruments), then makes a FRESH original
 * in that vibe. A scratch project is created on arrival so it works standalone.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { ReferenceListen } from '@/components/ReferenceListen';
import { LearnFromLyrics } from '@/components/LearnFromLyrics';
import { LearnMySound } from '@/components/LearnMySound';
import { TrainingSession } from '@/components/TrainingSession';

// The teaching lane. Every learning door on this page files what it hears under
// the scratch project's genre (it is both the detector's hint and its fallback)
// — hardcoding 'afrobeats' silently filed amapiano training into the afrobeats
// lane, starving every other lane. Keep in sync with the Create page list.
const GENRES = [
  { value: 'afrobeats', label: 'Afrobeats' }, { value: 'afro_fusion', label: 'Afro-fusion' },
  { value: 'amapiano', label: 'Amapiano' }, { value: 'afro_dancehall', label: 'Afro-dancehall' },
  { value: 'street_pop', label: 'Street-pop / Zanku' }, { value: 'afro_rnb', label: 'Afro R&B' },
  { value: 'afro_pop', label: 'Afropop' }, { value: 'highlife', label: 'Highlife' },
  { value: 'gospel', label: 'Gospel' }, { value: 'hip_hop', label: 'Hip-hop / Rap' },
  { value: 'afro_hip_hop', label: 'Afro / Naija Hip-Hop' }, { value: 'reggae', label: 'Reggae' },
  { value: 'pop', label: 'Pop' }, { value: 'rnb', label: 'R&B' },
  { value: 'dancehall', label: 'Dancehall' }, { value: 'drill', label: 'Drill' },
  { value: 'trap', label: 'Trap' }, { value: 'house', label: 'House' },
  { value: 'edm', label: 'EDM' }, { value: 'reggaeton', label: 'Reggaeton' },
  { value: 'latin_pop', label: 'Latin pop' }, { value: 'country', label: 'Country' },
  { value: 'rock', label: 'Rock' }, { value: 'soul', label: 'Soul' },
];

export default function ListenPage() {
  const api = useApi();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [genre, setGenre] = useState('afrobeats');
  const [err, setErr] = useState('');

  async function pickGenre(g: string) {
    setGenre(g);
    if (!projectId) return;
    try {
      await api.patch(`/projects/${projectId}`, { genre: g });
    } catch { /* non-fatal — the next listen still detects; the hint just stays stale */ }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // REUSE one persistent listen project — creating a fresh "Reference
        // session" on every visit littered the Projects page (and made deleted
        // junk look like it "came back"). Validate the remembered one still
        // exists (it may have been deleted — deletes must STICK).
        const KEY = 'afrohit.listenProject';
        const remembered = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
        if (remembered) {
          try {
            const proj = await api.get<{ genre?: string }>(`/projects/${remembered}`);
            if (!cancelled) {
              setProjectId(remembered);
              if (proj?.genre) setGenre(proj.genre);
            }
            return;
          } catch {
            localStorage.removeItem(KEY); // deleted or gone — start fresh
          }
        }
        const p = await api.post<{ id: string }>('/projects', { title: '🎧 Listen sessions', genre: 'afrobeats', bpm: 103 });
        localStorage.setItem(KEY, p.id);
        if (!cancelled) setProjectId(p.id);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };

  }, []);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-3xl">
        The studio <span className="text-gradient">learns</span> — three ways in
      </h1>
      <p className="mt-2 max-w-xl text-sm text-slate-400">
        <span className="text-slate-200">1 · Learn from a song</span> — play it out loud (Shazam-style) or drop a file; the AI hears the drums, groove, bass and voice.{' '}
        <span className="text-slate-200">2 · Learn from a lyric</span> — paste any lyrics; it studies the craft, never the words.{' '}
        <span className="text-slate-200">3 · Learn my sound</span> — feed it your own catalog. Everything lands in one library that every
        new song pulls from — and it compounds.
      </p>

      {err && <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">Couldn’t start a session: {err}</div>}
      {!projectId && !err && <div className="mt-8 text-sm text-slate-500">Setting up your session…</div>}

      {projectId && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm text-slate-200">What are you teaching it right now?</div>
          <p className="mt-1 text-xs text-slate-500">
            Everything you play or upload files into THIS lane’s training. The AI still detects the genre from the audio — this
            sets its starting hint and where an undetected track lands.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button
                key={g.value}
                onClick={() => void pickGenre(g.value)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  genre === g.value ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {projectId && <ReferenceListen projectId={projectId} />}
      {projectId && <LearnFromLyrics projectId={projectId} />}
      {projectId && <LearnMySound projectId={projectId} />}
      {projectId && <TrainingSession projectId={projectId} />}
    </div>
  );
}
