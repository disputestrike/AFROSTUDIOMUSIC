'use client';

/**
 * ALBUMS — each album is anchored to ONE song's sound. "Make the next track"
 * generates a fresh song INSIDE that lane (same voice, same flow, new story).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Disc3, Loader2, Plus, Trash2 } from 'lucide-react';

interface AlbumSong { id: string; title: string; status: string; projectId: string; audioUrl: string | null; isAnchor: boolean }
interface Album { id: string; title: string; anchorSongId: string | null; styleBrief: string | null; createdAt: string; songs: AlbumSong[] }

export default function AlbumsPage() {
  const api = useApi();
  const router = useRouter();
  const [albums, setAlbums] = useState<Album[] | null | 'error'>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500); };

  const load = useCallback(async () => {
    try { setAlbums(await api.get<Album[]>('/albums')); } catch { setAlbums('error'); }

  }, []);
  useEffect(() => { void load(); }, [load]);

  async function nextTrack(a: Album) {
    setBusy(a.id);
    try {
      const r = await api.post<{ jobId: string }>(`/albums/${a.id}/next`, {});
      flash('Writing + singing the next track in this album’s sound (2–4 min)…');
      for (let i = 0; i < 70; i++) {
        await new Promise((res) => setTimeout(res, 6000));
        const j = await api.get<{ status: string }>(`/jobs/${r.jobId}`);
        if (j.status === 'SUCCEEDED') { flash('New track landed — rendering finishes in the background. Refreshing…'); await load(); break; }
        if (j.status === 'FAILED') { flash('Couldn’t make that track — try again.'); break; }
      }
    } catch (e) { flash((e as Error).message.slice(0, 140)); }
    finally { setBusy(''); }
  }

  async function removeAlbum(a: Album) {
    if (!confirm(`Delete the album "${a.title}"? The songs stay in your catalog — only the album grouping is removed.`)) return;
    try { await api.del(`/albums/${a.id}`); await load(); flash('Album deleted.'); }
    catch (e) { flash(`Couldn’t delete: ${(e as Error).message.slice(0, 100)}`); }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur">{toast}</div>}
      <h1 className="flex items-center gap-3 font-display text-4xl"><Disc3 className="h-8 w-8 text-afrobrand-400" /> Albums</h1>
      <p className="mt-2 text-sm text-slate-400">
        An album holds <span className="text-slate-200">one sound</span>. Find a song you love in the Catalog → “Start an album from this” — then every next track keeps that voice and flow.
      </p>

      {albums === null && <div className="mt-10 text-sm text-slate-500">Loading…</div>}
      {albums === 'error' && (
        <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-sm text-red-300">
          Couldn&apos;t load albums — refresh in a moment.
        </div>
      )}
      {Array.isArray(albums) && albums.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
          No albums yet. Go to the <button onClick={() => router.push('/catalog')} className="text-afrobrand-400 hover:underline">Catalog</button>, open “More” on a song you love, and hit <span className="text-slate-300">Start an album from this</span>.
        </div>
      )}

      {Array.isArray(albums) && albums.map((a) => (
        <div key={a.id} className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-2xl">{a.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{a.songs.length} track{a.songs.length === 1 ? '' : 's'}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void nextTrack(a)}
                disabled={busy === a.id}
                className="flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
              >
                {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {busy === a.id ? 'Making the next track…' : 'Make the next track'}
              </button>
              <button onClick={() => void removeAlbum(a)} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10" title="Delete album">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {a.songs.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                <span className="w-6 shrink-0 text-center text-xs text-slate-500">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">
                    {s.title} {s.isAnchor && <span className="ml-1 rounded-full bg-afrobrand-500/15 px-2 py-0.5 text-[10px] text-afrobrand-300">ANCHOR — the sound</span>}
                  </div>
                  {s.audioUrl ? <audio controls preload="none" className="mt-1.5 w-full" src={s.audioUrl} /> : <div className="mt-1 text-xs text-slate-600">rendering…</div>}
                </div>
                <button onClick={() => router.push(`/projects/${s.projectId}`)} className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">Studio</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
