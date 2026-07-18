/**
 * CLAUDE-POWERED STUDIO CHAT — the co-producer brain runs on Claude.
 *
 * Benjamin: "the chat is weak — use Claude for the chat too." The tool-calling
 * conversation (deciding which labs to run, talking back to the artist) now
 * runs on Claude's tool-use API instead of GPT, with the SAME interface as the
 * OpenAI chatWithTools so the route is a drop-in swap. Falls back to OpenAI in
 * the caller when no Anthropic key is set.
 */
import { anthropicKey, anthropicEnabled, anthropicUsable, ANTHROPIC_MODEL, ANTHROPIC_FALLBACK_MODEL } from './anthropic-client';
import { recordLlmUsage } from './llm-usage';
import { chatWithTools, type ChatMessage, type ChatTurn } from './providers/text';

export { anthropicEnabled as claudeChatAvailable };

type ChatOpts = {
  messages: ChatMessage[];
  tools: ReadonlyArray<{ type: 'function'; name: string; description: string; parameters: Record<string, unknown> }>;
  model?: string;
  temperature?: number;
};

/**
 * THE studio-chat brain: Claude first (stronger co-producer taste + tool use),
 * OpenAI as the never-fail fallback. Drop-in for chatWithTools.
 */
/** Why the last chat turn fell off Claude — surfaced on /debug/ai so a broken
 *  brain (billing, stale model id) is visible instead of silently degrading
 *  every conversation to the weak fallback. Getter (not a `let` export): CJS
 *  compilation would freeze a re-assigned export at its import-time value. */
let lastStudioChatClaudeError: string | null = null;
export const getLastStudioChatClaudeError = (): string | null => lastStudioChatClaudeError;

export async function studioChat(opts: ChatOpts): Promise<ChatTurn> {
  // anthropicUsable (not anthropicEnabled): once the auth breaker is open from a
  // rejected key, skip Claude here too instead of eating a 401 on every turn.
  if (anthropicUsable() && process.env.STUB_AI !== '1') {
    try {
      const turn = await chatWithToolsClaude(opts);
      lastStudioChatClaudeError = null;
      return turn;
    } catch (e) {
      // Claude overloaded / transient → fall back so the chat never dies — but
      // RECORD the reason; a swallowed billing 400 looked like "chat is weak".
      lastStudioChatClaudeError = `${new Date().toISOString()} ${(e as Error).message.slice(0, 300)}`;
    }
  }
  // OpenAI is the sole working brain in the bad-Claude-key setup, so a single
  // transient 429/network blip here dead-airs the whole chat turn ("hiccup").
  // Retry ONCE after a short backoff — but fail fast on a permanent error
  // (quota/billing/invalid key), where a retry only wastes the user's time.
  try {
    return await chatWithTools(opts);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/insufficient_quota|billing|invalid_api_key|401|403/i.test(msg)) throw e;
    await new Promise((r) => setTimeout(r, 1000));
    return chatWithTools(opts);
  }
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** OpenAI-shaped history → Anthropic messages + a hoisted system string. */
function toAnthropic(messages: ChatMessage[]): { system: string; msgs: Array<{ role: 'user' | 'assistant'; content: Block[] | string }> } {
  const systemParts: string[] = [];
  const msgs: Array<{ role: 'user' | 'assistant'; content: Block[] | string }> = [];

  const pushUserBlocks = (blocks: Block[]) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(...blocks);
    else msgs.push({ role: 'user', content: blocks });
  };

  for (const m of messages) {
    if (m.role === 'system') { systemParts.push(m.content); continue; }
    if (m.role === 'user') { pushUserBlocks([{ type: 'text', text: m.content || '(no content)' }]); continue; }
    if (m.role === 'tool') {
      // A tool result must be a user turn with a tool_result block.
      pushUserBlocks([{ type: 'tool_result', tool_use_id: m.tool_call_id ?? 'unknown', content: m.content || '{}' }]);
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || '{}'); } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      msgs.push({ role: 'assistant', content: blocks.length ? blocks : (m.content || '') });
    }
  }
  // Anthropic requires the first message to be a user turn.
  if (msgs.length && msgs[0]!.role !== 'user') msgs.unshift({ role: 'user', content: 'Begin.' });
  return { system: systemParts.join('\n\n'), msgs };
}

export async function chatWithToolsClaude(opts: {
  messages: ChatMessage[];
  tools: ReadonlyArray<{ type: 'function'; name: string; description: string; parameters: Record<string, unknown> }>;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<ChatTurn> {
  const key = anthropicKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const { system, msgs } = toAnthropic(opts.messages);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? ANTHROPIC_MODEL(),
        // Fable 5's adaptive thinking counts against max_tokens — 2k could be
        // eaten before the reply, truncating tool calls mid-arguments.
        max_tokens: 6_000,
        system,
        tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        messages: msgs,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`anthropic-chat ${res.status}: ${(await res.text()).slice(0, 250)}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    // Chat is the #2 judgment spender after songs — it must be VISIBLE in
    // /admin/economics like everything else. Real token counts from the API
    // (not estimates), Sonnet rates $3/$15 per MTok.
    recordLlmUsage({
      tier: 'judgment',
      task: 'studio-chat',
      brain: 'claude',
      ms: 0,
      estCostUsd: ((data.usage?.input_tokens ?? 0) * 3 + (data.usage?.output_tokens ?? 0) * 15) / 1_000_000,
    });
    // Fable-5 classifier refusal (200 + stop_reason "refusal") → retry once on
    // the documented fallback model so Studio Chat never dead-airs the user.
    if (data.stop_reason === 'refusal') {
      const current = opts.model ?? ANTHROPIC_MODEL();
      const fb = ANTHROPIC_FALLBACK_MODEL();
      if (current !== fb) { clearTimeout(timer); return chatWithToolsClaude({ ...opts, model: fb }); }
      throw new Error('anthropic-chat: refusal on fallback model too');
    }
    const content = data.content ?? [];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    const toolCalls = content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id ?? 'call', name: c.name ?? '', arguments: c.input ?? {} }));
    return toolCalls.length ? { text: text || undefined, toolCalls } : { text };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
