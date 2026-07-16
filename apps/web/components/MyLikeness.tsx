'use client';

/**
 * MY LIKENESS — "my picture and my videos are what get created. I'm the face
 * of my brand." (owner directive, 2026-07-16)
 *
 * Own-face-only, mirroring Train-My-Voice exactly:
 *   1. Consent — a real, versioned LikenessConsent record, signed before any
 *      photo can attach and before any training or generation.
 *   2. Photos  — 10+ photos of YOURSELF (varied angles/lighting), magic-byte
 *      verified and hashed server-side.
 *   3. Train   — a Flux LoRA of your face (~$2–5 provider cost, charged as
 *      likeness-training credits). Gated by the operator flag; the button
 *      says exactly why it is disabled — no silent stubs.
 *
 * Once trained, per-scene video renders can start from a keyframe of YOUR
 * face (Catalog → Video → Render this scene).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import {
  LIKENESS_CONSENT_TEXT,
  LIKENESS_CONSENT_VERSION,
  formatCredits,
  CREDIT_COSTS,
} from '@afrohit/shared';
import {
  Loader2,
  Check,
  X,
  UploadCloud,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';

interface Artist {
  id: string;
  stageName: string;
}

interface LikenessPhoto {
  id: string;
  artistId: string;
  status: 'pending' | 'training' | 'trained' | 'failed';
  contentHash: string | null;
  createdAt: string;
  displayUrl: string;
}

interface LikenessSummary {
  photos: LikenessPhoto[];
  consent: { id: string; artistId: string; signedAt: string; revokedAt: string | null } | null;
  trained: {
    artistId: string;
    trainedModelRef: string;
    triggerWord: string | null;
    trainedAt: string | null;
    rightsBasis: string;
  } | null;
  gate: { ok: boolean; reasons: string[] };
  minPhotos: number;
  trainingEnabled: boolean;
}

function prettyError(raw: string): string {
  if (/insufficient_credits|\b402\b/.test(raw)) return 'Not enough credits — likeness training is a paid step. Top up in Billing, then try again.';
  if (/likeness_training_gate_failed|\b501\b/.test(raw)) return 'Training is gated — see the reasons listed under the train button.';
  if (/duplicate_likeness_photo/.test(raw)) return 'That exact photo is already in your set.';
  if (/likeness_consent_required/.test(raw)) return 'Sign the likeness consent first.';
  if (/unsupported_or_invalid_image/.test(raw)) return 'That file is not a real PNG/JPEG/WebP image.';
  const tail = raw.split(': ').slice(1).join(': ') || raw;
  return tail.slice(0, 220) || 'Something went wrong.';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MyLikeness() {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);

  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistId, setArtistId] = useState('');
  const [summary, setSummary] = useState<LikenessSummary | null>(null);
  const [legalName, setLegalName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'consent' | 'uploading' | 'training'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<{ index: number; total: number } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (forArtistId?: string) => {
    try {
      const query = forArtistId ? `?artistId=${forArtistId}` : '';
      const s = await api.get<LikenessSummary>(`/likeness${query}`);
      setSummary(s);
    } catch {
      /* panel loads best-effort; actions surface real errors */
    }

  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<Artist[]>('/artists');
        setArtists(list);
        if (list[0]) setArtistId(list[0].id);
        await load(list[0]?.id);
      } catch {
        /* no artist yet — the panel says so below */
      }
    })();

  }, []);

  const consentId = summary?.consent && !summary.consent.revokedAt ? summary.consent.id : null;

  async function signConsent() {
    setError(null);
    if (!artistId) { setError('Create your artist first (Settings → Artist DNA), then come back.'); return; }
    if (!legalName.trim() || !email.trim()) { setError('Add your legal name and email for the consent record.'); return; }
    if (!agreed) { setError('Tick the box to confirm these photos are of you.'); return; }
    setBusy('consent');
    try {
      await api.post('/likeness/consents', {
        artistId,
        legalName: legalName.trim(),
        email: email.trim(),
        consentText: LIKENESS_CONSENT_TEXT,
        consentVersion: LIKENESS_CONSENT_VERSION,
        accepted: true,
      });
      setNotice('Consent recorded.');
      await load(artistId);
    } catch (e) {
      setError(prettyError((e as Error).message));
    } finally {
      setBusy('idle');
    }
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length || busy !== 'idle') return;
    setError(null);
    setNotice(null);
    if (!consentId) { setError('Sign the likeness consent first — photos attach under your consent record.'); return; }
    setBusy('uploading');
    try {
      const list = [...files].slice(0, 20);
      for (let i = 0; i < list.length; i++) {
        setUploadPct({ index: i + 1, total: list.length });
        const file = list[i]!;
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
        if (!['png', 'jpg', 'webp'].includes(normalizedExt)) {
          throw new Error(`"${file.name}" is not a PNG/JPEG/WebP photo.`);
        }
        const contentType = file.type || (normalizedExt === 'png' ? 'image/png' : normalizedExt === 'webp' ? 'image/webp' : 'image/jpeg');
        const presigned = await api.post<{ url: string; key: string }>(
          '/likeness/photos/presign',
          { contentType, ext: normalizedExt, sizeBytes: file.size }
        );
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presigned.url);
          xhr.setRequestHeader('content-type', contentType);
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`upload failed: ${xhr.status}`));
          xhr.onerror = () => reject(new Error('upload network error'));
          xhr.send(file);
        });
        await api.post('/likeness/photos/attach', {
          key: presigned.key,
          artistId,
          consentId,
        });
      }
      setNotice(`${list.length} photo${list.length === 1 ? '' : 's'} added to your likeness set.`);
      await load(artistId);
    } catch (e) {
      setError(prettyError((e as Error).message));
      await load(artistId);
    } finally {
      setUploadPct(null);
      setBusy('idle');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function train() {
    if (!summary?.gate.ok || !consentId || busy !== 'idle') return;
    setError(null);
    setNotice(null);
    setBusy('training');
    try {
      const kicked = await api.post<{ jobId: string }>('/likeness/train', {
        artistId,
        consentId,
      });
      setNotice('Training started — your photos are on the GPU. This takes a few minutes.');
      // Poll the job to a terminal state; the row statuses tell the truth.
      for (let i = 0; i < 240; i++) {
        await sleep(6000);
        const j = await api.get<{ status: string; errorJson?: unknown }>(`/jobs/${kicked.jobId}`);
        if (j.status === 'SUCCEEDED') { setNotice('Your likeness is TRAINED — scene renders can now feature your face.'); break; }
        if (j.status === 'FAILED') {
          const e = j.errorJson;
          throw new Error(typeof e === 'string' ? e : ((e as { message?: string })?.message ?? 'training failed'));
        }
        if (i % 10 === 4) await load(artistId);
      }
      await load(artistId);
    } catch (e) {
      setError(prettyError((e as Error).message));
      await load(artistId);
    } finally {
      setBusy('idle');
    }
  }

  async function removePhoto(photo: LikenessPhoto) {
    if (!confirm('Remove this photo from your likeness set?')) return;
    setDeletingId(photo.id);
    try {
      await api.del(`/likeness/${photo.id}`);
      await load(artistId);
    } catch (e) {
      setError(prettyError((e as Error).message));
    } finally {
      setDeletingId(null);
    }
  }

  const statusChip = (s: LikenessPhoto['status']) => {
    const map: Record<LikenessPhoto['status'], string> = {
      pending: 'bg-slate-500/15 text-slate-300',
      training: 'bg-amber-500/15 text-amber-300',
      trained: 'bg-emerald-500/15 text-emerald-300',
      failed: 'bg-red-500/15 text-red-300',
    };
    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${map[s]}`}>{s}</span>;
  };

  const photos = summary?.photos ?? [];
  const trainCost = formatCredits(CREDIT_COSTS.likeness_training);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="flex items-center gap-2 font-display text-3xl">
        <UserRound className="h-7 w-7 text-afrobrand-400" /> My <span className="text-gradient">likeness</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Be the face of your brand: train a visual model of <span className="text-slate-200">your own face</span> so
        cover art and music-video scenes can feature <span className="text-slate-200">you</span>. Upload{' '}
        <span className="text-slate-200">{summary?.minPhotos ?? 10}+ clear photos of yourself</span> (varied angles,
        lighting, expressions — no other people in frame). Your photos stay private to this workspace; only your own
        consented face can ever be trained here.
      </p>

      {/* Trained banner */}
      {summary?.trained && (
        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <Check className="h-4 w-4 shrink-0" />
          <span>
            Your likeness is <span className="font-medium">trained</span>
            {summary.trained.trainedAt ? ` (${new Date(summary.trained.trainedAt).toLocaleString()})` : ''} — open a
            song&apos;s Video panel in the <a className="underline" href="/catalog">Catalog</a> and render a scene with your face.
          </span>
        </div>
      )}

      {artists.length === 0 && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          You need an artist profile first. Go to <a className="underline" href="/settings">Settings</a> and set your stage name, then come back.
        </div>
      )}

      {/* 1 · Consent */}
      <section className="mt-6 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <ShieldCheck className="h-5 w-5 text-afrobrand-400" /> 1 · Consent
        </h2>
        {consentId ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-300">
            <Check className="h-4 w-4" /> Likeness consent recorded ({LIKENESS_CONSENT_VERSION}).
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">Artist
                <select className="input mt-1 w-full" value={artistId} onChange={(e) => { setArtistId(e.target.value); void load(e.target.value); }} disabled={busy !== 'idle' || artists.length === 0}>
                  {artists.map((a) => <option key={a.id} value={a.id}>{a.stageName}</option>)}
                </select>
              </label>
              <div />
              <label className="text-xs text-slate-400">Your legal name
                <input className="input mt-1 w-full" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Full legal name" disabled={busy !== 'idle'} />
              </label>
              <label className="text-xs text-slate-400">Email
                <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" disabled={busy !== 'idle'} />
              </label>
            </div>
            <label className="mt-3 block text-xs text-slate-400">Consent statement
              <textarea className="input mt-1 h-32 w-full" value={LIKENESS_CONSENT_TEXT} readOnly aria-readonly="true" />
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
              <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy !== 'idle'} />
              I have read and accept this likeness consent statement — the photos I upload are of me.
            </label>
            <button
              onClick={() => void signConsent()}
              disabled={busy !== 'idle'}
              className="mt-3 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {busy === 'consent' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Record my consent
            </button>
          </>
        )}
      </section>

      {/* 2 · Photos */}
      <section className="mt-6 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <UploadCloud className="h-5 w-5 text-afrobrand-400" /> 2 · Your photos
          <span className="ml-auto text-xs font-normal text-slate-500">
            {photos.length} / {summary?.minPhotos ?? 10} minimum
          </span>
        </h2>
        <p className="mt-1 text-xs text-slate-500">PNG, JPEG or WebP. Only you in the frame — every file is verified and fingerprinted on the server.</p>
        <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => void uploadPhotos(e.target.files)} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy !== 'idle' || !consentId}
          title={consentId ? undefined : 'Sign the consent first'}
          className="mt-3 flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
        >
          {busy === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploadPct ? `Uploading ${uploadPct.index}/${uploadPct.total}…` : 'Add photos of me'}
        </button>
        {!consentId && <p className="mt-2 text-[11px] text-amber-300">Photos unlock after the consent is recorded — that order is the law here.</p>}
        {photos.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-white/10 bg-black/20">
                <img src={photo.displayUrl} alt="likeness photo" className="aspect-square w-full object-cover" />
                <div className="absolute left-1 top-1">{statusChip(photo.status)}</div>
                <button
                  onClick={() => void removePhoto(photo)}
                  disabled={deletingId === photo.id || busy !== 'idle'}
                  title="Remove from the likeness set"
                  className="absolute bottom-1 right-1 hidden h-7 w-7 items-center justify-center rounded-md bg-black/60 text-slate-300 hover:text-red-300 group-hover:flex"
                >
                  {deletingId === photo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3 · Train */}
      <section className="mt-6 rounded-2xl glass p-5">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <Sparkles className="h-5 w-5 text-afrobrand-400" /> 3 · Train my likeness
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Trains a private face model from your photos. Costs {trainCost} in credits (provider GPU cost is roughly $2–5 per run). Takes a few minutes.
        </p>
        <button
          onClick={() => void train()}
          disabled={busy !== 'idle' || !summary?.gate.ok}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-6 py-3 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          {busy === 'training' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy === 'training' ? 'Training your likeness…' : `Train my likeness (${trainCost})`}
        </button>
        {/* HONESTY: when disabled, say exactly why — verbatim from the gate. */}
        {summary && !summary.gate.ok && (
          <ul className="mt-3 space-y-1 text-xs text-amber-300">
            {summary.gate.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <X className="mt-0.5 h-3 w-3 shrink-0" /> {reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(notice || error) && (
        <div className="mt-5 rounded-2xl glass p-4 text-sm">
          {notice && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300">
              <Check className="h-4 w-4 shrink-0" /> {notice}
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
