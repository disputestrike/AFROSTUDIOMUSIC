'use client';
/** TALK TO YOUR SONG — chat-driven editing. "add a fill at 1:20" / "1.1x faster"
 *  / "lay warm keys over it" / "cut 0:45 to 1:00" -> one op -> a NEW VERSION
 *  that auto-plays right here, with one-tap revert living in Versions. */
import { useState } from 'react';
import { useApi } from '../lib/api';

interface Msg { who: 'you' | 'song'; text: string; audioUrl?: string }

export function SongChat({ songId, onNewVersion }: { songId: string; onNewVersion?: () => void }) {
  const api = useApi();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'you', text }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; dispatched?: string | null; jobId?: string | null }>(`/songs/${songId}/chat`, { message: text });
      setMsgs((m) => [...m, { who: 'song', text: r.reply }]);
      if (r.jobId) {
        setMsgs((m) => [...m, { who: 'song', text: 'Working on it…' }]);
        for (let i = 0; i < 90; i++) {
          await new Promise((res) => setTimeout(res, 4000));
          try {
            const j = await api.get<{ status: string; outputJson?: { url?: string; label?: string; note?: string } }>(`/jobs/${r.jobId}`);
            if (j.status === 'SUCCEEDED') {
              const url = j.outputJson?.url;
              setMsgs((m) => [...m.slice(0, -1), { who: 'song', text: `Done — ${j.outputJson?.label ?? r.dispatched}. This is the new current version (revert lives in Versions).`, audioUrl: url }]);
              onNewVersion?.();
              break;
            }
            if (j.status === 'FAILED') { setMsgs((m) => [...m.slice(0, -1), { who: 'song', text: 'That edit failed — try a different instruction.' }]); break; }
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
      <div className="mb-2 text-xs font-semibold text-slate-300">Talk to this song <span className="font-normal text-slate-500">— “add a fill at 1:20” · “move the hook earlier” · “reverb only on the vocal” · “open the vocal 0:45–1:00”</span></div>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {msgs.map((m, i) => (
          <div key={i} className={m.who === 'you' ? 'text-right' : ''}>
            <span className={`inline-block max-w-[85%] rounded px-2 py-1 text-xs ${m.who === 'you' ? 'bg-sky-900/50 text-sky-100' : 'bg-slate-800 text-slate-200'}`}>{m.text}</span>
            {m.audioUrl && <audio className="mt-1 w-full" controls autoPlay src={m.audioUrl} />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Tell the song what to change…" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200" />
        <button onClick={send} disabled={busy} className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50">{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
