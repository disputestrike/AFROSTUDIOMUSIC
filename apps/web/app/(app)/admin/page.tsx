'use client';

import { useEffect, useState } from 'react';
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
export default function AdminPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [denied, setDenied] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

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

  function saveKey() {
    if (!keyInput.trim()) return;
    localStorage.setItem('afrohit.adminKey', keyInput.trim());
    setKeyInput('');
    void load();
  }

  async function grant(id: string) {
    const usd = prompt('Grant amount in USD (negative to claw back):', '10');
    if (!usd) return;
    const reason = prompt('Reason (goes in the ledger):', 'support grant') ?? 'support grant';
    setBusy(id);
    try {
      await api.post(`/admin/workspaces/${id}/credits`, {
        deltaCents: Math.round(Number(usd) * 10_000),
        reason,
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend(row: WorkspaceRow) {
    if (!confirm(`${row.suspendedAt ? 'Unsuspend' : 'SUSPEND'} workspace "${row.name}"?`)) return;
    setBusy(row.id);
    try {
      await api.post(`/admin/workspaces/${row.id}/${row.suspendedAt ? 'unsuspend' : 'suspend'}`, {});
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (needsKey) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="font-display text-3xl">Admin key required</h1>
        <p className="mt-3 text-sm text-slate-400">
          Admin routes are locked (safety rail — the API is public). Enter the <code>ADMIN_SECRET</code> you set on the API
          service; it is stored only in this browser.
        </p>
        <div className="mt-5 flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            placeholder="ADMIN_SECRET"
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm"
          />
          <button onClick={saveKey} className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-medium text-ink">
            Unlock
          </button>
        </div>
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

      <h2 className="mt-10 font-display text-2xl">Workspaces</h2>
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
