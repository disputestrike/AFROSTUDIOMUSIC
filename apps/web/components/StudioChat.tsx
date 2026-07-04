'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { ArtifactCard } from './ArtifactCard';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolOutput?: unknown;
  artifactRefs?: Array<{ kind: string; id: string }>;
}

export default function StudioChat({ projectId }: { projectId?: string }) {
  const api = useApi();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!draft.trim() || busy) return;
    const userMsg: Message = { id: `local-${Date.now()}`, role: 'user', content: draft };
    setMessages((m) => [...m, userMsg]);
    setDraft('');
    setBusy(true);
    try {
      // Streaming endpoint — tool calls and the final summary render live as
      // the server works through them, instead of one blocking wait.
      await api.postStream(
        '/chat/messages/stream',
        { threadId: threadId ?? undefined, projectId, content: userMsg.content },
        (evt) => {
          switch (evt.type) {
            case 'thread':
              if (!threadId) setThreadId(String(evt.threadId));
              break;
            case 'tool_start':
              setMessages((m) => [
                ...m,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'tool',
                  content: '',
                  toolName: String(evt.name),
                  toolOutput: { pending: true },
                },
              ]);
              break;
            case 'tool_result':
              setMessages((m) => {
                // Replace the matching pending tool card with its result.
                const idx = [...m].reverse().findIndex(
                  (msg) => msg.role === 'tool' && msg.toolName === evt.name &&
                    (msg.toolOutput as { pending?: boolean })?.pending
                );
                if (idx === -1) return m;
                const realIdx = m.length - 1 - idx;
                const copy = [...m];
                copy[realIdx] = { ...copy[realIdx]!, toolOutput: evt.output };
                return copy;
              });
              break;
            case 'assistant':
              setMessages((m) => [
                ...m,
                { id: `asst-${Date.now()}`, role: 'assistant', content: String(evt.text ?? '') },
              ]);
              break;
            case 'error':
              setMessages((m) => [
                ...m,
                { id: `err-${Date.now()}`, role: 'assistant', content: `Something broke: ${evt.message}` },
              ]);
              break;
          }
        }
      );
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Something broke: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
            <div className="mb-2 font-display text-lg text-slate-100">
              Tell the studio what you want to make.
            </div>
            <ul className="space-y-2 text-slate-400">
              <li>
                &ldquo;Afro-fusion love song, 103 bpm, Pidgin/Yoruba, smooth wizkid lane. Give me 20
                hooks.&rdquo;
              </li>
              <li>
                &ldquo;Score the hooks. Approve the best. Write the lyrics, clean version too.&rdquo;
              </li>
              <li>
                &ldquo;Make the beat with stems. Render demo vocal with my voice. Mix for TikTok.&rdquo;
              </li>
              <li>
                &ldquo;Cover art, golden hour Lagos. 15-second vertical video. Rights check.
                Release kit.&rdquo;
              </li>
            </ul>
          </div>
        )}

        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> working…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-950/40 p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="What are we making today?"
            rows={2}
            className="flex-1 resize-none rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-afrobrand-500"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !draft.trim()}
            className={cn(
              'flex h-12 items-center justify-center rounded-2xl px-4',
              busy || !draft.trim()
                ? 'bg-slate-800 text-slate-500'
                : 'bg-afrobrand-500 text-ink hover:bg-afrobrand-400'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  if (m.role === 'tool') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
        <div className="mb-2 font-mono text-slate-400">→ tool: {m.toolName}</div>
        <ArtifactCard toolName={m.toolName!} output={m.toolOutput} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        'rounded-2xl p-4 text-sm whitespace-pre-wrap',
        m.role === 'user' ? 'ml-auto max-w-[80%] bg-afrobrand-500/15 text-slate-100' : 'mr-auto max-w-[85%] bg-slate-900 text-slate-200'
      )}
    >
      {m.content}
    </div>
  );
}
