'use client';

/**
 * BRING YOUR OWN — the create console's three doors for artists who arrive
 * with their own material. No new engines, no new render paths: every door
 * wires existing routes together.
 *
 *  A. "My beat + my vocals" — upload your beat, record/upload your chorus,
 *     the mixer renders them into a song. Fully real end to end.
 *  B. "My beat — you write for it" — upload your beat; the studio LISTENS
 *     (tempo/key/lane), then writes + demos a song to that DNA. HONEST: the
 *     demo's production is studio-made — your exact beat gets a vocal via
 *     door A, not this one. Your beat stays attached either way.
 *  C. "My chorus — you build the rest" — as TEXT it prefills the existing
 *     From-my-lyrics flow (sung verbatim); as AUDIO it becomes the lead
 *     vocal and our own engine assembles an instrumental bed under it.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { GENRES, genreSignature } from '@afrohit/shared';

type UpStatus = { kind: 'idle' | 'uploading' | 'done' | 'error'; msg?: string; pct?: number };
type LongOp =
  | { kind: 'idle' }
  | { kind: 'working'; step: number; msg?: string }
  | { kind: 'done'; msg?: string; url?: string; hook?: string }
  | { kind: 'handed'; msg: string }
  | { kind: 'error'; msg: string };

interface JobRow {
  status: string;
  error?: string | null;
  errorJson?: { message?: string } | null;
  outputJson?: Record<string, unknown> | null;
}

interface BeatProfile {
  bpm: number | null;
  key: string | null;
  genre: string | null;
  mood: string | null;
  energy: string | null;
  instruments?: string[];
  vibe?: string;
  suggestedVibePrompt?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
function guessFormat(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ['wav', 'mp3', 'flac', 'aiff', 'm4a', 'ogg'].includes(ext ?? '') ? ext! : 'wav';
}
/** beats/generate + drop take int 60–180 only — the ear can report floats. */
const clampBpm = (n: number | null | undefined, fallback: number) =>
  Math.round(Math.min(Math.max(n ?? fallback, 60), 180));
/** beats/upload + projects allow 40–220. */
const clampAttachBpm = (n: number) => Math.round(Math.min(Math.max(n, 40), 220));

/** Map a free-text detected genre to a supported lane (same as ReferenceListen). */
function matchGenre(detected?: string | null): string {
  const d = (detected ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!d) return 'afrobeats';
  const hit = GENRES.find((g) => d.includes(g.replace(/_/g, '')) || g.replace(/_/g, '').includes(d));
  if (hit) return hit;
  if (d.includes('piano')) return 'amapiano';
  if (d.includes('dancehall') || d.includes('reggae')) return 'afro_dancehall';
  if (d.includes('rnb') || d.includes('soul')) return 'afro_rnb';
  if (d.includes('gospel')) return 'gospel';
  if (d.includes('hiphop') || d.includes('rap') || d.includes('trap')) return 'hip_hop';
  return 'afrobeats';
}

const jobErr = (j: JobRow) => j.errorJson?.message ?? j.error ?? 'no reason recorded';

