'use client';
import { genreSignature } from '@afrohit/shared';

/**
 * The front door. Pick your sound → "Create the song" produces it RIGHT HERE
 * (hooks → A&R pick → lyrics → sung song) and plays it back. No navigation.
 * "Bring my own" is a separate intent that opens the full studio.
 */

import { useEffect, useRef, useState } from 'react';
import { BringYourOwn } from '@/components/BringYourOwn';
import { MumbleBooth } from '@/components/MumbleBooth';
import WorkspaceLibrary from '@/components/WorkspaceLibrary';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

// ALL genres — Afro core + global. Every entry has full Sound DNA + current-trend
// enrichment behind it (packages/ai/src/sound-dna), so the front door offers the
// whole library, not just the Afro lanes.
const GENRES = [
  // Afro / diaspora core
  { value: 'afrobeats', label: 'Afrobeats' }, { value: 'afro_fusion', label: 'Afro-fusion' },
  { value: 'amapiano', label: 'Amapiano' }, { value: 'afro_dancehall', label: 'Afro-dancehall' },
  { value: 'street_pop', label: 'Street-pop / Zanku' }, { value: 'afro_rnb', label: 'Afro R&B' },
  { value: 'afro_pop', label: 'Afropop' }, { value: 'afro_soul', label: 'Afro-soul' }, { value: 'highlife', label: 'Highlife' },
  { value: 'gospel', label: 'Gospel' }, { value: 'afro_gospel', label: 'Afro-gospel' },
  { value: 'worship', label: 'Worship' }, { value: 'praise', label: 'Praise' }, { value: 'spiritual', label: 'Spiritual' },
  { value: 'hip_hop', label: 'Hip-hop / Rap' }, { value: 'reggae', label: 'Reggae' }, { value: 'alte', label: 'Alté' },
  // African continental
  { value: 'gqom', label: 'Gqom' }, { value: 'kwaito', label: 'Kwaito' }, { value: 'afro_house', label: 'Afro house' },
  { value: 'bongo_flava', label: 'Bongo Flava' }, { value: 'azonto', label: 'Azonto' },
  { value: 'coupe_decale', label: 'Coupé-Décalé' }, { value: 'ndombolo', label: 'Ndombolo' },
  { value: 'soukous', label: 'Soukous' }, { value: 'fuji', label: 'Fuji' },
  { value: 'juju', label: 'Jùjú' }, { value: 'apala', label: 'Apala' },
  // Global
  { value: 'pop', label: 'Pop' }, { value: 'rnb', label: 'R&B' },
  { value: 'dancehall', label: 'Dancehall' }, { value: 'drill', label: 'Drill' },
  { value: 'trap', label: 'Trap' }, { value: 'house', label: 'House' },
  { value: 'edm', label: 'EDM' }, { value: 'reggaeton', label: 'Reggaeton' },
  { value: 'latin_pop', label: 'Latin pop' }, { value: 'country', label: 'Country' },
  { value: 'rock', label: 'Rock' }, { value: 'soul', label: 'Soul' },
  { value: 'jazz', label: 'Jazz' }, { value: 'funk', label: 'Funk' },
  { value: 'blues', label: 'Blues' }, { value: 'lofi', label: 'Lo-fi' },
];
const LANGS = [
  { value: 'pcm', label: 'Pidgin' }, { value: 'en', label: 'English' }, { value: 'yo', label: 'Yoruba' },
  { value: 'ig', label: 'Igbo' }, { value: 'ha', label: 'Hausa' }, { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' }, { value: 'sw', label: 'Swahili' }, { value: 'zu', label: 'Zulu (isiZulu)' }, { value: 'twi', label: 'Twi' },
  { value: 'xh', label: 'Xhosa (isiXhosa)' }, { value: 'st', label: 'Sesotho' }, { value: 'tn', label: 'Setswana' }, { value: 'tsotsitaal', label: 'Tsotsitaal (SA street)' },
  { value: 'ln', label: 'Lingala' }, { value: 'wo', label: 'Wolof' }, { value: 'bm', label: 'Bambara' }, { value: 'nouchi', label: 'Nouchi (Ivorian street)' },
  { value: 'es', label: 'Spanish' }, { value: 'ar', label: 'Arabic' }, { value: 'ht', label: 'Haitian Creole' }, { value: 'kriolu', label: 'Kriolu (Cape Verde)' }, { value: 'am', label: 'Amharic' }, { value: 'patois', label: 'Jamaican Patois' },
];
// MOODS — the emotional registers a real producer actually reaches for (the
// groove/feel vocabulary, not random adjectives).
const MOODS = [
  'confident', 'love', 'heartbreak', 'party', 'groovy', 'joyful', 'uplifting',
  'praise', 'worship', 'spiritual', 'prayerful', 'meditation',
  'chill', 'laid-back', 'hypnotic', 'bouncy', 'energetic', 'anthemic',
  'romantic', 'intimate', 'sexy', 'nostalgic', 'melancholy', 'dark',
  'street', 'hustle', 'triumphant', 'luxury', 'lifestyle', 'family',
  'gratitude', 'summer', 'motivation', 'freedom',
];
// INSTRUMENTS — explicit picks the artist can feature. Steering on provider
// engines (they're black boxes); exact on the own engine (per-role loops).
const INSTRUMENTS = [
  'log drum', 'talking drum', 'shekere', 'congas', 'djembe', 'steel pan',
  'saxophone', 'trumpet', 'brass section', 'flute', 'kalimba', 'balafon',
  'highlife guitar', 'palm-wine guitar', 'piano', 'rhodes', 'organ', 'strings',
  'warm sub bass', 'amapiano log bass', 'synth pads', 'kora',
];
const STEPS = ['Setting up your session', 'Writing hooks + A&R picking the best', 'Writing the lyrics', 'Singing & producing your song'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isExplicitPaymentRequired(error: unknown): boolean {
  return error instanceof Error && /^402(?:\s|$)/.test(error.message);
}

interface Deconstruction {
  title: string;
  languages: string[];
  mode: string;
  themes: string[];
  structure: string[];
  hookLine: string | null;
  suggestedGenre: string;
  suggestedBpm: number;
  mood: string;
  vocalDirection: string;
  notes: string;
}

export default function CreatePage() {
  const api = useApi();
  const router = useRouter();

  // STICKY PRODUCTION — the producing view must survive tab-backgrounding /
  // remounts (mobile reloads during a 3-12 min render were dumping users back
  // to a blank form while the song kept cooking). State persists; mount resumes.
  const PRODUCE_KEY = 'afrohit.produce.v1';
  const saveProduce = (patch: Record<string, unknown>) => {
    try {
      const cur = JSON.parse(sessionStorage.getItem(PRODUCE_KEY) ?? '{}');
      sessionStorage.setItem(PRODUCE_KEY, JSON.stringify({ ...cur, ...patch, at: Date.now() }));
      // STICKY MARKER = ?resume=1, NOT ?produce=1. produce=1 is the AUTO-CREATE
      // intent param (links from Zap/Listen) — mobile browsers evict
      // sessionStorage but RESTORE the URL, so marking the sticky state with
      // produce=1 made every tab-restore fire a brand-new render ("it keeps
      // creating for days"). resume=1 only resumes; it can never create.
      window.history.replaceState(null, '', '?resume=1');
    } catch { /* storage unavailable — non-fatal */ }
  };
  const clearProduce = () => {
    try { sessionStorage.removeItem(PRODUCE_KEY); window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
  };
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return; resumedRef.current = true;
    let saved: { dropJobId?: string; renderJobId?: string; projectId?: string; title?: string; hook?: string; score?: number | null; at?: number } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(PRODUCE_KEY) ?? 'null'); } catch { saved = null; }
    if (!saved || !(saved.dropJobId || saved.renderJobId) || Date.now() - (saved.at ?? 0) > 30 * 60 * 1000) {
      // Nothing valid to resume (or too old): clear ONLY the sticky state and the
      // resume marker. NEVER wipe the whole query string here — that destroyed
      // Zap/Listen intent links (?produce=1&genre=...) before the prefill effect
      // could read them, breaking "Make in this lane" entirely.
      try { sessionStorage.removeItem(PRODUCE_KEY); } catch { /* noop */ }
      const q = new URLSearchParams(window.location.search);
      if (q.get('resume') === '1') {
        q.delete('resume');
        window.history.replaceState(null, '', q.toString() ? `${window.location.pathname}?${q}` : window.location.pathname);
      }
      // Only fall back to the form when there is NO auto-create intent pending.
      if (phase === 'producing' && q.get('produce') !== '1') setPhase('form');
      return;
    }
    setPhase('producing'); setStepIdx(saved.renderJobId ? 3 : 1);
    void (async () => {
      const dropJobId = saved!.dropJobId; let renderJobId = saved!.renderJobId; let projectId = saved!.projectId;
      let hook = saved!.hook ?? ''; let score = saved!.score ?? null; let title = saved!.title ?? 'Your song';
      try {
        for (let i = 0; i < 200; i++) {
          const id = renderJobId ?? dropJobId; if (!id) break;
          let j: { status: string; error?: string | null; errorJson?: { message?: string } | null; outputJson?: { drop?: Array<{ jobId?: string; projectId?: string; title?: string; hookText?: string; score: number | null }> } };
          try { j = await api.get(`/jobs/${id}`); } catch { await sleep(6000); continue; }
          if (j.status === 'FAILED') { setErr(`That render failed — ${j.errorJson?.message ?? j.error ?? 'no reason recorded'}. Start another take.`); setPhase('error'); clearProduce(); return; }
          if (j.status === 'SUCCEEDED') {
            if (!renderJobId && dropJobId) {
              const item = j.outputJson?.drop?.[0];
              if (!item?.jobId) { setSong({ title, hook, score, url: '', projectId: projectId ?? '' }); setPhase('finishing'); clearProduce(); return; }
              renderJobId = item.jobId; projectId = item.projectId ?? projectId; hook = item.hookText ?? hook; score = item.score ?? score; title = item.title ?? title;
              saveProduce({ renderJobId, projectId, title, hook, score }); setStepIdx(3); continue;
            }
            let url = '';
            if (projectId) {
              try {
                const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${projectId}/beats`);
                url = beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url ?? '';
              } catch { /* land in Catalog */ }
            }
            setSong({ title, hook, score, url, projectId: projectId ?? '' });
            if (url) { setNowPlaying({ title, url }); setLibRefresh((n) => n + 1); setPhase('form'); }
            else setPhase('finishing');
            clearProduce(); return;
          }
          await sleep(5000);
        }
        // Poll budget exhausted — the render may still land server-side, but the
        // SCREEN must terminate: hand off to the Catalog and clear the sticky
        // state so no future mount resumes a zombie ("never stops on mobile").
        setSong({ title, hook, score, url: '', projectId: projectId ?? '' });
        setPhase('finishing'); clearProduce();
      } catch { setSong({ title: 'Your song', score: null, url: '', projectId: '' }); setPhase('finishing'); clearProduce(); }
    })();

  }, []);
  // MULTI-GENRE: first pick = the backbone; a second pick FUSES into it.
  const [genres, setGenres] = useState<string[]>(['afrobeats']);
  // Has the user (or a prefill) actually chosen a genre? Until then the shown
  // 'afrobeats' is just a default, and the first tap REPLACES it.
  const [genreTouched, setGenreTouched] = useState(false);
  const [mood, setMood] = useState('confident');
  const [bpm, setBpm] = useState(103);
  const bpmTouched = useRef(false);
  const langsTouched = useRef(false);
  const [langs, setLangs] = useState<string[]>(['pcm', 'en']);
  const [vibe, setVibe] = useState('');
  const [songName, setSongName] = useState('');
  const [singName, setSingName] = useState(true);
  const [voice, setVoice] = useState<'auto' | 'female' | 'male' | 'duet' | 'group'>('auto');
  // A zap/listen reference pinned via ?pin= — its recipe LEADS the engine brief.
  const [pinnedRef, setPinnedRef] = useState<string | null>(null);
  // WO-5: takes rendered for this song — 1 = cheap draft; 2-3 = the ear picks
  // among DIFFERENT directions (costs that many renders).
  const [takes, setTakes] = useState<1 | 2 | 3>(1);
  const [influence, setInfluence] = useState('');
  // Explicit instrument picks — featured prominently in the render's style
  // prompt (steering on provider engines; exact on the own engine).
  const [instruments, setInstruments] = useState<string[]>([]);
  // 'auto' lets the backend choose from routes connected for this workspace.
  const [engine, setEngine] = useState<'auto' | 'suno' | 'eleven' | 'ace_step' | 'minimax'>('auto');
  const [musicRoutes, setMusicRoutes] = useState<{ flagship: boolean; advanced: boolean; standard: boolean } | null>(null);
  useEffect(() => {
    void api.get<{ flagship: boolean; advanced: boolean; standard: boolean }>('/settings/music-capabilities')
      .then(setMusicRoutes)
      .catch(() => setMusicRoutes({ flagship: false, advanced: false, standard: false }));
  }, [api]);
  const hasMusicRoute = musicRoutes !== null
    && (musicRoutes.flagship || musicRoutes.advanced || musicRoutes.standard);

  // Three ways in: describe it / bring your own lyrics / listen & recreate.
  const [path, setPath] = useState<'song' | 'lyrics' | 'mumble'>('song');
  const [lyricsText, setLyricsText] = useState('');
  const [decon, setDecon] = useState<Deconstruction | null>(null);
  const [deconBusy, setDeconBusy] = useState(false);
  const [deconTitle, setDeconTitle] = useState('');

  // Start in 'producing' (no form flash) when EITHER an auto-create intent link
  // (?produce=1 from Zap/Lake) or a mid-render sticky marker (?resume=1) is
  // present. The resume effect validates the sticky state and falls back to the
  // form if there is nothing real to resume.
  const [phase, setPhase] = useState<'form' | 'producing' | 'done' | 'finishing' | 'error'>(() => {
    if (typeof window === 'undefined') return 'form';
    const q = new URLSearchParams(window.location.search);
    return q.get('produce') === '1' || q.get('resume') === '1' ? 'producing' : 'form';
  });
  const [stepIdx, setStepIdx] = useState(0);
  const [err, setErr] = useState('');
  const [song, setSong] = useState<{ title: string; hook?: string; score: number | null; url: string; projectId: string } | null>(null);
  // CONSOLE PLAYER (T2): what's playing on the left half under the Create
  // button. New renders land here; library rows play here.
  const [nowPlaying, setNowPlaying] = useState<{ title: string; url: string } | null>(null);
  const [libRefresh, setLibRefresh] = useState(0);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  // Prefill from links like /create?genre=...&mood=...&bpm=...&vibe=...&produce=1
  // e.g. "Make a song that outdoes this" after learning a lyric on /listen.
  // With produce=1 we AUTO-CREATE immediately — the user asked to make a song,
  // so don't dump them back on the form to click again.
  const [autoProduce, setAutoProduce] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get('genre');
    if (g && GENRES.some((x) => x.value === g)) { setGenres([g]); setGenreTouched(true); }
    const m = q.get('mood');
    if (m && MOODS.includes(m)) setMood(m);
    const b = Number(q.get('bpm'));
    if (b >= 60 && b <= 180) { setBpm(Math.round(b)); bpmTouched.current = true; }
    const v = q.get('vibe');
    if (v) setVibe(v.slice(0, 300));
    const inf = q.get('influence');
    const pin = q.get('pin');
    if (pin) setPinnedRef(pin);
    if (inf) setInfluence(inf.slice(0, 100));
    const lg = q.get('languages');
    if (lg) {
      const arr = lg.split(',').map((s) => s.trim()).filter((x) => LANGS.some((l) => l.value === x));
      if (arr.length) { setLangs(arr); langsTouched.current = true; }
    }
    // AUTO-CREATE only on an explicit intent link (?produce=1) AND only when no
    // render is already in flight — never double-create, never fire from a
    // restored tab (the sticky marker is ?resume=1 and never reaches here).
    let inFlight = false;
    try { inFlight = !!sessionStorage.getItem(PRODUCE_KEY); } catch { /* noop */ }
    if (q.get('produce') === '1' && !inFlight) setAutoProduce(true);
    // Clean the URL so a refresh doesn't re-fire the auto-create.
    if (q.toString()) window.history.replaceState(null, '', '/create');
  }, []);

  // Fire the create ONCE, after the prefills above have applied (state is set
  // by the time this effect runs). createSong reads the now-current genre/vibe.
  useEffect(() => {
    // Fire once autoProduce is set. Phase may already be 'producing' (we start
    // there on ?produce=1 to skip the form flash), so don't gate on phase==='form'.
    if (!autoProduce || musicRoutes === null) return;
    setAutoProduce(false);
    if (!hasMusicRoute) {
      setErr('No music engine is connected. Ask an owner to connect one in Settings.');
      setPhase('error');
      return;
    }
    void createSong();

  }, [autoProduce, hasMusicRoute, musicRoutes]);

  // SALIENCE: the software knows each lane's natural tempo and tongue — picking a
  // genre sets them; fusing two BLENDS the tempo; the user's touch always wins.
  useEffect(() => {
    const sigs = genres.slice(0, 2).map((g) => genreSignature(g));
    if (!sigs.length) return;
    const blend = Math.round(sigs.reduce((a, x) => a + x.bpm, 0) / sigs.length);
    if (!bpmTouched.current) setBpm(blend);
    if (!langsTouched.current) {
      const cand = [...new Set(sigs.flatMap((x) => x.languages))].filter((l) => LANGS.some((x) => x.value === l));
      if (cand.length) setLangs(cand);
    }

  }, [genres]);

  const toggleLang = (l: string) => { langsTouched.current = true; setLangs((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l])); };
  const toggleGenre = (g: string) =>
    setGenres((p) => {
      // The FIRST manual pick REPLACES the default backbone — so you can switch
      // the primary genre freely (the old bug: Afrobeats was stuck because tap
      // #1 just ADDED a fusion). After that, tap = toggle/fuse (max 2).
      if (!genreTouched) { setGenreTouched(true); return [g]; }
      if (p.includes(g)) return p.length > 1 ? p.filter((x) => x !== g) : p; // keep at least 1
      return p.length >= 2 ? [p[0]!, g] : [...p, g]; // max 2: backbone + fusion
    });
  const genre = genres[0]!;
  const fusion = genres.slice(1);
  const genreLabel = genres.map((g) => GENRES.find((x) => x.value === g)?.label ?? g).join(' × ');

  async function createSong() {
    setErr('');
    if (!hasMusicRoute) {
      setErr('No music engine is connected. Ask an owner to connect one in Settings.');
      setPhase('error');
      return;
    }
    // PRE-FLIGHT: refuse BEFORE the user commits to a multi-minute wait — never
    // let them sit through "producing…" only to hit the daily cap at the end.
    try {
      const pf = await api.get<{ ok: boolean; mode: string; remainingToday?: number }>('/billing/preflight');
      if (!pf.ok) {
        setErr(pf.mode === 'internal' ? 'Daily limit reached — resets at midnight UTC.' : 'insufficient_credits');
        setPhase('error');
        return;
      }
    } catch { /* preflight is advisory — if it can't be read, proceed */ }
    setPhase('producing');
    setStepIdx(0);
    try {
      const title = songName.trim().slice(0, 80) || vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
      const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
      setStepIdx(1);
      const langNames = langs.map((l) => LANGS.find((x) => x.value === l)?.label ?? l).join('/');
      const influenceLine = influence.trim()
        ? ` In the VIBE/LANE of ${influence.trim()} (capture that energy, tempo and production feel — never copy their melodies/lyrics and never name them in the song).`
        : '';
      const fusionLine = fusion.length ? ` This is a GENRE FUSION: ${genreLabel} — both identities must be clearly audible, something new, never mush.` : '';
      const theme = `${songName.trim() ? (singName ? `SONG TITLE (CREATIVE ANCHOR): "${songName.trim()}" — the HOOK must SING this name (or a natural in-language variant) as its centerpiece; verses orbit its meaning; if the vibe conflicts with the name inside the hook, the NAME wins. The lyric title uses it exactly. ` : `SONG TITLE (LABEL ONLY): "${songName.trim()}" — use it as the title exactly, but do NOT force the phrase into the lyrics. `) : ''}${genreLabel} ${mood} song, ${bpm}bpm, ${langNames}${vibe ? `, ${vibe.trim()}` : ''}. Make it catchy and current.${fusionLine}${influenceLine}`;
      // Fire the Drop Machine — it replies 202 + a job id INSTANTLY and works in
      // the background (holding a 3-minute HTTP request open dies on real
      // networks). We poll the drop job for the hook/lyrics result…
      let started: { jobId: string };
      try {
        started = await api.post<{ jobId: string }>(
        `/projects/${project.id}/drop`,
        { theme, vibe: vibe.trim().slice(0, 500) || undefined, songTitle: songName.trim() || undefined, voice: voice === 'auto' ? undefined : voice, candidates: takes > 1 ? takes : undefined, pinnedReferenceId: pinnedRef || undefined, count: 1, genre, fusionGenres: fusion.length ? fusion : undefined, mood, bpm, withVocals: true, songEngine: engine === 'auto' ? undefined : engine, influence: influence.trim() || undefined, languages: langs, instruments: instruments.length ? instruments : undefined },
        // One key per CLICK: the retry-on-network-death in apiFetch can re-send
        // this POST — the server returns the drop already running instead of
        // starting (and charging) a second one.
        { 'Idempotency-Key': crypto.randomUUID() }
      );
      } catch (error) {
        if (isExplicitPaymentRequired(error)) {
          await api.del('/projects/' + project.id).catch(() => undefined);
        }
        throw error;
      }
      saveProduce({ dropJobId: started.jobId, renderJobId: undefined });
      let item: { jobId?: string; hookText?: string; score: number | null; error?: string } | undefined;
      // Hooks + lyrics run on Claude and can be slow under load — wait up to ~8 min.
      // RESILIENT POLL: a single fetch that fails (phone backgrounded the tab, wifi↔
      // cellular switch, brief network blip) must NOT kill the whole thing — the work
      // keeps running server-side. Retry; only give up after ~2 min of solid failures.
      let dropFailed = false;
      let netFails = 0;
      let dropErr: string | undefined;
      let dropFailReason = '';
      let lastDropStatus = '';
      // LIVE-MEASURED: a full write (hooks → A&R → 2-pass lyrics) took 11 min on
      // prod while this window was 8 — the screen quit before the writer finished
      // and LIED "couldn't finish". Window now 16 min, and a still-RUNNING job at
      // the end hands off calmly instead of erroring.
      for (let i = 0; i < 192; i++) {
        await sleep(5000);
        if (i === 10) setStepIdx(2); // hooks done-ish → writing lyrics
        let j: { status: string; errorJson?: { message?: string } | null; outputJson?: { drop?: Array<typeof item>; error?: string } };
        try { j = await api.get(`/jobs/${started.jobId}`); netFails = 0; }
        catch { if (++netFails >= 24) break; continue; }
        // Top-level error carries WHY when no take rendered (brain down, no hooks).
        lastDropStatus = j.status;
        if (j.status === 'SUCCEEDED') { item = j.outputJson?.drop?.[0]; dropErr = j.outputJson?.error; break; }
        if (j.status === 'FAILED') { dropFailed = true; dropFailReason = j.errorJson?.message ?? ''; break; }
      }
      // Show the SERVER'S reason (e.g. "the studio restarted while writing this
      // song") — the generic line hid restarts/zombies as a brain-keys mystery.
      if (dropFailed) throw new Error(dropFailReason || 'Could not write the song — try again.');
      if (!item?.jobId && lastDropStatus === 'RUNNING') {
        // NOT a failure: the writer is still working past our window. Hand off
        // calmly — the sticky state stays, so reopening resumes the watch, and
        // the song lands in the Catalog when done.
        setSong({ title, hook: undefined, score: null, url: '', projectId: project.id });
        setPhase('finishing');
        return;
      }
      if (!item?.jobId) {
        const e = item?.error || dropErr || '';
        if (!e && netFails >= 24) throw new Error('Connection dropped while the studio kept working — your song did NOT fail; it will land in the Catalog. Reopen this page to resume watching it.');
        // Only call it the cap when it ACTUALLY is — a blank error used to be
        // mislabeled "daily limit reached", hiding a brain/keys outage as a budget
        // problem. Show the real reason the server gave.
        if (/credit|cap|limit|quota|daily/i.test(e)) throw new Error('Daily generation limit reached — it resets at midnight UTC (or raise the cap).');
        throw new Error(e || 'The studio could not start this song — try again, and if it repeats check the API brain keys (ANTHROPIC / OPENAI).');
      }
      saveProduce({ renderJobId: item.jobId, projectId: project.id, title, hook: item.hookText, score: item.score });
      setStepIdx(3);
      // Poll for the rendered audio. Real sung renders take 3-12 min (best-of-N +
      // the provider's rate limit), so wait up to ~12 min — then hand off calmly to
      // the Catalog rather than showing a scary error for a song that IS finishing.
      let url: string | null = null;
      let renderFailed = false;
      let lastJobError: string | null = null;
      netFails = 0;
      for (let i = 0; i < 144; i++) {
        await sleep(5000);
        let job: { status: string; error?: string | null; errorJson?: { message?: string } | null };
        try { job = await api.get(`/jobs/${item.jobId}`); lastJobError = job.errorJson?.message ?? job.error ?? lastJobError; netFails = 0; }
        catch { if (++netFails >= 24) break; continue; } // network blip → retry, render keeps going
        if (job.status === 'SUCCEEDED') {
          try {
            const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${project.id}/beats`);
            url = beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url ?? null;
          } catch { /* beats fetch blip — fall through to the calm Catalog hand-off */ }
          break;
        }
        if (job.status === 'FAILED') { renderFailed = true; break; }
      }
      if (renderFailed) throw new Error(`The render failed — ${lastJobError ?? 'no reason recorded'}. Try again.`);
      if (!url) {
        // Not a failure — the render is just still cooking. Send them to the
        // Catalog where it lands, instead of the red "Couldn't finish that one".
        setSong({ title, hook: item.hookText, score: item.score, url: '', projectId: project.id });
        setPhase('finishing');
        return; // storage kept — reopening resumes the watch
      }
      setSong({ title, hook: item.hookText, score: item.score, url, projectId: project.id });
      // CONSOLE FLOW (T2): play the finished song INLINE under the Create button
      // (console flow) instead of a takeover page; the library refreshes to show it.
      setNowPlaying({ title, url });
      setLibRefresh((n) => n + 1);
      setPhase('form');
      clearProduce();
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  /** FROM-LYRICS step 1: the AI reads YOUR lyrics and fills out what they are. */
  async function deconstruct(textOverride?: string) {
    const text = (textOverride ?? lyricsText).trim();
    if (text.length < 20 || deconBusy) return;
    setDeconBusy(true);
    setErr('');
    try {
      // A scratch project scopes the call; reuse the persistent one if present.
      const KEY = 'afrohit.lyricsProject';
      let pid = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      if (pid) { try { await api.get(`/projects/${pid}`); } catch { pid = null; } }
      if (!pid) {
        const p = await api.post<{ id: string }>('/projects', { title: '📝 From my lyrics', genre: 'afrobeats', bpm: 103 });
        pid = p.id;
        localStorage.setItem(KEY, pid);
      }
      const d = await api.post<Deconstruction>(`/projects/${pid}/lyrics/deconstruct`, { lyrics: text });
      setDecon(d);
      setDeconTitle(d.title);
      // Prefill the shared dials from what it heard — all still editable.
      // bpmTouched is set BEFORE setBpm: setGenres fires the genres-effect, which
      // used to clobber the DETECTED tempo with the genre-signature default.
      if (GENRES.some((g) => g.value === d.suggestedGenre)) setGenres([d.suggestedGenre]);
      bpmTouched.current = true;
      setBpm(d.suggestedBpm);
      if (MOODS.includes(d.mood)) setMood(d.mood);
      // The chips must SHOW what will be sung — the detected languages land on
      // the page (and lock against the genres-effect), so a user re-toggle after
      // deconstruct is real intent the submit can honor.
      const detected = (d.languages ?? []).filter((l) => LANGS.some((x) => x.value === l));
      if (detected.length) { langsTouched.current = true; setLangs(detected); }
    } catch (e) {
      setErr((e as Error).message.slice(0, 160));
    } finally {
      setDeconBusy(false);
    }
  }

  /** FROM-LYRICS step 2: sing EXACTLY these words over a produced record. */
  async function createFromLyrics() {
    // Sing needs LYRICS, not a successful deconstruct — the analyze step can fail
    // (daily cap, malformed JSON) and used to leave this (and the button) dead.
    if (lyricsText.trim().length < 20) return;
    setErr('');
    if (!hasMusicRoute) {
      setErr('No music engine is connected. Ask an owner to connect one in Settings.');
      setPhase('error');
      return;
    }
    try {
      const pf = await api.get<{ ok: boolean; mode: string }>('/billing/preflight').catch(() => ({ ok: true, mode: 'unknown' }));
      if (!pf.ok) { setErr('Daily limit reached — resets at midnight UTC.'); setPhase('error'); return; }
    } catch { /* advisory */ }
    setPhase('producing');
    setStepIdx(0);
    try {
      const title = (deconTitle || decon?.title || 'My lyrics').slice(0, 100);
      const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
      const attached = await api.post<{ songId: string }>(`/projects/${project.id}/lyrics/attach`, { title, body: lyricsText.trim() });
      setStepIdx(3); // straight to singing — the words are already written
      let r: { jobId: string };
      try {
        r = await api.post<{ jobId: string }>(`/projects/${project.id}/beats/generate`, {
        songId: attached.songId,
        genre,
        fusionGenres: fusion.length ? fusion : undefined,
        bpm,
        withStems: false,
        withVocals: true,
        // NO inline lyrics — the attach above stored the draft artistAuthored, and
        // the server sings draft.body VERBATIM on that path. Passing the text
        // inline skipped the artistAuthored check and the enrichment REWROTE the
        // artist's own words (the exact violation the owner banned).
        songEngine: engine === 'auto' ? undefined : engine,
        // Language chips are the truth here: deconstruct() writes the DETECTED
        // languages onto the chips, so any difference now is the user's own
        // re-toggle — real intent, honored.
        languages: langs,
        voice: voice === 'auto' ? undefined : voice,
        mood,
        influence: influence.trim() || undefined,
        instruments: instruments.length ? instruments : undefined,
        candidates: takes > 1 ? takes : undefined,
        pinnedReferenceId: pinnedRef || undefined,
        vibePrompt: [`${mood} energy`, decon?.vocalDirection, fusion.length ? `genre fusion: ${genreLabel}` : null].filter(Boolean).join('. '),
      });
      } catch (error) {
        if (isExplicitPaymentRequired(error)) {
          await api.del('/projects/' + project.id).catch(() => undefined);
        }
        throw error;
      }
      saveProduce({ renderJobId: r.jobId, projectId: project.id, title: 'Your song', hook: '', score: null });
      let url: string | null = null;
      let renderFailed = false;
      let lastJobError: string | null = null;
      let netFails = 0;
      for (let i = 0; i < 144; i++) {
        await sleep(5000);
        let job: { status: string; error?: string | null; errorJson?: { message?: string } | null };
        try { job = await api.get(`/jobs/${r.jobId}`); lastJobError = job.errorJson?.message ?? job.error ?? lastJobError; netFails = 0; }
        catch { if (++netFails >= 24) break; continue; } // network blip → retry, render keeps going
        if (job.status === 'SUCCEEDED') {
          try {
            const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${project.id}/beats`);
            url = beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url ?? null;
          } catch { /* beats fetch blip — fall through to the calm Catalog hand-off */ }
          break;
        }
        if (job.status === 'FAILED') { renderFailed = true; break; }
      }
      if (renderFailed) throw new Error('The render failed — try again or switch engine.');
      if (!url) {
        setSong({ title, hook: decon?.hookLine ?? undefined, score: null, url: '', projectId: project.id });
        setPhase('finishing');
        return;
      }
      setSong({ title, hook: decon?.hookLine ?? undefined, score: null, url, projectId: project.id });
      setNowPlaying({ title, url });
      setLibRefresh((n) => n + 1);
      setPhase('form');
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  async function openStudio() {
    const title = songName.trim().slice(0, 80) || vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
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

  // ---- Still finishing (render outran our wait, but it IS being made) ----
  if (phase === 'finishing' && song) {
    return (
      <div className="mx-auto max-w-lg px-6 py-14 text-center">
        <div className="rounded-3xl border-gradient glass p-6 shadow-card">
          <div className="mx-auto flex aspect-square w-full max-w-xs items-center justify-center rounded-2xl bg-brand-gradient text-ink shadow-glow">
            <span className="font-display text-5xl animate-pulse">♪</span>
          </div>
          <h1 className="mt-5 font-display text-2xl">“{song.title}” is still cooking</h1>
          <p className="mt-2 text-sm text-slate-400">
            The song is taking a little longer to render. It’s not lost — it finishes in the background and lands in your Catalog in a minute or two, fully mastered.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => router.push('/catalog')} className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">
              🎧 See it in my Catalog →
            </button>
            <button onClick={() => router.push(`/projects/${song.projectId}`)} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm hover:bg-white/10">
              Open this project
            </button>
            <button onClick={() => { setSong(null); setPhase('form'); }} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm hover:bg-white/10">
              ✨ Make another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error ----
  if (phase === 'error') {
    const isLimit = /insufficient_credits|daily limit/i.test(err);
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <div className="font-display text-2xl">{isLimit ? 'You’ve hit today’s limit' : 'Couldn’t finish that one'}</div>
        <p className="mt-2 text-sm text-red-400">
          {isLimit ? 'The daily generation cap protects your budget. It resets at midnight UTC — or top up / raise the cap.' : err}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isLimit ? (
            <>
              <button onClick={() => router.push('/billing')} className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">See plans &amp; credits →</button>
              <button onClick={() => router.push('/catalog')} className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm hover:bg-white/10">Work on existing songs</button>
            </>
          ) : (
            <button onClick={() => setPhase('form')} className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow">Try again</button>
          )}
        </div>
      </div>
    );
  }

  // ---- The CONSOLE (T2, console layout): create panel LEFT with the player under
  // the Create button; workspace library RIGHT. Stacks on mobile. ----
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl">Make a song</h1>
          <p className="mt-2 text-sm text-slate-400">Pick your sound and hit create — it makes the whole song right here.</p>
        </div>
        <button
          onClick={() => router.push('/listen')}
          title="Play a track — the AI listens and makes it (or a better version) in that vibe"
          className="mt-1 flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm hover:bg-white/10"
        >
          🎧 <span className="hidden sm:inline">Listen &amp; recreate</span>
        </button>
      </div>

      {/* THREE WAYS IN */}
      <div className="mt-6 flex flex-wrap gap-2">
        {([
          { id: 'song' as const, label: '✨ Describe it' },
          { id: 'lyrics' as const, label: '📝 Start from my lyrics' },
          { id: 'mumble' as const, label: '🎤 Hum it (mumble first)' },
        ]).map((t) => (
          <button key={t.id} onClick={() => setPath(t.id)} className={`rounded-full px-4 py-2 text-sm font-medium ${path === t.id ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.5)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>
            {t.label}
          </button>
        ))}
        <button onClick={() => router.push('/listen')} className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-white/5">
          🎧 Listen &amp; recreate
        </button>
      </div>

      {path === 'mumble' && (
        <div className="mt-6">
          <MumbleBooth
            onPick={(lyric) => {
              // The booth found the flow; the from-lyrics path produces it.
              setLyricsText(lyric);
              setDecon(null);
              setPath('lyrics');
              void deconstruct(lyric);
            }}
          />
        </div>
      )}

      {path === 'lyrics' && (
        <div className="mt-6 rounded-2xl glass p-4">
          <div className="mb-2 text-sm text-slate-400">Paste or write your lyrics — the studio reads them like a producer, tells you exactly what they are, and sings them.</div>
          <textarea
            value={lyricsText}
            onChange={(e) => { setLyricsText(e.target.value); setDecon(null); }}
            rows={10}
            placeholder={'[Hook]\nYour words here…\n\n[Verse]\n…'}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs leading-relaxed"
          />
          {err && path === 'lyrics' && phase === 'form' && <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">{err}</div>}
          {!decon ? (
            <button
              onClick={() => void deconstruct()}
              disabled={deconBusy || lyricsText.trim().length < 20}
              className="mt-3 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
            >
              {deconBusy ? '🔍 Reading your lyrics…' : '🔍 Deconstruct my lyrics'}
            </button>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs font-medium uppercase tracking-widest text-slate-500">What the studio heard</div>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div><span className="text-slate-500">Mode:</span> <span className="text-afrobrand-300">{decon.mode.replace(/_/g, ' ')}</span></div>
                <div><span className="text-slate-500">Languages:</span> <span className="text-slate-200">{decon.languages.join(', ') || '—'}</span></div>
                <div className="sm:col-span-2"><span className="text-slate-500">Themes:</span> <span className="text-slate-200">{decon.themes.join(' · ')}</span></div>
                <div className="sm:col-span-2"><span className="text-slate-500">Structure:</span> <span className="text-slate-200">{decon.structure.join(' → ')}</span></div>
                {decon.hookLine && <div className="sm:col-span-2"><span className="text-slate-500">The hook:</span> <span className="text-slate-200">“{decon.hookLine}”</span></div>}
                <div className="sm:col-span-2"><span className="text-slate-500">Vocal direction:</span> <span className="text-slate-200">{decon.vocalDirection}</span></div>
                {decon.notes && <div className="sm:col-span-2 text-slate-400">💡 {decon.notes}</div>}
              </div>
              <div className="mt-3">
                <div className="mb-1 text-xs text-slate-500">Title</div>
                <input value={deconTitle} onChange={(e) => setDeconTitle(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Genre, tempo, mood and engine below are prefilled from your lyrics — adjust anything, then hit go.</p>
            </div>
          )}
        </div>
      )}

      <Picker label={`Genre — pick one; tap a second to FUSE (${genreLabel})`} items={GENRES} selected={genres} onPick={toggleGenre} />
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Mood</div>
        <div className="flex flex-wrap gap-2">{MOODS.map((m) => (
          <button key={m} onClick={() => setMood(m)} className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${mood === m ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{m}</button>
        ))}</div>
      </div>
      <div className="mt-6">
        <div className="mb-2 flex justify-between text-sm text-slate-400"><span>Tempo</span><span className="tabular-nums text-slate-200">{bpm} BPM</span></div>
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => { bpmTouched.current = true; setBpm(Number(e.target.value)); }} className="w-full accent-afrobrand-500" />
      </div>
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Languages</div>
        <div className="flex flex-wrap gap-2">{LANGS.map((l) => (
          <button key={l.value} onClick={() => toggleLang(l.value)} className={`rounded-full px-3.5 py-1.5 text-sm ${langs.includes(l.value) ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{l.label}</button>
        ))}</div>
      </div>
      <label className="mb-1 mt-6 block text-sm text-slate-300">Song name <span className="text-slate-500">(optional — leave blank and the studio names it from the vibe)</span></label>
      <input value={songName} onChange={(e) => setSongName(e.target.value)} maxLength={80} placeholder="e.g. Midnight in Lekki" className="mb-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
{songName.trim() && (
  <label className="mb-5 flex items-center gap-2 text-xs text-slate-400">
    <input type="checkbox" checked={singName} onChange={(e) => setSingName(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950" />
    Sing the name in the hook <span className="text-slate-600">— off = label only, the lyrics won&apos;t force it</span>
  </label>
)}
      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Vibe / what it’s about (optional)</div>
        <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="e.g. rainy-day love, chant-along hook, drive-through-Lekki energy" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm" />
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Influence — artist lane (optional)</div>
        <input value={influence} onChange={(e) => setInfluence(e.target.value)} placeholder="e.g. Davido, Wizkid, Asake" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm" />
        <p className="mt-1.5 text-xs text-slate-500">Steers the <span className="text-slate-300">vibe/energy/production feel</span> toward artists you love — the kind of record they’d make. It never copies their songs and never names them.</p>
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Feature instruments (optional) <span className="text-xs text-slate-500">— pick up to 5; they lead the production</span></div>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((inst) => {
            const on = instruments.includes(inst);
            return (
              <button
                key={inst}
                onClick={() => setInstruments((cur) => (on ? cur.filter((x) => x !== inst) : cur.length >= 5 ? cur : [...cur, inst]))}
                className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-transparent bg-gradient-to-r from-orange-500 to-pink-500 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}
              >
                {inst}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mb-1 mt-4 block text-sm text-slate-300">Voice</label>

      <div className="mb-4 flex flex-wrap gap-2">

        {(['auto', 'female', 'male', 'duet', 'group'] as const).map((v) => (

          <button key={v} onClick={() => setVoice(v)} className={`rounded-full border px-3 py-1.5 text-sm capitalize ${voice === v ? 'border-transparent bg-gradient-to-r from-orange-500 to-pink-500 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'}`}>{v === 'auto' ? 'Auto' : v}</button>

        ))}

      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Vocal engine</div>
        <div className="flex flex-wrap gap-2">
          {([
            // §1.11 THE WALL: public surfaces speak in ENGINE CLASSES, never
            // vendor names. Values stay internal identifiers; labels are classes.
            { value: 'auto', label: 'Auto', hint: 'Connected route', available: hasMusicRoute },
            { value: 'suno', label: 'Flagship', hint: 'First-party route', available: musicRoutes?.flagship === true },
            { value: 'eleven', label: 'Advanced', hint: 'Section-controlled route', available: musicRoutes?.advanced === true },
            { value: 'minimax', label: 'Standard A', hint: 'Full-song route', available: musicRoutes?.standard === true },
            { value: 'ace_step', label: 'Standard B', hint: 'Alternate full-song route', available: musicRoutes?.standard === true },
          ] as const).filter((e) => e.available).map((e) => (
            <button key={e.value} onClick={() => setEngine(e.value)} className={`rounded-full px-4 py-2 text-sm ${engine === e.value ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {e.label} <span className="opacity-60">· {e.hint}</span>
            </button>
          ))}
        </div>
        {musicRoutes && !hasMusicRoute && (
          <p className="mt-2 text-sm text-amber-300">No vocal engine is connected. An owner must connect one in Settings before rendering.</p>
        )}
      </div>

      <div className="mt-4"><div className="mb-2 text-sm text-slate-400">Takes <span className="text-xs text-slate-500">— more takes = more directions; the ear keeps the one most in your lane</span></div>
        <div className="flex gap-2">
          {([1, 2, 3] as const).map((n) => (
            <button key={n} onClick={() => setTakes(n)} className={`rounded-full px-4 py-2 text-sm ${takes === n ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {n === 1 ? '1 · Draft' : `${n} directions`}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {path === 'song' ? (
          <button
            onClick={() => void createSong()}
            disabled={!hasMusicRoute}
            title={!hasMusicRoute ? 'Connect a music engine in Settings first' : undefined}
            className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            ⚡ Create the song
          </button>
        ) : (
          <button
            onClick={() => void createFromLyrics()}
            disabled={lyricsText.trim().length < 20 || !hasMusicRoute}
            title={!hasMusicRoute ? 'Connect a music engine in Settings first' : !decon ? 'Deconstruct your lyrics first' : undefined}
            className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            🎤 Sing MY lyrics — make the song
          </button>
        )}
        <button onClick={() => void openStudio()} className="rounded-full border border-white/15 bg-white/5 px-6 py-3 font-medium hover:bg-white/10">
          🎛️ I’ll bring my own beat / voice
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {path === 'song'
          ? '“Create the song” makes it here, start to finish. Pick TWO genres to fuse them into something new.'
          : 'It sings EXACTLY your words — deconstruct first so the production matches what your lyrics actually are.'}
        {' '}“Bring my own” opens the studio to upload a beat or record your voice.
      </p>

      {/* THE CONSOLE PLAYER — on the left half, right under the Create button
          (the console layout). New songs auto-play here; library rows
          play here too. */}
      {nowPlaying && (
        <div className="mt-5 rounded-2xl border-gradient glass p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Now playing</div>
              <div className="truncate font-display text-lg">{nowPlaying.title}</div>
            </div>
            <button
              onClick={() => { playerRef.current?.pause(); setNowPlaying(null); }}
              className="ml-3 shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              ⏹ Stop
            </button>
          </div>
          <audio ref={playerRef} controls autoPlay src={nowPlaying.url} className="mt-3 w-full" />
        </div>
      )}

      {/* BRING YOUR OWN — beat/chorus/vocal doors. All logic lives in the
          component; a chorus typed there lands in the from-lyrics flow above
          (same hand-off as MumbleBooth). */}
      <BringYourOwn
        onChorusText={(lyric) => {
          setLyricsText(lyric);
          setDecon(null);
          setPath('lyrics');
          void deconstruct(lyric);
        }}
      />
    </div>

    {/* Independent column: sticky with its OWN scrollbar so browsing the
        library never scrolls the create form (and vice versa). */}
    <div className="mt-8 lg:sticky lg:top-6 lg:mt-0 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1">
      <WorkspaceLibrary
        playingUrl={nowPlaying?.url ?? null}
        onPlay={(s) => setNowPlaying((cur) => (cur?.url === s.url ? null : s))}
        refreshKey={libRefresh}
      />
    </div>
    </div>
  );
}

function Picker({ label, items, selected, onPick }: { label: string; items: { value: string; label: string }[]; selected: string[]; onPick: (v: string) => void }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm text-slate-400">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((g) => {
          const idx = selected.indexOf(g.value);
          return (
            <button key={g.value} onClick={() => onPick(g.value)} className={`rounded-full px-4 py-2 text-sm ${idx === 0 ? 'bg-brand-gradient text-ink shadow-glow' : idx > 0 ? 'bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.6)]' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {idx > 0 ? '+ ' : ''}{g.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
