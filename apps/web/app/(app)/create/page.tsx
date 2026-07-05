'use client';

/**
 * The front door. Pick your sound → "Create the song" produces it RIGHT HERE
 * (hooks → A&R pick → lyrics → sung song) and plays it back. No navigation.
 * "Bring my own" is a separate intent that opens the full studio.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

const GENRES = [
  { value: 'afrobeats', label: 'Afrobeats' }, { value: 'afro_fusion', label: 'Afro-fusion' },
  { value: 'amapiano', label: 'Amapiano' }, { value: 'afro_dancehall', label: 'Afro-dancehall' },
  { value: 'street_pop', label: 'Street-pop / Zanku' }, { value: 'afro_rnb', label: 'Afro R&B' },
  { value: 'afro_pop', label: 'Afropop' }, { value: 'highlife', label: 'Highlife' },
  { value: 'gospel', label: 'Gospel' }, { value: 'hip_hop', label: 'Hip-hop' }, { value: 'reggae', label: 'Reggae' },
];
const LANGS = [
  { value: 'pcm', label: 'Pidgin' }, { value: 'en', label: 'English' }, { value: 'yo', label: 'Yoruba' },
  { value: 'ig', label: 'Igbo' }, { value: 'ha', label: 'Hausa' }, { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' }, { value: 'sw', label: 'Swahili' }, { value: 'zu', label: 'Zulu' }, { value: 'twi', label: 'Twi' },
];
const MOODS = ['confident', 'love', 'heartbreak', 'party', 'vibey', 'spiritual', 'hustle', 'nostalgic', 'sexy', 'triumphant'];
const STEPS = ['Setting up your session', 'Writing hooks + A&R picking the best', 'Writing the lyrics', 'Singing & producing your song'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CreatePage() {
  const api = useApi();
  const router = useRouter();
  const [genre, setGenre] = useState('afrobeats');
  const [mood, setMood] = useState('confident');
  const [bpm, setBpm] = useState(103);
  const [langs, setLangs] = useState<string[]>(['pcm', 'en']);
  const [vibe, setVibe] = useState('');

  const [phase, setPhase] = useState<'form' | 'producing' | 'done' | 'error'>('form');
  const [stepIdx, setStepIdx] = useState(0);
  const [err, setErr] = useState('');
  const [song, setSong] = useState<{ title: string; hook?: string; score: number | null; url: string; projectId: string } | null>(null);

  const toggleLang = (l: string) => setLangs((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const genreLabel = GENRES.find((g) => g.value === genre)?.label ?? genre;

  async function createSong() {
    setPhase('producing');
    setStepIdx(0);
    setErr('');
    try {
      const title = vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
      const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
      setStepIdx(1);
      const langNames = langs.map((l) => LANGS.find((x) => x.value === l)?.label ?? l).join('/');
      const theme = `${genreLabel} ${mood} song, ${bpm}bpm, ${langNames}${vibe ? `, ${vibe.trim()}` : ''}. Make it catchy and current.`;
      // This one call runs hooks → A&R pick → lyrics → queues the sung song.
      const drop = await api.post<{ drop: Array<{ jobId?: string; hookText?: string; score: number | null; error?: string }> }>(
        `/projects/${project.id}/drop`,
        { theme, count: 1, genre, bpm, withVocals: true }
      );
      const item = drop.drop?.[0];
      if (!item?.jobId) throw new Error(item?.error === 'insufficient_credits' ? 'Daily limit reached — try again tomorrow.' : item?.error || 'Could not start production.');
      setStepIdx(3);
      // Poll for the rendered audio.
      let url: string | null = null;
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const job = await api.get<{ status: string }>(`/jobs/${item.jobId}`);
        if (job.status === 'SUCCEEDED') {
          const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${project.id}/beats`);
          url = beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url ?? null;
          break;
        }
        if (job.status === 'FAILED') throw new Error('The render failed — try again.');
      }
      if (!url) throw new Error('Still rendering — check the studio in a minute.');
      setSong({ title, hook: item.hookText, score: item.score, url, projectId: project.id });
      setPhase('done');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  async function openStudio() {
    const title = vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
    const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
    router.push(`/projects/${project.id}`);
  }

  // ---- Producing ----
  if (phase === 'producing') {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <div className="animate-pulse font-display text-3xl text-gradient">Creating your {genreLabel} song…</div>
        <p className="mt-2 text-sm text-slate-400">This takes about a minute or two. Stay here — it’s making it now.</p>
        <ul className="mx-auto mt-8 max-w-sm space-y-3 text-left">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${i < stepIdx ? 'bg-emerald-500/25 text-emerald-300' : i === stepIdx ? 'bg-brand-gradient text-ink' : 'bg-white/5 text-slate-500'}`}>
                {i < stepIdx ? '✓' : i === stepIdx ? '●' : i + 1}
              </span>
              <span className={i <= stepIdx ? 'text-slate-200' : 'text-slate-500'}>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // ---- Done ----
  if (phase === 'done' && song) {
    return (
      <div className="mx-auto max-w-lg px-6 py-14 text-center">
        <div className="rounded-3xl border-gradient glass p-6 shadow-card">
          <div className="mx-auto flex aspect-square w-full max-w-xs items-center justify-center rounded-2xl bg-brand-gradient text-ink shadow-glow">
            <span className="font-display text-5xl">♪</span>
          </div>
          <h1 className="mt-5 font-display text-3xl">{song.title}</h1>
          {song.hook && <p className="mt-1 text-sm text-slate-400">“{song.hook.replace(/\(response:.*/i, '').trim()}”</p>}
          {song.score != null && <div className="mt-1 text-xs text-afrobrand-300">A&R score {song.score.toFixed(1)}</div>}
          <audio controls autoPlay className="mt-5 w-full" src={song.url} />
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => { setSong(null); setPhase('form'); }} className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">
              ✨ Make another
            </button>
            <button onClick={() => router.push(`/projects/${song.projectId}`)} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm hover:bg-white/10">
              🎬 Cover, mix, clip &amp; release →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error ----
  if (phase === 'error') {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <div className="font-display text-2xl">Couldn’t finish that one</div>
        <p className="mt-2 text-sm text-red-400">{err}</p>
        <button onClick={() => setPhase('form')} className="mt-6 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">Try again</button>
      </div>
    );
  }

  // ---- Form ----
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-5xl">Make a song</h1>
      <p className="mt-2 text-sm text-slate-400">Pick your sound and hit create — it makes the whole song right here.</p>

      <Picker label="Genre" items={GENRES} value={genre} onPick={setGenre} />
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Mood</div>
        <div className="flex flex-wrap gap-2">{MOODS.map((m) => (
          <button key={m} onClick={() => setMood(m)} className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${mood === m ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{m}</button>
        ))}</div>
      </div>
      <div className="mt-6">
        <div className="mb-2 flex justify-between text-sm text-slate-400"><span>Tempo</span><span className="tabular-nums text-slate-200">{bpm} BPM</span></div>
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-afrobrand-500" />
      </div>
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Languages</div>
        <div className="flex flex-wrap gap-2">{LANGS.map((l) => (
          <button key={l.value} onClick={() => toggleLang(l.value)} className={`rounded-full px-3.5 py-1.5 text-sm ${langs.includes(l.value) ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{l.label}</button>
        ))}</div>
      </div>
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Vibe / what it’s about (optional)</div>
        <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="e.g. rainy-day love, smooth Wizkid lane, chant-along hook" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm" />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button onClick={() => void createSong()} className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow">
          ⚡ Create the song
        </button>
        <button onClick={() => void openStudio()} className="rounded-full border border-white/15 bg-white/5 px-6 py-3 font-medium hover:bg-white/10">
          🎤 I’ll bring my own beat / voice
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">“Create the song” makes it here, start to finish. “Bring my own” opens the studio to upload a beat, play a reference, or record.</p>
    </div>
  );
}

function Picker({ label, items, value, onPick }: { label: string; items: { value: string; label: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((g) => (
          <button key={g.value} onClick={() => onPick(g.value)} className={`rounded-full px-4 py-2 text-sm ${value === g.value ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>{g.label}</button>
        ))}
      </div>
    </div>
  );
}
