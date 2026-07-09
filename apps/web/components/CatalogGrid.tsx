'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Trash2, Download, Wand2, FileText, Copy, Recycle, Pencil, Sliders, X, Loader2, Music2, Layers, TrendingUp, RefreshCw, Mic, Disc3, Sparkles, GitCompare } from 'lucide-react';
import { SunoBridge } from './SunoBridge';

interface HitPrediction {
  hitScore: number;
  viralScore: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  toMakeItBigger: string[];
  comparableLane: string;
  tiktokMoment: string | null;
}

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
  hitScore?: number | null;
  viralScore?: number | null;
  coverUrl: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  SKETCH: 'Sketch', DEMO: 'Demo', FULL: 'Full', MIXED: 'Mixed', MASTERED: 'Mastered', RELEASED: 'Released',
};

type DownloadFile = { label: string; url: string; kind: string; dl?: string };
type LyricVer = { body: string; title: string | null; at: string; label?: string };
interface VersionsResp {
  songId: string;
  versionLabel: string | null;
  hasBigger: boolean;
  audioVersions: Array<{ index: number; label: string; url: string; at: string; isCurrent?: boolean; dl?: string; canRevert?: boolean }>;
  lyricVersions: Array<{ label: string; title: string | null; body: string; at: string | null }>;
}

