'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  Loader2,
  Mic2,
  PackageCheck,
  Plus,
  RadioTower,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useApi } from '@/lib/api';
import { LaneReport } from './LaneReport';
import { AdjustSong } from './AdjustSong';

interface Split {
  name: string;
  role: string;
  share: number;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface Status {
  song: {
    id: string;
    title: string;
    isrc: string | null;
    upc: string | null;
    splitSheet: Split[];
    releaseReady: boolean;
    nativeReviewOk: boolean;
  } | null;
  greenLight: {
    ready: boolean;
    checks: Check[];
    needsReview: boolean;
  } | null;
  evidence?: {
    receiptHashValid: boolean;
    receiptCurrent: boolean;
    splitAttested: boolean;
    nativeAttested: boolean;
    requiredNativeLanguages: string[];
  };
  assets?: {
    audio: {
      id: string;
      kind: 'master' | 'mix';
      qualityState: string;
      contentHash: string | null;
    } | null;
    cover: {
      id: string;
      width: number | null;
      height: number | null;
      approved: boolean;
      qualityState: string;
      contentHash: string | null;
      playbackUrl: string;
    } | null;
    lyric: { id: string; approved: boolean } | null;
  };
  rightsReceipt?: {
    id: string;
    risk: string | null;
    okToExport: boolean;
  } | null;
  latestExport?: {
    id: string;
    qualityState: string;
    contentHash: string | null;
    sizeBytes: number | null;
    current: boolean;
    downloadPath: string | null;
  } | null;
}

interface Job {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorJson?: { message?: string } | null;
}

interface PerformancePack {
  backingTrack: string | null;
  bpm: number | null;
  key: string | null;
  certified: boolean;
}

const ROLES = ['writer', 'composer', 'producer', 'performer', 'featured', 'other'];
const RIGHTS_BASES = [
  { value: '', label: 'No catalog match expected' },
  { value: 'owner', label: 'I own the matched recording' },
  { value: 'licensed', label: 'Matched recording is licensed' },
  { value: 'public_domain', label: 'Matched recording is public domain' },
] as const;

export function ReleaseReadiness({ projectId }: { projectId: string }) {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewLanguages, setReviewLanguages] = useState<string[]>([]);
  const [rightsBasis, setRightsBasis] = useState<'' | 'owner' | 'licensed' | 'public_domain'>('');
  const [rightsNote, setRightsNote] = useState('');
  const [performance, setPerformance] = useState<PerformancePack | null>(null);

  const load = useCallback(async () => {
    const next = await api.get<Status>('/projects/' + projectId + '/release');
    setStatus(next);
    setSplits(
      next.song?.splitSheet?.length
        ? next.song.splitSheet
        : [{ name: '', role: 'writer', share: 100 }],
    );
    const required = next.evidence?.requiredNativeLanguages ?? [];
    setReviewLanguages((current) => current.length ? current : required);
  }, [api, projectId]);

  useEffect(() => {
    void load().catch((error) => setMessage((error as Error).message));
  }, [load]);

