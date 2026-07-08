'use client';

/**
 * ZAP — the real Shazam layer. Hear a song → identify it → play its licensed
 * preview → learn its craft into your training. Clean by design: we identify +
 * learn the CRAFT (never the recording), and only play the official preview.
 */
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Mic, Square, Loader2, Sparkles, ExternalLink, GraduationCap, Check, Upload, Radar } from 'lucide-react';

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
  const [phase, setPhase] = useState<'idle' | 'listening' | 'identifying' | 'result' | 'nomatch' | 'error'>('idle');
  const [match, setMatch] = useState<Match | null>(null);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  const [learn, setLearn] = useState<'idle' | 'learning' | 'done'>('idle');
  const [learned, setLearned] = useState<{ craft?: string[]; whatToLearn?: string } | null>(null);
  const [radar, setRadar] = useState<'idle' | 'running'>('idle');
  const [radarMsg, setRadarMsg] = useState('');

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

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
      const r = await api.post<{ craft?: string[]; whatToLearn?: string }>('/zap/learn', {
        title: match.title, artist: match.artist, genre: match.genre, album: match.album, releaseDate: match.releaseDate, isrc: match.isrc,
      });
      setLearned(r);
      setLearn('done');
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
    </div>
  );
}
