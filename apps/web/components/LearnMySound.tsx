'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION } from '@afrohit/shared';
import { useApi } from '@/lib/api';

type QueueStatus = 'waiting' | 'uploading' | 'listening' | 'learned' | 'failed';

interface QueueItem {
  id: string;
  name: string;
  file: File;
  status: QueueStatus;
  note?: string;
}

interface SoundProfile {
  totalReferences: number;
  genres: Array<{ genre: string; count: number }>;
  traits: Array<{ genre: string; trait: string; learnedAt: string }>;
  lastLearnedAt: string | null;
}

const STARTER_REFERENCE_TARGET = 3;
const MAX_FILES_PER_BATCH = 10;
const AUDIO_FILE_PATTERN = /\.(wav|mp3|m4a|ogg|flac|mpeg|mpg)$/i;

function statusLabel(status: QueueStatus): string {
  if (status === 'uploading') return 'Uploading';
  if (status === 'listening') return 'Analyzing';
  if (status === 'learned') return 'Added';
  if (status === 'failed') return 'Needs attention';
  return 'Waiting';
}

export function LearnMySound({ projectId }: { projectId: string }) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [profile, setProfile] = useState<SoundProfile | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await api.get<SoundProfile>('/taste/sound-profile'));
    } catch {
      // Profile display is best-effort. Upload authorization remains explicit.
    }
  }, [api]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  function updateItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function pollJob(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 72; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const job = await api.get<{ status: string; errorJson?: unknown }>(`/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') return;
      if (job.status === 'FAILED') {
        throw new Error(typeof job.errorJson === 'string' ? job.errorJson : 'Analysis did not complete.');
      }
    }
    throw new Error('Analysis is taking longer than expected. Retry this file in a few minutes.');
  }

  async function runQueue(items: QueueItem[]) {
    if (!rightsConfirmed || running || items.length === 0) return;
    setRunning(true);
    for (const item of items) {
      try {
        updateItem(item.id, { status: 'uploading', note: undefined });
        const { publicUrl } = await api.uploadAudioDirect(item.file, 'reference');
        updateItem(item.id, { status: 'listening' });
        const { jobId } = await api.post<{ jobId: string }>(`/projects/${projectId}/analyze`, {
          url: publicUrl,
          rightsConfirmation: {
            version: OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION,
            confirmed: true,
          },
        });
        await pollJob(jobId);
        updateItem(item.id, { status: 'learned' });
        await loadProfile();
      } catch (cause) {
        updateItem(item.id, {
          status: 'failed',
          note: ((cause as Error).message || 'Upload or analysis failed.').slice(0, 160),
        });
      }
    }
    setRunning(false);
    await loadProfile();
  }

  function onFiles(list: FileList | null) {
    if (!list?.length || running) return;
    setSelectionError('');
    if (!rightsConfirmed) {
      setSelectionError('Confirm the rights statement before choosing recordings.');
      return;
    }

    const selected = [...list].slice(0, MAX_FILES_PER_BATCH);
    const invalid = selected.filter((file) => !file.type.startsWith('audio/') && !AUDIO_FILE_PATTERN.test(file.name));
    if (invalid.length > 0) {
      setSelectionError(`Remove unsupported files: ${invalid.map((file) => file.name).join(', ')}`);
      return;
    }

    const batch = selected.map((file, index): QueueItem => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      file,
      status: 'waiting',
    }));
    setQueue(batch);
    void runQueue(batch);
  }

  function retryFailed() {
    if (running || !rightsConfirmed) return;
    const failed = queue.filter((item) => item.status === 'failed').map((item) => ({ ...item, status: 'waiting' as const, note: undefined }));
    if (failed.length === 0) return;
    const failedIds = new Set(failed.map((item) => item.id));
    setQueue((current) => current.map((item) => failedIds.has(item.id) ? { ...item, status: 'waiting', note: undefined } : item));
    void runQueue(failed);
  }

  const referenceCount = profile?.totalReferences ?? 0;
  const starterProgress = Math.min(100, Math.round((referenceCount / STARTER_REFERENCE_TARGET) * 100));
  const completedCount = queue.filter((item) => item.status === 'learned').length;
  const failedCount = queue.filter((item) => item.status === 'failed').length;
  const activeItem = queue.find((item) => item.status === 'uploading' || item.status === 'listening');

  return (
    <section className="studio-learning-section" aria-labelledby="learn-my-sound-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="studio-section-kicker"><AudioLines aria-hidden="true" /> Personal sound profile</div>
          <h2 id="learn-my-sound-title" className="mt-2 font-display text-3xl text-white">Teach the studio your sound</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Add recordings you own or are licensed to use. The studio analyzes groove, instrumentation, vocals, and arrangement so future briefs can draw from your approved references.
          </p>
        </div>
        <div className="studio-readiness-meter" aria-label={`${referenceCount} sound references added`}>
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="font-semibold text-slate-200">Shelf readiness</span>
            <span className="tabular-nums text-slate-400">{referenceCount} reference{referenceCount === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={STARTER_REFERENCE_TARGET} aria-valuenow={Math.min(referenceCount, STARTER_REFERENCE_TARGET)}>
            <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${starterProgress}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {referenceCount >= STARTER_REFERENCE_TARGET ? 'Starter profile ready. Add more variety whenever you choose.' : `${STARTER_REFERENCE_TARGET - referenceCount} more to reach a starter profile.`}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="studio-upload-panel">
          <input ref={fileRef} type="file" multiple accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.mpeg,.mpg" className="sr-only" onChange={(event) => { onFiles(event.target.files); event.currentTarget.value = ''; }} />

          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={rightsConfirmed} disabled={running} onChange={(event) => { setRightsConfirmed(event.target.checked); setSelectionError(''); }} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500" />
              <span>
                <strong className="block font-medium text-white">I own or control the required rights</strong>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  This authorizes sound-learning analysis for my workspace under confirmation v{OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION}. I will not upload music taken from streaming services or music I cannot authorize.
                </span>
              </span>
            </label>
          </div>

          <button type="button" onClick={() => rightsConfirmed ? fileRef.current?.click() : setSelectionError('Confirm the rights statement before choosing recordings.')} disabled={running} className="studio-upload-target mt-4 w-full" aria-describedby="upload-timing">
            <span className="studio-choice-icon"><Upload aria-hidden="true" /></span>
            <span className="text-left">
              <strong>{running ? 'Processing your recordings' : 'Choose audio files'}</strong>
              <small>WAV, MP3, M4A, OGG, or FLAC. Up to 10 at a time.</small>
            </span>
          </button>

          <p id="upload-timing" className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Files are processed one at a time. Most tracks take 2-6 minutes each; you can leave this page after an upload has been accepted.
          </p>
          <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" aria-hidden="true" />
            Uploading is optional. You can create with the studio library without contributing recordings.
          </p>

          {selectionError && (
            <div className="studio-error-callout mt-4" role="alert"><CircleAlert aria-hidden="true" /><span>{selectionError}</span></div>
          )}

          {queue.length > 0 && (
            <div className="mt-5" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-200">Upload queue</p>
                <p className="text-xs tabular-nums text-slate-500">{completedCount} of {queue.length} added</p>
              </div>
              <ul className="mt-2 divide-y divide-white/5 rounded-lg border border-white/10 bg-black/20">
                {queue.map((item) => (
                  <li key={item.id} className="flex min-w-0 items-start gap-3 px-3 py-3 text-xs">
                    <span className="mt-0.5">
                      {item.status === 'learned' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        : item.status === 'failed' ? <X className="h-4 w-4 text-red-400" aria-hidden="true" />
                        : item.status === 'waiting' ? <span className="block h-4 w-4 rounded-full border border-slate-600" aria-hidden="true" />
                        : <LoaderCircle className="h-4 w-4 animate-spin text-orange-400" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-300">{item.name}</span>
                      {item.note && <span className="mt-1 block break-words text-red-300">{item.note}</span>}
                    </span>
                    <span className="shrink-0 text-slate-500">{statusLabel(item.status)}</span>
                  </li>
                ))}
              </ul>
              {failedCount > 0 && (
                <button type="button" onClick={retryFailed} disabled={running || !rightsConfirmed} className="studio-secondary-button mt-3">
                  <RotateCcw aria-hidden="true" /> Retry {failedCount} failed
                </button>
              )}
              {activeItem && <p className="mt-3 text-xs text-slate-500">Working on {activeItem.name}. The next file starts automatically.</p>}
            </div>
          )}
        </div>

        <aside className="studio-profile-panel" aria-label="Current sound profile">
          <p className="text-xs font-semibold uppercase text-slate-500">What the studio knows</p>
          {profile && profile.totalReferences > 0 ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {profile.genres.slice(0, 6).map((genre) => (
                  <span key={genre.genre} className="studio-tag">{genre.genre.replace(/_/g, ' ')} <span>{genre.count}</span></span>
                ))}
              </div>
              {profile.traits.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {profile.traits.slice(0, 4).map((trait, index) => (
                    <li key={`${trait.learnedAt}-${index}`} className="rounded-lg border border-white/5 bg-black/20 p-2.5 text-xs leading-5 text-slate-300">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">{trait.genre.replace(/_/g, ' ')}</span>
                      {trait.trait}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Available to future briefs</p>
            </>
          ) : (
            <div className="mt-5 text-sm leading-6 text-slate-500">
              No approved references yet. Your first completed analysis will appear here.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