  async function waitForJob(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await api.get<Job>('/jobs/' + jobId);
      if (job.status === 'SUCCEEDED') return;
      if (job.status === 'FAILED') {
        throw new Error(job.errorJson?.message ?? 'The background job failed.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('The job is still running. Its result will remain available in Jobs.');
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const total = splits.reduce((sum, split) => sum + (Number(split.share) || 0), 0);
  const totalValid = splits.length > 0 && Math.abs(total - 100) < 0.01;
  const requiredLanguages = status?.evidence?.requiredNativeLanguages ?? [];
  const cover = status?.assets?.cover;
  const canRunRights = !!status?.assets?.audio
    && !!cover?.approved
    && status.assets?.lyric?.approved === true;

  async function acceptSplits() {
    if (!status?.song) return;
    await runAction('splits', async () => {
      const next = await api.patch<Status>(
        '/projects/' + projectId + '/release/' + status.song!.id,
        { splitSheet: splits, acceptSplits: true },
      );
      setStatus(next);
      setMessage('Split-sheet accepted and sealed to this exact 100% allocation.');
    });
  }

  async function approveCover() {
    if (!cover) return;
    await runAction('cover', async () => {
      await api.patch('/images/' + cover.id, { approved: true });
      await load();
      setMessage('Cover approved. Any older cover approval was retired.');
    });
  }

  async function attestNativeReview() {
    if (!status?.song) return;
    await runAction('native', async () => {
      const next = await api.patch<Status>(
        '/projects/' + projectId + '/release/' + status.song!.id,
        {
          nativeReview: {
            reviewerName,
            languages: reviewLanguages,
            attested: true,
            ...(reviewNotes.trim() ? { notes: reviewNotes.trim() } : {}),
          },
        },
      );
      setStatus(next);
      setMessage('Native-language review recorded with the reviewer identity.');
    });
  }

  async function revokeNativeReview() {
    if (!status?.song) return;
    await runAction('native', async () => {
      const next = await api.patch<Status>(
        '/projects/' + projectId + '/release/' + status.song!.id,
        { revokeNativeReview: true },
      );
      setStatus(next);
      setMessage('Native-language attestation revoked.');
    });
  }

  async function runRightsScan() {
    if (!status?.song) return;
    await runAction('rights', async () => {
      const queued = await api.post<{ jobId: string }>('/rights/check', {
        projectId,
        songId: status.song!.id,
        ...(rightsBasis
          ? {
              audioRightsAttestation: {
                confirmed: true,
                basis: rightsBasis,
                ...(rightsNote.trim() ? { note: rightsNote.trim() } : {}),
              },
            }
          : {}),
      });
      await waitForJob(queued.jobId);
      await load();
      setMessage('Rights scan completed against the current certified artifacts.');
    });
  }

  async function buildPackage() {
    if (!status?.song) return;
    await runAction('export', async () => {
      const queued = await api.post<{ jobId: string }>(
        '/projects/' + projectId + '/exports',
        { songId: status.song!.id },
      );
      await waitForJob(queued.jobId);
      await load();
      setMessage('Verified release package built and ready to download.');
    });
  }

  async function loadPerformance() {
    if (!status?.song) return;
    await runAction('performance', async () => {
      setPerformance(await api.get<PerformancePack>(
        '/projects/' + projectId + '/release/' + status.song!.id + '/performance',
      ));
    });
  }

  async function distribute() {
    if (!status?.song) return;
    await runAction('distribution', async () => {
      const result = await api.post<{ message: string }>(
        '/projects/' + projectId + '/release/' + status.song!.id + '/distribute',
        {},
      );
      setMessage(result.message);
    });
  }

  if (!status) {
    return (
      <section className="mt-8 flex min-h-40 items-center justify-center border-t border-white/10">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading release status" />
      </section>
    );
  }

  if (!status.song) {
    return (
      <section className="mt-8 border-t border-white/10 pt-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-slate-400" />
          <h2 className="font-display text-xl">Release readiness</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500">A rendered song will appear here for certification.</p>
      </section>
    );
  }

  const greenLight = status.greenLight;
  const latestExport = status.latestExport;

  return (
    <section className="mt-8 border-t border-white/10 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-afrobrand-300" />
        <h2 className="font-display text-2xl">Release readiness</h2>
        <span className={
          'rounded border px-2 py-1 text-xs font-semibold ' +
          (greenLight?.ready
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-300')
        }>
          {greenLight?.ready ? 'GREEN-LIT' : 'BLOCKED'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-400">{status.song.title}</p>

      <LaneReport songId={status.song.id} />
      <AdjustSong songId={status.song.id} onDispatched={() => void load()} />

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-slate-300" />
            <h3 className="font-display text-base">Certification checks</h3>
          </div>
          <ul className="mt-3 space-y-2">
            {greenLight?.checks.map((check) => (
              <li key={check.name} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                {check.ok
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                  : <Circle className="mt-0.5 h-4 w-4 text-slate-600" />}
                <div className="min-w-0">
                  <div className={check.ok ? 'text-slate-200' : 'text-slate-400'}>{check.name}</div>
                  {check.detail && <div className="break-words text-xs text-slate-500">{check.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
          {(status.song.isrc || status.song.upc) && (
            <dl className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">ISRC</dt>
                <dd className="mt-0.5 break-all font-mono text-slate-300">{status.song.isrc}</dd>
              </div>
              <div>
                <dt className="text-slate-500">UPC</dt>
                <dd className="mt-0.5 break-all font-mono text-slate-300">{status.song.upc}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-slate-300" />
            <h3 className="font-display text-base">Cover approval</h3>
          </div>
          {cover ? (
            <div className="mt-3 grid grid-cols-[96px_1fr] gap-3">
              <Image
                src={cover.playbackUrl}
                alt="Current release cover"
                width={96}
                height={96}
                unoptimized
                className="aspect-square rounded object-cover"
              />
              <div className="min-w-0 text-xs text-slate-400">
                <div>{cover.width ?? '?'} x {cover.height ?? '?'}</div>
                <div className="mt-1 break-words">{cover.qualityState}</div>
                <div className="mt-1">{cover.approved ? 'Approved' : 'Approval required'}</div>
                {!cover.approved && (
                  <button
                    type="button"
                    onClick={() => void approveCover()}
                    disabled={busy !== null || cover.qualityState !== 'passed'}
                    className="mt-3 inline-flex min-h-9 items-center gap-2 rounded bg-white px-3 py-2 font-medium text-slate-950 disabled:opacity-50"
                  >
                    {busy === 'cover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve cover
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No cover has been generated for this project.</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-300" />
            <h3 className="font-display text-base">Split-sheet</h3>
          </div>
          <span className={'font-mono text-sm ' + (totalValid ? 'text-emerald-400' : 'text-amber-400')}>
            {total.toFixed(2).replace(/\.00$/, '')}%
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {splits.map((split, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,140px)_72px_36px] gap-2">
              <input
                value={split.name}
                onChange={(event) => setSplits((current) => current.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, name: event.target.value } : row
                ))}
                placeholder="Contributor"
                className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
              />
              <select
                value={split.role}
                onChange={(event) => setSplits((current) => current.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, role: event.target.value } : row
                ))}
                className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
              >
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={split.share}
                onChange={(event) => setSplits((current) => current.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, share: Number(event.target.value) } : row
                ))}
                aria-label={'Share for ' + (split.name || 'contributor')}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-sm tabular-nums"
              />
              <button
                type="button"
                onClick={() => setSplits((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-700 text-slate-400 hover:border-red-500/50 hover:text-red-300"
                title="Remove contributor"
                aria-label="Remove contributor"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSplits((current) => [...current, { name: '', role: 'writer', share: 0 }])}
            className="inline-flex min-h-9 items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            <Plus className="h-4 w-4" />
            Contributor
          </button>
          <button
            type="button"
            onClick={() => void acceptSplits()}
            disabled={busy !== null || !totalValid || splits.some((split) => !split.name.trim())}
            className="ml-auto inline-flex min-h-9 items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
          >
            {busy === 'splits' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
            Accept splits
          </button>
        </div>
      </div>

      {requiredLanguages.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-amber-300" />
            <h3 className="font-display text-base text-amber-100">Native-language review</h3>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              Reviewer name
              <input
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <fieldset>
              <legend className="text-xs text-slate-400">Reviewed languages</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {requiredLanguages.map((language) => (
                  <label key={language} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={reviewLanguages.includes(language)}
                      onChange={(event) => setReviewLanguages((current) =>
                        event.target.checked
                          ? [...new Set([...current, language])]
                          : current.filter((item) => item !== language)
                      )}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    {language.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label className="mt-3 block text-xs text-slate-400">
            Review notes
            <textarea
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
              rows={2}
              className="mt-1 w-full resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void attestNativeReview()}
              disabled={
                busy !== null
                || reviewerName.trim().length < 2
                || requiredLanguages.some((language) => !reviewLanguages.includes(language))
              }
              className="inline-flex min-h-9 items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              {busy === 'native' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Record review
            </button>
            {status.evidence?.nativeAttested && (
              <button
                type="button"
                onClick={() => void revokeNativeReview()}
                disabled={busy !== null}
                className="inline-flex min-h-9 items-center rounded border border-slate-700 px-3 py-2 text-sm text-slate-300"
              >
                Revoke review
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-slate-300" />
            <h3 className="font-display text-base">Rights scan</h3>
          </div>
          <div className="mt-3 grid gap-2">
            <select
              value={rightsBasis}
              onChange={(event) => setRightsBasis(event.target.value as typeof rightsBasis)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              {RIGHTS_BASES.map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
            </select>
            {rightsBasis && (
              <input
                value={rightsNote}
                onChange={(event) => setRightsNote(event.target.value)}
                placeholder="License, ownership, or public-domain note"
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => void runRightsScan()}
            disabled={busy !== null || !canRunRights}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
          >
            {busy === 'rights' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            Scan current song
          </button>
          {status.rightsReceipt && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              {status.rightsReceipt.okToExport
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                : <AlertTriangle className="h-4 w-4 text-amber-400" />}
              {status.rightsReceipt.risk ?? 'unknown'} risk
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-slate-300" />
            <h3 className="font-display text-base">Release package</h3>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Verified WAV, MP3, cover, metadata, lyrics, splits, provenance, receipt, and checksums.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void buildPackage()}
              disabled={busy !== null || !greenLight?.ready}
              className="inline-flex min-h-9 items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Build package
            </button>
            {latestExport?.current && latestExport.downloadPath && (
              <a
                href={api.fileHref(latestExport.downloadPath)}
                className="inline-flex min-h-9 items-center gap-2 rounded border border-emerald-500/40 px-4 py-2 text-sm font-medium text-emerald-300"
              >
                <Download className="h-4 w-4" />
                Download ZIP
              </a>
            )}
          </div>
          {latestExport?.sizeBytes != null && (
            <div className="mt-3 text-xs text-slate-500">
              {(latestExport.sizeBytes / (1024 * 1024)).toFixed(1)} MB
              {latestExport.current ? ' verified' : ' stale package'}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <a
          href={'/r/' + status.song.id}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-300"
        >
          <ExternalLink className="h-4 w-4" />
          Public page
        </a>
        <button
          type="button"
          onClick={() => void loadPerformance()}
          disabled={busy !== null}
          className="inline-flex min-h-9 items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-300"
        >
          {busy === 'performance' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
          Performance pack
        </button>
        <button
          type="button"
          onClick={() => void distribute()}
          disabled={busy !== null || !latestExport?.current}
          className="inline-flex min-h-9 items-center gap-2 rounded bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
        >
          {busy === 'distribution' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}
          Send to distributor
        </button>
        {performance?.backingTrack && (
          <a
            href={performance.backingTrack}
            className="inline-flex min-h-9 items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-300"
          >
            <Download className="h-4 w-4" />
            Backing track
          </a>
        )}
        {performance && (
          <span className="text-xs text-slate-500">
            {performance.bpm ? performance.bpm + ' BPM' : ''}
            {performance.key ? ' / ' + performance.key : ''}
          </span>
        )}
      </div>

      {message && (
        <div
          role="status"
          className="mt-3 rounded border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-300"
        >
          {message}
        </div>
      )}
    </section>
  );
}
