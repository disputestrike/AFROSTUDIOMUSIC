'use client';

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { humanizeChatError, scrubVendorNames, type HumanChatError } from '@afrohit/shared';
import { ArtifactCard } from './ArtifactCard';
import { Send, Loader2, Mic, Plus, MessageSquare, Play, RotateCcw, Trash2, Sparkles, Headphones } from 'lucide-react';

const ACTIVE_THREAD_KEY = 'afrohit.activeThread';
import { cn, formatElapsed } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolOutput?: unknown;
  /** A failed step, already humanized — renders as a compact error card with one retry. */
  error?: HumanChatError;
}

interface ThreadRow {
  id: string;
  title: string | null;
  updatedAt: string;
}

const QUICK_ACTIONS: Array<{ label: string; icon: React.ReactNode; prompt: string }> = [
  { label: 'Continue', icon: <Play className="h-3.5 w-3.5" />, prompt: 'Continue to the next step.' },
  { label: 'Regenerate', icon: <RotateCcw className="h-3.5 w-3.5" />, prompt: 'Regenerate the current hooks — sharper versions in the SAME lane and concept. Keep what works, fix the weak lines, deepen the imagery, and tighten it. Do NOT switch to a different idea or start over.' },
];

// The compact status line speaks producer, not plumbing: server stages and
// tool names map to ONE human label. Only real, currently-running work is
// named — never a fake progress percentage (honesty law).
const TOOL_STAGE: Record<string, string> = {
  research_trends: 'Checking the charts',
  polish_brief: 'Shaping the brief',
  generate_hooks: 'Writing hooks',
  score_hooks: 'Scoring hooks',
  approve_hook: 'Locking the hook',
  reject_hook: 'Noting your taste',
  generate_lyrics: 'Writing the lyrics',
  create_beat_job: 'Starting the render',
  generate_cover_art: 'Starting the cover art',
  generate_video_storyboard: 'Drafting the video',
  render_video: 'Starting the video render',
  run_rights_check: 'Checking rights',
  create_release_kit: 'Bundling the release',
  analyze_audio: 'Listening to the track',
  run_drop: 'Producing the drop',
  master_song: 'Mastering',
  make_snippet: 'Cutting the snippet',
  list_beats: 'Checking your beats',
  list_catalog: 'Checking your catalog',
  set_release_rights: 'Saving the splits',
  predict_hit: 'Reading the record',
  forge_materials: 'Forging material',
  assemble_beat: 'Assembling the beat',
  make_material_beat: 'Building the beat from material',
  separate_stems: 'Splitting the stems',
  learn_lyrics: 'Studying the craft',
  show_data_lake: 'Reading what you taught me',
  request_approval: 'Asking for your sign-off',
};

function humanStage(stage: string): string {
  if (stage === 'thinking') return 'Thinking';
  if (stage === 'summarizing') return 'Wrapping up';
  const step = /^producing \(step (\d+)\)$/.exec(stage);
  if (step) return `Producing — step ${step[1]}`;
  return stage;
}

