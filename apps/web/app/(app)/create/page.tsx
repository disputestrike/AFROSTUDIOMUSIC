'use client';

/**
 * The front door. Pick what you actually want — genre, mood, tempo, language —
 * then open a studio where you can attach a beat, play a reference track,
 * record vocals, batch-produce, mix, and release. No long chat required.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

const GENRES: { value: string; label: string }[] = [
  { value: 'afrobeats', label: 'Afrobeats' },
  { value: 'afro_fusion', label: 'Afro-fusion' },
  { value: 'amapiano', label: 'Amapiano' },
  { value: 'afro_dancehall', label: 'Afro-dancehall' },
  { value: 'street_pop', label: 'Street-pop / Zanku' },
  { value: 'afro_rnb', label: 'Afro R&B' },
  { value: 'afro_pop', label: 'Afropop' },
  { value: 'highlife', label: 'Highlife' },
  { value: 'gospel', label: 'Gospel' },
  { value: 'hip_hop', label: 'Hip-hop' },
  { value: 'reggae', label: 'Reggae' },
];

const LANGS: { value: string; label: string }[] = [
  { value: 'pcm', label: 'Pidgin' },
  { value: 'en', label: 'English' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'ig', label: 'Igbo' },
  { value: 'ha', label: 'Hausa' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'sw', label: 'Swahili' },
  { value: 'zu', label: 'Zulu' },
  { value: 'twi', label: 'Twi' },
];

const MOODS = ['confident', 'love', 'heartbreak', 'party', 'vibey', 'spiritual', 'hustle', 'nostalgic', 'sexy', 'triumphant'];

export default function CreatePage() {
  const api = useApi();
  const router = useRouter();
  const [genre, setGenre] = useState('afrobeats');
  const [mood, setMood] = useState('confident');
  const [bpm, setBpm] = useState(103);
  const [langs, setLangs] = useState<string[]>(['pcm', 'en']);
  const [vibe, setVibe] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleLang = (l: string) => setLangs((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));

  async function create(mode: 'workspace' | 'produce') {
    setBusy(true);
    try {
      const genreLabel = GENRES.find((g) => g.value === genre)?.label ?? genre;
      const title = vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
      const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
      const q = new URLSearchParams();
      if (mode === 'produce') {
        // Hand the studio a ready-made brief so it can auto-produce immediately.
        const langNames = langs.map((l) => LANGS.find((x) => x.value === l)?.label ?? l).join('/');
        q.set(
          'produce',
          `${genreLabel} ${mood} song, ${bpm}bpm, ${langNames}${vibe ? `, ${vibe.trim()}` : ''}. Take it all the way — full sung song, cover, and a clip.`
        );
      }
      router.push(`/projects/${project.id}${q.toString() ? `?${q}` : ''}`);
    } catch (e) {
      setBusy(false);
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-5xl">Make a song</h1>
      <p className="mt-2 text-sm text-slate-400">Pick your sound. Next screen: attach a beat, play a reference, record vocals, auto-produce, mix, and release — all in one place.</p>

      {/* Genre */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-slate-400">Genre</div>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <button key={g.value} onClick={() => setGenre(g.value)} className={`rounded-full px-4 py-2 text-sm transition ${genre === g.value ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-slate-400">Mood</div>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <button key={m} onClick={() => setMood(m)} className={`rounded-full px-3.5 py-1.5 text-sm capitalize transition ${mood === m ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* BPM */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
          <span>Tempo</span>
          <span className="tabular-nums text-slate-200">{bpm} BPM</span>
        </div>
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-afrobrand-500" />
      </div>

      {/* Languages */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-slate-400">Languages</div>
        <div className="flex flex-wrap gap-2">
          {LANGS.map((l) => (
            <button key={l.value} onClick={() => toggleLang(l.value)} className={`rounded-full px-3.5 py-1.5 text-sm transition ${langs.includes(l.value) ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vibe */}
      <div className="mt-6">
        <div className="mb-2 text-sm text-slate-400">Vibe / reference (optional)</div>
        <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="e.g. smooth Wizkid lane, rainy-day love, chant-along hook" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm" />
      </div>

      {/* Actions */}
      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={() => void create('produce')} disabled={busy} className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:opacity-50">
          {busy ? 'Opening…' : '⚡ Auto-produce this'}
        </button>
        <button onClick={() => void create('workspace')} disabled={busy} className="rounded-full border border-white/15 bg-white/5 px-6 py-3 font-medium hover:bg-white/10 disabled:opacity-50">
          🎛️ Open studio (attach beat / play a track / record)
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Every tool — upload a beat, import a link, play a track for the AI to match, record vocals, mixer, batch Drop Machine, clip maker, and release — lives in the studio you open.</p>
    </div>
  );
}
