'use client';
import { OperatorGate } from '@/components/OperatorGate';

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { formatUsd } from '@/lib/utils';

interface Stats {
  workspaces: number;
  users: number;
  songs: number;
  jobs: number;
  openReviews: number;
  failedJobs: number;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  creditsCents: number;
  suspendedAt: string | null;
  createdAt: string;
  _count: { members: number; projects: number };
}

/**
 * Operator console. The API enforces ADMIN_EMAILS — non-admins get a 403
 * and this page shows the denial rather than pretending to work.
 */
function AdminPageInner() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [denied, setDenied] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState('');

  // The api helper throws "401 Unauthorized: …" — read the status off the
  // front and point at the fix (a stale/wrong admin key is the common case).
  function actionErrText(prefix: string, e: unknown): string {
    const m = String((e as Error)?.message ?? e);
    const hint = /^40[13]\b/.test(m) ? ' — check the admin key in the field above' : '';
    return `${prefix}: ${m.slice(0, 160)}${hint}`;
  }

  async function load() {
    try {
      const [s, w] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<WorkspaceRow[]>('/admin/workspaces'),
      ]);
      setStats(s);
      setRows(w);
      setDenied(false);
      setNeedsKey(false);
    } catch (err) {
      // WO-1: admin routes are locked behind ADMIN_SECRET — prompt for the key.
      if (String(err).includes('401')) setNeedsKey(true);
      else if (String(err).includes('403')) setDenied(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setActionErr('');
    try {
      await api.post('/auth/admin-unlock', { secret: keyInput.trim() });
      setKeyInput('');
      await load();
    } catch (error) {
      setActionErr(actionErrText('Unlock failed', error));
    }
  }

  async function grant(id: string) {
    const usd = prompt('Grant amount in USD (negative to claw back):', '10');
    if (!usd) return;
    const reason = prompt('Reason (goes in the ledger):', 'support grant') ?? 'support grant';
    setBusy(id);
    setActionErr('');
    try {
      await api.post(`/admin/workspaces/${id}/credits`, {
        deltaCents: Math.round(Number(usd) * 10_000),
        reason,
      });
      await load();
    } catch (e) {
      setActionErr(actionErrText('Credit grant failed', e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend(row: WorkspaceRow) {
    if (!confirm(`${row.suspendedAt ? 'Unsuspend' : 'SUSPEND'} workspace "${row.name}"?`)) return;
    setBusy(row.id);
    setActionErr('');
    try {
      await api.post(`/admin/workspaces/${row.id}/${row.suspendedAt ? 'unsuspend' : 'suspend'}`, {});
      await load();
    } catch (e) {
      setActionErr(actionErrText(`${row.suspendedAt ? 'Unsuspend' : 'Suspend'} failed`, e));
    } finally {
      setBusy(null);
    }
  }

  // ENTER STUDIO — one click, logged into that workspace as its owner (2h
  // support session; the API swaps THIS browser's session cookie, so coming
  // back to the operator account = sign in again as yourself).
  async function enterStudio(row: WorkspaceRow) {
    if (!confirm(`Enter "${row.name}" as its owner? Your current session is replaced (sign back in as yourself to return).`)) return;
    setBusy(row.id);
    setActionErr('');
    try {
      await api.post(`/admin/workspaces/${row.id}/enter`, {});
      window.location.href = '/catalog';
    } catch (e) {
      setActionErr(actionErrText('Enter studio failed', e));
      setBusy(null);
    }
  }

  if (needsKey) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="font-display text-3xl">Admin key required</h1>
        <p className="mt-3 text-sm text-slate-400">
          Admin routes are locked (safety rail — the API is public). Enter the <code>ADMIN_SECRET</code> you set on the API
          service. The secret is exchanged for a two-hour HttpOnly browser grant and is not stored in web storage.
        </p>
        <div className="mt-5 flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(); }}
            placeholder="ADMIN_SECRET"
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm"
          />
          <button onClick={() => void saveKey()} className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-medium text-ink">
            Unlock
          </button>
        </div>
        {actionErr && <p className="mt-3 text-xs text-red-300">{actionErr}</p>}
      </div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl">Not an operator</h1>
        <p className="mt-3 text-sm text-slate-400">
          Your email is not in <code>ADMIN_EMAILS</code>. Ask the workspace owner to add you.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-4xl">Operator console</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats &&
          (
            [
              ['Workspaces', stats.workspaces],
              ['Users', stats.users],
              ['Songs', stats.songs],
              ['Jobs', stats.jobs],
              ['Open reviews', stats.openReviews],
              ['Failed jobs', stats.failedJobs],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-2xl font-bold text-afrobrand-400">{n}</div>
              <div className="text-xs uppercase tracking-widest text-slate-400">{label}</div>
            </div>
          ))}
      </div>

      <AutonomyCard />
      <TrainingConsentCard />
      <LakeJobs />

      <WriterAb />

      <EngineStatus />

      <RefileReview />

      <h2 className="mt-10 font-display text-2xl">Workspaces</h2>
      {actionErr && (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{actionErr}</div>
      )}
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-widest text-slate-400">
          <tr>
            <th className="py-2">Name</th>
            <th>Plan</th>
            <th>Credits</th>
            <th>Members</th>
            <th>Projects</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-800">
              <td className="py-2">
                {r.name} <span className="text-xs text-slate-500">({r.slug})</span>
              </td>
              <td>{r.plan}</td>
              <td className="text-afrobrand-400">{formatUsd(r.creditsCents)}</td>
              <td>{r._count.members}</td>
              <td>{r._count.projects}</td>
              <td>
                {r.suspendedAt ? (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-300">suspended</span>
                ) : (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">active</span>
                )}
              </td>
              <td className="space-x-2">
                <button
                  disabled={busy === r.id}
                  onClick={() => void enterStudio(r)}
                  className="rounded-full bg-brand-gradient px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
                >
                  Enter studio →
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => void grant(r.id)}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-afrobrand-500 disabled:opacity-50"
                >
                  Credits
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => void toggleSuspend(r)}
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-red-500 disabled:opacity-50"
                >
                  {r.suspendedAt ? 'Unsuspend' : 'Suspend'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * DATA-LAKE JOBS — the backfill buttons, one click each. Every task lands on the
 * worker's lake queue (never contends with renders); results show up on the Lake
 * page's Training utilization table a few minutes later.
 */
const LAKE_TASKS = [
  { task: 'measure-backfill', label: 'Measure backfill', what: 'deep-measure owned references + beats the ear missed' },
  { task: 'learn-backfill', label: 'Learn backfill', what: 'learn uploaded songs that never got a listen' },
  { task: 'listen-back', label: 'Listen back', what: 're-score the back-catalog; retro-promote QC passes' },
  { task: 'refile-references', label: 'Refile scan', what: 'propose lane moves for misfiled history (approve below)' },
  { task: 'mine-lexicon', label: 'Mine lexicon', what: 'harvest vocabulary from owned-upload transcripts' },
] as const;

/**
 * AUTONOMY — the on/off switches for every money-spending automatic job. The
 * API routes existed for days while THIS card didn't (the owner rightly called
 * it out: "you'll just be telling stuff that is not there"). One click per job;
 * OFF = that job spends nothing until you flip it back.
 */
/**
 * THE CONSENT DOOR (2026-07-19) — one tap. Grants (or withdraws) the versioned,
 * hashed training-license for THIS workspace so its user-original catalog
 * (masters, uploads, imported vocals) counts as training fuel in the nightly
 * flywheel. Shows the recorded verdict + what becomes trainable, honestly.
 */
function TrainingConsentCard() {
  const api = useApi();
  const [wsId, setWsId] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    granted: boolean; current?: boolean; version?: string; reason?: string;
    trainableNow?: number; total?: number; byOrigin?: Record<string, number>;
    outsideLearning?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await api.get<{ workspaceId?: string }>('/auth/me');
      const id = me.workspaceId ?? null;
      setWsId(id);
      if (!id) return;
      const m = await api.get<{ consent?: { granted?: boolean; current?: boolean; version?: string; reason?: string }; outsideRenderLearning?: boolean; trainableNow?: number; counts?: { total?: number; byOrigin?: Record<string, number> } }>(`/admin/training/manifest?workspaceId=${id}`);
      setStatus({
        granted: !!m.consent?.granted,
        current: m.consent?.current,
        version: m.consent?.version,
        reason: m.consent?.reason,
        trainableNow: m.trainableNow,
        total: m.counts?.total,
        byOrigin: m.counts?.byOrigin,
        outsideLearning: !!m.outsideRenderLearning,
      });
    } catch (e) { setErr((e as Error).message.slice(0, 140)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);

  // OUTSIDE-RENDER LEARNING (owner switch): admits MiniMax/Suno-era renders as
  // training fuel. Owner's call, owner's risk — the confirm states it plainly,
  // and turning it OFF later stops new fuel but cannot un-train weights.
  async function flipOutsideLearning(enabled: boolean) {
    const warning = enabled
      ? 'Turn ON learning from outside-engine renders?\n\nThis admits MiniMax/Suno-era songs as training fuel. Their terms forbid training a competing model on their output — flipping this ON is accepting that risk, and a model cannot UNLEARN later. Every flip is logged.'
      : 'Turn OFF outside-render learning? New training runs go back to rights-clean fuel only (already-trained weights keep what they learned).';
    if (!confirm(warning)) return;
    setBusy(true); setErr('');
    try { await api.post('/admin/training/outside-learning', { enabled }); await load(); }
    catch (e) { setErr((e as Error).message.slice(0, 140)); }
    setBusy(false);
  }

  async function grant() {
    if (!wsId) return;
    setBusy(true); setErr('');
    try { await api.post('/admin/training/consent', { workspaceId: wsId }); await load(); }
    catch (e) { setErr((e as Error).message.slice(0, 140)); }
    setBusy(false);
  }
  async function revoke() {
    if (!wsId) return;
    setBusy(true); setErr('');
    try { await api.del(`/admin/training/consent/${wsId}`); await load(); }
    catch (e) { setErr((e as Error).message.slice(0, 140)); }
    setBusy(false);
  }

  const granted = status?.granted && status?.current;
  return (
    <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="font-display text-2xl">Training license <span className="text-sm font-normal text-slate-500">— the consent door: lets YOUR catalog train YOUR model. Recorded, versioned, revocable.</span></h2>
      {status && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${granted ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {granted ? `GRANTED (${status.version})` : status.granted ? `granted under older terms (${status.version}) — re-grant` : 'NOT GRANTED'}
          </span>
          {typeof status.trainableNow === 'number' && (
            <span className="text-slate-400">trainable now: <span className="text-slate-200">{status.trainableNow}</span>{typeof status.total === 'number' ? ` of ${status.total} assets` : ''}</span>
          )}
          {!granted && status.reason && <span className="text-xs text-slate-500">{status.reason}</span>}
        </div>
      )}
      {status?.byOrigin && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {Object.entries(status.byOrigin).map(([origin, n]) => (
            <span key={origin} className={`rounded-full border px-2 py-0.5 ${origin === 'third-party-render' || origin === 'unknown' ? 'border-slate-700 text-slate-500' : 'border-emerald-500/30 text-emerald-300/80'}`}>
              {origin.replace(/-/g, ' ')}: {n}
            </span>
          ))}
          <span className="text-slate-500">
            {status?.outsideLearning
              ? '— OUTSIDE-RENDER LEARNING IS ON: MiniMax/Suno-era songs count as fuel (operator override, labeled in every manifest).'
              : '— third-party renders (MiniMax/Suno-era songs) are not fuel while the switch below is OFF: their terms, your protection.'}
          </span>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!granted ? (
          <button onClick={() => void grant()} disabled={busy || !wsId}
            className="rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-ink shadow-glow disabled:opacity-50">
            {busy ? 'Granting…' : 'Grant training license for this studio'}
          </button>
        ) : (
          <button onClick={() => void revoke()} disabled={busy}
            className="rounded-full border border-slate-700 px-5 py-2.5 text-sm text-slate-300 disabled:opacity-50">
            {busy ? 'Withdrawing…' : 'Withdraw (future training only)'}
          </button>
        )}
        <button onClick={() => void flipOutsideLearning(!status?.outsideLearning)} disabled={busy || !status}
          className={`rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${status?.outsideLearning ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' : 'border border-slate-700 text-slate-300'}`}>
          {status?.outsideLearning ? '⚠ Outside-render learning: ON — click to turn OFF' : 'Outside-render learning: OFF — click to turn ON'}
        </button>
      </div>
      {err && <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}
      <p className="mt-3 text-[11px] text-slate-500">Granting records the exact license text (hashed) under your admin identity. The nightly flywheel then counts this workspace&apos;s own uploads, masters and vocals as training fuel. The outside-render switch is yours: OFF keeps the rights-clean line (their ToS forbid training on their output); ON admits those renders as fuel, every flip is logged, and manifests always label their origin honestly. A later OFF stops new fuel but trained weights don&apos;t forget.</p>
    </section>
  );
}

interface AutonomyJobRow { job: string; enabled: boolean; schedule: string; what: string; valueSignal: string }
function AutonomyCard() {
  const api = useApi();
  const [jobs, setJobs] = useState<AutonomyJobRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    try {
      const r = await api.get<{ jobs: AutonomyJobRow[] }>('/admin/autonomy');
      setJobs(r.jobs);
      setErr('');
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      setErr(`couldn't load autonomy: ${m.slice(0, 120)}${/^40[13]\b/.test(m) ? ' — set the admin key above first' : ''}`);
    }
  }
  useEffect(() => { void load();   }, []);

  async function toggle(job: string, enabled: boolean) {
    setBusy(job);
    try {
      await api.post('/admin/autonomy', { job, enabled });
      await load();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      setErr(`${job}: ${m.slice(0, 120)}${/^40[13]\b/.test(m) ? ' — check the admin key above' : ''}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-amber-900/60 bg-slate-900/40 p-4">
      <h2 className="font-display text-2xl">Autonomy <span className="text-sm font-normal text-slate-500">— every automatic job that can spend money, with its OFF switch.</span></h2>
      {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
      {!jobs && !err && <div className="mt-3 text-xs text-slate-500">Loading…</div>}
      {jobs && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {jobs.map((j) => (
            <div key={j.job} className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div>
                <div className="text-sm text-slate-200">{j.job.replace(/_/g, ' ')} <span className="text-[11px] text-slate-500">({j.schedule})</span></div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{j.what}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{j.valueSignal}</div>
              </div>
              <button
                onClick={() => void toggle(j.job, !j.enabled)}
                disabled={busy === j.job}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${j.enabled ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-700' : 'bg-rose-600/20 text-rose-300 border border-rose-800'} disabled:opacity-50`}
              >
                {busy === j.job ? '…' : j.enabled ? 'ON — click to stop' : 'OFF — click to start'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LakeJobs() {
  const api = useApi();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function run(task: string) {
    setBusy(task);
    setMsg('');
    try {
      const r = await api.post<{ queued: string; note?: string }>('/admin/run', { task });
      setMsg(`${r.queued} queued${r.note ? ` — ${r.note}` : ''}`);
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      const hint = /^40[13]\b/.test(m) ? ' — check the admin key above' : '';
      setMsg(`${task} failed: ${m.slice(0, 140)}${hint}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="font-display text-2xl">Data-lake jobs <span className="text-sm font-normal text-slate-500">— run the compounding passes NOW instead of waiting for tonight.</span></h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LAKE_TASKS.map((t) => (
          <div key={t.task} className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div>
              <div className="text-sm text-slate-200">{t.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{t.what}</div>
            </div>
            <button
              onClick={() => void run(t.task)}
              disabled={!!busy}
              className="shrink-0 rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-afrobrand-500 disabled:opacity-50"
            >
              {busy === t.task ? 'Queuing…' : 'Run'}
            </button>
          </div>
        ))}
      </div>
      {msg && <div className="mt-3 text-xs text-slate-400">{msg}</div>}
    </div>
  );
}

/**
 * ADDENDUM C-3 — the re-file review list. The nightly scanner proposes lane
 * moves for history misfiled before the teach-genre picker existed; NOTHING
 * moves without approval here (§1.5 — your ear outranks the machine).
 */
interface RefileRow { id: string; title: string | null; filedLane: string | null; proposedLane?: string; detectedScore?: number; filedScore?: number | null; learnedAt: string }
function RefileReview() {
  const api = useApi();
  const [rows, setRows] = useState<RefileRow[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await api.get<{ proposals: RefileRow[] }>('/admin/refile');
      setRows(r.proposals);
    } catch { /* admin key missing/invalid — the page-level prompt handles it */ }
  }
  useEffect(() => { void load(); }, []);

  async function act(id: string, action: 'approve' | 'reject', lane?: string) {
    setBusy(id);
    try {
      await api.post(`/admin/refile/${id}`, { action, lane });
      setRows((r) => r.filter((x) => x.id !== id));
      setMsg(action === 'approve' ? 'Moved — both lanes rebuild on next read.' : 'Rejected — stays as filed.');
    } catch (e) { setMsg((e as Error).message.slice(0, 120)); }
    finally { setBusy(''); }
  }

  async function bulkApprove() {
    setBusy('bulk');
    try {
      const r = await api.post<{ approved: number }>('/admin/refile/bulk-approve', {});
      setMsg(`Approved ${r.approved} moves — profiles + grounding rebuild on next read.`);
      setRows([]);
    } catch (e) { setMsg((e as Error).message.slice(0, 120)); }
    finally { setBusy(''); }
  }

  async function scanNow() {
    setBusy('scan');
    try {
      await api.post('/admin/run', { task: 'refile-references' });
      setMsg('Scan queued on the worker — refresh this list in ~1 min.');
    } catch (e) { setMsg((e as Error).message.slice(0, 120)); }
    finally { setBusy(''); }
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl">Re-file review</h2>
        <button onClick={() => void scanNow()} disabled={busy === 'scan'} className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-afrobrand-500 disabled:opacity-50">Scan history now</button>
        {rows.length > 0 && (
          <button onClick={() => void bulkApprove()} disabled={busy === 'bulk'} className="rounded-full bg-brand-gradient px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">Approve all ({rows.length})</button>
        )}
        {msg && <span className="text-xs text-slate-400">{msg}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        References the ear believes were filed in the wrong lane (misfiled before the teach-genre picker). Nothing moves without your approval.
      </p>
      {rows.length === 0 ? (
        <div className="mt-3 text-xs text-slate-600">No pending proposals — history is clean (or the scan hasn’t found any yet).</div>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-widest text-slate-400">
            <tr><th className="py-2">Reference</th><th>Filed as</th><th>Ear says</th><th>Scores</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="py-2 max-w-[240px] truncate">{r.title || r.id}</td>
                <td className="text-slate-400">{r.filedLane ?? '—'}</td>
                <td className="text-afrobrand-300">{r.proposedLane}</td>
                <td className="text-xs text-slate-500">{r.detectedScore ?? '—'} vs {r.filedScore ?? '—'}</td>
                <td className="space-x-2">
                  <button disabled={busy === r.id} onClick={() => void act(r.id, 'approve')} className="rounded-full border border-emerald-700 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Approve</button>
                  <button disabled={busy === r.id} onClick={() => void act(r.id, 'reject')} className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-red-500 disabled:opacity-50">Reject</button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => { const lane = prompt('Move to which lane? (e.g. amapiano, afrobeats, highlife)'); if (lane) void act(r.id, 'approve', lane.trim()); }}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-afrobrand-500 disabled:opacity-50"
                  >
                    Reassign…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A3-3 — ENGINE STATUS: which engine is used, per path, live (admin-only). */
function EngineStatus() {
  const api = useApi();
  const [d, setD] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { api.get<Record<string, unknown>>('/admin/engines').then(setD).catch(() => {}); }, []);
  if (!d) return null;
  const resolved = (d.resolved ?? {}) as Record<string, unknown>;
  const routing = (d.renderRouting ?? {}) as { adapters?: Record<string, string> };
  const brains = (d.brainTiers ?? {}) as { judgment?: { configured?: boolean }; fallback?: { configured?: boolean }; bulk?: { configured?: boolean; model?: string } };
  const spend = (d.last24hRenderSpend ?? []) as Array<{ engine: string; renders: number; costUsd: number }>;
  // AFRO-1 — the own engine's NAME (owner 2026-07-19: "give our engine a
  // name"). Display-only: the internal ids (afrohit-own / material /
  // instrumental-reuse) are load-bearing for the rights classifiers and never
  // change; the console unifies them under the brand.
  const AFRO1_IDS = new Set(['afrohit-own', 'material', 'instrumental-reuse', 'own', 'own_engine']);
  const engineLabel = (id: string) => (AFRO1_IDS.has(id) ? `AFRO-1 · ${id}` : id);
  const afro1Renders = spend.filter((s2) => AFRO1_IDS.has(s2.engine)).reduce((a, s2) => a + s2.renders, 0);
  return (
    <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="font-display text-2xl">Engine status</h2>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Own engine</div>
          <div className="text-afrobrand-300">AFRO-1 <span className="text-xs text-slate-500">— beds from YOUR shelf, $0, always the default for instrumentals</span></div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Vocal default (the singer)</div>
          <div className="text-afrobrand-300">{String(resolved.vocalDefault ?? '—')} <span className="text-xs text-slate-500">— sings when a record needs vocals; AFRO-1 renders the bed. Flip via SONG_ENGINE (ace_step after the bake-off).</span></div>
        </div>
        <div><div className="text-xs uppercase tracking-widest text-slate-500">Stems mode</div><div className="text-slate-200">{String(resolved.stemsMode ?? '—')}</div></div>
        <div><div className="text-xs uppercase tracking-widest text-slate-500">Brains</div><div className="text-slate-200">judgment: {brains.judgment?.configured ? 'anthropic ✓' : '✗'} · fallback: {brains.fallback?.configured ? 'openai ✓' : 'openai ✗ (set OPENAI_API_KEY)'} · bulk: {brains.bulk?.configured ? `cerebras ✓ (${brains.bulk?.model})` : 'not set'}</div></div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <div>
          <div className="text-slate-500 uppercase tracking-widest">Adapters</div>
          <div>AFRO-1: <span className="text-slate-200">our engine — assembles from your material shelf ($0, rights-clean fuel)</span></div>
          {Object.entries(routing.adapters ?? {}).map(([k, v]) => <div key={k}>{k}: <span className="text-slate-200">{String(v)}</span></div>)}
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-widest">Last 24h render spend</div>
          {afro1Renders > 0 && <div className="text-emerald-300/90">AFRO-1 (own): {afro1Renders} renders · $0</div>}
          {spend.length === 0 ? <div>no renders</div> : spend.filter((s2) => !AFRO1_IDS.has(s2.engine)).map((s2) => <div key={s2.engine}>{engineLabel(s2.engine)}: {s2.renders} renders · ${s2.costUsd}</div>)}
        </div>
      </div>
    </div>
  );
}

/** WRITER A/B — blind bench: which brain writes the better song? Your ear decides. */
function WriterAb() {
  const api = useApi();
  const [genre, setGenre] = useState('afrobeats');
  const [mood, setMood] = useState('love');
  const [langs, setLangs] = useState('pcm,en');
  const [theme, setTheme] = useState('');
  const [busy2, setBusy2] = useState(false);
  const [res, setRes] = useState<{ hookText: string; blind: Array<{ label: string; title: string; body: string }>; reveal: string } | null>(null);
  const [revealed, setRevealed] = useState('');
  const [msg, setMsg] = useState('');

  async function run() {
    setBusy2(true); setMsg(''); setRes(null); setRevealed('');
    try {
      const r = await api.post<{ hookText: string; blind: Array<{ label: string; title: string; body: string }>; reveal: string }>('/admin/writer-ab', {
        genre, mood, languages: langs.split(',').map((x) => x.trim()).filter(Boolean), theme: theme || undefined,
      });
      setRes(r);
    } catch (e) { setMsg((e as Error).message.slice(0, 160)); }
    finally { setBusy2(false); }
  }

  return (
    <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="font-display text-2xl">Writer A/B <span className="text-sm font-normal text-slate-500">— blind: same hook, same brief, same polish; only the brain differs. Judge FIRST, reveal after.</span></h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="genre" className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
        <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="mood" className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
        <input value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="languages (csv)" className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
        <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="theme (optional)" className="flex-1 min-w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
        <button onClick={() => void run()} disabled={busy2} className="rounded-full bg-brand-gradient px-4 py-1.5 text-sm font-medium text-ink disabled:opacity-50">{busy2 ? 'Writing both…' : 'Run A/B'}</button>
      </div>
      {msg && <div className="mt-2 text-xs text-red-300">{msg}</div>}
      {res && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-slate-400">Shared hook: <span className="text-slate-200">{res.hookText}</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            {res.blind.map((v) => (
              <div key={v.label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="mb-1 text-sm font-bold text-afrobrand-300">{v.label} — {v.title}</div>
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap text-xs text-slate-300">{v.body}</pre>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => setRevealed(atob(res.reveal))} className="rounded-full border border-slate-700 px-3 py-1 text-xs hover:border-afrobrand-500">Reveal (after judging!)</button>
            {revealed && <span className="text-sm text-emerald-300">{revealed}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// TENANT SURFACE ISOLATION (Wave 8a): operator-only page. The gate is a
// polite presentation wrapper for deep links; the API routes behind this page
// are independently requireAdmin-gated server-side.
export default function AdminPage() {
  return (
    <OperatorGate>
      <AdminPageInner />
    </OperatorGate>
  );
}