// If the stream goes fully silent for this long (the server heartbeats every
// 15s, so silence means the connection is actually dead), stop waiting and
// say so honestly instead of spinning forever.
const DEAD_AIR_MS = 90_000;

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
  const listRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => { if (stickRef.current) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })); });
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  // The nav is LOCKED on most recent: newest thread on top, rail snaps to top on change.
  useEffect(() => { navRef.current?.scrollTo({ top: 0 }); }, [threads.length]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [micAvailable, setMicAvailable] = useState(false); // set after mount → no SSR mismatch
  const [uploading, setUploading] = useState(false);
  const [resumeFailed, setResumeFailed] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<SR | null>(null);
  const listenRef = useRef<HTMLInputElement | null>(null);
  const lastSentRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stage]);

  // Real elapsed time on the status line — the render can take minutes and a
  // silent spinner reads as dead. One ticking number, no fake progress.
  useEffect(() => {
    if (!busy) { setElapsedS(0); return; }
    const started = Date.now();
    const timer = setInterval(() => setElapsedS(Math.floor((Date.now() - started) / 1000)), 1_000);
    return () => clearInterval(timer);
  }, [busy]);

  // Leaving the page kills the stream read (the queued work continues server-side).
  useEffect(() => () => { abortRef.current?.abort(); if (watchdogRef.current) clearTimeout(watchdogRef.current); }, []);

  async function loadThreads() {
    try {
      setThreads(
        (await api.get<ThreadRow[]>('/chat/threads')).sort((a, b) =>
          String((b as { updatedAt?: string; createdAt?: string }).updatedAt ?? (b as { createdAt?: string }).createdAt ?? '')
            .localeCompare(String((a as { updatedAt?: string; createdAt?: string }).updatedAt ?? (a as { createdAt?: string }).createdAt ?? ''))
        )
      );
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

  }, []);

  // Remember the active thread so navigation away/back continues it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (threadId) localStorage.setItem(ACTIVE_THREAD_KEY, threadId);
  }, [threadId]);

  async function openThread(id: string) {
    setBusy(true);
    setResumeFailed(null);
    try {
      const t = await api.get<{ id: string; messages: Array<Record<string, unknown>> }>(`/chat/threads/${id}`);
      setThreadId(t.id);
      setMessages(
        (t.messages ?? [])
          .map((m, i) => ({
            id: `${id}-${i}`,
            role: (m.role as Message['role']) ?? 'assistant',
            // Old rows predate the server-side scrub — clean them at render time.
            content: (m.role === 'assistant' ? scrubVendorNames : String)(String(m.content ?? '')),
            toolName: (m.toolName as string) ?? undefined,
            toolOutput: m.toolOutput ?? undefined,
          }))
          // Empty assistant turns (a failed summary) are noise, not history.
          .filter((m) => m.role !== 'assistant' || m.content.trim().length > 0)
      );
    } catch (e) {
      const msg = String((e as Error)?.message ?? '');
      if (/^40[34]\b/.test(msg)) {
        // Thread is truly gone (deleted elsewhere) — drop the stale pointer, start fresh.
        if (typeof window !== 'undefined') localStorage.removeItem(ACTIVE_THREAD_KEY);
        setThreadId(null);
      } else {
        // Transient failure (network/deploy/rate limit) — KEEP the pointer and
        // offer a retry instead of silently killing the session.
        setResumeFailed(id);
      }
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    setDraft('');
    setResumeFailed(null);
    if (typeof window !== 'undefined') localStorage.removeItem(ACTIVE_THREAD_KEY);
  }

  // 🎧 Listen: upload a track → the chat brain analyzes it and creates in that vibe.
  async function onListenFile(file: File) {
    if (uploading || busy) return;
    setUploading(true);
    try {
      const { publicUrl } = await api.uploadAudioDirect(file, 'reference');
      await sendText(`Listen to this track and make a fresh original in that vibe — or make it better. Never copy it. Reference: ${publicUrl}`);
    } catch (e) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: '', error: humanizeChatError(e as Error) }]);
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
    lastSentRef.current = text;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: text }]);
    setDraft('');
    setBusy(true);
    // Instant acknowledgment — the status line lights up the moment they hit
    // send, before any round-trip. Honest: the request IS in flight.
    setStage('On it');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const armWatchdog = () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => ctrl.abort(), DEAD_AIR_MS);
    };
    armWatchdog();
    let createdThread = false;
    try {
      await api.postStream(
        '/chat/messages/stream',
        { threadId: threadId ?? undefined, projectId, content: text, autopilot },
        (evt) => {
          armWatchdog(); // every event (incl. heartbeat pings) proves life
          switch (evt.type) {
            case 'ping':
              break;
            case 'thread':
              if (!threadId) {
                setThreadId(String(evt.threadId));
                createdThread = true;
              }
              break;
            case 'stage':
              setStage(humanStage(String(evt.stage)));
              break;
            case 'tool_start':
              // Internal steps live on the status line, never in the transcript —
              // no more dangling "running…" rows when a stream dies mid-step.
              setStage(TOOL_STAGE[String(evt.name)] ?? 'Working');
              break;
            case 'tool_result':
              if (typeof evt.name === 'string') {
                setMessages((m) => [
                  ...m,
                  { id: `t-${Date.now()}-${Math.random()}`, role: 'tool', content: '', toolName: String(evt.name), toolOutput: evt.output },
                ]);
              }
              break;
            case 'assistant': {
              const said = scrubVendorNames(String(evt.text ?? '')).trim();
              if (said) setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: said }]);
              break;
            }
            case 'error':
              setMessages((m) => [
                ...m,
                {
                  id: `e-${Date.now()}`,
                  role: 'assistant',
                  content: '',
                  error: {
                    text: typeof evt.message === 'string' && evt.message ? evt.message : 'Something went wrong with that one — try again.',
                    canRetry: evt.canRetry !== false,
                    ...(typeof evt.details === 'string' && evt.details ? { details: evt.details } : {}),
                  },
                },
              ]);
              break;
          }
        },
        { signal: ctrl.signal }
      );
    } catch (err) {
      const wasAborted = (err as Error)?.name === 'AbortError' || ctrl.signal.aborted;
      const human = wasAborted
        ? { text: 'The studio went quiet on that one — nothing came back. Try again.', canRetry: true }
        : humanizeChatError(err as Error);
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: '', error: human }]);
    } finally {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      abortRef.current = null;
      setBusy(false);
      setStage(null);
      if (createdThread) void loadThreads();
    }
  }

  function retryLast() {
    if (busy) return;
    const text = lastSentRef.current;
    if (text) void sendText(text);
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
    // Mobile: the fixed 240px rail would crush the chat — hide it below md
    // (threads still resume via localStorage; history is a desktop affordance).
    <div className="grid h-[calc(100dvh-88px)] min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[240px_1fr]">
      {/* History rail */}
      <aside className="hidden min-h-0 md:flex flex-col border-r border-slate-800 bg-slate-950/60">
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
      <div className="flex h-full min-h-0 flex-col">
        {/* stick-to-bottom lives on the MESSAGES pane — it was wired to the
            thread-history sidebar, so new messages scrolled the wrong element. */}
        <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          {resumeFailed && (
            <div className="mx-auto mb-3 flex max-w-3xl items-center gap-3 rounded-xl border border-amber-800/50 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-200">
              <span className="flex-1">Couldn&rsquo;t load your last session.</span>
              <button
                onClick={() => void openThread(resumeFailed)}
                className="flex items-center gap-1.5 rounded-full border border-amber-700/60 px-3 py-1 text-xs hover:bg-amber-900/40"
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}
          {messages.length === 0 && (
            <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
              <div className="mb-1 font-display text-2xl text-slate-100">Ship <span className="text-gradient">your</span> Afrobeats.</div>
              <div className="mb-3 text-slate-400">Say what you want — the studio builds it and hands you the result.</div>
              <ul className="space-y-2 text-slate-400">
                <li>&ldquo;Upload my beat and finish the whole song around it.&rdquo;</li>
                <li>&ldquo;Afro-fusion love song, 103 bpm, Pidgin/Yoruba, smooth Wizkid lane — take it all the way.&rdquo;</li>
                <li>&ldquo;Record my hook, produce it, master it, and make me a 9:16 clip to post.&rdquo;</li>
              </ul>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m) => (
              <BubbleBoundary key={m.id}>
                <MessageBubble m={m} onAction={(p) => void sendText(p)} onRetry={retryLast} />
              </BubbleBoundary>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{stage ?? 'Working'}…</span>
                {elapsedS >= 5 && <span className="text-xs tabular-nums text-slate-600">{formatElapsed(elapsedS)}</span>}
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
                Autopilot on — one prompt runs the full pipeline without pausing.
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={listenRef}
                type="file"
                accept="audio/*,audio/mpeg,.wav,.mp3,.m4a,.ogg,.flac,.mpeg,.mpg"
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

/** One failed step: a short human sentence, one retry, internals folded away. */
function ErrorCard({ error, onRetry }: { error: HumanChatError; onRetry?: () => void }) {
  return (
    <div className="mr-auto max-w-[85%] rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-200">
      <div>{error.text}</div>
      {(error.canRetry && onRetry) || error.details ? (
        <div className="mt-2 flex items-start gap-3">
          {error.canRetry && onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full border border-red-800/60 px-3 py-1 text-xs text-red-200 hover:bg-red-900/40"
            >
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
          {error.details && (
            <details className="min-w-0 text-[10px] text-red-300/50">
              <summary className="cursor-pointer select-none py-1">Details</summary>
              <div className="mt-1 whitespace-pre-wrap break-words">{error.details}</div>
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * PER-MESSAGE ERROR BOUNDARY — one malformed message (a bad saved thread row, an
 * unexpected tool payload) used to throw during render and take down the WHOLE
 * chat page ("The chat hit a snag"). Now a single bad bubble degrades to a quiet
 * placeholder and the rest of the conversation renders normally.
 */
class BubbleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="mx-auto max-w-3xl px-3 py-2 text-xs italic text-slate-500">
        (a message here couldn&rsquo;t display — your chat is safe)
      </div>
    ) : (
      this.props.children
    );
  }
}

function MessageBubble({ m, onAction, onRetry }: { m: Message; onAction?: (prompt: string) => void; onRetry?: () => void }) {
  if (m.error) return <ErrorCard error={m.error} onRetry={m.error.canRetry ? onRetry : undefined} />;
  if (m.role === 'tool') {
    // A failed tool renders as the SAME humanized error card — never the raw
    // machine string. Retry = ask the producer to rerun that one step.
    const out = m.toolOutput as { error?: unknown } | null | undefined;
    if (out && typeof out === 'object' && typeof out.error === 'string') {
      const human = humanizeChatError(out);
      return (
        <ErrorCard
          error={human}
          onRetry={human.canRetry && onAction ? () => onAction('Run that last step again.') : undefined}
        />
      );
    }
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
