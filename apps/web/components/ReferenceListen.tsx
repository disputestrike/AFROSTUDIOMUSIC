'use client';

/**
 * Play a track → the AI listens → understands it → you create from it.
 *
 * Two ways in, like a real Shazam:
 *  1. LISTEN NOW — record from the mic whatever is playing in the room (off a
 *     phone, a speaker, in the air). The AI hears it and creates a fresh original.
 *  2. Choose a file — drop in audio you have the rights to.
 * Either way we only extract BPM/key/genre/mood and make an ORIGINAL — never a copy.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { GENRES } from '@afrohit/shared';

/** Map a free-text detected genre to one of our supported lanes. */
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

interface Profile {
  bpm: number | null;
  key: string | null;
  genre: string | null;
  mood: string | null;
  energy: string | null;
  instruments: string[];
  vocalGender: string | null;
  vocalStyle: string | null;
  language: string | null;
  vibe: string;
  suggestedVibePrompt: string;
  raw: string;
}

/** Describe the heard voice so the created song matches it, not just the tempo. */
function voiceLine(p: Profile): string {
  const bits = [
    p.vocalGender && p.vocalGender !== 'instrumental' ? `${p.vocalGender} lead vocal` : null,
    p.vocalStyle || null,
    p.language ? `sung in ${p.language}` : null,
  ].filter(Boolean);
  return bits.length ? ` Vocal: ${bits.join(', ')}.` : '';
}

