'use client';

/**
 * ZAP — the real Shazam layer. Hear a song → identify it → play its licensed
 * preview → learn its craft into your training. Clean by design: we identify +
 * learn the CRAFT (never the recording), and only play the official preview.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Mic, Square, Loader2, Sparkles, ExternalLink, GraduationCap, Check, Upload, Radar, Wand2, History } from 'lucide-react';

interface ZapHist {
  id: string;
  genre: string | null;
  bpm?: number | null;
  mood?: string | null;
  languages?: string[] | null;
  songTitle: string | null;
  artist: string | null;
  vibe: string | null;
  whatToLearn: string | null;
  viaRadar: boolean;
}

interface Match {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  genre?: string;
  isrc?: string;
  previewUrl?: string;
  links: { song?: string; spotify?: string; apple?: string; deezer?: string };
}

const MAX_SECS = 12;

export default function ZapPage() {
  const api = useApi();
  const router = useRouter();
  const [history, setHistory] = useState<ZapHist[]>([]);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'identifying' | 'result' | 'nomatch' | 'error'>('idle');
  const [match, setMatch] = useState<Match | null>(null);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  const [learn, setLearn] = useState<'idle' | 'learning' | 'done'>('idle');
  const [learned, setLearned] = useState<{ craft?: string[]; whatToLearn?: string; genre?: string; bpm?: number | null; mood?: string | null; languages?: string[] | null } | null>(null);
  const [radar, setRadar] = useState<'idle' | 'running'>('idle');
  const [radarMsg, setRadarMsg] = useState('');

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function loadHistory() {
    try { setHistory(await api.get<ZapHist[]>('/zap/history')); } catch { /* ignore */ }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadHistory(); }, []);

  /** Make a FRESH song in the lane of something you Zapped — everything pre-picked
   * (genre, tempo, language, the artist as a LANE cue) and it STARTS MAKING
   * immediately (produce=1). Same lane/style; fresh beat, name, lyrics. The artist
   * only steers the vibe via influence — never copied or named in the record. */
  function makeInLane(h: { genre: string | null; bpm?: number | null; mood?: string | null; languages?: string[] | null; artist?: string | null; whatToLearn: string | null; vibe: string | null }) {
    const genre = h.genre || 'afrobeats';
    const params = new URLSearchParams({
      genre,
      produce: '1',
      // Match the lane's actual languages/mood when Zap captured them, else afro default.
      languages: h.languages?.length ? h.languages.join(',') : 'pcm,en',
      vibe: (h.whatToLearn || h.vibe || `a fresh ${genre.replace(/_/g, ' ')} record`).slice(0, 240),
    });
    if (h.bpm) params.set('bpm', String(h.bpm));
    if (h.mood) params.set('mood', h.mood);
    if (h.artist) params.set('influence', h.artist);
    router.push(`/create?${params.toString()}`);
  }

  async function identify(blob: Blob) {
    setPhase('identifying');
    setErr('');
    setMatch(null);
    setLearn('idle');
    setLearned(null);
    try {
      const { key } = await api.uploadAudioDirect(blob, 'reference');
      const r = await api.post<{ match: Match | null }>('/zap/identify', { key });
      if (r.match) {
        setMatch(r.match);
        setPhase('result');
      } else {
        setPhase('nomatch');
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      if (/501|not_configured/.test(msg)) setErr('Zap needs a recognition key — add AUDD_API_TOKEN (from audd.io) to the API + worker, then try again.');
      else setErr(msg.slice(0, 180) || 'Could not identify that.');
      setPhase('error');
    }
  }

  async function start() {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (blob.size > 1000) void identify(blob);
        else { setErr('Nothing recorded — try again closer to the speaker.'); setPhase('error'); }
      };
      mr.start();
      setPhase('listening');
      setSecs(0);
      const iv = setInterval(() => setSecs((n) => {
        const v = n + 1;
        if (v >= MAX_SECS) { stop(); clearInterval(iv); }
        return v;
      }), 1000);
    } catch {
      setErr('Microphone blocked — allow the mic, or upload a clip below.');
      setPhase('error');
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }

  async function doLearn() {
    if (!match) return;
    setLearn('learning');
    try {
      const r = await api.post<{ craft?: string[]; whatToLearn?: string; genre?: string; bpm?: number | null; mood?: string | null; languages?: string[] | null }>('/zap/learn', {
        title: match.title, artist: match.artist, genre: match.genre, album: match.album, releaseDate: match.releaseDate, isrc: match.isrc,
      });
      setLearned(r);
      setLearn('done');
      void loadHistory();
    } catch {
      setLearn('idle');
    }
  }

  const busy = phase === 'listening' || phase === 'identifying';

  async function runRadar() {
    setRadar('running');
    setRadarMsg('');
    try {
      const r = await api.post<{ learned: number }>('/zap/radar', {});
      setRadarMsg(r.learned ? `Learned ${r.learned} new trending song${r.learned === 1 ? '' : 's'} into your lake ✓` : 'Your lake is already up to date with the charts ✓');
      void loadHistory();
    } catch {
      setRadarMsg('Radar hit a snag — try again in a bit.');
    } finally {
      setRadar('idle');
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl">Zap</h1>
      <p className="mt-1 text-sm text-slate-400">
        Play a song near your mic. Zap finds it, plays it, and <span className="text-slate-200">learns its craft</span> into your training — so your songs get better. It studies the lane, never copies the record.
      </p>

      {/* Autonomous radar — runs daily on its own; tap to top up now. */}
      <div className="mt-3">
        <button onClick={() => void runRadar()} disabled={radar === 'running'} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60">
          {radar === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5 text-afrobrand-400" />}
          {radar === 'running' ? 'Scanning the charts…' : 'Run radar — learn today’s trending'}
        </button>
        {radarMsg && <span className="ml-2 text-xs text-emerald-300">{radarMsg}</span>}
        <p className="mt-1 text-[11px] text-slate-500">Zap also runs on its own daily (03:00 UTC), quietly filling your lake with what’s charting — no keys needed for this.</p>
      </div>

      {/* The button */}
      <div className="mt-8 flex flex-col items-center">
        <button
          onClick={() => (phase === 'listening' ? stop() : start())}
          disabled={phase === 'identifying'}
          className={`flex h-28 w-28 items-center justify-center rounded-full shadow-glow transition-transform active:scale-95 ${
            phase === 'listening' ? 'bg-red-500 animate-pulse' : 'bg-brand-gradient'
          } text-ink disabled:opacity-60`}
        >
          {phase === 'identifying' ? <Loader2 className="h-10 w-10 animate-spin" /> : phase === 'listening' ? <Square className="h-9 w-9" /> : <Mic className="h-11 w-11" />}
        </button>
        <div className="mt-3 text-sm text-slate-400">
          {phase === 'listening' ? `Listening… ${secs}s (tap to stop)` : phase === 'identifying' ? 'Finding the song…' : 'Tap to Zap a song'}
        </div>

        {/* Upload fallback */}
        {!busy && (
          <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300">
            <Upload className="h-3.5 w-3.5" /> or upload a clip
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void identify(f); }} />
          </label>
        )}
      </div>

      {err && <div className="mt-6 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{err}</div>}
      {phase === 'nomatch' && <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">Couldn’t recognize that one — try again with the song louder/clearer, or upload a cleaner clip.</div>}

      {/* Result */}
      {phase === 'result' && match && (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-afrobrand-300"><Sparkles className="h-4 w-4" /> Found it</div>
          <h2 className="mt-1 font-display text-2xl">{match.title}</h2>
          <div className="text-sm text-slate-300">{match.artist}{match.genre ? ` · ${match.genre}` : ''}{match.releaseDate ? ` · ${String(match.releaseDate).slice(0, 4)}` : ''}</div>

          {match.previewUrl ? (
            <audio controls src={match.previewUrl} className="mt-4 w-full" />
          ) : (
            <div className="mt-4 text-xs text-slate-500">No preview available — open it below to listen.</div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {match.links.spotify && <a href={match.links.spotify} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10">Spotify <ExternalLink className="h-3 w-3" /></a>}
            {match.links.apple && <a href={match.links.apple} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10">Apple Music <ExternalLink className="h-3 w-3" /></a>}
            {match.links.song && !match.links.spotify && !match.links.apple && <a href={match.links.song} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10">Open <ExternalLink className="h-3 w-3" /></a>}
          </div>

          {/* Learn it */}
          <div className="mt-5 border-t border-white/10 pt-4">
            {learn === 'done' && learned ? (
              <div>
                <div className="flex items-center gap-2 text-sm text-emerald-300"><Check className="h-4 w-4" /> Learned into your training</div>
                {learned.whatToLearn && <p className="mt-1.5 text-xs text-slate-300">{learned.whatToLearn}</p>}
                {learned.craft?.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                    {learned.craft.slice(0, 5).map((c, i) => <li key={i} className="flex gap-1.5"><span className="text-afrobrand-400">•</span>{c}</li>)}
                  </ul>
                ) : null}
                <button
                  onClick={() => makeInLane({ genre: learned.genre || match.genre || null, artist: match.artist, bpm: learned.bpm, mood: learned.mood, languages: learned.languages, whatToLearn: learned.whatToLearn || null, vibe: null })}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow"
                >
                  <Wand2 className="h-4 w-4" /> Make a song in this lane →
                </button>
              </div>
            ) : (
              <button onClick={() => void doLearn()} disabled={learn === 'learning'} className="inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-60">
                {learn === 'learning' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GraduationCap className="h-4 w-4" />}
                {learn === 'learning' ? 'Learning the craft…' : 'Learn its craft → my training'}
              </button>
            )}
            <p className="mt-2 text-[11px] text-slate-500">Studies the lane’s craft (production, groove, hook mechanics) as reference — never copies the song or its lyrics.</p>
          </div>
        </div>
      )}

      {/* Your zaps — what you've learned, and make a fresh song in any lane. */}
      {history.length > 0 && (
        <div className="mt-10">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200"><History className="h-4 w-4 text-afrobrand-400" /> Your zaps <span className="text-xs font-normal text-slate-500">({history.length})</span></div>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{h.songTitle || 'Learned lane'}{h.artist ? <span className="text-slate-500"> · {h.artist}</span> : ''}</div>
                  <div className="truncate text-[11px] text-slate-500">{(h.genre || '—').replace(/_/g, ' ')}{h.viaRadar ? ' · via radar' : ''}{h.whatToLearn ? ` · ${h.whatToLearn}` : ''}</div>
                </div>
                <button
                  onClick={() => makeInLane(h)}
                  title="Make a fresh song in this lane"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Make in this lane
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">Every zap feeds your training — new songs in these lanes already pull from them. “Make in this lane” starts a fresh original (never a copy).</p>
        </div>
      )}
    </div>
  );
}