export default function CatalogGrid({ initial }: { initial: SongRow[] }) {
  const api = useApi();
  const router = useRouter();
  const [songs, setSongs] = useState<SongRow[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>(''); // `${id}:${action}`
  const [toast, setToast] = useState<string>('');
  const [editing, setEditing] = useState<{ id: string; lyricId?: string; title: string; body: string; versions?: LyricVer[] } | null>(null);
  const [downloads, setDownloads] = useState<{ id: string; files: DownloadFile[] } | null>(null);
  const [hit, setHit] = useState<{ title: string; p: HitPrediction } | null>(null);
  const [suno, setSuno] = useState<{ songId: string; projectId: string } | null>(null);
  const [compare, setCompare] = useState<{ title: string; loading: boolean; data?: VersionsResp } | null>(null);

  async function openCompare(s: SongRow) {
    setCompare({ title: s.title, loading: true });
    try {
      const data = await api.get<VersionsResp>(`/songs/${s.id}/versions`);
      setCompare({ title: s.title, loading: false, data });
    } catch (e) {
      flash((e as Error).message || 'Could not load versions');
      setCompare(null);
    }
  }

  // Make ANY prior take the current version, then refresh the modal + the card audio.
  async function revertAudio(index: number) {
    const data = compare?.data;
    if (!data) return;
    setBusy(`${data.songId}:revert${index}`);
    try {
      await api.post(`/songs/${data.songId}/versions/revert`, { index });
      flash('Reverted — that take is now the current version.');
      const fresh = await api.get<VersionsResp>(`/songs/${data.songId}/versions`);
      setCompare((c) => (c ? { ...c, data: fresh } : c));
      router.refresh(); // update the catalog card's current audio
    } catch (e) {
      flash((e as Error).message || 'Revert failed');
    } finally {
      setBusy('');
    }
  }

  // Kick off a Demucs instrumental for a SPECIFIC take (downloadable when it finishes).
  async function versionInstrumental(index: number) {
    const data = compare?.data;
    if (!data) return;
    setBusy(`${data.songId}:inst${index}`);
    try {
      await api.post(`/songs/${data.songId}/versions/instrumental`, { index });
      flash('Instrumental is separating — it’ll be downloadable from Download → stems shortly.');
    } catch (e) {
      flash((e as Error).message || 'Could not start instrumental');
    } finally {
      setBusy('');
    }
  }

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  const isBusy = (id: string, a: string) => busy === `${id}:${a}`;

  // Inline two-step confirm — native confirm() can be silently suppressed by
  // the browser ("prevent additional dialogs"), which made Delete LOOK broken.
  const [armedDelete, setArmedDelete] = useState('');
  async function remove(id: string) {
    if (armedDelete !== id) {
      setArmedDelete(id);
      setTimeout(() => setArmedDelete((cur) => (cur === id ? '' : cur)), 4000);
      return;
    }
    setArmedDelete('');
    const before = songs;
    setSongs((s) => s.filter((x) => x.id !== id));
    try {
      await api.del(`/songs/${id}`);
      flash('Deleted.');
    } catch (e) {
      // NEVER pretend: if the server refused, put the song back and say so —
      // a silently-failed delete is exactly the "it always comes back" bug.
      setSongs(before);
      flash(`Couldn’t delete: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  async function remaster(s: SongRow) {
    setBusy(`${s.id}:master`);
    try { await api.post(`/songs/${s.id}/master`, { preset: 'streaming_lufs_-14' }); flash('Re-master queued — refresh in ~1 min for the new master.'); }
    catch (e) { flash((e as Error).message || 'Master failed'); }
    finally { setBusy(''); }
  }

  async function makeItBigger(s: SongRow) {
    setBusy(`${s.id}:bigger`);
    try {
      const res = await api.post<{ whatChanged: string[] }>(`/songs/${s.id}/make-it-bigger`, {});
      // The old score no longer describes this song — clear it locally too
      // (the gate re-scores automatically once the new render lands).
      setSongs((prev) => prev.map((x) => (x.id === s.id ? { ...x, hitScore: null, viralScore: null, versionLabel: 'bigger (A&R notes applied)' } : x)));
      flash(`A&R notes implemented — re-singing the bigger version (auto-masters + re-scores). Changed: ${(res.whatChanged ?? []).slice(0, 2).join('; ') || 'see lyrics'}`);
    } catch (e) { flash((e as Error).message || 'Make-it-bigger failed'); }
    finally { setBusy(''); }
  }

  async function reuseBeat(s: SongRow) {
    setBusy(`${s.id}:reuse`);
    try {
      const r = await api.post<{ projectId: string; message?: string }>(`/songs/${s.id}/reuse-beat`, {});
      flash(r.message || 'Beat reused in a new song. Opening the studio…');
      setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
    } catch (e) { flash((e as Error).message || 'Reuse failed'); }
    finally { setBusy(''); }
  }

  // Reuse ONLY the lyrics into a fresh song (write a new beat under them).
  async function reuseLyrics(s: SongRow) {
    setBusy(`${s.id}:reuselyrics`);
    try {
      const r = await api.post<{ projectId: string; message?: string }>(`/songs/${s.id}/reuse-lyrics`, {});
      flash(r.message || 'Lyrics reused in a new song. Opening the studio…');
      setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
    } catch (e) { flash((e as Error).message || 'Reuse lyrics failed'); }
    finally { setBusy(''); }
  }

  // Reuse ONLY the clean instrumental — SEAMLESSLY. If the stems don't exist
  // yet, this orchestrates the whole chain itself: separate → wait → reuse.
  // The user clicks once; the studio does the work and narrates it.
  async function reuseInstrumental(s: SongRow) {
    setBusy(`${s.id}:reuseinst`);
    try {
      try {
        const r = await api.post<{ projectId: string; message?: string }>(`/songs/${s.id}/reuse-instrumental`, {});
        flash(r.message || 'Instrumental reused in a new song. Opening the studio…');
        setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
        return;
      } catch (e) {
        if (!/no_instrumental_stem/.test((e as Error).message)) throw e;
      }
      // No clean instrumental yet — make one first, then finish the job.
      flash('No clean instrumental yet — separating the vocals now (about a minute)…');
      const sep = await api.post<{ jobId: string }>(`/songs/${s.id}/stems`, { mode: 'instrumental' });
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const j = await api.get<{ status: string }>(`/jobs/${sep.jobId}`);
        if (j.status === 'SUCCEEDED') break;
        if (j.status === 'FAILED') throw new Error('Separation failed — try again in a moment.');
        if (i === 35) throw new Error('Separation is taking long — it will finish in the background; try Reuse instrumental again shortly.');
      }
      const r2 = await api.post<{ projectId: string; message?: string }>(`/songs/${s.id}/reuse-instrumental`, {});
      flash(r2.message || 'Clean instrumental extracted + reused in a new song. Opening the studio…');
      setTimeout(() => router.push(`/projects/${r2.projectId}`), 1400);
    } catch (e) { flash((e as Error).message.slice(0, 140)); }
    finally { setBusy(''); }
  }

  // Start an ALBUM anchored to this song's sound — every next track holds it.
  async function startAlbum(s: SongRow) {
    setBusy(`${s.id}:album`);
    try {
      const a = await api.post<{ id: string; title: string }>('/albums', { anchorSongId: s.id });
      flash(`Album started: “${a.title}”. Opening Albums…`);
      setTimeout(() => router.push('/albums'), 1200);
    } catch (e) { flash((e as Error).message.slice(0, 140)); }
    finally { setBusy(''); }
  }

  // Re-sing the song with its CURRENT (edited) lyrics — surgical edit → new take.
  async function resing(s: SongRow) {
    setBusy(`${s.id}:resing`);
    try {
      await api.post(`/songs/${s.id}/regenerate-beat`, {});
      flash('Re-singing with the current lyrics — refresh in ~1–2 min for the new version.');
    } catch (e) { flash((e as Error).message || 'Re-sing failed'); }
    finally { setBusy(''); }
  }

  async function duplicate(s: SongRow) {
    setBusy(`${s.id}:dup`);
    try { await api.post(`/songs/${s.id}/duplicate`, {}); flash('Duplicated. Refresh to see the copy.'); }
    catch (e) { flash((e as Error).message || 'Duplicate failed'); }
    finally { setBusy(''); }
  }

  async function willItHit(s: SongRow) {
    setBusy(`${s.id}:hit`);
    try {
      const p = await api.post<HitPrediction>(`/songs/${s.id}/hit-score`, {});
      setHit({ title: s.title, p });
    } catch (e) { flash((e as Error).message || 'A&R scout unavailable'); }
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
      const r = await api.get<{ lyric: { id: string; title?: string; body: string; versions?: LyricVer[] } | null }>(`/songs/${s.id}/lyrics`);
      setEditing({ id: s.id, lyricId: r.lyric?.id, title: r.lyric?.title ?? s.title, body: r.lyric?.body ?? '', versions: r.lyric?.versions ?? [] });
    } catch (e) { flash((e as Error).message || 'Could not load lyrics'); }
    finally { setBusy(''); }
  }

  // Revert the lyric to a saved prior take — the original is never lost.
  async function revertLyric(index: number) {
    if (!editing) return;
    setBusy(`${editing.id}:revert`);
    try {
      const r = await api.post<{ lyric: { title?: string; body: string; versions?: LyricVer[] }; needsRegeneration?: boolean; revertedTo?: string }>(`/songs/${editing.id}/lyrics/revert`, { index });
      setEditing({ ...editing, title: r.lyric.title ?? editing.title, body: r.lyric.body, versions: r.lyric.versions ?? [] });
      flash(`Reverted to ${r.revertedTo ?? 'that take'}.${r.needsRegeneration ? ' Use “Re-sing” to hear it.' : ''}`);
    } catch (e) { flash((e as Error).message || 'Revert failed'); }
    finally { setBusy(''); }
  }

  async function saveLyrics(andResing = false) {
    if (!editing) return;
    const id = editing.id;
    setBusy(`${id}:savelyrics`);
    try {
      const r = await api.patch<{ needsRegeneration?: boolean }>(`/songs/${id}/lyrics`, { title: editing.title, body: editing.body });
      setEditing(null);
      if (andResing) {
        flash('Lyrics saved — re-singing the song now…');
        await api.post(`/songs/${id}/regenerate-beat`, {});
        flash('Re-singing with your edits — refresh in ~1–2 min for the new version.');
      } else {
        flash(r.needsRegeneration ? 'Lyrics saved. Use “Re-sing” to hear the new version.' : 'Lyrics saved.');
      }
    } catch (e) { flash((e as Error).message || 'Save failed'); }
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
                <img src={s.coverUrl} alt={s.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
                <audio controls preload="none" className="mt-3 w-full" src={s.audioUrl} />
              ) : (
                <div className="mt-3 text-xs text-slate-600">No audio rendered yet.</div>
              )}

              {/* Action bar — the workstation */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Action label="Download" icon={<Download className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'dl')} onClick={() => void openDownloads(s)} />
                <Action label="Lyrics" icon={<FileText className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'lyrics')} onClick={() => void openLyrics(s)} />
                <Action label={s.hitScore != null ? `A&R ${s.hitScore}/100` : 'Will it hit?'} icon={<TrendingUp className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'hit')} onClick={() => void willItHit(s)} />
                {s.hitScore != null && <Action label="🚀 Make it bigger" busy={isBusy(s.id, 'bigger')} onClick={() => void makeItBigger(s)} />}
                {/bigger/i.test(s.versionLabel ?? '') && <Action label="⤢ Compare versions" icon={<GitCompare className="h-3.5 w-3.5" />} onClick={() => void openCompare(s)} />}
                <Action label="Re-master" icon={<Wand2 className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'master')} onClick={() => void remaster(s)} />
                <button
                  onClick={() => setSuno({ songId: s.id, projectId: s.projectId })}
                  title="Generate this in your own Suno account (best audio, your rights), then bring it back to master + score"
                  className="inline-flex items-center gap-1 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Take to Suno
                </button>
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">
                  {openId === s.id ? 'Less' : 'More'}
                </button>
              </div>
              {openId === s.id && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2">
                  <Action label="Re-sing (apply lyric edits)" icon={<RefreshCw className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'resing')} onClick={() => void resing(s)} />
                  <Action label="Instrumental" icon={<Music2 className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'instrumental')} onClick={() => void separate(s, 'instrumental')} />
                  <Action label="Stems" icon={<Layers className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'full')} onClick={() => void separate(s, 'full')} />
                  <Action label="Reuse beat" icon={<Recycle className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'reuse')} onClick={() => void reuseBeat(s)} />
                  <Action label="Reuse lyrics" icon={<FileText className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'reuselyrics')} onClick={() => void reuseLyrics(s)} />
                  <Action label="Reuse instrumental" icon={<Mic className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'reuseinst')} onClick={() => void reuseInstrumental(s)} />
                  <Action label="Start an album from this" icon={<Disc3 className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'album')} onClick={() => void startAlbum(s)} />
                  <Action label="Duplicate" icon={<Copy className="h-3.5 w-3.5" />} busy={isBusy(s.id, 'dup')} onClick={() => void duplicate(s)} />
                  <Action label="Rename" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void rename(s)} />
                  <Action label="Studio" icon={<Sliders className="h-3.5 w-3.5" />} onClick={() => router.push(`/projects/${s.projectId}`)} />
                  <button onClick={() => void remove(s.id)} className={`rounded-full border px-2.5 py-1 text-xs ${armedDelete === s.id ? 'border-red-500/60 bg-red-500/20 font-medium text-red-300' : 'border-white/10 bg-white/5 text-red-400 hover:bg-red-500/10'}`}>
                    <Trash2 className="inline h-3.5 w-3.5" /> {armedDelete === s.id ? 'Really delete?' : 'Delete'}
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
          {editing.versions && editing.versions.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <RefreshCw className="h-3 w-3 text-afrobrand-400" /> Version history — your original is always here
              </div>
              <ul className="space-y-1">
                {editing.versions.map((v, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`rounded-full px-1.5 py-0.5 ${v.label === 'original' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-400'}`}>
                      {v.label ?? `take ${editing.versions!.length - i}`}
                    </span>
                    <span className="truncate text-slate-500">{v.body.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 54)}…</span>
                    <button
                      onClick={() => void revertLyric(i)}
                      disabled={isBusy(editing.id, 'revert')}
                      className="ml-auto shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                    >
                      {isBusy(editing.id, 'revert') ? '…' : 'Revert'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Editing the words? “Save &amp; re-sing” re-records the vocal with your new lyrics and makes it the current version. “Save only” keeps the text edit without re-rendering. Every rewrite keeps your previous take above — “Revert” restores it (then Re-sing to hear it).</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button onClick={() => setEditing(null)} className="rounded-full border border-white/15 px-4 py-2 text-sm">Cancel</button>
            <button onClick={() => void saveLyrics(false)} disabled={isBusy(editing.id, 'savelyrics')} className="rounded-full border border-white/15 px-4 py-2 text-sm">
              {isBusy(editing.id, 'savelyrics') ? 'Saving…' : 'Save only'}
            </button>
            <button onClick={() => void saveLyrics(true)} disabled={isBusy(editing.id, 'savelyrics')} className="inline-flex items-center gap-1 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink">
              <RefreshCw className="h-3.5 w-3.5" /> {isBusy(editing.id, 'savelyrics') ? 'Working…' : 'Save & re-sing'}
            </button>
          </div>
        </Modal>
      )}

      {/* A&R hit prediction */}
      {hit && (
        <Modal onClose={() => setHit(null)} title={`A&R read — ${hit.title}`}>
          <div className="flex gap-4">
            <ScorePill label="HIT" value={hit.p.hitScore} />
            <ScorePill label="VIRAL" value={hit.p.viralScore} />
          </div>
          <p className="mt-3 text-sm text-slate-200">{hit.p.verdict}</p>
          {hit.p.comparableLane && <p className="mt-1 text-xs text-slate-400">Lane: {hit.p.comparableLane}</p>}
          {hit.p.tiktokMoment && <p className="mt-1 text-xs text-afrobrand-300">📱 TikTok moment: {hit.p.tiktokMoment}</p>}
          {hit.p.strengths?.length > 0 && (
            <div className="mt-3"><div className="text-xs font-medium text-emerald-300">Strengths</div><ul className="mt-1 list-disc pl-4 text-xs text-slate-300">{hit.p.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
          {hit.p.risks?.length > 0 && (
            <div className="mt-2"><div className="text-xs font-medium text-amber-300">Risks</div><ul className="mt-1 list-disc pl-4 text-xs text-slate-300">{hit.p.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
          {hit.p.toMakeItBigger?.length > 0 && (
            <div className="mt-2"><div className="text-xs font-medium text-afrobrand-300">To make it bigger</div><ul className="mt-1 list-disc pl-4 text-xs text-slate-300">{hit.p.toMakeItBigger.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          )}
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
                  <a href={f.dl ? api.fileHref(f.dl) : f.url} download target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                    <span>{f.label}</span>
                    <Download className="h-4 w-4 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {suno && (
        <SunoBridge
          songId={suno.songId}
          projectId={suno.projectId}
          onClose={() => setSuno(null)}
          onDone={() => flash('Suno file received — mastering + scoring. It updates here in ~1 min.')}
        />
      )}

      {compare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCompare(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-lg"><GitCompare className="h-4 w-4 text-afrobrand-400" /> Compare — {compare.title}</div>
              <button onClick={() => setCompare(null)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button>
            </div>
            {compare.loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading versions…</div>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-500">The original and each “bigger” take, side by side — play them, read them, and pick the one you like. Nothing was lost; the originals were just hidden behind the newest.</p>
                {/* Audio takes */}
                <div className="mb-4">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Audio</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {compare.data?.audioVersions.map((a, i) => (
                      <div key={i} className={`rounded-xl border p-2.5 ${a.label.includes('Original') ? 'border-white/10 bg-white/5' : 'border-afrobrand-500/30 bg-afrobrand-500/5'}`}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-200">{a.label}</span>
                          {a.isCurrent && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">current</span>}
                        </div>
                        <audio controls preload="none" src={a.url} className="w-full" />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <a
                            href={api.fileHref(a.dl ?? `/songs/${compare.data!.songId}/file?type=version&index=${a.index}`)}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                          {a.canRevert && (
                            <Action
                              label={isBusy(compare.data!.songId, `revert${a.index}`) ? 'Reverting…' : 'Make current'}
                              icon={<RefreshCw className="h-3.5 w-3.5" />}
                              onClick={() => void revertAudio(a.index)}
                              busy={isBusy(compare.data!.songId, `revert${a.index}`)}
                            />
                          )}
                          <Action
                            label={isBusy(compare.data!.songId, `inst${a.index}`) ? 'Starting…' : 'Instrumental'}
                            icon={<Music2 className="h-3.5 w-3.5" />}
                            onClick={() => void versionInstrumental(a.index)}
                            busy={isBusy(compare.data!.songId, `inst${a.index}`)}
                          />
                        </div>
                      </div>
                    ))}
                    {!compare.data?.audioVersions.length && <div className="text-xs text-slate-500">No audio takes found.</div>}
                  </div>
                </div>
                {/* Lyric takes */}
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Lyrics</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {compare.data?.lyricVersions.map((l, i) => (
                      <div key={i} className={`rounded-xl border p-2.5 ${/original/i.test(l.label) ? 'border-white/10 bg-white/5' : 'border-afrobrand-500/30 bg-afrobrand-500/5'}`}>
                        <div className="mb-1 text-xs font-medium text-slate-200">{l.label}{l.title ? ` · ${l.title}` : ''}</div>
                        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{l.body}</pre>
                      </div>
                    ))}
                    {(compare.data?.lyricVersions.length ?? 0) < 2 && <div className="text-xs text-slate-500">Only one lyric take is on record (the original text may predate version history — the audio original above is still here).</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'text-emerald-300' : value >= 60 ? 'text-afrobrand-300' : value >= 40 ? 'text-amber-300' : 'text-slate-400';
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-display text-3xl ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-600">/ 100</div>
    </div>
  );
}

function Action({ label, icon, onClick, busy }: { label: string; icon?: React.ReactNode; onClick: () => void; busy?: boolean }) {
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
