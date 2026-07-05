'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Trash2, Download, Wand2, FileText, Copy, Recycle, Pencil, Sliders, X, Loader2, Music2, Layers } from 'lucide-react';

export interface SongRow {
  id: string;
  title: string;
  versionLabel?: string | null;
  status: string;
  artist: string;
  projectId: string;
  projectTitle: string;
  genre: string;
  bpm: number | null;
  audioUrl: string | null;
  masterUrl?: string | null;
  mixUrl?: string | null;
  beatUrl?: string | null;
  beatId?: string | null;
  stemCount?: number;
  hasLyrics?: boolean;
  releaseReady?: boolean;
  coverUrl: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  SKETCH: 'Sketch', DEMO: 'Demo', FULL: 'Full', MIXED: 'Mixed', MASTERED: 'Mastered', RELEASED: 'Released',
};

type DownloadFile = { label: string; url: string; kind: string };

export default function CatalogGrid({ initial }: { initial: SongRow[] }) {
  const api = useApi();
  const router = useRouter();
  const [songs, setSongs] = useState<SongRow[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>(''); // `${id}:${action}`
  const [toast, setToast] = useState<string>('');
  const [editing, setEditing] = useState<{ id: string; lyricId?: string; title: string; body: string } | null>(null);
  const [downloads, setDownloads] = useState<{ id: string; files: DownloadFile[] } | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  const isBusy = (id: string, a: string) => busy === `${id}:${a}`;

  async function remove(id: string) {
    if (!confirm('Delete this song? This cannot be undone.')) return;
    setSongs((s) => s.filter((x) => x.id !== id));
    try { await api.del(`/songs/${id}`); } catch { /* best-effort */ }
  }

  async function remaster(s: SongRow) {
    setBusy(`${s.id}:master`);
    try { await api.post(`/songs/${s.id}/master`, { preset: 'streaming_lufs_-14' }); flash('Re-master queued — refresh in ~1 min for the new master.'); }
    catch (e) { flash((e as Error).message || 'Master failed'); }
    finally { setBusy(''); }
  }

  async function reuseBeat(s: SongRow) {
    setBusy(`${s.id}:reuse`);
    try {
      const r = await api.post<{ projectId: string }>(`/songs/${s.id}/reuse-beat`, {});
      flash('Beat reused in a new song. Opening the studio…');
      router.push(`/projects/${r.projectId}`);
    } catch (e) { flash((e as Error).message || 'Reuse failed'); }
    finally { setBusy(''); }
  }

  async function duplicate(s: SongRow) {
    setBusy(`${s.id}:dup`);
    try { await api.post(`/songs/${s.id}/duplicate`, {}); flash('Duplicated. Refresh to see the copy.'); }
    catch (e) { flash((e as Error).message || 'Duplicate failed'); }
    finally { setBusy(''); }
  }

  async function separate(s: SongRow, mode: 'instrumental' | 'full') {
    setBusy(`${s.id}:${mode}`);
    try {
      await api.post(`/songs/${s.id}/stems`, { mode });
      flash(mode === 'instrumental' ? 'Making the instrumental — it’ll appear in Download in ~1 min.' : 'Separating stems — they’ll appear in Download in ~1 min.');
    } catch (e) { flash((e as Error).message || 'Separation failed'); }
    finally { setBusy(''); }
  }

  async function rename(s: SongRow) {
    const title = prompt('Rename song', s.title);
    if (!title || title === s.title) return;
    setSongs((arr) => arr.map((x) => (x.id === s.id ? { ...x, title } : x)));
    try { await api.patch(`/songs/${s.id}`, { title }); } catch (e) { flash((e as Error).message || 'Rename failed'); }
  }

  async function openLyrics(s: SongRow) {
    setBusy(`${s.id}:lyrics`);
    try {
      const r = await api.get<{ lyric: { id: string; title?: string; body: string } | null }>(`/songs/${s.id}/lyrics`);
      setEditing({ id: s.id, lyricId: r.lyric?.id, title: r.lyric?.title ?? s.title, body: r.lyric?.body ?? '' });
    } catch (e) { flash((e as Error).message || 'Could not load lyrics'); }
    finally { setBusy(''); }
  }

  async function saveLyrics() {
    if (!editing) return;
    setBusy(`${editing.id}:savelyrics`);
    try { await api.patch(`/songs/${editing.id}/lyrics`, { title: editing.title, body: editing.body }); flash('Lyrics saved.'); setEditing(null); }
    catch (e) { flash((e as Error).message || 'Save failed'); }
    finally { setBusy(''); }
  }

  async function openDownloads(s: SongRow) {
    setBusy(`${s.id}:dl`);
    try {
      const r = await api.get<{ files: DownloadFile[] }>(`/songs/${s.id}/download`);
      setDownloads({ id: s.id, files: r.files ?? [] });
    } catch (e) { flash((e as Error).message || 'Could not load files'); }
    finally { setBusy(''); }
  }

  if (songs.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
        No songs yet. Head to <span className="text-afrobrand-400">Create</span> and make one.
      </div>
    );
  }

  return (
    <div className="mt-8">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur">{toast}</div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {songs.map((s) => (
          <div key={s.id} className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
            <div className="aspect-square w-full bg-slate-800">
              {s.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.coverUrl} alt={s.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center font-display text-5xl text-slate-700">♪</div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="font-display text-lg leading-tight">{s.title}{s.versionLabel ? <span className="ml-1 text-xs text-slate-500">· {s.versionLabel}</span> : null}</div>
                <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {s.artist} · {s.genre.replace('_', ' ')}{s.bpm ? ` · ${s.bpm} bpm` : ''}{s.stemCount ? ` · ${s.stemCount} stems` : ''}
              </div>
              {s.audioUrl ? (
                <audio controls className="mt-3 w-full" src={s.audioUrl} />
              ) : (
                <div className="mt-3 text-xs text-slate-600">No audio rendered yet.</div>
              )}

              {/* Action bar — the workstation */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Action label="Download" icon={<Download className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'dl')} onClick={() => void openDownloads(s)} />
                <Action label="Lyrics" icon={<FileText className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'lyrics')} onClick={() => void openLyrics(s)} />
                <Action label="Re-master" icon={<Wand2 className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'master')} onClick={() => void remaster(s)} />
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">
                  {openId === s.id ? 'Less' : 'More'}
                </button>
              </div>
              {openId === s.id && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2">
                  <Action label="Instrumental" icon={<Music2 className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'instrumental')} onClick={() => void separate(s, 'instrumental')} />
                  <Action label="Stems" icon={<Layers className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'full')} onClick={() => void separate(s, 'full')} />
                  <Action label="Reuse beat" icon={<Recycle className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'reuse')} onClick={() => void reuseBeat(s)} />
                  <Action label="Duplicate" icon={<Copy className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'dup')} onClick={() => void duplicate(s)} />
                  <Action label="Rename" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void rename(s)} />
                  <Action label="Studio" icon={<Sliders className="h-3.5 w-3.5" />} onClick={() => router.push(`/projects/${s.projectId}`)} />
                  <button onClick={() => void remove(s.id)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10">
                    <Trash2 className="inline h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Lyric editor */}
      {editing && (
        <Modal onClose={() => setEditing(null)} title="Edit lyrics">
          <input
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="Title"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={16}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed"
            placeholder="[Hook]…"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="rounded-full border border-white/15 px-4 py-2 text-sm">Cancel</button>
            <button onClick={() => void saveLyrics()} disabled={isBusy(editing.id, 'savelyrics')} className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink">
              {isBusy(editing.id, 'savelyrics') ? 'Saving…' : 'Save lyrics'}
            </button>
          </div>
        </Modal>
      )}

      {/* Download list */}
      {downloads && (
        <Modal onClose={() => setDownloads(null)} title="Download">
          {downloads.files.length === 0 ? (
            <div className="text-sm text-slate-400">No downloadable files yet — render a master first.</div>
          ) : (
            <ul className="space-y-2">
              {downloads.files.map((f, i) => (
                <li key={i}>
                  <a href={f.url} download target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    <span>{f.label}</span>
                    <Download className="h-4 w-4 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function Action({ label, icon, onClick, busy }: { label: string; icon: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
