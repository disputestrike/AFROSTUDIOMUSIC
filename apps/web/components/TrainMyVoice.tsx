'use client';

/**
 * TRAIN MY VOICE — the missing screen.
 *
 * The /voices cloning API (sign consent → build dataset → RVC train → READY)
 * and its worker were fully built, and the pricing/landing pages already SELL
 * "Voice profile (with consent)" — but there was no UI to actually run it. The
 * only visible "upload your audio" button (Learn-My-Sound) teaches the writer
 * your STYLE, never your voice. This screen closes that gap end to end:
 *
 *   1. Consent  — you affirm you own the voice (a real VoiceConsent record).
 *   2. Upload   — YOUR OWN dry vocal takes (10–20 min of clean solo vocals is best).
 *   3. Dataset  — the worker converts to 48k mono + splits into the trainer layout.
 *   4. Train    — RVC training kicks off on Replicate; we poll to READY.
 *
 * HONEST: this clones your VOICE (timbre) — it does NOT teach "flow". Flow lives
 * in the writer/melody brain and the Learn-My-Sound reference path. Dry, solo
 * vocals (no beat underneath) train best; a beat under the take poisons the model.
 * Training charges voice-clone credits.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { VOICE_CONSENT_TEXT, VOICE_CONSENT_VERSION } from '@afrohit/shared';
import { Loader2, Check, X, UploadCloud, Mic2, ShieldCheck, Music4, Trash2 } from 'lucide-react';

interface Artist {
  id: string;
  stageName: string;
}
interface VoiceProfile {
  id: string;
  name: string;
  status: 'PENDING' | 'TRAINING' | 'READY' | 'FAILED' | 'REVOKED';
  artist?: { id: string; stageName: string } | null;
  createdAt?: string;
}

type Phase = 'idle' | 'consent' | 'uploading' | 'dataset' | 'training' | 'done' | 'error';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function prettyError(raw: string): string {
  if (/insufficient_credits|\b402\b/.test(raw)) return "Not enough credits — voice cloning is a paid step. Top up in Billing, then try again.";
  if (/voice_training_not_configured|\b501\b/.test(raw)) return "Voice training isn't switched on for this studio yet — the operator needs to enable the voice trainer.";
  if (/no audio segments|under 1 second|record longer/.test(raw)) return "Those takes produced no usable audio — upload longer, clean solo-vocal takes.";
  if (/ffmpeg is not available/.test(raw)) return 'The studio worker is missing its audio tools right now — try again shortly.';
  const tail = raw.split(': ').slice(1).join(': ') || raw;
  return tail.slice(0, 200) || 'Something went wrong.';
}

export function TrainMyVoice() {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);

  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistId, setArtistId] = useState('');
  const [voices, setVoices] = useState<VoiceProfile[]>([]);

  const [name, setName] = useState('My Voice');
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [upIdx, setUpIdx] = useState(0);
  const [upPct, setUpPct] = useState(0);
  const [dsInfo, setDsInfo] = useState<{ segments?: number; minutes?: number } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const say = (m: string) => setLog((l) => [...l, m]);
  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error';

  const loadVoices = useCallback(async () => {
    try {
      setVoices(await api.get<VoiceProfile[]>('/voices'));
    } catch {
      /* best-effort */
    }

  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<Artist[]>('/artists');
        setArtists(list);
        if (list[0]) {
          setArtistId(list[0].id);
          setName((n) => (n === 'My Voice' ? `${list[0]!.stageName} Voice` : n));
        }
      } catch {
        /* no artist yet */
      }
      void loadVoices();
    })();

  }, []);

  function onFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    setFiles([...list].slice(0, 20));
    setError(null);
  }

  const totalMb = (files.reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(1);

  async function pollJob(jobId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 90; i++) {
      await sleep(4000);
      const j = await api.get<{ status: string; outputJson?: Record<string, unknown> | null; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (j.status === 'SUCCEEDED') return j.outputJson ?? {};
      if (j.status === 'FAILED') {
        const e = j.errorJson;
        throw new Error(typeof e === 'string' ? e : ((e as { message?: string })?.message ?? 'dataset build failed'));
      }
    }
    throw new Error('dataset build timed out — try fewer/shorter takes');
  }

  async function pollTraining(voiceId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await sleep(6000);
      const s = await api.get<{ status: string; meta?: { error?: string } }>(`/voices/${voiceId}/training`);
      if (s.status === 'READY') return;
      if (s.status === 'FAILED') throw new Error(s.meta?.error ?? 'training failed');
      if (i === 3 || i === 20 || i === 60) say('still training — RVC takes a few minutes on the GPU…');
    }
    throw new Error('still training after a while — it keeps running on the server; reopen this page and it will show READY when done.');
  }

  async function run() {
    setError(null);
    setLog([]);
    setDsInfo(null);
    if (!artistId) { setError('Create your artist first (Settings → Artist), then come back.'); return; }
    if (!legalName.trim() || !email.trim()) { setError('Add your legal name and email for the consent record.'); return; }
    if (!agreed) { setError('Tick the box to confirm you own this voice.'); return; }
    if (files.length === 0) { setError('Add at least one clean, solo vocal take.'); return; }

    try {
      setPhase('consent');
      say('Recording your consent…');
      const consent = await api.post<{ id: string }>('/voices/consents', {
        artistId,
        legalName: legalName.trim(),
        email: email.trim(),
        consentText: VOICE_CONSENT_TEXT,
        consentVersion: VOICE_CONSENT_VERSION,
        accepted: true,
      });

      setPhase('uploading');
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setUpIdx(i);
        setUpPct(0);
        say(`Uploading ${files[i]!.name}…`);
        const { publicUrl } = await api.uploadToStorage(files[i]!, 'vocal', (f) => setUpPct(f));
        urls.push(publicUrl);
      }

      setPhase('dataset');
      say('Building the training dataset (48k mono, split into clean segments)…');
      const ds = await api.post<{ jobId: string }>('/voices/dataset', { name: name.trim() || 'My Voice', sampleUrls: urls });
      const out = await pollJob(ds.jobId);
      const datasetZipRef = out.datasetZipRef as string | undefined;
      if (!datasetZipRef) throw new Error('dataset built but returned no private asset reference');
      const segments = Number(out.segments ?? 0);
      const minutes = Math.round(Number(out.totalSeconds ?? 0) / 60);
      setDsInfo({ segments, minutes });
      say(`Dataset ready — ${segments} segments (~${minutes} min of voice).`);

      setPhase('training');
      say('Starting RVC training on your voice…');
      const t = await api.post<{ profile: { id: string }; trainingId: string }>('/voices/train', {
        artistId,
        consentId: consent.id,
        name: name.trim() || 'My Voice',
        datasetZipUrl: datasetZipRef,
      });
      void loadVoices();
      await pollTraining(t.profile.id);

      setPhase('done');
      say('Your voice is trained and READY. It can now sing your songs.');
      void loadVoices();
    } catch (e) {
      setError(prettyError((e as Error).message));
      setPhase('error');
      void loadVoices();
    }
  }

  async function revokeVoice(voice: VoiceProfile) {
    if (!confirm(`Revoke "${voice.name}"? Its consent will be revoked and owned samples, dataset, and model files will be deleted. This cannot be undone.`)) return;
    setRevokingId(voice.id);
    setError(null);
    try {
      await api.del(`/voices/${voice.id}`);
      await loadVoices();
    } catch (cause) {
      setError(prettyError((cause as Error).message));
    } finally {
      setRevokingId(null);
    }
  }

  const statusBadge = (s: VoiceProfile['status']) => {
    const map: Record<VoiceProfile['status'], string> = {
      READY: 'bg-emerald-500/15 text-emerald-300',
      TRAINING: 'bg-amber-500/15 text-amber-300',
      PENDING: 'bg-slate-500/15 text-slate-300',
      FAILED: 'bg-red-500/15 text-red-300',
      REVOKED: 'bg-slate-700/40 text-slate-400',
    };
    return <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[s]}`}>{s.toLowerCase()}</span>;
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="flex items-center gap-2 font-display text-3xl">
        <Mic2 className="h-7 w-7 text-afrobrand-400" /> Train <span className="text-gradient">my</span> voice
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Clone <span className="text-slate-200">your own voice</span> so the studio can sing in it. Upload clean, solo vocal takes
        (no beat underneath) — <span className="text-slate-200">10–20 minutes is ideal</span>. We build the dataset and train an
        RVC model that&apos;s yours. This clones your <span className="text-slate-200">timbre</span>; it doesn&apos;t change songwriting
        &quot;flow&quot; (that&apos;s <a className="text-afrobrand-300 underline" href="/create">Learn my sound</a>). Training uses voice-clone credits.
      </p>

      {/* Existing voices */}
      {voices.length > 0 && (
        <div className="mt-6 rounded-2xl glass p-4">
          <div className="text-xs font-medium uppercase tracking-widest text-slate-500">Your voices</div>
          <ul className="mt-2 space-y-1.5">
            {voices.map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                <Music4 className="h-4 w-4 shrink-0 text-afrobrand-400" />
                <span className="truncate text-slate-200">{v.name}</span>
                {v.artist?.stageName && <span className="text-xs text-slate-500">· {v.artist.stageName}</span>}
                <span className="ml-auto">{statusBadge(v.status)}</span>
                {v.status !== 'REVOKED' && (
                  <button
                    type="button"
                    onClick={() => void revokeVoice(v)}
                    disabled={revokingId === v.id}
                    title="Revoke consent and delete this voice model"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                  >
                    {revokingId === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {artists.length === 0 && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          You need an artist profile first. Go to <a className="underline" href="/settings">Settings</a> and set your stage name, then come back.
        </div>
      )}

      {/* 1. Consent */}
      <section className="mt-6 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><ShieldCheck className="h-5 w-5 text-afrobrand-400" /> 1 · Consent</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Voice name
            <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={busy} />
          </label>
          <label className="text-xs text-slate-400">Artist
            <select className="input mt-1 w-full" value={artistId} onChange={(e) => setArtistId(e.target.value)} disabled={busy || artists.length === 0}>
              {artists.map((a) => <option key={a.id} value={a.id}>{a.stageName}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Your legal name
            <input className="input mt-1 w-full" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Full legal name" disabled={busy} />
          </label>
          <label className="text-xs text-slate-400">Email
            <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" disabled={busy} />
          </label>
        </div>
        <label className="mt-3 block text-xs text-slate-400">Consent statement
          <textarea className="input mt-1 h-32 w-full" value={VOICE_CONSENT_TEXT} readOnly aria-readonly="true" />
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
          I have read and accept this voice-model consent statement.
        </label>
      </section>

      {/* 2. Upload */}
      <section className="mt-6 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><UploadCloud className="h-5 w-5 text-afrobrand-400" /> 2 · Your vocal takes</h2>
        <p className="mt-1 text-xs text-slate-500">Clean, solo vocals only — no instrumental under them. Multiple takes welcome.</p>
        <input ref={fileRef} type="file" multiple accept="audio/*,audio/mpeg,.wav,.mp3,.m4a,.ogg,.flac,.aiff,.webm,.mpeg,.mpg" className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="mt-3 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50">
          <UploadCloud className="h-4 w-4" /> Choose vocal files
        </button>
        {files.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-slate-500">{files.length} file{files.length === 1 ? '' : 's'} · {totalMb} MB</div>
            <ul className="mt-1.5 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs">
                  <span className="truncate text-slate-300">{f.name}</span>
                  <span className="ml-auto shrink-0 text-slate-500">
                    {phase === 'uploading' && i === upIdx ? `${Math.round(upPct * 100)}%` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Action */}
      <div className="mt-6">
        <button
          onClick={() => void run()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-6 py-3 text-sm font-medium text-ink shadow-glow disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
          {phase === 'consent' ? 'Recording consent…'
            : phase === 'uploading' ? 'Uploading takes…'
            : phase === 'dataset' ? 'Building dataset…'
            : phase === 'training' ? 'Training your voice…'
            : 'Train my voice'}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-500">Training runs on a GPU and takes a few minutes — keep this page open.</p>
      </div>

      {/* Live status */}
      {(log.length > 0 || error || phase === 'done') && (
        <div className="mt-5 rounded-2xl glass p-4 text-sm">
          {log.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-slate-300">
              <Loader2 className={`h-3.5 w-3.5 ${busy && i === log.length - 1 ? 'animate-spin text-afrobrand-400' : 'text-slate-600'}`} />
              {m}
            </div>
          ))}
          {dsInfo && <div className="mt-1 text-xs text-slate-500">Dataset: {dsInfo.segments} segments · ~{dsInfo.minutes} min of voice</div>}
          {phase === 'done' && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300">
              <Check className="h-4 w-4" /> Your voice is READY — it can now sing your songs.
            </div>
          )}
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-red-300">
              <X className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
