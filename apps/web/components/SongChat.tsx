'use client';
/** TALK TO YOUR SONG — chat-driven editing. "add a fill at 1:20" / "1.1x faster"
 *  / "lay warm keys over it" / "cut 0:45 to 1:00" -> one op -> a NEW VERSION
 *  that auto-plays right here, with one-tap revert living in Versions. */
import { useRef, useEffect, useState } from 'react';
import { useApi } from '../lib/api';

interface Msg { who: 'you' | 'song'; text: string; audioUrl?: string }

export function SongChat({ songId, onNewVersion }: { songId: string; onNewVersion?: () => void }) {
  const api = useApi();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  // GPT/Claude-style stick-to-bottom: newest message auto-scrolls into view,
  // but never yanks the user down while they're scrolled up reading.
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    if (!stickRef.current) return;
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sections, setSections] = useState<Array<{ index: number; label: string; startS: number; endS: number }>>([]);
  // VERSION PICKER — by default every edit hits the CURRENT version; the artist
  // can aim an instruction at any earlier take ("do it to the original").
  const [versions, setVersions] = useState<Array<{ index: number; label: string; isCurrent?: boolean }>>([]);
  const [versionIndex, setVersionIndex] = useState<number | 'current'>('current');
  useEffect(() => {
    api.get<{ sections: typeof sections }>(`/songs/${songId}/sections`).then((r) => setSections(r.sections)).catch(() => {});
    api.get<{ audioVersions: Array<{ index: number; label: string; isCurrent?: boolean }> }>(`/songs/${songId}/versions`).then((r) => setVersions(r.audioVersions ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);
  function tellSong(text: string) { void send(text); }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'you', text }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; dispatched?: string | null; jobId?: string | null; talkingTo?: string }>(`/songs/${songId}/chat`, { message: text, ...(versionIndex !== 'current' ? { versionIndex } : {}) });
      setMsgs((m) => [...m, { who: 'song', text: r.reply }]);
      if (r.jobId) {
        setMsgs((m) => [...m, { who: 'song', text: 'Working on it…' }]);
        for (let i = 0; i < 90; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          try {
            const j = await api.get<{ status: string; errorJson?: { message?: string } | null; outputJson?: { url?: string; label?: string; note?: string } }>(`/jobs/${r.jobId}`);
            if (j.status === 'SUCCEEDED') {
              const url = j.outputJson?.url;
              setMsgs((m) => [...m.slice(0, -1), { who: 'song', text: `Done — ${j.outputJson?.label ?? r.dispatched}. This is the new current version (revert lives in Versions).`, audioUrl: url }]);
              onNewVersion?.();
              break;
            }
            if (j.status === 'FAILED') { setMsgs((m) => [...m.slice(0, -1), { who: 'song', text: `That edit failed — ${j.errorJson?.message ?? 'no reason recorded'}.` }]); break; }
          } catch { /* blip — keep polling */ }
        }
      }
    } catch (e) {
      setMsgs((m) => [...m, { who: 'song', text: (e as Error).message }]);
    }
    setBusy(false);
  }

  return (
    <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-300">Talk to this song <span className="font-normal text-slate-500">— “add a fill at 1:20” · “move the hook earlier” · “reverb only on the vocal”</span></div>
        {versions.length > 1 && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            Talking to:
            <select
              value={versionIndex === 'current' ? 'current' : String(versionIndex)}
              onChange={(e) => setVersionIndex(e.target.value === 'current' ? 'current' : Number(e.target.value))}
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200"
            >
              <option value="current">Current (latest)</option>
              {versions.map((v) => (
                <option key={v.index} value={v.index}>{v.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {sections.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sections.map((sec) => (
            <span key={sec.index} className="flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300">
              <b>{sec.label}</b> {Math.floor(sec.startS / 60)}:{String(sec.startS % 60).padStart(2, '0')}
              <button title="move earlier" onClick={() => tellSong(`move section ${sec.index} to position ${Math.max(1, sec.index - 1)}`)} className="text-slate-500 hover:text-slate-200">◀</button>
              <button title="move later" onClick={() => tellSong(`move section ${sec.index} to position ${Math.min(sections.length, sec.index + 1)}`)} className="text-slate-500 hover:text-slate-200">▶</button>
              <button title="duplicate" onClick={() => tellSong(`duplicate section ${sec.index}`)} className="text-slate-500 hover:text-slate-200">⧉</button>
              <button title="fresh beat under this section's vocal" onClick={() => tellSong(`re-play section ${sec.index} with a fresh beat`)} className="text-slate-500 hover:text-slate-200">↻</button>
            </span>
          ))}
        </div>
      )}
      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} className="max-h-96 space-y-2 overflow-y-auto">
        {msgs.map((m, i) => (
          <div key={i} className={m.who === 'you' ? 'text-right' : ''}>
            <span className={`inline-block max-w-[85%] rounded px-2 py-1 text-xs ${m.who === 'you' ? 'bg-sky-900/50 text-sky-100' : 'bg-slate-800 text-slate-200'}`}>{m.text}</span>
            {m.audioUrl && <audio className="mt-1 w-full" controls autoPlay src={m.audioUrl} />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} placeholder="Tell the song what to change…" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200" />
        <button onClick={() => void send()} disabled={busy} className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50">{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
