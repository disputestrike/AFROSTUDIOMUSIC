'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { ArtifactCard } from './ArtifactCard';
import { Send, Loader2, Mic, Plus, MessageSquare, Play, RotateCcw, Trash2, Sparkles, Headphones } from 'lucide-react';

const ACTIVE_THREAD_KEY = 'afrohit.activeThread';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolOutput?: unknown;
}

interface ThreadRow {
  id: string;
  title: string | null;
  updatedAt: string;
}

const QUICK_ACTIONS: Array<{ label: string; icon: React.ReactNode; prompt: string }> = [
  { label: 'Continue', icon: <Play className="h-3.5 w-3.5" />, prompt: 'Continue to the next step.' },
  { label: 'Regenerate', icon: <RotateCcw className="h-3.5 w-3.5" />, prompt: 'Regenerate that — give me fresh options.' },
];

// SpeechRecognition is vendor-prefixed on some browsers.
type SR = { start: () => void; stop: () => void; onresult: ((e: unknown) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };
function getSpeechRecognition(): SR | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export default function StudioChat({ projectId }: { projectId?: string }) {
  const api = useApi();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [micAvailable, setMicAvailable] = useState(false); // set after mount → no SSR mismatch
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<SR | null>(null);
  const listenRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stage]);

  async function loadThreads() {
    try {
      setThreads(await api.get<ThreadRow[]>('/chat/threads'));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    void loadThreads();
    setMicAvailable(!!getSpeechRecognition());
    // Persistent chat: resume the last session on return so leaving and coming
    // back never restarts the conversation — the context stays safe.
    const saved = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_THREAD_KEY) : null;
    if (saved) void openThread(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the active thread so navigation away/back continues it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (threadId) localStorage.setItem(ACTIVE_THREAD_KEY, threadId);
  }, [threadId]);

  async function openThread(id: string) {
    setBusy(true);
    try {
      const t = await api.get<{ id: string; messages: Array<Record<string, unknown>> }>(`/chat/threads/${id}`);
      setThreadId(t.id);
      setMessages(
        (t.messages ?? []).map((m, i) => ({
          id: `${id}-${i}`,
          role: (m.role as Message['role']) ?? 'assistant',
          content: String(m.content ?? ''),
          toolName: (m.toolName as string) ?? undefined,
          toolOutput: m.toolOutput ?? undefined,
        }))
      );
    } catch {
      // Saved thread is gone (deleted) — drop the stale pointer, start fresh.
      if (typeof window !== 'undefined') localStorage.removeItem(ACTIVE_THREAD_KEY);
      setThreadId(null);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    setDraft('');
    if (typeof window !== 'undefined') localStorage.removeItem(ACTIVE_THREAD_KEY);
  }

  // 🎧 Listen: upload a track → the chat brain analyzes it and creates in that vibe.
  async function onListenFile(file: File) {
    if (uploading || busy) return;
    setUploading(true);
    try {
      const { publicUrl } = await api.uploadToStorage(file, 'reference');
      await sendText(`Listen to this track and make a fresh original in that vibe — or make it better. Never copy it. Reference: ${publicUrl}`);
    } catch (e) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: `Couldn't upload that track: ${(e as Error).message}` }]);
    } finally {
      setUploading(false);
    }
  }

  async function deleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    setThreads((t) => t.filter((x) => x.id !== id));
    if (id === threadId) newChat();
    try {
      await api.del(`/chat/threads/${id}`);
    } catch {
      void loadThreads();
    }
  }

  async function sendText(text: string) {
    if (!text.trim() || busy) return;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: text }]);
    setDraft('');
    setBusy(true);
    setStage('thinking');
    let createdThread = false;
    try {
      await api.postStream(
        '/chat/messages/stream',
        { threadId: threadId ?? undefined, projectId, content: text, autopilot },
        (evt) => {
          switch (evt.type) {
            case 'thread':
              if (!threadId) {
                setThreadId(String(evt.threadId));
                createdThread = true;
              }
              break;
            case 'stage':
              setStage(String(evt.stage));
              break;
            case 'tool_start':
              setMessages((m) => [
                ...m,
                { id: `t-${Date.now()}-${Math.random()}`, role: 'tool', content: '', toolName: String(evt.name), toolOutput: { pending: true } },
              ]);
              break;
            case 'tool_result':
              setMessages((m) => {
                const idx = [...m].reverse().findIndex(
                  (msg) => msg.role === 'tool' && msg.toolName === evt.name && (msg.toolOutput as { pending?: boolean })?.pending
                );
                if (idx === -1) return m;
                const real = m.length - 1 - idx;
                const copy = [...m];
                copy[real] = { ...copy[real]!, toolOutput: evt.output };
                return copy;
              });
              break;
            case 'assistant':
              setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: String(evt.text ?? '') }]);
              break;
            case 'error':
              setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: `Something broke: ${evt.message}` }]);
              break;
          }
        }
      );
    } catch (err) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: `Something broke: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
      setStage(null);
      if (createdThread) void loadThreads();
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getSpeechRecognition();
    if (!rec) return;
    rec.lang = 'en-NG';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: unknown) => {
      const ev = e as { results: ArrayLike<ArrayLike<{ transcript: string }>> };
      let text = '';
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i]![0]!.transcript;
      setDraft(text);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      {/* History rail */}
      <aside className="flex flex-col border-r border-slate-800 bg-slate-950/60">
        <button
          onClick={newChat}
          className="m-3 flex items-center justify-center gap-2 rounded-xl bg-afrobrand-500 px-3 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400"
        >
          <Plus className="h-4 w-4" /> New session
        </button>
        <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-slate-500">History</div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {threads.length === 0 && <div className="px-2 py-3 text-xs text-slate-600">No sessions yet.</div>}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => void openThread(t.id)}
              className={cn(
                'group mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-xs',
                t.id === threadId ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900'
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">{t.title || 'Untitled session'}</span>
              <button
                onClick={(e) => void deleteThread(t.id, e)}
                title="Delete session"
                className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat column */}
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && (
            <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
              <div className="mb-1 font-display text-2xl text-slate-100">Ship <span className="text-gradient">your</span> Afrobeats.</div>
              <div className="mb-3 text-slate-400">Bring your voice — the studio produces around it, masters it, and hands you a rights-clean release + a clip to post.</div>
              <ul className="space-y-2 text-slate-400">
                <li>&ldquo;Upload my beat and finish the whole song around it.&rdquo;</li>
                <li>&ldquo;Afro-fusion love song, 103 bpm, Pidgin/Yoruba, smooth Wizkid lane — take it all the way.&rdquo;</li>
                <li>&ldquo;Record my hook, produce it, master it, and make me a 9:16 clip to post.&rdquo;</li>
              </ul>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} onAction={(p) => void sendText(p)} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> {stage ?? 'working'}…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-slate-800 bg-slate-950/40 p-3">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={() => setAutopilot((v) => !v)}
                title="Auto-produce: run the whole pipeline from one prompt"
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                  autopilot
                    ? 'border-afrobrand-500 bg-afrobrand-500/20 text-afrobrand-300'
                    : 'border-slate-700 text-slate-400 hover:text-slate-200'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" /> Auto-produce {autopilot ? 'ON' : 'OFF'}
              </button>
              {messages.length > 0 &&
                QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => void sendText(a.prompt)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-afrobrand-500 hover:text-slate-100 disabled:opacity-50"
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
            </div>
            {autopilot && (
              <div className="mb-2 text-xs text-afrobrand-300/80">
                Autopilot on — one prompt runs the full pipeline (hooks → pick best → lyrics → beat → cover → bundle) without pausing.
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={listenRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onListenFile(e.target.files[0])}
              />
              <button
                onClick={() => listenRef.current?.click()}
                disabled={uploading || busy}
                title="Play a track — the AI listens and makes it (or a better version) in that vibe"
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-2xl border',
                  uploading ? 'animate-pulse border-afrobrand-500 bg-afrobrand-500/20 text-afrobrand-300' : 'border-slate-800 text-slate-400 hover:border-slate-600'
                )}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
              </button>
              {micAvailable && (
                <button
                  onClick={toggleMic}
                  title="Speak to the studio"
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-2xl border',
                    listening ? 'animate-pulse border-afrobrand-500 bg-afrobrand-500/20 text-afrobrand-300' : 'border-slate-800 text-slate-400 hover:border-slate-600'
                  )}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendText(draft);
                  }
                }}
                placeholder={listening ? 'Listening…' : 'What are we making today?'}
                rows={2}
                className="flex-1 resize-none rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-afrobrand-500"
              />
              <button
                onClick={() => void sendText(draft)}
                disabled={busy || !draft.trim()}
                className={cn(
                  'flex h-12 items-center justify-center rounded-2xl px-4',
                  busy || !draft.trim() ? 'bg-slate-800 text-slate-500' : 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400'
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m, onAction }: { m: Message; onAction?: (prompt: string) => void }) {
  if (m.role === 'tool') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <ArtifactCard toolName={m.toolName!} output={m.toolOutput} onAction={onAction} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'whitespace-pre-wrap rounded-2xl p-4 text-sm',
        m.role === 'user' ? 'ml-auto max-w-[80%] bg-afrobrand-500/15 text-slate-100' : 'mr-auto max-w-[85%] bg-slate-900 text-slate-200'
      )}
    >
      {m.content}
    </div>
  );
}
