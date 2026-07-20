'use client';
import { genreSignature } from '@afrohit/shared';

/**
 * The front door — THREE CREATOR DOORS (owner spec, 2026-07-16):
 *   Make a song - today's full flow (hooks, A&R, lyrics, and sung song)
 *   Make an instrumental - the beat path only (withVocals:false)
 *   Sounds for film and creators - scene-first sound design riding the same
 *      instrumental machinery (scene + sound type lead the render's vibe prompt;
 *      no hooks/lyrics/A&R anywhere near it)
 * Each creator walks into their own room and never sees the other rooms'
 * complexity. The chosen door is remembered per device.
 * "Bring my own" is a separate intent that opens the full studio.
 */

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  AudioLines,
  BadgeCheck,
  Check,
  CircleAlert,
  Clock3,
  Download,
  Film,
  Gauge,
  Headphones,
  LibraryBig,
  LoaderCircle,
  Mic2,
  Music2,
  Piano,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react';
import { BringYourOwn } from '@/components/BringYourOwn';
import { MumbleBooth } from '@/components/MumbleBooth';
import WorkspaceLibrary from '@/components/WorkspaceLibrary';
import { MyWorkspacePane } from '@/components/consumer/MyWorkspacePane';
import { useOperatorView } from '@/components/OperatorGate';
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
// SIMPLE-MODE SUGGESTIONS (USERSHELL) — real prefill chips: each one only
// sets the same vibe/genre/mood state the form already owns. Prefill only;
// nothing renders until the user walks through the confirm step.
const SIMPLE_SUGGESTIONS: Array<{ label: string; vibe: string; genre?: string; mood?: string }> = [
  { label: 'Amapiano night drive', vibe: 'a smooth amapiano night-drive song, log drums and space, chant-along hook', genre: 'amapiano', mood: 'chill' },
  { label: 'Praise lift', vibe: 'an afro-gospel praise song that lifts the whole room, choir answers on the hook', genre: 'afro_gospel', mood: 'praise' },
  { label: 'Street anthem', vibe: 'a street-pop anthem with zanku energy and a chant hook', genre: 'street_pop', mood: 'energetic' },
  { label: 'Slow-burn love', vibe: 'an afro r&b slow burn about a love that took its time', genre: 'afro_rnb', mood: 'romantic' },
  { label: 'Summer party', vibe: 'an afrobeats party record for the summer, horns and bounce', genre: 'afrobeats', mood: 'party' },
];
const STEPS = ['Setting up your session', 'Writing hooks + A&R picking the best', 'Writing the lyrics', 'Singing & producing your song'];
// Door 2/3 producing steps — HONEST: no "writing lyrics" line when nothing is
// being written. Instrumentals and film sounds skip the whole writing pipeline.
const BEAT_STEPS = ['Setting up your session', 'Building the groove', 'Rendering & mastering'];
const FILM_STEPS = ['Setting up your session', 'Scoring the scene', 'Rendering & mastering'];

// THE THREE DOORS (owner spec 2026-07-16): "creators and movie creators create
// SOUNDS, not songs… and people who just wanna create INSTRUMENTS. Three things."
type Door = 'song' | 'instrumental' | 'film' | 'video';
type RenderAction = 'song' | 'lyrics' | 'instrumental' | 'film';
const DOOR_KEY = 'afrohit.create.door.v1';
const DOORS: Array<{ id: Door; icon: LucideIcon; title: string; sub: string }> = [
  { id: 'song', icon: Mic2, title: 'Make a song', sub: 'Hooks, lyrics, vocals, and production' },
  { id: 'instrumental', icon: Piano, title: 'Make an instrumental', sub: 'A beat, bed, or groove without vocals' },
  { id: 'film', icon: Film, title: 'Score a scene', sub: 'Beds, risers, stingers, and transitions' },
  // THE VERTICAL'S FRONT DOOR (owner, 2026-07-17: "somebody with a song,
  // fully developed, can come in — we make the video for that song exactly
  // as it is"). Suno owns songs; this door is how we own music videos.
  { id: 'video', icon: Video, title: 'Make a music video', sub: 'Bring a finished song and build its visual' },
];