export function ReferenceListen({ projectId }: { projectId: string }) {
  const api = useApi();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [factsOnly, setFactsOnly] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Visible production state — creating from a listen takes 2-4 minutes and MUST
  // look alive the whole time (a quiet status line reads as a dead button).
  const [producing, setProducing] = useState<null | { step: number; label: string; startedAt: number }>(null);
  const [prodElapsed, setProdElapsed] = useState(0);
  const [madeUrl, setMadeUrl] = useState<string | null>(null);
  const [prodError, setProdError] = useState('');
  // NOT an error: the song is still being written/rendered server-side past the
  // time we're willing to hold the screen. It WILL land in the Catalog.
  const [handedOff, setHandedOff] = useState('');
  const PROD_STEPS = ['Writing the hook + lyrics (A&R picks the best)', 'Singing & producing the record', 'Done — play it'];

  useEffect(() => {
    if (!producing) return;
    const t = setInterval(() => setProdElapsed(Math.round((Date.now() - producing.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [producing]);

  // Mic capture (the Shazam "listen to the room" path).
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micAvailable, setMicAvailable] = useState(false);
  const MAX_SECS = 40; // long enough to catch a verse + the chorus

  useEffect(() => {
    setMicAvailable(typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // The id of the SoundReference the analyze just stored — PINNED into the
  // remake so the song rebuilds THIS record's sound, not a lucky-recent one.
  const referenceIdRef = useRef<string | null>(null);

  async function poll(jobId: string): Promise<Profile | null> {
    // Replicate can cold-start (first call after idle) for 2-3 min — poll up to
    // ~6 min and keep the user informed instead of giving up at 2 min.
    const MAX = 72; // 72 × 5s = 360s
    for (let i = 0; i < MAX; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const job = await api.get<{ status: string; outputJson?: { profile?: Profile; referenceId?: string | null; factsOnly?: boolean }; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED' && job.outputJson?.factsOnly) {
        // Facts-only: numbers landed in the lane profile; there is no vibe
        // profile to show (by design — no expression was learned).
        referenceIdRef.current = null;
        return null;
      }
      if (job.status === 'SUCCEEDED' && job.outputJson?.profile) {
        referenceIdRef.current = job.outputJson.referenceId ?? null;
        return job.outputJson.profile;
      }
      if (job.status === 'FAILED') throw new Error(typeof job.errorJson === 'string' ? job.errorJson : JSON.stringify(job.errorJson ?? 'analyze failed'));
      setStatus(`🎧 The AI is listening… (${(i + 1) * 5}s — first run can take a couple minutes)`);
    }
    throw new Error('Still listening — the model is warming up. Give it a moment and try again.');
  }

  async function analyzeSource(src: Blob) {
    setBusy(true);
    setProfile(null);
    setStatus('Uploading what I heard…');
    try {
      // Proxy through our API (no R2 CORS needed) for the recording/reference.
      const { publicUrl } = await api.uploadAudioDirect(src, 'reference');
      setStatus(factsOnly ? '📐 Measuring the numbers…' : '🎧 The AI is listening…');
      const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/analyze`, { url: publicUrl, factsOnly: factsOnly || undefined });
      const p = await poll(jobId);
      if (!p) {
        setStatus('📐 Measured into the lane profile — tempo, groove, log-drum, arrangement. Numbers only: no words learned, audio deleted after measuring.');
        return;
      }
      setProfile(p);
      setStatus('Here’s what the AI heard:');
    } catch (e) {
      setStatus(`Couldn’t analyze: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function onFile(file: File) {
    void analyzeSource(file);
  }

  // Record ambient audio from the mic (music playing off any device / in the air).
  async function startListening() {
    if (recording || busy) return;
    setProfile(null);
    setStatus('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const mt = mr.mimeType || 'audio/webm';
        const ext = mt.includes('ogg') ? 'ogg' : mt.includes('mp4') ? 'mp4' : 'webm';
        const file = new File(chunksRef.current, `listen.${ext}`, { type: `audio/${ext}` });
        if (file.size < 2000) { setStatus('Didn’t catch enough audio — try again with the song playing.'); return; }
        void analyzeSource(file);
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setElapsed(0);
      setStatus('🎙️ Listening to the room — play the song now…');
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          const n = s + 1;
          if (n >= MAX_SECS) stopListening();
          return n;
        });
      }, 1000);
    } catch (e) {
      setStatus(`I need mic access to listen to the room: ${(e as Error).message}`);
    }
  }

  function stopListening() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }

  /** Poll a render job, then return the freshest beat URL for this project. */
  async function pollRenderedAudio(jobId: string): Promise<string> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const job = await api.get<{ status: string; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') {
        const beats = await api.get<Array<{ url: string; createdAt: string }>>(`/projects/${projectId}/beats`);
        const url = beats.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]?.url;
        if (url) return url;
        throw new Error('Rendered, but the audio is still landing — check the studio in a minute.');
      }
      if (job.status === 'FAILED') {
        throw new Error(typeof job.errorJson === 'string' ? job.errorJson : 'The render failed — try again or switch engine in Settings.');
      }
    }
    throw new Error('Still rendering — it will appear in the studio when done.');
  }

  async function makeBeat() {
    if (!profile || producing) return;
    setProdError('');
    setMadeUrl(null);
    setProducing({ step: 1, label: 'Producing the beat', startedAt: Date.now() });
    try {
      const bpm = Math.min(Math.max(profile.bpm ?? 103, 60), 180);
      const r = await api.post<{ jobId: string }>(`/projects/${projectId}/beats/generate`, {
        genre: matchGenre(profile.genre),
        bpm,
        ...(profile.key ? { keySignature: profile.key } : {}),
        mood: profile.mood ?? undefined,
        pinnedReferenceId: referenceIdRef.current ?? undefined,
        vibePrompt: `${profile.genre ? profile.genre + ' — ' : ''}${profile.suggestedVibePrompt}${voiceLine(profile)}`,
        withStems: false,
      });
      const url = await pollRenderedAudio(r.jobId);
      setMadeUrl(url);
      setProducing((p) => (p ? { ...p, step: 2, label: 'Done' } : p));
    } catch (e) {
      setProdError((e as Error).message);
      setProducing(null);
    }
  }

  async function makeFullSong() {
    if (!profile || producing) return;
    setProdError('');
    setHandedOff('');
    setMadeUrl(null);
    // Step 0 starts IMMEDIATELY — the /drop call alone takes 1-3 minutes (it
    // writes the hook + lyrics server-side before responding), and the user must
    // see life the entire time.
    setProducing({ step: 0, label: PROD_STEPS[0]!, startedAt: Date.now() });
    try {
      const bpm = Math.min(Math.max(profile.bpm ?? 103, 60), 180);
      const genre = matchGenre(profile.genre);
      const theme = `A fresh ${genre.replace(/_/g, ' ')} song in the vibe of: ${profile.suggestedVibePrompt || profile.vibe}.${voiceLine(profile)} Catchy, original, never a copy.`;
      // 202 + drop-job id instantly; poll for the written hook/lyrics result
      // (holding one multi-minute HTTP request open dies on real networks).
      const started = await api.post<{ jobId: string }>(
        `/projects/${projectId}/drop`,
        {
          theme,
          count: 1,
          genre,
          bpm,
          withVocals: true,
          // Pin the exact reference we just heard + carry its mood — the remake
          // must rebuild THAT sound.
          mood: profile.mood ?? undefined,
          pinnedReferenceId: referenceIdRef.current ?? undefined,
        }
      );
      let item: { jobId?: string; error?: string } | undefined;
      let dropErr: string | undefined;
      let lastStatus = 'RUNNING';
      let netFails = 0;
      // The writer now drafts + runs a full critic-polish pass + arranges vocals
      // BEFORE the render is queued — a real record takes minutes. Wait up to ~11
      // min, and shrug off transient network blips (backgrounded tab, wifi↔cell)
      // instead of killing a song that's still being written server-side.
      for (let i = 0; i < 130; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        let j: { status: string; outputJson?: { drop?: Array<typeof item>; error?: string } };
        try { j = await api.get(`/jobs/${started.jobId}`); netFails = 0; }
        catch { if (++netFails >= 24) break; continue; }
        lastStatus = j.status;
        // Read the TOP-LEVEL reason too: when no take rendered, the drop carries
        // WHY (brain down, no hooks) there — not on a per-take item.
        if (j.status === 'SUCCEEDED') { item = j.outputJson?.drop?.[0]; dropErr = j.outputJson?.error; break; }
        if (j.status === 'FAILED') throw new Error('Could not write the song — try again.');
      }
      if (!item?.jobId) {
        const reason = item?.error || dropErr;
        if (reason === 'insufficient_credits') throw new Error('Daily limit reached — resets at midnight UTC.');
        if (reason) throw new Error(reason); // a REAL failure the server named
        // No result yet but no failure either — the song is STILL being written
        // (or the connection blipped). It is NOT lost; hand off calmly instead of
        // crying "Could not start the render" over a song that's still cooking.
        setHandedOff('This one’s taking a little longer to write — it’s still going and will appear in your Catalog when it’s done. You can leave this page; you don’t need to wait here.');
        setProducing(null);
        return;
      }
      setProducing((p) => (p ? { ...p, step: 1, label: PROD_STEPS[1]! } : p));
      const url = await pollRenderedAudio(item.jobId);
      setMadeUrl(url);
      setProducing((p) => (p ? { ...p, step: 2, label: PROD_STEPS[2]! } : p));
    } catch (e) {
      setProdError((e as Error).message);
      setProducing(null);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">🎧 Play a track — the AI listens</h2>
      <p className="mt-1 text-sm text-slate-400">
        Tap <span className="text-slate-200">Listen now</span> and play the song out loud from any device — the AI hears it through your mic (like Shazam),
        tells you what it hears, then makes a <span className="text-slate-200">fresh original</span> in that vibe — never a copy. Or choose a file.
      </p>

      <div className="mt-4 rounded-2xl glass p-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />

        {/* PRIMARY: listen to whatever is playing in the room / on another device */}
        {recording ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-afrobrand-300">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              Listening… {elapsed}s / {MAX_SECS}s
            </span>
            <button onClick={stopListening} className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
              Stop &amp; analyze
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {micAvailable && (
              <button
                onClick={() => void startListening()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
              >
                🎙️ {busy ? 'Working…' : 'Listen now'}
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
            >
              or choose a file
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Play the song out loud from any phone, speaker, or device — hold your mic near it. The AI listens to the air (like Shazam), then builds a fresh original in that vibe.
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={factsOnly}
            onChange={(e) => setFactsOnly(e.target.checked)}
            className="mt-0.5 accent-amber-400"
          />
          <span>
            <span className="text-slate-200">📐 Facts-only reference</span> — a record you own but didn’t make. The ear measures the
            NUMBERS (tempo, groove, log-drum, arrangement) into this lane’s profile so your songs hit the real target sound. No lyrics
            transcribed, no recipe copied, audio deleted after measuring — facts, never someone else’s expression.
          </span>
        </label>
        {status && <div className="mt-3 text-xs text-slate-400">{status}</div>}

        {profile && (
          <div className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <Stat label="BPM" value={profile.bpm ?? '—'} />
              <Stat label="Key" value={profile.key ?? '—'} />
              <Stat label="Genre" value={profile.genre ?? '—'} />
              <Stat label="Mood" value={profile.mood ?? '—'} />
              <Stat label="Energy" value={profile.energy ?? '—'} />
              <Stat label="Vocal" value={[profile.vocalGender, profile.language].filter(Boolean).join(' · ') || '—'} />
              <Stat label="Instruments" value={profile.instruments?.join(', ') || '—'} />
            </div>
            {profile.vibe && <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-300">“{profile.vibe}”</div>}

            {/* Production error — loud, with a way forward. Never a quiet gray line. */}
            {prodError && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                Couldn’t make it: {prodError}
                <button onClick={() => setProdError('')} className="ml-3 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">Try again</button>
              </div>
            )}

            {/* Hand-off — NOT a failure. The song is still being made; say so calmly. */}
            {handedOff && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
                Still cooking 🎶 {handedOff}
                <button onClick={() => setHandedOff('')} className="ml-3 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">Got it</button>
              </div>
            )}

            {/* LIVE production panel — creating takes 2-4 min and must look alive. */}
            {producing ? (
              <div className="rounded-2xl border-gradient glass p-4">
                <div className="flex items-center justify-between">
                  <div className="animate-pulse font-display text-lg text-gradient">
                    {producing.step >= 2 ? 'Your song is ready' : 'Making it now…'}
                  </div>
                  {producing.step < 2 && <span className="text-xs text-slate-500">{prodElapsed}s</span>}
                </div>
                <ul className="mt-3 space-y-2">
                  {PROD_STEPS.map((s, i) => (
                    <li key={s} className="flex items-center gap-2 text-sm">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i < producing.step ? 'bg-emerald-500/25 text-emerald-300' : i === producing.step ? 'bg-brand-gradient text-ink' : 'bg-white/5 text-slate-500'}`}>
                        {i < producing.step ? '✓' : i === producing.step ? '●' : i + 1}
                      </span>
                      <span className={i <= producing.step ? 'text-slate-200' : 'text-slate-500'}>{s}</span>
                    </li>
                  ))}
                </ul>
                {producing.step < 2 && (
                  <p className="mt-2 text-xs text-slate-500">Stay here — the studio writes, critiques and re-polishes the lyric before singing, so a real record takes about 3–7 minutes. It’s working the whole time; you can also leave and find it in your Catalog.</p>
                )}
                {madeUrl && (
                  <div className="mt-3">
                    <audio controls autoPlay className="w-full" src={madeUrl} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => router.push(`/projects/${projectId}`)} className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow">
                        🎬 Open the studio (cover, mix, release) →
                      </button>
                      <button onClick={() => { setProducing(null); setMadeUrl(null); }} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
                        Make another take
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={makeFullSong}
                  disabled={busy}
                  className="w-fit rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
                >
                  🎤 Make the full sung song in this vibe
                </button>
                <button
                  onClick={makeBeat}
                  disabled={busy}
                  className="w-fit rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-4 py-2 text-sm font-medium text-afrobrand-300 hover:bg-afrobrand-500/20 disabled:opacity-50"
                >
                  🎼 Just the beat
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="truncate text-slate-200" title={String(value)}>{value}</div>
    </div>
  );
}
