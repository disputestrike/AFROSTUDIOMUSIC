'use client';

/**
 * WORD BANK — thousands of authentic African/diaspora terms across Pidgin,
 * Yoruba, Igbo, Hausa, Ghanaian Twi/Ga, Swahili + theme/drum/ad-lib/proverb
 * banks. Search, filter by language + category, add your own. Every hook and
 * lyric the studio writes now draws a fresh slice from here — the fix for
 * "small words, same words every song".
 */

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { BookText, Search, Plus, Loader2, Trash2 } from 'lucide-react';

interface Entry { id: string; term: string; language: string; category: string; register: string | null; meaning: string | null; example: string | null; source: string; workspaceId: string | null }
interface Stats { total: number; byLanguage: Array<{ language: string; count: number }>; byCategory: Array<{ category: string; count: number }> }

const LANG_LABEL: Record<string, string> = { pcm: 'Pidgin', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', twi: 'Twi/Ga', sw: 'Swahili', en: 'English', mixed: 'Mixed', motif: 'Motif' };

export default function LexiconPage() {
  const api = useApi();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [cat, setCat] = useState('');
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ term: '', language: 'pcm', category: 'slang', meaning: '' });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (lang) params.set('language', lang);
      if (cat) params.set('category', cat);
      const res = await api.get<{ entries: Entry[] }>(`/lexicon?${params.toString()}`);
      setEntries(res.entries);
      setErr('');
    } catch (e) {
      setErr((e as Error).message.slice(0, 160));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lang, cat]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get<Stats>('/lexicon/stats').then(setStats).catch(() => {}); /* eslint-disable-next-line */ }, []);

  async function add() {
    if (draft.term.trim().length < 1 || adding) return;
    setAdding(true);
    try {
      await api.post('/lexicon', { ...draft, term: draft.term.trim(), meaning: draft.meaning.trim() || undefined });
      setDraft({ ...draft, term: '', meaning: '' });
      await load();
      api.get<Stats>('/lexicon/stats').then(setStats).catch(() => {});
    } catch (e) {
      setErr((e as Error).message.slice(0, 120));
    } finally {
      setAdding(false);
    }
  }

  async function remove(e: Entry) {
    if (!e.workspaceId) return; // shared, not deletable
    setEntries((cur) => (cur ?? []).filter((x) => x.id !== e.id));
    await api.del(`/lexicon/${e.id}`).catch(() => void load());
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="flex items-center gap-2.5 font-display text-3xl">
        <BookText className="h-7 w-7 text-afrobrand-400" /> Word <span className="text-gradient">bank</span>
        {stats && <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-sm font-normal text-slate-400">{stats.total.toLocaleString()} terms</span>}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Authentic African &amp; diaspora words — Pidgin, Yoruba, Igbo, Hausa, Twi, Swahili, plus theme, drum, ad-lib and proverb banks.
        Every hook and lyric pulls a fresh slice from here so the writing stays wide. Add your own anytime.
      </p>

      {stats && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {stats.byLanguage.map((l) => (
            <button key={l.language} onClick={() => setLang(lang === l.language ? '' : l.language)}
              className={`rounded-full px-2.5 py-1 text-xs ${lang === l.language ? 'bg-afrobrand-500/25 text-afrobrand-200' : 'border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
              {LANG_LABEL[l.language] ?? l.language} · {l.count}
            </button>
          ))}
        </div>
      )}
      {stats && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stats.byCategory.map((c) => (
            <button key={c.category} onClick={() => setCat(cat === c.category ? '' : c.category)}
              className={`rounded-full px-2.5 py-1 text-xs ${cat === c.category ? 'bg-afrobrand-500/25 text-afrobrand-200' : 'border border-white/10 bg-white/5 text-slate-500 hover:bg-white/10'}`}>
              {c.category} · {c.count}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
        <Search className="h-4 w-4 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms…" className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none" />
        {(lang || cat) && <button onClick={() => { setLang(''); setCat(''); }} className="text-xs text-slate-500 hover:text-slate-300">clear filters</button>}
      </div>

      {/* Add your own */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <input value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder="new term / phrase" className="w-40 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-slate-200" />
        <select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-200">
          {['pcm', 'yo', 'ig', 'ha', 'twi', 'sw', 'en', 'mixed', 'motif'].map((l) => <option key={l} value={l}>{LANG_LABEL[l] ?? l}</option>)}
        </select>
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-200">
          {['slang', 'love', 'street', 'party', 'faith', 'proverb', 'dance', 'drums', 'places', 'adlib', 'motif', 'music'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={draft.meaning} onChange={(e) => setDraft({ ...draft, meaning: e.target.value })} placeholder="meaning (optional)" className="flex-1 min-w-[140px] rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-slate-200" />
        <button onClick={() => void add()} disabled={adding || !draft.term.trim()} className="flex items-center gap-1.5 rounded-full bg-brand-gradient px-3.5 py-1.5 text-sm font-medium text-ink disabled:opacity-50">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
        </button>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>}
      {entries === null && !err && <div className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the word bank…</div>}

      {entries && (
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => (
            <div key={e.id} className="group rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-slate-100">{e.term}</span>
                <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{LANG_LABEL[e.language] ?? e.language}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>{e.category}</span>{e.register && <span>· {e.register}</span>}
                {e.workspaceId && (
                  <button onClick={() => void remove(e)} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" title="Remove your addition"><Trash2 className="h-3 w-3 text-red-400" /></button>
                )}
              </div>
              {e.meaning && <div className="mt-1 text-xs text-slate-400">{e.meaning}</div>}
            </div>
          ))}
          {entries.length === 0 && <div className="text-sm text-slate-500">No terms match — try a different filter, or add one above.</div>}
        </div>
      )}
    </div>
  );
}
