'use client';

/**
 * The Drop Machine — one theme → a batch of full songs, ranked by the A&R.
 * You become the curator: pick the winners, bin the rest.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

interface DropItem {
  songId?: string;
  hookText?: string;
  title?: string;
  score: number | null;
  jobId?: string;
  error?: string;
}

export function DropMachine({ projectId, initialTheme = '' }: { projectId: string; initialTheme?: string }) {
  const api = useApi();
  const router = useRouter();
  const [theme, setTheme] = useState(initialTheme);
  const [count, setCount] = useState(initialTheme ? 1 : 3);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<DropItem[]>([]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const autoRan = useRef(false);

  // "Auto-produce this" from the Create screen (?produce=…): actually start
  // producing on arrival, scroll it into view, and strip the param so a
  // refresh doesn't re-run (and re-charge).
  useEffect(() => {
    if (!initialTheme || autoRan.current) return;
    autoRan.current = true;
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void run(1);
    router.replace(`/projects/${projectId}`);

  }, []);

  async function run(overrideCount?: number) {
    const n = overrideCount ?? count;
    if (!theme.trim()) return;
    setBusy(true);
    setItems([]);
    setStatus(`Producing ${n} song${n > 1 ? 's' : ''} on “${theme.trim()}” — hooks, A&R pick, lyrics, sung song…`);
    try {
      // 202 + a job id INSTANTLY — the pipeline runs detached server-side
      // (holding a multi-minute HTTP request open dies on real networks).
      const started = await api.post<{ jobId: string }>(`/projects/${projectId}/drop`, {
        theme: theme.trim(),
        count: n,
      });
      const t0 = Date.now();
      const elapsed = () => {
        const s = Math.round((Date.now() - t0) / 1000);
        return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
      };
      let out: { produced?: number; drop?: DropItem[]; error?: string } | undefined;
      let failMsg = '';
      let netFails = 0;
      // 192 × 5s = 16 min — a full write (hooks → A&R → polished lyrics × N
      // takes) can take that long under load. Past the window we hand off
      // calmly; the pipeline keeps going and the songs land in the Catalog.
      for (let i = 0; i < 192; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        let j: { status: string; errorJson?: { message?: string } | null; outputJson?: { produced?: number; drop?: DropItem[]; error?: string } };
        // A single failed poll (backgrounded tab, wifi↔cell switch) must not
        // kill a drop that's still running server-side — retry, give up only
        // after ~2 min of solid failures.
        try { j = await api.get(`/jobs/${started.jobId}`); netFails = 0; }
        catch { if (++netFails >= 24) break; continue; }
        if (j.status === 'SUCCEEDED') { out = j.outputJson; break; }
        if (j.status === 'FAILED') { failMsg = j.errorJson?.message ?? 'the drop failed — try again'; break; }
        setStatus(
          i < 24
            ? `Writing hooks + the A&R pick… (${elapsed()})`
            : i < 96
              ? `Writing & polishing the lyrics… (${elapsed()})`
              : `Ranking the takes & queueing the renders… (${elapsed()})`
        );
      }
      if (failMsg) throw new Error(failMsg);
      if (!out) {
        setStatus('Still rendering in the background — this batch is taking longer than usual. Check the Catalog in a few minutes; nothing is lost.');
        return;
      }
      setItems(out.drop ?? []);
      // Top-level error = NO take rendered; the server names why (brain down,
      // cap hit) — show that, never a fabricated "0 songs queued".
      if (out.error) {
        setStatus(`Drop failed: ${out.error}`);
        return;
      }
      const produced = out.produced ?? 0;
      setStatus(`${produced} song${produced === 1 ? '' : 's'} queued & ranked. Audio renders in the background — refresh Catalog to hear them.`);
      router.refresh();
    } catch (e) {
      setStatus(`Drop failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section ref={sectionRef} className="mt-8">
      <h2 className="font-display text-2xl">⚡ Drop Machine</h2>
      <p className="mt-1 text-sm text-slate-400">
        One theme → a batch of full sung songs, ranked by the A&R. You curate the winners. (Daily cost cap always applies.)
      </p>
      <div className="mt-4 rounded-2xl glass p-4">
        <textarea
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="e.g. Amapiano-Afrobeats love songs in Pidgin, smooth Wizkid lane, for the club"
          rows={2}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            How many
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void run()}
            disabled={busy || !theme.trim()}
            className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
          >
            {busy ? 'Producing…' : `Drop ${count} songs`}
          </button>
        </div>
        {status && <div className="mt-3 text-xs text-slate-400">{status}</div>}

        {items.length > 0 && (
          <ol className="mt-4 space-y-2">
            {items.map((it, i) => (
              <li key={it.songId ?? i} className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                <span className="font-display text-lg text-afrobrand-400">#{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{it.hookText ?? (it.error ? `(${it.error})` : '—')}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    A&R score {it.score?.toFixed(1) ?? '—'} · {it.error ? 'skipped' : it.jobId ? 'rendering…' : 'queued'}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