// FILM SOUND TYPES — each rides the EXISTING instrumental machinery. A genre is
// a required render parameter (hard enum server-side), so every type maps to
// the most NEUTRAL existing lane (rnb = pads/keys/sub textures; edm = risers &
// impact energy) and the scene itself leads the engine's vibe prompt.
const FILM_TYPES = [
  { id: 'score_bed', label: 'Score bed', genre: 'rnb', bpm: 90, token: 'cinematic underscore bed' },
  { id: 'ambient', label: 'Ambient texture', genre: 'rnb', bpm: 75, token: 'ambient texture bed' },
  { id: 'riser', label: 'Riser / build', genre: 'edm', bpm: 128, token: 'cinematic riser build-up' },
  { id: 'stinger', label: 'Stinger / hit', genre: 'edm', bpm: 120, token: 'cinematic stinger hit accent' },
  { id: 'whoosh', label: 'Transition whoosh', genre: 'edm', bpm: 128, token: 'transition whoosh sweep' },
] as const;
type FilmTypeId = (typeof FILM_TYPES)[number]['id'];
// 8s was in the ask, but the render contract's floor is 15s (schema min 15) —
// offer only durations the machinery can honestly deliver.
const FILM_DURATIONS = [15, 30, 60] as const;
const FILM_MOODS = ['tense', 'warm', 'epic', 'playful', 'eerie', 'triumphant'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

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
    setRenderStartedAt(saved.at ?? Date.now()); setPhase('producing'); setStepIdx(saved.renderJobId ? 3 : 1);
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
  const [engine, setEngine] = useState<'auto' | 'suno' | 'eleven' | 'ace_step' | 'minimax' | 'own'>('auto');
  type MusicRoutes = { flagship: boolean; advanced: boolean; standard: boolean; falAvailable?: boolean; afrooneSinging?: boolean };
  const [musicRoutes, setMusicRoutes] = useState<MusicRoutes | null>(null);
  useEffect(() => {
    void api.get<MusicRoutes>('/settings/music-capabilities')
      .then(setMusicRoutes)
      .catch(() => setMusicRoutes({ flagship: false, advanced: false, standard: false }));
  }, [api]);
  const hasMusicRoute = musicRoutes !== null
    && (musicRoutes.flagship || musicRoutes.advanced || musicRoutes.standard || musicRoutes.falAvailable === true);

  // Three ways in: describe it / bring your own lyrics / listen & recreate.
  const [path, setPath] = useState<'song' | 'lyrics' | 'mumble'>('song');
  const [lyricsText, setLyricsText] = useState('');
  const [decon, setDecon] = useState<Deconstruction | null>(null);
  const [deconBusy, setDeconBusy] = useState(false);
  const [deconTitle, setDeconTitle] = useState('');

  // WHICH DOOR — the big mode switch at the top, remembered per device.
  // Restored in an effect (not the initializer) so the server-rendered HTML
  // always matches the first client paint — no hydration mismatch.
  const [door, setDoor] = useState<Door>('song');
  useEffect(() => {
    try {
      const d = localStorage.getItem(DOOR_KEY);
      if (d === 'song' || d === 'instrumental' || d === 'film' || d === 'video') setDoor(d);
    } catch { /* storage unavailable — stay on the song door */ }
  }, []);
  const pickDoor = (d: Door) => {
    setDoor(d);
    setPendingAction(null);
    try { localStorage.setItem(DOOR_KEY, d); } catch { /* noop */ }
  };

  // USERSHELL (owner order 2026-07-19): consumers get the Suno-shaped
  // two-pane console with a Simple/Advanced toggle; the operator's console
  // stays EXACTLY as it was. SAME state, SAME handlers, SAME confirm step —
  // only the arrangement differs (no forked business logic).
  const view = useOperatorView();
  const consumerShell = !view.loading && !view.effectiveOperator;
  const [uiMode, setUiMode] = useState<'simple' | 'advanced'>('simple');
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [allGenresOpen, setAllGenresOpen] = useState(false);
  // Simple mode only speaks song/instrumental — a film/video door remembered
  // on this device belongs to Advanced (where all four doors still live).
  useEffect(() => {
    if (consumerShell && uiMode === 'simple' && (door === 'film' || door === 'video')) setDoor('song');
  }, [consumerShell, uiMode, door]);

  // FILM DOOR state — scene-first sound design.
  const [filmScene, setFilmScene] = useState('');
  const [filmType, setFilmType] = useState<FilmTypeId>('score_bed');
  const [filmDuration, setFilmDuration] = useState<(typeof FILM_DURATIONS)[number]>(30);
  const [filmMoods, setFilmMoods] = useState<string[]>([]);

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
  const [firstRun, setFirstRun] = useState(false);
  const [pendingAction, setPendingAction] = useState<RenderAction | null>(null);
  const [lastAction, setLastAction] = useState<RenderAction>('song');
  const [renderStartedAt, setRenderStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [song, setSong] = useState<{ title: string; hook?: string; score: number | null; url: string; projectId: string } | null>(null);
  // CONSOLE PLAYER (T2): what's playing on the left half under the Create
  // button. New renders land here; library rows play here.
  const [nowPlaying, setNowPlaying] = useState<{ title: string; url: string } | null>(null);
  const [libRefresh, setLibRefresh] = useState(0);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (phase !== 'producing' || renderStartedAt === null) return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - renderStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [phase, renderStartedAt]);

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
    if (q.get('onboarding') === 'brief') setFirstRun(true);
    const inf = q.get('influence');
    const pin = q.get('pin');
    if (pin) setPinnedRef(pin);
    if (inf) setInfluence(inf.slice(0, 100));
    const lg = q.get('languages');
    if (lg) {
      const arr = lg.split(',').map((s) => s.trim()).filter((x) => LANGS.some((l) => l.value === x));
      if (arr.length) { setLangs(arr); langsTouched.current = true; }
    }
    // Intent links (Zap/Listen "make it in this lane") are SONG intents — walk
    // straight into the song door for THIS visit only. setDoor (not pickDoor):
    // the device's remembered door choice stays untouched.
    if (q.get('produce') === '1' || g || m || v || inf || pin || lg || (b >= 60 && b <= 180)) setDoor('song');
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

  // FAST / SLOW for laypeople (owner, 2026-07-17: "some people don't know all
  // this music type — just add fast, slow"). RELATIVE to the picked lane's
  // natural tempo, so "Fast amapiano" and "Fast afrobeats" each stay in-genre.
  // Not a new category — it just nudges the same BPM the slider already sets.
  const laneNaturalBpm = () => {
    const sigs = genres.slice(0, 2).map((g) => genreSignature(g));
    if (!sigs.length) return 103;
    return Math.round(sigs.reduce((a, x) => a + x.bpm, 0) / sigs.length);
  };
  const setFeel = (delta: number) => {
    bpmTouched.current = true;
    setBpm(Math.max(60, Math.min(180, laneNaturalBpm() + delta)));
  };
  const feelActive = (delta: number) => {
    const target = Math.max(60, Math.min(180, laneNaturalBpm() + delta));
    return Math.abs(bpm - target) <= 3;
  };
  const FeelRow = () => (
    <div className="mt-2 flex gap-2">
      {[
        { label: 'Slow', delta: -16 },
        { label: 'Natural', delta: 0 },
        { label: 'Fast', delta: 16 },
      ].map((f) => (
        <button
          key={f.label}
          type="button"
          onClick={() => setFeel(f.delta)}
          className={`flex-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            feelActive(f.delta)
              ? 'border-afrobrand-500/50 bg-afrobrand-500/15 text-afrobrand-300'
              : 'border-white/15 text-slate-400 hover:bg-white/10'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
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
    setLastAction('song');
    setRenderStartedAt(Date.now());
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
        // OUR ENGINE IS INSTRUMENTAL-ONLY (2026-07-16): sung vocals aren't wired
        // to it yet, and withVocals:true + own used to guarantee a 422 on every
        // click — right after the owner proudly restored the picker. The chip
        // says so honestly; the request matches: instrumental bed, vocals come
        // by upload or re-sing.
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
      // RESILIENT POLL: a single fetch that fails (phone backgrounded the tab, wifi-to-
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
      const p = await api.post<{ id: string }>('/projects', { title: 'From my lyrics', genre: 'afrobeats', bpm: 103 });
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
      // Clamp the detected tempo into the render's valid range so a fast/slow
      // read can never 400 the generate call (the from-lyrics bug, 2026-07-19).
      setBpm(Math.min(220, Math.max(40, Math.round(d.suggestedBpm) || 112)));
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
    setLastAction('lyrics');
    setRenderStartedAt(Date.now());
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
        // AFROONE SINGS (2026-07-20, supersedes the 2026-07-16 instrumental-only
        // note): own + withVocals:true rides the armed singing path — the
        // attached artistAuthored draft is sung VERBATIM over the owned bed,
        // word-verified before it ships. Other engines sing it as before.
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

  /** Poll a render job to its audio URL (doors 2/3 only — door 1's loops are
   *  untouched). Mirrors the door-1 semantics exactly: network blips retry and
   *  never kill the render, FAILED throws with the server's reason, and a
   *  still-cooking render past the window returns null (calm Catalog hand-off,
   *  sticky state kept so reopening resumes the watch). */
  async function pollRenderToUrl(jobId: string, projectId: string): Promise<string | null> {
    let netFails = 0;
    let lastJobError: string | null = null;
    for (let i = 0; i < 144; i++) {
      await sleep(5000);
      let job: { status: string; error?: string | null; errorJson?: { message?: string } | null };
      try { job = await api.get(`/jobs/${jobId}`); lastJobError = job.errorJson?.message ?? job.error ?? lastJobError; netFails = 0; }
      catch { if (++netFails >= 24) break; continue; } // network blip → retry, render keeps going
      if (job.status === 'SUCCEEDED') {
        try {
          const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${projectId}/beats`);
          return beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url ?? null;
        } catch { return null; /* beats fetch blip — calm Catalog hand-off */ }
      }
      if (job.status === 'FAILED') throw new Error(`The render failed — ${lastJobError ?? 'no reason recorded'}. Try again.`);
    }
    return null;
  }

  /** DOOR 2 — the instrumental room. The EXISTING beat path with
   *  withVocals:false: no hooks, no lyrics, no A&R, no vocal machinery. */
  async function createInstrumental() {
    setLastAction('instrumental');
    setRenderStartedAt(Date.now());
    setErr('');
    const own = engine === 'own';
    // Our Engine assembles from the workspace's own + synthesized material — it
    // needs no provider route. Every other engine does.
    if (!own && !hasMusicRoute) {
      setErr('No music engine is connected. Ask an owner to connect one in Settings.');
      setPhase('error');
      return;
    }
    // PRE-FLIGHT: refuse BEFORE the wait, same as the song door.
    try {
      const pf = await api.get<{ ok: boolean; mode: string }>('/billing/preflight');
      if (!pf.ok) {
        setErr(pf.mode === 'internal' ? 'Daily limit reached — resets at midnight UTC.' : 'insufficient_credits');
        setPhase('error');
        return;
      }
    } catch { /* preflight is advisory — if it can't be read, proceed */ }
    setPhase('producing');
    setStepIdx(0);
    try {
      const title = `${genreLabel} ${mood} instrumental`.slice(0, 120);
      const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
      setStepIdx(1);
      let r: { jobId: string };
      try {
        r = await api.post<{ jobId: string }>(`/projects/${project.id}/beats/generate`, {
          genre,
          bpm,
          withStems: false,
          withVocals: false,
          creationKind: 'instrumental',
          songEngine: engine === 'auto' ? undefined : engine,
          instruments: instruments.length ? instruments : undefined,
          // AfroOne renders named, deterministic directions from the same shelf.
          // Provider-only mood/fusion controls remain off this exact path.
          candidates: takes > 1 ? takes : undefined,
          ...(own ? {} : {
            fusionGenres: fusion.length ? fusion : undefined,
            mood,
          }),
        });
      } catch (error) {
        if (isExplicitPaymentRequired(error)) {
          await api.del('/projects/' + project.id).catch(() => undefined);
        }
        throw error;
      }
      saveProduce({ renderJobId: r.jobId, projectId: project.id, title, hook: '', score: null });
      setStepIdx(2);
      const url = await pollRenderToUrl(r.jobId, project.id);
      if (!url) {
        setSong({ title, score: null, url: '', projectId: project.id });
        setPhase('finishing');
        return; // sticky state kept — reopening resumes the watch
      }
      setSong({ title, score: null, url, projectId: project.id });
      setNowPlaying({ title, url });
      setLibRefresh((n) => n + 1);
      setPhase('form');
      clearProduce();
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  /** DOOR 3 — sounds for film & creators. The SAME instrumental machinery: the
   *  scene + sound type ride the render's vibe prompt in a neutral musical
   *  lane; no hooks/lyrics/A&R involvement. Lands in the Catalog honestly
   *  labeled — the title IS the scene. */
  async function createFilmSound() {
    setLastAction('film');
    setRenderStartedAt(Date.now());
    setErr('');
    const scene = filmScene.trim();
    if (scene.length < 5) return;
    if (!hasMusicRoute) {
      setErr('No music engine is connected. Ask an owner to connect one in Settings.');
      setPhase('error');
      return;
    }
    try {
      const pf = await api.get<{ ok: boolean; mode: string }>('/billing/preflight');
      if (!pf.ok) {
        setErr(pf.mode === 'internal' ? 'Daily limit reached — resets at midnight UTC.' : 'insufficient_credits');
        setPhase('error');
        return;
      }
    } catch { /* advisory */ }
    setPhase('producing');
    setStepIdx(0);
    try {
      const t = FILM_TYPES.find((x) => x.id === filmType) ?? FILM_TYPES[0];
      const title = scene.slice(0, 120); // honest label: the scene names the sound
      const project = await api.post<{ id: string }>('/projects', { title, genre: t.genre, bpm: t.bpm });
      setStepIdx(1);
      // The engine brief caps the vibe at ~160 chars — the sound TYPE leads
      // (it's structural: a stinger is not a bed), then the scene, then moods
      // (first to be truncated when the scene runs long).
      const vibePrompt = `${t.token}: ${scene}${filmMoods.length ? ` — ${filmMoods.join(', ')} mood` : ''}`;
      let r: { jobId: string };
      try {
        r = await api.post<{ jobId: string }>(`/projects/${project.id}/beats/generate`, {
          genre: t.genre,
          bpm: t.bpm,
          durationS: filmDuration,
          withStems: false,
          withVocals: false,
          creationKind: 'film_sound',
          mood: filmMoods[0],
          vibePrompt,
        });
      } catch (error) {
        if (isExplicitPaymentRequired(error)) {
          await api.del('/projects/' + project.id).catch(() => undefined);
        }
        throw error;
      }
      saveProduce({ renderJobId: r.jobId, projectId: project.id, title, hook: '', score: null });
      setStepIdx(2);
      const url = await pollRenderToUrl(r.jobId, project.id);
      if (!url) {
        setSong({ title, score: null, url: '', projectId: project.id });
        setPhase('finishing');
        return; // sticky state kept — reopening resumes the watch
      }
      setSong({ title, score: null, url, projectId: project.id });
      setNowPlaying({ title, url });
      setLibRefresh((n) => n + 1);
      setPhase('form');
      clearProduce();
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  }

  function requestRender(action: RenderAction) {
    setErr('');
    setLastAction(action);
    setPendingAction(action);
  }

  function confirmRender() {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'song') void createSong();
    if (action === 'lyrics') void createFromLyrics();
    if (action === 'instrumental') void createInstrumental();
    if (action === 'film') void createFilmSound();
  }

  function retryLastBrief() {
    setPhase('form');
    setPendingAction(lastAction);
  }

  async function openStudio() {
    const title = songName.trim().slice(0, 80) || vibe.trim().slice(0, 60) || `${genreLabel} ${mood}`;
    const project = await api.post<{ id: string }>('/projects', { title, genre, bpm });
    router.push(`/projects/${project.id}`);
  }

  // ---- Producing ----
  if (phase === 'producing') {
    // Door-aware copy: the song door renders EXACTLY as before (steps === STEPS,
    // cur === stepIdx). Doors 2/3 get honest steps — no "writing lyrics" line —
    // and cur clamps a resumed stepIdx (the sticky state stores song-scale
    // indices) onto the shorter lists.
    const steps = door === 'instrumental' ? BEAT_STEPS : door === 'film' ? FILM_STEPS : STEPS;
    const cur = Math.min(stepIdx, steps.length - 1);
    const headline = door === 'instrumental'
      ? `Building your ${genreLabel} instrumental`
      : door === 'film'
        ? 'Designing the sound for your scene'
        : `Creating your ${genreLabel} song`;
    const progress = Math.round(((cur + 1) / steps.length) * 100);
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:px-6" aria-labelledby="render-status-title">
        <section className="studio-status-panel" role="status" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="studio-section-kicker"><LoaderCircle className="animate-spin" aria-hidden="true" /> Render in progress</div>
              <h1 id="render-status-title" className="mt-3 font-display text-3xl text-white">{headline}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Full songs usually take 3-12 minutes. Instrumentals and scene sounds are often faster. The work continues on the server if this tab is backgrounded.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right">
              <span className="block text-[10px] font-semibold uppercase text-slate-500">Elapsed</span>
              <span className="font-mono text-sm tabular-nums text-slate-200">{formatElapsed(elapsedSeconds)}</span>
            </div>
          </div>

          <div className="mt-7 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>

          <ol className="mt-6 space-y-2 text-left">
          {steps.map((s, i) => (
            <li key={s} className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm ${i === cur ? 'border-orange-400/30 bg-orange-400/5' : 'border-transparent'}`}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${i < cur ? 'bg-emerald-500/15 text-emerald-300' : i === cur ? 'bg-orange-400 text-ink' : 'bg-white/5 text-slate-500'}`}>
                {i < cur ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i === cur ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : i + 1}
              </span>
              <span className={i <= cur ? 'text-slate-200' : 'text-slate-500'}>{s}</span>
            </li>
          ))}
          </ol>

          <div className="mt-7 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" aria-hidden="true" />
              Refreshing will resume this status instead of starting another paid render.
            </p>
            <button type="button" onClick={() => router.push('/catalog')} className="studio-secondary-button shrink-0">
              <LibraryBig aria-hidden="true" /> Open Catalog
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ---- Done ----
  if (phase === 'done' && song) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
        <section className="studio-status-panel">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <BadgeCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-3xl text-white">{song.title}</h1>
          {song.hook && <p className="mt-1 text-sm text-slate-400">&quot;{song.hook.replace(/\(response:.*/i, '').trim()}&quot;</p>}
          {song.score != null && <div className="mt-2 text-xs text-orange-300">A&amp;R score {song.score.toFixed(1)}</div>}
          <audio controls autoPlay className="mt-5 w-full" src={song.url} />

          <div className="mt-6 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-4">
            <div className="flex items-start gap-3">
              <Download className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-slate-100">Ready for your DAW</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Open the project to separate stems, download production files, and continue in FL Studio, Ableton, Logic, or your preferred DAW.</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => router.push(song.projectId ? `/projects/${song.projectId}` : '/catalog')} className="studio-primary-button">
              <SlidersHorizontal aria-hidden="true" /> Open project and export stems <ArrowRight aria-hidden="true" />
            </button>
            <button type="button" onClick={() => { setSong(null); setPhase('form'); }} className="studio-secondary-button">
              <RotateCcw aria-hidden="true" /> Make another
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ---- Still finishing (render outran our wait, but it IS being made) ----
  if (phase === 'finishing' && song) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
        <section className="studio-status-panel">
          <div className="studio-section-kicker"><Clock3 aria-hidden="true" /> Finishing in the background</div>
          <h1 className="mt-4 font-display text-3xl text-white">{song.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            The {door === 'instrumental' ? 'instrumental' : door === 'film' ? 'scene sound' : 'song'} exceeded the live wait window, but the server is still working. It will appear in Catalog when it is ready; starting another brief will not cancel it.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => router.push('/catalog')} className="studio-primary-button">
              <LibraryBig aria-hidden="true" /> Watch in Catalog <ArrowRight aria-hidden="true" />
            </button>
            {song.projectId && (
              <button type="button" onClick={() => router.push(`/projects/${song.projectId}`)} className="studio-secondary-button">
                <SlidersHorizontal aria-hidden="true" /> Open project
              </button>
            )}
            <button type="button" onClick={() => { setSong(null); setPhase('form'); }} className="studio-secondary-button">
              <RotateCcw aria-hidden="true" /> New brief
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ---- Error ----
  if (phase === 'error') {
    // HONEST 402s: a capped workspace and an out-of-credits workspace are
    // different problems with different fixes — the old screen told everyone
    // 'daily cap' (the live incident: the owner was out of CREDITS, not
    // capped, and the copy sent them chasing a cap that never fired).
    const isCap = /"reason":"(daily_cap|monthly_cap)"|daily limit/i.test(err);
    const isCredits = !isCap && /insufficient_credits/i.test(err);
    const isLimit = isCap || isCredits;
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
        <section className="studio-status-panel" aria-labelledby="render-error-title">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-400/30 bg-red-400/10 text-red-300">
          <CircleAlert className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 id="render-error-title" className="mt-4 font-display text-3xl text-white">
          {isCap ? 'You’ve hit today’s limit' : isCredits ? 'Out of credits' : 'Couldn’t finish that one'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {isCap
            ? 'The daily generation cap protects your budget. It resets at midnight UTC — or top up / raise the cap.'
            : isCredits
              ? 'This song needs more credits than the studio has left. Top up or upgrade to keep creating.'
              : err}
        </p>
        {/* SELF-EXPLAINING 402s: the billing engine reports exactly which
            rule produced this block — no more screenshot-and-guess loops. */}
        {isLimit && <BillingDiagnosisLine />}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {isLimit ? (
            <>
              <button type="button" onClick={() => router.push('/billing')} className="studio-primary-button">See plans and credits <ArrowRight aria-hidden="true" /></button>
              <button type="button" onClick={() => router.push('/catalog')} className="studio-secondary-button"><LibraryBig aria-hidden="true" /> Work on existing songs</button>
            </>
          ) : (
            <>
              <button type="button" onClick={retryLastBrief} className="studio-primary-button"><RotateCcw aria-hidden="true" /> Review and retry</button>
              <button type="button" onClick={() => { setPendingAction(null); setPhase('form'); }} className="studio-secondary-button">Edit the brief</button>
              <button type="button" onClick={() => router.push('/catalog')} className="studio-secondary-button"><LibraryBig aria-hidden="true" /> Check Catalog</button>
            </>
          )}
        </div>
        <p className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-slate-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" aria-hidden="true" />
          Retrying returns to a confirmation step. It never spends credits automatically.
        </p>
        </section>
      </main>
    );
  }

  // ---- The CONSOLE (T2, console layout): create panel LEFT with the player
  // under the Create button; library RIGHT. Stacks on mobile.
  // USERSHELL: while /auth/me resolves we hold on a small loading state —
  // the operator console and the consumer two-pane are too different to
  // guess between (the same pattern OperatorGate already uses). ----
  if (view.loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-500">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Opening the console…
      </div>
    );
  }

  // Shared console pieces — EXTRACTED (not forked) so Simple, Advanced and
  // the operator console all run the exact same no-auto-spend review step
  // and the same inline player.
  const confirmPanel = pendingAction && (
        <section className="studio-confirm-panel mt-7" aria-labelledby="confirm-render-title" aria-live="polite">
          <div className="flex items-start gap-3">
            <div className="studio-choice-icon"><Gauge aria-hidden /></div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase text-slate-500">Final review</p>
              <h2 id="confirm-render-title" className="mt-1 font-display text-xl text-white">
                {pendingAction === 'film' ? 'Confirm one scene-sound render' : `Confirm ${takes} ${takes === 1 ? 'direction' : 'directions'}`}
              </h2>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div><dt className="text-slate-500">Output</dt><dd className="mt-1 text-slate-200">{pendingAction === 'song' || pendingAction === 'lyrics' ? 'Full song with vocals' : pendingAction === 'instrumental' ? 'Instrumental without vocals' : `${filmDuration}-second scene sound`}</dd></div>
                <div><dt className="text-slate-500">Engine</dt><dd className="mt-1 text-slate-200">{pendingAction === 'film' ? 'Best connected route' : engine === 'auto' ? 'Best available route' : engine === 'own' ? 'Our Engine' : 'Selected engine class'}</dd></div>
                <div><dt className="text-slate-500">Lane</dt><dd className="mt-1 text-slate-200">{pendingAction === 'film' ? FILM_TYPES.find((item) => item.id === filmType)?.label : genreLabel}</dd></div>
                <div><dt className="text-slate-500">Billing</dt><dd className="mt-1 text-slate-200">Your plan rate applies after confirmation</dd></div>
              </dl>
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" aria-hidden />
                No work has started yet. Confirming runs the existing balance and daily-cap preflight before any render is accepted.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setPendingAction(null)} className="studio-secondary-button">Cancel</button>
            <button type="button" onClick={() => router.push('/billing')} className="studio-secondary-button">Review billing</button>
            <button type="button" onClick={confirmRender} className="studio-primary-button">
              <Play aria-hidden /> Confirm and start
            </button>
          </div>
        </section>
  );

  // THE CONSOLE PLAYER — right under the Create button (the console layout).
  // New songs auto-play here; library rows play here too.
  const consolePlayer = nowPlaying && (
        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Now playing</div>
              <div className="truncate font-display text-lg">{nowPlaying.title}</div>
            </div>
            <button
              onClick={() => { playerRef.current?.pause(); setNowPlaying(null); }}
              title="Stop playback"
              aria-label="Stop playback"
              className="studio-icon-button ml-3 shrink-0"
            >
              <X aria-hidden />
            </button>
          </div>
          <audio ref={playerRef} controls autoPlay src={nowPlaying.url} className="mt-3 w-full" />
          <button type="button" onClick={() => router.push('/catalog')} className="studio-secondary-button mt-4 w-full justify-center">
            <Download aria-hidden /> Open Catalog for stems and DAW export
          </button>
        </div>
  );

  const consoleForm = (
    <div className="min-w-0">
      {firstRun && (
        <section className="studio-first-run mb-6" aria-labelledby="first-run-title">
          <div className="flex min-w-0 items-start gap-3">
            <div className="studio-choice-icon"><LibraryBig aria-hidden="true" /></div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">First session</p>
              <h1 id="first-run-title" className="mt-1 font-display text-2xl text-white">Start with a clear brief</h1>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Your saved idea is ready below. Review every setting before the confirmation step; nothing starts or spends credits on its own.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => router.push('/listen?onboarding=sound')} className="studio-secondary-button">
              <AudioLines aria-hidden="true" /> Teach my sound instead
            </button>
            <button type="button" onClick={() => setFirstRun(false)} aria-label="Dismiss first-session guidance" className="studio-icon-button">
              <X aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* THE THREE DOORS — big, obvious, remembered on this device. Each creator
          walks into their own room and never sees the other rooms' complexity. */}
      {/* All FOUR doors on one line (owner 2026-07-18): 2-up on mobile, 4-up
          from sm so "Make a music video" no longer drops to its own row. */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOORS.map((item) => {
          const Icon = item.icon;
          const selected = door === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => pickDoor(item.id)}
              aria-pressed={selected}
              className={`studio-door-button ${selected ? 'is-selected' : ''}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="mt-3 block font-display text-base leading-tight">{item.title}</span>
              <span className="mt-1 block text-xs leading-5">{item.sub}</span>
            </button>
          );
        })}
      </div>

      {/* ═══ DOOR 1 — MAKE A SONG: today's flow EXACTLY as-is ═══ */}
      {door === 'song' && (<>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="studio-section-kicker"><Mic2 aria-hidden="true" /> Song workspace</div>
          <h1 className="mt-2 font-display text-3xl text-white">Make a song</h1>
          <p className="mt-2 text-sm text-slate-400">Shape the brief, review the expected work, then start the render.</p>
        </div>
        <button
          onClick={() => router.push('/listen')}
          title="Play a track — the AI listens and makes it (or a better version) in that vibe"
          className="mt-1 flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm hover:bg-white/10"
        >
          <Headphones className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">Listen and recreate</span>
        </button>
      </div>

      {/* THREE WAYS IN */}
      <div className="mt-6 flex flex-wrap gap-2">
        {([
          { id: 'song' as const, label: 'Describe it', icon: LibraryBig },
          { id: 'lyrics' as const, label: 'Start from my lyrics', icon: Music2 },
          { id: 'mumble' as const, label: 'Hum a melody', icon: Mic2 },
        ]).map((entry) => {
          const EntryIcon = entry.icon;
          return (
            <button key={entry.id} type="button" onClick={() => setPath(entry.id)} aria-pressed={path === entry.id} className={`studio-mode-button ${path === entry.id ? 'is-selected' : ''}`}>
              <EntryIcon aria-hidden="true" /> {entry.label}
            </button>
          );
        })}
        <button onClick={() => router.push('/listen')} className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-white/5">
          <Headphones className="mr-1 inline h-4 w-4" aria-hidden="true" /> Listen and recreate
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
              {deconBusy ? 'Reading your lyrics...' : 'Deconstruct my lyrics'}
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
                {decon.notes && <div className="sm:col-span-2 text-slate-400">{decon.notes}</div>}
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
        <FeelRow />
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => { bpmTouched.current = true; setBpm(Number(e.target.value)); }} className="mt-2 w-full accent-afrobrand-500" />
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
            // vendor names — for EXTERNAL engines. "Our Engine" is first-party
            // (the studio's own material assembler) and is named proudly; it
            // was dropped in the Jul-13/14 rewrite and restored by owner order
            // (2026-07-16) together with the human hints from 3f62388.
            { value: 'auto', label: 'Auto', hint: 'Best engine available (recommended)', available: hasMusicRoute },
            { value: 'suno', label: 'Flagship', hint: 'Best quality (first-party releases)', available: musicRoutes?.flagship === true },
            { value: 'eleven', label: 'Advanced', hint: 'Section-controlled, high realism', available: musicRoutes?.advanced === true },
            { value: 'minimax', label: 'Standard A', hint: 'High vocal realism', available: musicRoutes?.standard === true },
            { value: 'ace_step', label: 'Standard B', hint: 'Fast draft', available: musicRoutes?.standard === true || musicRoutes?.falAvailable === true },
            // CAPABILITY-DRIVEN HINT (owner 2026-07-19: "our engine is still
            // talking about bringing sound — that should have been corrected").
            // The copy follows /settings/music-capabilities.afrooneSinging: it
            // advertises genuine singing ONLY when the singing path is armed
            // and reachable — the honest-hint law of 2026-07-16 still holds,
            // the capability just moved from hardcoded to measured.
            // EQUAL-CONFIDENCE COPY (owner 2026-07-20: "look at the other
            // engines — three words. What's the purpose of all this talk?").
            // The house engine speaks with the MOST confidence on the page,
            // not the least. No pipeline jargon ("approved lyrics" read as
            // "bring your lyrics" — it never meant that; the engine writes
            // its own). Capability truth still holds via the flag.
            {
              value: 'own',
              label: 'AfroOne — Our Engine',
              hint: musicRoutes?.afrooneSinging === true
                ? 'Writes it, builds it, sings it — your sound'
                : 'Beats from your sound',
              available: true,
            },
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
            type="button"
            onClick={() => requestRender('song')}
            disabled={!hasMusicRoute}
            title={!hasMusicRoute ? 'Connect a music engine in Settings first' : undefined}
            className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="mr-2 inline h-4 w-4" aria-hidden="true" /> Review and create
          </button>
        ) : (
          <button
            type="button"
            onClick={() => requestRender('lyrics')}
            disabled={lyricsText.trim().length < 20 || !hasMusicRoute}
            title={!hasMusicRoute ? 'Connect a music engine in Settings first' : !decon ? 'Deconstruct your lyrics first' : undefined}
            className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic2 className="mr-2 inline h-4 w-4" aria-hidden="true" /> Review and sing my lyrics
          </button>
        )}
        <button onClick={() => void openStudio()} className="rounded-full border border-white/15 bg-white/5 px-6 py-3 font-medium hover:bg-white/10">
          <SlidersHorizontal className="mr-2 inline h-4 w-4" aria-hidden="true" /> I will bring my own beat or voice
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {path === 'song'
          ? '“Create the song” makes it here, start to finish. Pick TWO genres to fuse them into something new.'
          : 'It sings EXACTLY your words — deconstruct first so the production matches what your lyrics actually are.'}
        {' '}“Bring my own” opens the studio to upload a beat or record your voice.
      </p>
      </>)}

      {/* ═══ DOOR 2 — MAKE AN INSTRUMENTAL: the beat path, withVocals:false ═══ */}
      {door === 'instrumental' && (<>
      <div>
        <div className="studio-section-kicker"><Piano aria-hidden="true" /> Instrumental workspace</div>
        <h1 className="mt-2 font-display text-3xl text-white">Make an instrumental</h1>
        <p className="mt-2 text-sm text-slate-400">A beat, a bed, a groove — yours. No lyrics, no vocals, no song machinery: pick the lane, set the pocket, hit cook.</p>
      </div>

      <Picker label={`Genre — pick one; tap a second to FUSE (${genreLabel})`} items={GENRES} selected={genres} onPick={toggleGenre} />

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Mood / feel</div>
        <div className="flex flex-wrap gap-2">{MOODS.map((m) => (
          <button key={m} onClick={() => setMood(m)} className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${mood === m ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}>{m}</button>
        ))}</div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex justify-between text-sm text-slate-400"><span>Tempo</span><span className="tabular-nums text-slate-200">{bpm} BPM</span></div>
        <FeelRow />
        <input type="range" min={60} max={180} value={bpm} onChange={(e) => { bpmTouched.current = true; setBpm(Number(e.target.value)); }} className="mt-2 w-full accent-afrobrand-500" />
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Feature instruments (optional) <span className="text-xs text-slate-500">— pick up to 5; steering on provider engines, exact on Our Engine</span></div>
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

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Engine</div>
        <div className="flex flex-wrap gap-2">
          {([
            // OUR ENGINE FIRST — this door is its home turf: instrumental beds
            // assembled from YOUR OWN + synthesized material are exactly what it
            // does. External engines stay in CLASS language (§1.11 THE WALL).
            { value: 'own', label: 'AfroOne — Our Engine', hint: 'Assembled from YOUR material — the studio’s own instrumental engine', available: true },
            { value: 'auto', label: 'Auto', hint: 'Best engine available', available: hasMusicRoute },
            { value: 'suno', label: 'Flagship', hint: 'Best quality (first-party releases)', available: musicRoutes?.flagship === true },
            { value: 'eleven', label: 'Advanced', hint: 'Section-controlled, high realism', available: musicRoutes?.advanced === true },
            { value: 'minimax', label: 'Standard A', hint: 'High realism', available: musicRoutes?.standard === true },
            { value: 'ace_step', label: 'Standard B', hint: 'Fast draft', available: musicRoutes?.standard === true || musicRoutes?.falAvailable === true },
          ] as const).filter((e) => e.available).map((e) => (
            <button key={e.value} onClick={() => setEngine(e.value)} className={`rounded-full px-4 py-2 text-sm ${engine === e.value ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {e.label} <span className="opacity-60">· {e.hint}</span>
            </button>
          ))}
        </div>
        {engine === 'own' && (
          <p className="mt-2 text-xs text-amber-300/90">Our Engine builds from your own + synthesized material. Three directions are intentional: commercial-safe, spacious, and hook-forward.</p>
        )}
        {musicRoutes && !hasMusicRoute && engine !== 'own' && (
          <p className="mt-2 text-sm text-amber-300">No provider engine is connected. Our Engine still works — or ask an owner to connect one in Settings.</p>
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
        <button
          type="button"
          onClick={() => requestRender('instrumental')}
          disabled={engine !== 'own' && !hasMusicRoute}
          title={engine !== 'own' && !hasMusicRoute ? 'Pick Our Engine, or connect a provider engine in Settings' : undefined}
          className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="mr-2 inline h-4 w-4" aria-hidden="true" /> Review and create instrumental
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Renders the instrumental only — no lyrics, no vocals — mastered and landing in your Catalog. Add vocals any time by upload or re-sing.
      </p>
      </>)}

      {/* ═══ DOOR 3 — SOUNDS FOR FILM & CREATORS: scene-first sound design on
          the same instrumental machinery (scene + type ride the vibe prompt) ═══ */}
      {door === 'film' && (<>
      <div>
        <div className="studio-section-kicker"><Film aria-hidden="true" /> Scene sound workspace</div>
        <h1 className="mt-2 font-display text-3xl text-white">Sounds for film and creators</h1>
        <p className="mt-2 text-sm text-slate-400">Describe the scene — get the sound. Score beds, textures, risers, stingers and transitions, rendered for your cut.</p>
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">The scene / purpose — brief it like you’d brief a composer</div>
        <input
          value={filmScene}
          onChange={(e) => setFilmScene(e.target.value)}
          maxLength={120}
          placeholder="e.g. tense chase through Lagos traffic at night"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm"
        />
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Sound type</div>
        <div className="flex flex-wrap gap-2">
          {FILM_TYPES.map((t) => (
            <button key={t.id} onClick={() => setFilmType(t.id)} className={`rounded-full px-4 py-2 text-sm ${filmType === t.id ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Duration</div>
        <div className="flex gap-2">
          {FILM_DURATIONS.map((d) => (
            <button key={d} onClick={() => setFilmDuration(d)} className={`rounded-full px-4 py-2 text-sm tabular-nums ${filmDuration === d ? 'bg-brand-gradient text-ink shadow-glow' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {d}s
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">15s is the shortest cut the render contract delivers — trim tighter hits in your editor.</p>
      </div>

      <div className="mt-6"><div className="mb-2 text-sm text-slate-400">Mood (optional — up to 3)</div>
        <div className="flex flex-wrap gap-2">
          {FILM_MOODS.map((m) => {
            const on = filmMoods.includes(m);
            return (
              <button
                key={m}
                onClick={() => setFilmMoods((cur) => (on ? cur.filter((x) => x !== m) : cur.length >= 3 ? cur : [...cur, m]))}
                className={`rounded-full px-3.5 py-1.5 text-sm capitalize ${on ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => requestRender('film')}
          disabled={filmScene.trim().length < 5 || !hasMusicRoute}
          title={!hasMusicRoute ? 'Connect a music engine in Settings first' : filmScene.trim().length < 5 ? 'Describe the scene first' : undefined}
          className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="mr-2 inline h-4 w-4" aria-hidden="true" /> Review and create sound
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Straight talk: your sound renders on the same music-engine classes that power the studio — your scene leads the brief in a neutral musical lane; nothing is sampled from a foley library. It lands in your Catalog titled after the scene.
      </p>
      {musicRoutes && !hasMusicRoute && (
        <p className="mt-2 text-sm text-amber-300">No music engine is connected. An owner must connect one in Settings before rendering.</p>
      )}
      </>)}

      {confirmPanel}

      {consolePlayer}

      {door === 'video' && (
        <VideoDoorPanel />
      )}

      {/* BRING YOUR OWN — beat/chorus/vocal doors. All logic lives in the
          component; a chorus typed there lands in the from-lyrics flow above
          (same hand-off as MumbleBooth). Song-door only: its chorus/vocal
          hand-offs are song machinery the other rooms must never see. */}
      {door === 'song' && (
      <BringYourOwn
        onChorusText={(lyric) => {
          setLyricsText(lyric);
          setDecon(null);
          setPath('lyrics');
          void deconstruct(lyric);
        }}
      />
      )}
    </div>
  );

  // ═══ USERSHELL CONSUMER CONSOLE — the Suno-shaped two-pane. Same state,
  // same handlers, same confirm step; Simple just shows fewer dials. ═══
  if (consumerShell) {
    const lyricsReady = lyricsText.trim().length >= 20;
    const simpleAction: RenderAction =
      door === 'instrumental' ? 'instrumental' : lyricsOpen && lyricsReady ? 'lyrics' : 'song';
    const simpleBlocked =
      door === 'instrumental'
        ? engine !== 'own' && !hasMusicRoute
        : !hasMusicRoute || (lyricsOpen && lyricsText.trim().length > 0 && !lyricsReady);
    const simpleGenres = [
      ...GENRES.filter((g) => genres.includes(g.value)),
      ...GENRES.filter((g) => !genres.includes(g.value)),
    ].slice(0, allGenresOpen ? GENRES.length : 12);
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_370px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          {/* Simple / Advanced pills */}
          <div className="mb-6 flex items-center gap-2">
            {(['simple', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setUiMode(m)}
                aria-pressed={uiMode === m}
                className={`rounded-full px-4 py-1.5 text-sm capitalize transition-colors ${
                  uiMode === m
                    ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.35)]'
                    : 'border border-white/10 text-slate-400 hover:bg-white/5'
                }`}
              >
                {m}
              </button>
            ))}
            <span className="ml-1 hidden text-xs text-slate-600 sm:inline">
              {uiMode === 'simple' ? 'The quick brief — Advanced opens every dial.' : 'The full console — every dial the studio has.'}
            </span>
          </div>

          {uiMode === 'advanced' ? (
            consoleForm
          ) : (
            <div className="min-w-0">
              <h1 className="font-display text-3xl text-white">Create</h1>
              <p className="mt-1.5 text-sm text-slate-400">Describe it, review the brief, and the studio makes it. Nothing renders until you confirm.</p>

              {/* Song description */}
              <div className="mt-6">
                <div className="mb-2 text-sm text-slate-400">Song description</div>
                <textarea
                  value={vibe}
                  onChange={(e) => setVibe(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="a smooth amapiano song about moving to Lagos — chant-along hook, log drums, night-drive energy"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-orange-400/60 focus:outline-none"
                />
              </div>

              {/* Suggestions — prefill only, never render */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">Suggestions</span>
                {SIMPLE_SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setVibe(s.vibe);
                      if (s.genre && GENRES.some((g) => g.value === s.genre)) { setGenres([s.genre]); setGenreTouched(true); }
                      if (s.mood && MOODS.includes(s.mood)) setMood(s.mood);
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* + Lyrics expander (song only — an instrumental has no lyrics) */}
              {door !== 'instrumental' && (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setLyricsOpen((o) => { const next = !o; setPath(next ? 'lyrics' : 'song'); return next; })}
                    aria-expanded={lyricsOpen}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                  >
                    <Plus className={`h-4 w-4 transition-transform ${lyricsOpen ? 'rotate-45' : ''}`} aria-hidden /> Lyrics
                  </button>
                  {lyricsOpen && (
                    <div className="mt-3">
                      <textarea
                        value={lyricsText}
                        onChange={(e) => { setLyricsText(e.target.value); setDecon(null); }}
                        rows={8}
                        placeholder={'[Hook]\nYour words here…\n\n[Verse]\n…'}
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-orange-400/60 focus:outline-none"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">Your words are sung exactly as written — the studio never rewrites lyrics you bring.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Instrumental toggle — the SAME door 2 the full console uses */}
              <div className="mt-5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={door === 'instrumental'}
                  onClick={() => pickDoor(door === 'instrumental' ? 'song' : 'instrumental')}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span>
                    <span className="block text-sm text-slate-200">Instrumental</span>
                    <span className="mt-0.5 block text-xs text-slate-500">No lyrics, no vocals — just the record.</span>
                  </span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${door === 'instrumental' ? 'bg-afrobrand-500' : 'bg-white/10'}`} aria-hidden>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${door === 'instrumental' ? 'left-[22px]' : 'left-0.5'}`} />
                  </span>
                </button>
              </div>

              {/* Genre chips — the same picker state, curated first */}
              <div className="mt-5">
                <div className="mb-2 text-sm text-slate-400">Genre — pick one; tap a second to fuse ({genreLabel})</div>
                <div className="flex flex-wrap gap-2">
                  {simpleGenres.map((g) => {
                    const idx = genres.indexOf(g.value);
                    return (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => toggleGenre(g.value)}
                        className={`rounded-full px-3.5 py-1.5 text-sm ${idx === 0 ? 'bg-brand-gradient text-ink shadow-glow' : idx > 0 ? 'bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.6)]' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
                      >
                        {idx > 0 ? '+ ' : ''}{g.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setAllGenresOpen((o) => !o)}
                    className="rounded-full border border-dashed border-white/15 px-3.5 py-1.5 text-sm text-slate-500 hover:bg-white/5"
                  >
                    {allGenresOpen ? 'Fewer genres' : 'All genres'}
                  </button>
                </div>
              </div>

              {err && phase === 'form' && (
                <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-300">{err}</div>
              )}

              {/* The big Create button — opens the SAME review step as always */}
              <div className="mt-7">
                <button
                  type="button"
                  onClick={() => requestRender(simpleAction)}
                  disabled={simpleBlocked}
                  title={simpleBlocked ? (hasMusicRoute ? 'Finish your lyrics first (at least 20 characters)' : 'No music engine is connected — ask an owner to connect one in Settings') : undefined}
                  className="w-full rounded-full bg-brand-gradient px-6 py-3.5 font-medium text-ink shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-10"
                >
                  <Play className="mr-2 inline h-4 w-4" aria-hidden />
                  {simpleAction === 'instrumental' ? 'Create instrumental' : simpleAction === 'lyrics' ? 'Create with my lyrics' : 'Create'}
                </button>
                <p className="mt-3 text-xs text-slate-500">
                  You review the brief and billing before anything starts — nothing renders or spends credits automatically. Advanced opens tempo, languages, voice, engine class, takes and more.
                </p>
                {musicRoutes && !hasMusicRoute && door !== 'instrumental' && (
                  <p className="mt-2 text-sm text-amber-300">No music engine is connected. An owner must connect one in Settings before rendering.</p>
                )}
              </div>

              {confirmPanel}
              {consolePlayer}
            </div>
          )}
        </div>

        {/* Workspaces › My Workspace — the user's songs, always in reach. */}
        <div className="mt-8 lg:sticky lg:top-6 lg:mt-0 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1">
          <MyWorkspacePane refreshKey={libRefresh} />
        </div>
      </div>
    );
  }

  // ═══ OPERATOR CONSOLE — EXACTLY the pre-USERSHELL layout ═══
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
    {consoleForm}

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

/**
 * Fetches the billing engine's own explanation of the current block and
 * renders it as one honest line — which detection rule matched or missed,
 * from the same code that made the decision.
 */
function BillingDiagnosisLine() {
  const api = useApi();
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{
        firstParty: boolean;
        billingEnforcement: string;
        rules: { envList: boolean; isHouseWorkspace: boolean; houseWorkspaceKnown: boolean; emailIsMaster: boolean; masterEmailsConfigured: number };
        workspace: { songCount: number; creditsCents: number | null; plan: string | null };
      }>(`/billing/diagnose`)
      .then((d) => {
        if (cancelled) return;
        if (d.firstParty) {
          setLine('Diagnosis: this account IS recognized as the house — this block should not have happened; report this exact screen.');
        } else {
          const misses = [
            d.rules.isHouseWorkspace ? null : `not the house workspace (${d.workspace.songCount} songs here)`,
            d.rules.emailIsMaster ? null : `login email is not in the master list (${d.rules.masterEmailsConfigured} configured)`,
            d.rules.envList ? null : 'not in FIRST_PARTY_WORKSPACE_IDS',
          ].filter(Boolean);
          setLine(`Diagnosis: treated as a customer — ${misses.join('; ')}. Billing enforcement: ${d.billingEnforcement}.`);
        }
      })
      .catch(() => setLine(null));
    return () => { cancelled = true; };
  }, [api]);
  if (!line) return null;
  return <p className="mt-2 text-xs text-slate-500">{line}</p>;
}


/**
 * DOOR 4 — MAKE A MUSIC VIDEO (the vertical's front door, owner 2026-07-17):
 * an artist with a FINISHED song walks in, attests it is theirs, uploads it,
 * and lands on its catalog card, where Video writes the treatment and
 * "Make the full video" does the rest. The song is used EXACTLY as brought
 * (verbatim-upload law) and auto-mastered to streaming loudness ("make it
 * perfect"). LEARNING BOUNDARY (owner's own law): we learn from the VIDEO we
 * make — never from their song.
 */
function VideoDoorPanel() {
  const api = useApi();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');

  async function submit() {
    if (!file || !attested || busy) return;
    setBusy(true);
    setError('');
    try {
      const songTitle = (title.trim() || file.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120);
      const project = await api.post<{ id: string }>('/projects', {
        title: songTitle,
        genre: 'afrobeats',
        bpm: 100,
      });
      const { key } = await api.uploadToStorage(file, 'reference', f => setPct(Math.round(f * 100)));
      await api.post(`/projects/${project.id}/mixes/upload`, {
        key,
        title: songTitle,
        autoMaster: true,
        masterPreset: 'afro_stream_-9',
      });
      router.push('/catalog');
    } catch (e) {
      setError((e as Error).message?.slice(0, 160) || 'Upload failed');
      setBusy(false);
    }
  }

  return (
    <section className="studio-upload-panel mx-auto max-w-xl" aria-labelledby="video-upload-title">
      <div className="studio-section-kicker"><Video aria-hidden="true" /> Music video workspace</div>
      <h2 id="video-upload-title" className="mt-2 font-display text-3xl text-white">Bring a finished song</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Upload the final song you want to visualize. The recording stays verbatim while the project prepares treatment, scenes, credits, and the finished video workflow.
      </p>
      <label htmlFor="video-song-title" className="studio-field-label mt-5">Song title <span>Optional</span></label>
      <input
        id="video-song-title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Song title (or we use the filename)"
        className="w-full rounded-lg border border-white/10 bg-black/30 p-2.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <label className="studio-upload-target mt-4 flex cursor-pointer">
        <span className="studio-choice-icon"><AudioLines aria-hidden="true" /></span>
        <span className="min-w-0 text-left">
          <strong className="truncate">{file ? file.name : 'Choose the finished song'}</strong>
          <small>MP3, WAV, M4A, or another supported audio file</small>
        </span>
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className="mt-4 flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-4 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={attested}
          onChange={e => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
        />
        <span>
          <strong className="block font-medium text-slate-200">I own or control this recording</strong>
          <span className="mt-1 block leading-5">I authorize the studio to master it and create a music video from it. It is not taken from a streaming platform, and this upload does not opt the recording into sound learning.</span>
        </span>
      </label>
      {busy && (
        <div className="mt-4" aria-live="polite">
          <div className="flex justify-between text-xs text-slate-500"><span>Uploading</span><span className="tabular-nums">{pct}%</span></div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {error && <div className="studio-error-callout mt-3" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span></div>}
      <button
        disabled={!file || !attested || busy}
        onClick={() => void submit()}
        className="studio-primary-button mt-4 w-full justify-center"
      >
        {busy ? <><LoaderCircle className="animate-spin" aria-hidden="true" /> Uploading {pct}%</> : <><Video aria-hidden="true" /> Continue to video treatment <ArrowRight aria-hidden="true" /></>}
      </button>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Next, open the song in Catalog to review the treatment and explicitly approve any paid scene renders.
      </p>
    </section>
  );
}
