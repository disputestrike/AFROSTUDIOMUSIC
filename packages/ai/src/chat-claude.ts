/**
 * CLAUDE-POWERED STUDIO CHAT — the co-producer brain runs on Claude.
 *
 * Benjamin: "the chat is weak — use Claude for the chat too." The tool-calling
 * conversation (deciding which labs to run, talking back to the artist) now
 * runs on Claude's tool-use API instead of GPT, with the SAME interface as the
 * OpenAI chatWithTools so the route is a drop-in swap. Falls back to OpenAI in
 * the caller when no Anthropic key is set.
 */
import { anthropicKey, anthropicEnabled, ANTHROPIC_MODEL } from './anthropic-client';
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
export async function studioChat(opts: ChatOpts): Promise<ChatTurn> {
  if (anthropicEnabled() && process.env.STUB_AI !== '1') {
    try {
      return await chatWithToolsClaude(opts);
    } catch {
      // Claude overloaded / transient → fall back so the chat never dies.
    }
  }
  return chatWithTools(opts);
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
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? ANTHROPIC_MODEL(),
        max_tokens: 2_000,
        system,
        tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        messages: msgs,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`anthropic-chat ${res.status}: ${(await res.text()).slice(0, 250)}`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
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