export function BringYourOwn({ onChorusText }: { onChorusText: (lyrics: string) => void }) {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [door, setDoor] = useState<'mix' | 'write' | 'chorus'>('mix');
  const rootRef = useRef<HTMLElement>(null);

  /** The app shell scrolls an inner <main>, NOT the window — climb to the real
   *  scroll container so the prefilled lyrics door actually comes into view. */
  function scrollToConsoleTop() {
    let el: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight + 10) el = el.parentElement;
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Resilient job poll (the codebase pattern): a fetch that fails (backgrounded
   * tab, wifi↔cell switch) must NOT kill work that keeps running server-side.
   * Returns null when the poll budget runs out while the job is still RUNNING.
   */
  async function pollJob(jobId: string, tries: number, onTick?: (i: number) => void): Promise<JobRow | null> {
    let netFails = 0;
    for (let i = 0; i < tries; i++) {
      await sleep(5000);
      let j: JobRow;
      try {
        j = await api.get<JobRow>(`/jobs/${jobId}`);
        netFails = 0;
      } catch {
        if (++netFails >= 24) return null;
        continue;
      }
      onTick?.(i);
      if (j.status === 'SUCCEEDED' || j.status === 'FAILED') return j;
    }
    return null;
  }

  /** Advisory cap check before a long paid run — refuse BEFORE the wait, not after. */
  async function preflightOk(setter: (op: LongOp) => void): Promise<boolean> {
    try {
      const pf = await api.get<{ ok: boolean; mode: string }>('/billing/preflight');
      if (!pf.ok) {
        setter({ kind: 'error', msg: 'Daily generation limit reached — it resets at midnight UTC.' });
        return false;
      }
    } catch {
      /* preflight is advisory — if it can't be read, proceed */
    }
    return true;
  }

  // ══════════════ DOOR A — my beat + my vocals → mix ══════════════
  const [aProject, setAProject] = useState<string | null>(null);
  const [aSong, setASong] = useState<string | null>(null);
  const [aBpm, setABpm] = useState('');
  const [aKey, setAKey] = useState('');
  const [aBeat, setABeat] = useState<UpStatus>({ kind: 'idle' });
  const [aVocal, setAVocal] = useState<UpStatus>({ kind: 'idle' });
  const [aMix, setAMix] = useState<LongOp>({ kind: 'idle' });
  const aBeatFile = useRef<HTMLInputElement>(null);

  async function ensureProjectA(): Promise<string> {
    if (aProject) return aProject;
    const p = await api.post<{ id: string }>('/projects', {
      title: 'My beat + my vocals',
      genre: 'afrobeats',
      ...(aBpm ? { bpm: clampAttachBpm(Number(aBpm)) } : {}),
      ...(aKey ? { keySignature: aKey } : {}),
    });
    setAProject(p.id);
    return p.id;
  }

  async function uploadBeatA(file: File) {
    setABeat({ kind: 'uploading', pct: 0 });
    try {
      const pid = await ensureProjectA();
      const { key } = await api.uploadToStorage(file, 'beat', (f) => setABeat({ kind: 'uploading', pct: Math.round(f * 100) }));
      const res = await api.post<{ songId: string; jobId: string }>(`/projects/${pid}/beats/upload`, {
        key,
        format: guessFormat(file.name),
        title: baseName(file.name),
        ...(aSong ? { songId: aSong } : {}),
        ...(aBpm ? { bpm: clampAttachBpm(Number(aBpm)) } : {}),
        ...(aKey ? { keySignature: aKey } : {}),
      });
      setASong(res.songId);
      setABeat({ kind: 'uploading', msg: 'Checking the exact beat file before it enters the mixer…' });
      const qcJob = await pollJob(res.jobId, 24);
      if (!qcJob || qcJob.status !== 'SUCCEEDED') {
        throw new Error(qcJob ? jobErr(qcJob) : 'Beat QC is still running. Try again shortly.');
      }
      setABeat({ kind: 'done', msg: 'Your beat passed QC and will be used verbatim.' });
    } catch (e) {
      setABeat({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function uploadVocalA(src: File | Blob, label: string) {
    setAVocal(src instanceof File ? { kind: 'uploading', pct: 0 } : { kind: 'uploading', msg: 'Uploading the recording…' });
    try {
      const pid = await ensureProjectA();
      const { key } =
        src instanceof File
          ? await api.uploadToStorage(src, 'vocal', (f) => setAVocal({ kind: 'uploading', pct: Math.round(f * 100) }))
          : await api.uploadAudioDirect(src, 'vocal');
      const res = await api.post<{ songId: string; jobId: string }>(`/projects/${pid}/vocals/upload`, {
        key,
        role: 'lead',
        isolationConfirmed: true,
        ...(aSong ? { songId: aSong } : {}),
      });
      setASong(res.songId);
      const qcJob = await pollJob(res.jobId, 24);
      if (!qcJob || qcJob.status !== 'SUCCEEDED') {
        throw new Error(qcJob ? jobErr(qcJob) : 'Vocal QC is still running. Try again shortly.');
      }
      setAVocal({ kind: 'done', msg: `${label} is in as the lead vocal — mixed verbatim, never cloned.` });
    } catch (e) {
      setAVocal({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function mixA() {
    if (!aProject || !aSong || aMix.kind === 'working') return;
    setAMix({ kind: 'working', step: 0, msg: 'Mixing your beat + your vocal (radio preset)…' });
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${aProject}/mixes`, { songId: aSong, preset: 'radio' });
      const j = await pollJob(jobId, 72);
      if (!j) {
        setAMix({ kind: 'handed', msg: 'Still mixing past our wait — it finishes server-side and lands in this project. Open it in a minute.' });
        return;
      }
      if (j.status === 'FAILED') {
        setAMix({ kind: 'error', msg: `The mix failed — ${jobErr(j)}` });
        return;
      }
      const url = (j.outputJson as { url?: string } | null)?.url;
      if (!url) {
        setAMix({ kind: 'handed', msg: 'Mixed — the file is still landing. Open the project to play it.' });
        return;
      }
      setAMix({ kind: 'done', url, msg: 'Your song — your beat, your voice, mastered to a competitive streaming loudness (measured).' });
    } catch (e) {
      setAMix({ kind: 'error', msg: (e as Error).message });
    }
  }

  // ══════════════ DOOR B — my beat → the studio writes for it ══════════════
  const [bProject, setBProject] = useState<string | null>(null);
  const [bBpm, setBBpm] = useState('');
  const [bKey, setBKey] = useState('');
  const [bBeat, setBBeat] = useState<UpStatus>({ kind: 'idle' });
  const [bBeatUrl, setBBeatUrl] = useState<string | null>(null);
  const [bAnalyze, setBAnalyze] = useState<{ kind: 'idle' | 'listening' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });
  const [bProfile, setBProfile] = useState<BeatProfile | null>(null);
  const bReferenceId = useRef<string | null>(null);
  const [bWrite, setBWrite] = useState<LongOp>({ kind: 'idle' });
  const bBeatFile = useRef<HTMLInputElement>(null);
  const B_STEPS = ['Reading your beat’s DNA', 'Writing the hook + lyrics to it', 'Singing & producing the demo'];

  async function uploadBeatB(file: File) {
    setBBeat({ kind: 'uploading', pct: 0 });
    try {
      let pid = bProject;
      if (!pid) {
        const p = await api.post<{ id: string }>('/projects', {
          title: 'My beat — write for it',
          genre: 'afrobeats',
          ...(bBpm ? { bpm: clampAttachBpm(Number(bBpm)) } : {}),
          ...(bKey ? { keySignature: bKey } : {}),
        });
        pid = p.id;
        setBProject(pid);
      }
      const { key, publicUrl, playbackUrl } = await api.uploadToStorage(file, 'beat', (f) => setBBeat({ kind: 'uploading', pct: Math.round(f * 100) }));
      const attached = await api.post<{ jobId: string }>(`/projects/${pid}/beats/upload`, {
        key,
        format: guessFormat(file.name),
        title: baseName(file.name),
        ...(bBpm ? { bpm: clampAttachBpm(Number(bBpm)) } : {}),
        ...(bKey ? { keySignature: bKey } : {}),
      });
      setBBeat({ kind: 'uploading', msg: 'Checking the exact beat file before the studio uses it…' });
      const qcJob = await pollJob(attached.jobId, 24);
      if (!qcJob || qcJob.status !== 'SUCCEEDED') {
        throw new Error(qcJob ? jobErr(qcJob) : 'Beat QC is still running. Try again shortly.');
      }
      setBBeatUrl(playbackUrl);
      setBBeat({ kind: 'done', msg: 'Beat passed QC and is attached to your project. It stays yours whatever happens next.' });
      void analyzeB(pid, publicUrl);
    } catch (e) {
      setBBeat({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function analyzeB(pid: string, url: string) {
    setBAnalyze({ kind: 'listening', msg: 'The studio is listening to your beat…' });
    setBProfile(null);
    bReferenceId.current = null;
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${pid}/analyze`, { url });
      const j = await pollJob(jobId, 72, (i) =>
        setBAnalyze({ kind: 'listening', msg: `Listening… ${(i + 1) * 5}s (the first run can take a couple of minutes)` })
      );
      if (!j) throw new Error('still listening — the ear is warming up. Try “Listen again” in a minute.');
      if (j.status === 'FAILED') throw new Error(jobErr(j));
      const out = j.outputJson as { profile?: BeatProfile; referenceId?: string | null } | null;
      if (!out?.profile) throw new Error('no profile came back from the listen');
      bReferenceId.current = out.referenceId ?? null;
      setBProfile(out.profile);
      setBAnalyze({ kind: 'done', msg: 'Your beat’s DNA:' });
    } catch (e) {
      setBAnalyze({
        kind: 'error',
        msg: `Couldn’t read the beat: ${(e as Error).message} — you can still hit Write below; the studio will use your tempo/key inputs (or the lane default) instead.`,
      });
    }
  }

  async function writeB() {
    if (!bProject || bWrite.kind === 'working') return;
    if (!(await preflightOk(setBWrite))) return;
    setBWrite({ kind: 'working', step: 1 });
    try {
      const genre = matchGenre(bProfile?.genre);
      const bpm = clampBpm(bProfile?.bpm ?? (bBpm ? Number(bBpm) : null), genreSignature(genre).bpm);
      const keyLine = bProfile?.key ?? (bKey || null);
      const theme = `A fresh ${genre.replace(/_/g, ' ')} song written to this exact beat DNA: ${bpm}bpm${keyLine ? `, key ${keyLine}` : ''}${
        bProfile?.mood ? `, ${bProfile.mood} mood` : ''
      }.${bProfile?.suggestedVibePrompt ? ` Vibe: ${bProfile.suggestedVibePrompt}.` : ''} Chorus-first and catchy. Original, never a copy.`;
      const started = await api.post<{ jobId: string }>(
        `/projects/${bProject}/drop`,
        {
          theme,
          vibe: bProfile?.suggestedVibePrompt?.slice(0, 500) || undefined,
          count: 1,
          genre,
          bpm,
          mood: bProfile?.mood ?? undefined,
          withVocals: true,
          pinnedReferenceId: bReferenceId.current ?? undefined,
        },
        // One key per CLICK — the network-retry in apiFetch can re-send this
        // POST; the server must not start (and charge) a second drop.
        { 'Idempotency-Key': crypto.randomUUID() }
      );
      const dj = await pollJob(started.jobId, 130);
      if (!dj) {
        setBWrite({ kind: 'handed', msg: 'Still writing — the studio keeps going server-side and the song lands in your Catalog when done.' });
        return;
      }
      if (dj.status === 'FAILED') throw new Error(jobErr(dj));
      const out = dj.outputJson as { drop?: Array<{ jobId?: string; hookText?: string; error?: string }>; error?: string } | null;
      const item = out?.drop?.[0];
      if (!item?.jobId) throw new Error(item?.error || out?.error || 'The writer could not start this one — try again.');
      setBWrite({ kind: 'working', step: 2 });
      const rj = await pollJob(item.jobId, 144);
      if (!rj) {
        setBWrite({ kind: 'handed', msg: 'The demo is still rendering — it lands in your Catalog in a few minutes. Nothing is lost.' });
        return;
      }
      if (rj.status === 'FAILED') throw new Error(jobErr(rj));
      let url = '';
      try {
        const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${bProject}/beats`);
        url = beats.sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt))[0]?.url ?? '';
      } catch {
        /* beats fetch blip — hand off below */
      }
      if (!url) {
        setBWrite({ kind: 'handed', msg: 'Rendered — the audio is still landing. Open the project or Catalog to play it.' });
        return;
      }
      setBWrite({ kind: 'done', url, hook: item.hookText, msg: 'Written and demoed to your beat’s DNA.' });
    } catch (e) {
      setBWrite({ kind: 'error', msg: (e as Error).message });
    }
  }

  // ══════════════ DOOR C — my chorus → the studio builds the rest ══════════════
  const [cMode, setCMode] = useState<'text' | 'audio'>('text');
  const [cText, setCText] = useState('');
  const [cGenre, setCGenre] = useState('afrobeats');
  const [cBpm, setCBpm] = useState<number>(genreSignature('afrobeats').bpm);
  const cBpmTouched = useRef(false);
  const [cProject, setCProject] = useState<string | null>(null);
  const [cSong, setCSong] = useState<string | null>(null);
  const [cVocal, setCVocal] = useState<UpStatus>({ kind: 'idle' });
  const [cBuild, setCBuild] = useState<LongOp>({ kind: 'idle' });
  const C_STEPS = ['Assembling your beat (own engine)', 'Mixing your chorus onto it'];

  function pickGenreC(g: string) {
    setCGenre(g);
    if (!cBpmTouched.current) setCBpm(genreSignature(g).bpm);
  }

  function useChorusText() {
    const t = cText.trim();
    if (t.length < 15) return;
    // Hand the chorus to the existing From-my-lyrics flow as the [Hook] —
    // that flow sings EXACTLY what's in its box (artist words are law).
    onChorusText(t.startsWith('[') ? t : `[Hook]\n${t}`);
    scrollToConsoleTop();
  }

  async function uploadChorusC(src: File | Blob, label: string) {
    setCVocal(src instanceof File ? { kind: 'uploading', pct: 0 } : { kind: 'uploading', msg: 'Uploading the recording…' });
    try {
      let pid = cProject;
      if (!pid) {
        const p = await api.post<{ id: string }>('/projects', {
          title: 'My chorus — build the rest',
          genre: cGenre,
          bpm: clampAttachBpm(cBpm),
        });
        pid = p.id;
        setCProject(pid);
      }
      const { key } =
        src instanceof File
          ? await api.uploadToStorage(src, 'vocal', (f) => setCVocal({ kind: 'uploading', pct: Math.round(f * 100) }))
          : await api.uploadAudioDirect(src, 'vocal');
      const res = await api.post<{ songId: string; jobId: string }>(`/projects/${pid}/vocals/upload`, {
        key,
        role: 'lead',
        isolationConfirmed: true,
        ...(cSong ? { songId: cSong } : {}),
      });
      setCSong(res.songId);
      const qcJob = await pollJob(res.jobId, 24);
      if (!qcJob || qcJob.status !== 'SUCCEEDED') {
        throw new Error(qcJob ? jobErr(qcJob) : 'Vocal QC is still running. Try again shortly.');
      }
      setCVocal({ kind: 'done', msg: `${label} is in as the lead vocal — used verbatim.` });
    } catch (e) {
      setCVocal({ kind: 'error', msg: (e as Error).message });
    }
  }

  async function buildC() {
    if (!cProject || !cSong || cBuild.kind === 'working') return;
    if (!(await preflightOk(setCBuild))) return;
    setCBuild({ kind: 'working', step: 0 });
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${cProject}/beats/generate`, {
        songId: cSong,
        genre: cGenre,
        bpm: clampBpm(cBpm, genreSignature(cGenre).bpm),
        withStems: false,
        withVocals: false,
        songEngine: 'own',
      });
      const j = await pollJob(jobId, 108);
      if (!j) {
        setCBuild({ kind: 'handed', msg: 'The beat is still assembling — it lands in this project; open it to mix when it’s there.' });
        return;
      }
      if (j.status === 'FAILED') throw new Error(jobErr(j));
      setCBuild({ kind: 'working', step: 1 });
      const { jobId: mixJobId } = await api.post<{ jobId: string }>(`/projects/${cProject}/mixes`, { songId: cSong, preset: 'radio' });
      const mj = await pollJob(mixJobId, 72);
      if (!mj) {
        setCBuild({ kind: 'handed', msg: 'Still mixing — it finishes server-side and lands in this project. Open it in a minute.' });
        return;
      }
      if (mj.status === 'FAILED') throw new Error(`The mix failed — ${jobErr(mj)}`);
      const url = (mj.outputJson as { url?: string } | null)?.url;
      if (!url) {
        setCBuild({ kind: 'handed', msg: 'Mixed — the file is still landing. Open the project to play it.' });
        return;
      }
      setCBuild({ kind: 'done', url, msg: 'Your chorus over a beat built from owned material in your lane.' });
    } catch (e) {
      setCBuild({ kind: 'error', msg: (e as Error).message });
    }
  }

  // ══════════════ render ══════════════
  return (
    <section ref={rootRef} className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <div>
          <div className="font-display text-2xl">🎒 Bring your own</div>
          <p className="mt-0.5 text-sm text-slate-400">
            Got your own beat or chorus? Bring it — sing on it, have the studio write for it, or let it build the rest around you.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-slate-300">{open ? '− Close' : '+ Open'}</span>
      </button>

      {open && (
        <div className="border-t border-white/10 p-5">
          {/* THREE DOORS */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'mix' as const, label: '🎚️ My beat + my vocals' },
                { id: 'write' as const, label: '✍️ My beat — write for it' },
                { id: 'chorus' as const, label: '🎼 My chorus — build the rest' },
              ]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setDoor(t.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  door === t.id ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(249,115,22,.5)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── DOOR A ── */}
          {door === 'mix' && (
            <div className="mt-4 rounded-2xl glass p-4">
              <p className="text-sm text-slate-400">
                Upload your beat, then record or upload your vocal — the studio mixes them into <span className="text-slate-200">your</span> song.
                Both are used verbatim: nothing invented, nothing replaced.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={aBpm} onChange={(e) => setABpm(e.target.value.replace(/[^0-9]/g, ''))} placeholder="BPM (optional)" inputMode="numeric" className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                <input value={aKey} onChange={(e) => setAKey(e.target.value)} placeholder="Key e.g. Am (optional)" className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="font-display text-lg">1 · Your beat</div>
                  <input ref={aBeatFile} type="file" accept="audio/*,audio/mpeg,.wav,.mp3,.flac,.aiff,.m4a,.ogg,.mpeg,.mpg" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadBeatA(e.target.files[0])} />
                  <button
                    onClick={() => aBeatFile.current?.click()}
                    disabled={aBeat.kind === 'uploading'}
                    className="mt-3 w-full rounded-full border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    {aBeat.kind === 'uploading' ? `Uploading… ${aBeat.pct ?? 0}%` : aBeat.kind === 'done' ? 'Replace beat' : 'Choose beat file'}
                  </button>
                  <StatusLine status={aBeat} />
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="font-display text-lg">2 · Your vocal / chorus</div>
                  <VocalIn status={aVocal} onAudio={(src, label) => void uploadVocalA(src, label)} onError={(m) => setAVocal({ kind: 'error', msg: m })} />
                </div>
              </div>
              <div className="mt-4">
                <button
                  onClick={() => void mixA()}
                  disabled={aBeat.kind !== 'done' || aVocal.kind !== 'done' || !aSong || aMix.kind === 'working'}
                  className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:opacity-50"
                >
                  {aMix.kind === 'working' ? '🎚️ Mixing your song…' : '🎚️ Mix my song'}
                </button>
                {aBeat.kind !== 'done' || aVocal.kind !== 'done' ? (
                  <p className="mt-2 text-xs text-slate-500">Bring both the beat and the vocal in first — then the mixer puts them together.</p>
                ) : null}
                <OpResult op={aMix} projectId={aProject} router={router} />
              </div>
            </div>
          )}

          {/* ── DOOR B ── */}
          {door === 'write' && (
            <div className="mt-4 rounded-2xl glass p-4">
              <p className="text-sm text-slate-400">
                Upload your beat — the studio listens and detects its tempo, key and lane, then writes a chorus + lyrics and demos a song{' '}
                <span className="text-slate-200">to your beat’s DNA</span>.
              </p>
              <p className="mt-1.5 text-xs text-amber-200/90">
                Honest note: the demo’s production is studio-made in your beat’s tempo/key/lane — no engine here sings on top of your exact file.
                To put a vocal ON your actual beat, use “My beat + my vocals”. Your beat stays attached to this project either way.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={bBpm} onChange={(e) => setBBpm(e.target.value.replace(/[^0-9]/g, ''))} placeholder="BPM (optional)" inputMode="numeric" className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                <input value={bKey} onChange={(e) => setBKey(e.target.value)} placeholder="Key e.g. Am (optional)" className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
                <input ref={bBeatFile} type="file" accept="audio/*,audio/mpeg,.wav,.mp3,.flac,.aiff,.m4a,.ogg,.mpeg,.mpg" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadBeatB(e.target.files[0])} />
                <button
                  onClick={() => bBeatFile.current?.click()}
                  disabled={bBeat.kind === 'uploading' || bAnalyze.kind === 'listening'}
                  className="rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400 disabled:opacity-50"
                >
                  {bBeat.kind === 'uploading' ? `Uploading… ${bBeat.pct ?? 0}%` : bBeat.kind === 'done' ? 'Replace beat' : 'Upload my beat'}
                </button>
              </div>
              <StatusLine status={bBeat} />
              {bAnalyze.kind !== 'idle' && (
                <div className={`mt-3 text-xs ${bAnalyze.kind === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
                  {bAnalyze.msg}
                  {bAnalyze.kind === 'error' && bProject && bBeatUrl && (
                    <button onClick={() => void analyzeB(bProject, bBeatUrl)} className="ml-2 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">
                      Listen again
                    </button>
                  )}
                </div>
              )}
              {bProfile && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Stat label="BPM" value={bProfile.bpm ?? '—'} />
                  <Stat label="Key" value={bProfile.key ?? '—'} />
                  <Stat label="Lane" value={bProfile.genre ?? '—'} />
                  <Stat label="Mood" value={bProfile.mood ?? '—'} />
                </div>
              )}
              {bBeat.kind === 'done' && (
                <div className="mt-4">
                  <button
                    onClick={() => void writeB()}
                    disabled={bWrite.kind === 'working' || bAnalyze.kind === 'listening'}
                    className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:opacity-50"
                  >
                    {bWrite.kind === 'working' ? '✍️ Writing to your beat…' : '✍️ Write me a chorus + lyrics for this beat'}
                  </button>
                  {bWrite.kind === 'working' && <Steps steps={B_STEPS} current={bWrite.step} />}
                  <OpResult op={bWrite} projectId={bProject} router={router} />
                </div>
              )}
            </div>
          )}

          {/* ── DOOR C ── */}
          {door === 'chorus' && (
            <div className="mt-4 rounded-2xl glass p-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'text' as const, label: '📝 I’ll type / paste it' },
                    { id: 'audio' as const, label: '🎤 I’ll record / upload it' },
                  ]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setCMode(t.id)}
                    className={`rounded-full px-3.5 py-1.5 text-sm ${
                      cMode === t.id ? 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(226,62,140,.4)]' : 'border border-white/10 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {cMode === 'text' ? (
                <div className="mt-3">
                  <p className="text-sm text-slate-400">
                    Paste your chorus — it becomes the <span className="text-slate-200">[Hook]</span> in the “Start from my lyrics” door above. The
                    studio reads it, prefills genre/tempo, and sings <span className="text-slate-200">exactly</span> what’s in that box. Add verses
                    up there if you want verses — your words are law, never rewritten.
                  </p>
                  <textarea
                    value={cText}
                    onChange={(e) => setCText(e.target.value)}
                    rows={5}
                    placeholder={'Your chorus here…'}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs leading-relaxed"
                  />
                  <button
                    onClick={useChorusText}
                    disabled={cText.trim().length < 15}
                    className="mt-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
                  >
                    📝 Use it as my hook — build the song
                  </button>
                  {cText.trim().length > 0 && cText.trim().length < 15 && (
                    <p className="mt-1.5 text-xs text-slate-500">A few more words — at least a full line, so the reader has something to read.</p>
                  )}
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-slate-400">
                    Record or upload your sung chorus — it becomes the <span className="text-slate-200">lead vocal, verbatim</span>. Our own engine
                    assembles an instrumental bed in your chosen lane and tempo, then mixes your chorus on top.
                  </p>
                  <p className="mt-1.5 text-xs text-amber-200/90">
                    Honest note: this path builds the beat and mixes — it doesn’t write or sing new verses onto your recording. For a fully written
                    song around your words, use the text option.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select value={cGenre} onChange={(e) => pickGenreC(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm capitalize">
                      {GENRES.map((g) => (
                        <option key={g} value={g}>
                          {g.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(cBpm)}
                      onChange={(e) => {
                        cBpmTouched.current = true;
                        const n = Number(e.target.value.replace(/[^0-9]/g, '') || 0);
                        setCBpm(n);
                      }}
                      placeholder="BPM"
                      inputMode="numeric"
                      className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <span className="text-[11px] text-slate-500">Lane + tempo the beat is built in (60–180).</span>
                  </div>
                  <div className="mt-3 max-w-md rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="font-display text-lg">Your chorus</div>
                    <VocalIn status={cVocal} onAudio={(src, label) => void uploadChorusC(src, label)} onError={(m) => setCVocal({ kind: 'error', msg: m })} />
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => void buildC()}
                      disabled={cVocal.kind !== 'done' || !cSong || cBuild.kind === 'working'}
                      className="rounded-full bg-brand-gradient px-6 py-3 font-medium text-ink shadow-glow disabled:opacity-50"
                    >
                      {cBuild.kind === 'working' ? '🧱 Building your beat…' : '🧱 Build my beat + mix my chorus on it'}
                    </button>
                    {cBuild.kind === 'working' && <Steps steps={C_STEPS} current={cBuild.step} />}
                    <OpResult op={cBuild} projectId={cProject} router={router} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Record-or-upload input for a vocal take (StudioUpload's MediaRecorder pattern). */
function VocalIn({
  status,
  onAudio,
  onError,
}: {
  status: UpStatus;
  onAudio: (src: File | Blob, label: string) => void;
  onError: (msg: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 2000) {
          onError('Didn’t catch enough audio — record again, a little longer.');
          return;
        }
        onAudio(blob, 'Recording');
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      onError(`Mic blocked: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <div className="mt-3 flex gap-2">
        {!recording ? (
          <button onClick={() => void start()} disabled={status.kind === 'uploading'} className="flex-1 rounded-full bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
            ● Record
          </button>
        ) : (
          <button onClick={() => recRef.current?.stop()} className="flex-1 animate-pulse rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white">
            ■ Stop &amp; save
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,audio/mpeg,.wav,.mp3,.m4a,.ogg,.webm,.mpeg,.mpg"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onAudio(e.target.files[0], e.target.files[0].name)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={status.kind === 'uploading' || recording}
          className="flex-1 rounded-full border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {status.kind === 'uploading' ? (status.pct != null ? `Uploading… ${status.pct}%` : 'Uploading…') : 'Upload take'}
        </button>
      </div>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status?: UpStatus }) {
  if (!status || status.kind === 'idle') return null;
  const color = status.kind === 'error' ? 'text-red-400' : status.kind === 'done' ? 'text-emerald-400' : 'text-slate-400';
  return <div className={`mt-2 text-xs ${color}`}>{status.msg ?? (status.pct != null ? `Uploading… ${status.pct}%` : '…')}</div>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-slate-200" title={String(value)}>
        {value}
      </div>
    </div>
  );
}

function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ul className="mt-3 space-y-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2 text-sm">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
              i < current ? 'bg-emerald-500/25 text-emerald-300' : i === current ? 'bg-brand-gradient text-ink' : 'bg-white/5 text-slate-500'
            }`}
          >
            {i < current ? '✓' : i === current ? '●' : i + 1}
          </span>
          <span className={i <= current ? 'text-slate-200' : 'text-slate-500'}>{s}</span>
        </li>
      ))}
    </ul>
  );
}

/** Terminal state of a long door operation: error / calm hand-off / playable result. */
function OpResult({ op, projectId, router }: { op: LongOp; projectId: string | null; router: ReturnType<typeof useRouter> }) {
  if (op.kind === 'error') {
    return <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">Couldn’t finish: {op.msg}</div>;
  }
  if (op.kind === 'handed') {
    return <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">Still cooking 🎶 {op.msg}</div>;
  }
  if (op.kind !== 'done') return null;
  return (
    <div className="mt-3 rounded-2xl border-gradient glass p-4">
      {op.msg && <div className="text-sm text-slate-300">{op.msg}</div>}
      {op.hook && <div className="mt-1 text-sm text-slate-400">“{op.hook.replace(/\(response:.*/i, '').trim()}”</div>}
      {op.url && <audio controls autoPlay className="mt-3 w-full" src={op.url} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => router.push('/catalog')} className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
          🎧 See it in my Catalog →
        </button>
        {projectId && (
          <button onClick={() => router.push(`/projects/${projectId}`)} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
            🎬 Open the project (cover, master, release)
          </button>
        )}
      </div>
    </div>
  );
}
