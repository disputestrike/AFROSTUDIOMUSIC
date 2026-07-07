'use client';

/**
 * LEARN FROM A LYRIC — bring ANY lyrics and the studio STUDIES them into the
 * library: hook mechanics, flow, repetition engine, code-switching, imagery
 * field. It stores the CRAFT (patterns/technique — legally uncopyrightable
 * facts), never the words. Every future hook + lyric pulls from what it
 * learned here. The craft card is the proof.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { BookOpenText, Loader2, Check, Rocket } from 'lucide-react';

interface Craft {
  craftTitle: string;
  genre: string;
  mode: string;
  themes: string[];
  hookMechanics: string;
  flow: string;
  repetitionEngine: string;
  codeSwitching: string;
  imageryPalette: string;
  craftLessons: string[];
}

export function LearnFromLyrics({ projectId }: { projectId: string }) {
  const api = useApi();
  const [lyrics, setLyrics] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ craft: Craft; lyricCraftInLibrary: number; alreadyLearned?: boolean } | null>(null);

  async function learn() {
    if (lyrics.trim().length < 40 || busy) return;
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const res = await api.post<{ craft: Craft; lyricCraftInLibrary: number }>(`/projects/${projectId}/lyrics/learn`, { lyrics });
      setResult(res);
    } catch (e) {
      setErr((e as Error).message.slice(0, 180));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-display text-2xl">
        <BookOpenText className="h-6 w-6 text-afrobrand-400" /> Learn from a <span className="text-gradient">lyric</span>
      </h2>
      <p className="mt-1 max-w-xl text-sm text-slate-400">
        Paste any lyrics — the studio studies <span className="text-slate-200">why they work</span> (the hook mechanics, the flow,
        the repetition, the language switches) and adds those lessons to its library.
        It keeps the <span className="text-slate-200">craft, never the words</span> — then every new hook and lyric writes sharper.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={7}
          placeholder="Paste the lyrics to study (at least a verse + hook)…"
          className="w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-afrobrand-500/50 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void learn()}
            disabled={busy || lyrics.trim().length < 40}
            className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpenText className="h-4 w-4" />}
            {busy ? 'Studying the craft…' : 'Learn this style'}
          </button>
          {lyrics.trim().length > 0 && lyrics.trim().length < 40 && <span className="text-xs text-slate-500">a bit more — paste at least a verse</span>}
        </div>

        {err && <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}

        {result && (
          <div className="mt-5 border-t border-white/5 pt-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-500">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> {result.alreadyLearned ? 'Already studied — here’s the lesson' : 'Learned'} — in the library ({result.lyricCraftInLibrary} lyric{result.lyricCraftInLibrary === 1 ? '' : 's'} studied)
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-afrobrand-500/15 px-2.5 py-1 text-xs text-afrobrand-300">{result.craft.craftTitle || 'learned style'}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{(result.craft.genre || '').replace(/_/g, ' ')}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">{(result.craft.mode || '').replace(/_/g, ' ')}</span>
              {(result.craft.themes ?? []).slice(0, 4).map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400">{t}</span>
              ))}
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
              {result.craft.hookMechanics && <li className="rounded-lg border border-white/10 bg-black/20 p-2.5"><span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">hook</span>{result.craft.hookMechanics}</li>}
              {result.craft.flow && <li className="rounded-lg border border-white/10 bg-black/20 p-2.5"><span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">flow</span>{result.craft.flow}</li>}
              {(result.craft.craftLessons ?? []).map((l, i) => (
                <li key={i} className="rounded-lg border border-white/10 bg-black/20 p-2.5"><span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">lesson</span>{l}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">Every new hook and lyric now pulls from these lessons automatically.</p>

            {/* THE BRIDGE: learned → now go make one that OUTDOES it. */}
            <Link
              href={`/create?genre=${encodeURIComponent(result.craft.genre || 'afrobeats')}&vibe=${encodeURIComponent(
                `outdo the style just studied (${result.craft.craftTitle || 'the lesson'}): ${(result.craft.craftLessons ?? []).slice(0, 2).join('; ')}`.slice(0, 280)
              )}`}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow"
            >
              <Rocket className="h-4 w-4" /> Make a song that outdoes this
            </Link>
            <p className="mt-1.5 text-[11px] text-slate-500">Opens Create pre-loaded with the lesson — the studio treats it as the floor, not the ceiling.</p>
          </div>
        )}
      </div>
    </section>
  );
}
