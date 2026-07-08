'use client';

/**
 * The Instrumental Library — every instrumental you own in one findable place.
 * Strip a song's vocal (catalog → "Instrumental") and it lands here; from here you
 * can play it, download it, or load it into a new song to work over.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Disc3, Download, Plus } from 'lucide-react';

interface Instrumental {
  id: string;
  url: string;
  genre: string | null;
  bpm: number | null;
  keySignature: string | null;
  durationS: number | null;
  source: string;
  createdAt: string;
}

export default function InstrumentalsPage() {
  const api = useApi();
  const router = useRouter();
  const [items, setItems] = useState<Instrumental[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      const r = await api.get<{ instrumentals: Instrumental[] }>('/instrumentals');
      setItems(r.instrumentals ?? []);
    } catch {
      /* show empty state */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reuse(id: string) {
    setBusy(id);
    setMsg('');
    try {
      const r = await api.post<{ projectId: string; message?: string }>(`/instrumentals/${id}/reuse`, {});
      setMsg(r.message || 'Loaded into a new song. Opening the studio…');
      router.push(`/projects/${r.projectId}`);
    } catch (e) {
      setMsg((e as Error).message || 'Could not reuse that instrumental');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-1 flex items-center gap-2">
        <Disc3 className="h-6 w-6 text-afrobrand-400" />
        <h1 className="font-display text-3xl">Instrumentals</h1>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-slate-400">
        Every instrumental you own — stripped from your songs (Catalog → “Instrumental”) or uploaded. Play, download, or load one into a new song to work over.
      </p>

      {msg && <div className="mb-4 rounded-lg border border-afrobrand-500/30 bg-afrobrand-500/10 p-2.5 text-sm text-afrobrand-200">{msg}</div>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading your instrumentals…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Disc3 className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">No instrumentals yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Open a song in your Catalog and hit <span className="text-slate-300">“Instrumental”</span> to strip the vocal — the clean instrumental lands here, ready to reuse.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((m) => (
            <div key={m.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="rounded-full bg-afrobrand-500/15 px-2 py-0.5 text-xs text-afrobrand-300">{m.source === 'upload' ? 'uploaded' : 'stripped'}</span>
                <span className="text-slate-300">{m.genre ?? 'instrumental'}</span>
                <span className="text-xs text-slate-500">
                  {[m.bpm ? `${m.bpm} bpm` : null, m.keySignature].filter(Boolean).join(' · ')}
                </span>
              </div>
              <audio controls preload="none" className="w-full" src={m.url} />
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={() => void reuse(m.id)}
                  disabled={busy === m.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-gradient px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> {busy === m.id ? 'Loading…' : 'Use in a new song'}
                </button>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
