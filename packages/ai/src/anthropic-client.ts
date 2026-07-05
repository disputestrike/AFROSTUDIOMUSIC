/**
 * Anthropic (Claude) client — the A&R director / creative critic in the
 * multi-model pipeline. Raw fetch against the Messages API (no SDK) to keep
 * deps light, matching the rest of the codebase.
 *
 * Claude has no JSON mode, so we instruct it to return only JSON and parse the
 * text (stripping any accidental markdown fences).
 */

/** Accept common key spellings so a naming mismatch can't silently disable it. */
export function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined;
}

export function anthropicEnabled(): boolean {
  return !!anthropicKey();
}

export const ANTHROPIC_MODEL = (): string =>
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/** Diagnostic: make a tiny real call and surface the exact error (model, auth…). */
export async function anthropicPing(): Promise<{ ok: boolean; model: string; error?: string }> {
  const model = ANTHROPIC_MODEL();
  if (!anthropicEnabled()) return { ok: false, model, error: 'no ANTHROPIC_API_KEY' };
  try {
    await claudeJson<{ ok: boolean }>({ system: 'Reply with JSON {"ok":true} only.', user: 'ping', maxTokens: 20, temperature: 0 });
    return { ok: true, model };
  } catch (e) {
    return { ok: false, model, error: (e as Error).message.slice(0, 300) };
  }
}

function extractJson(text: string): string {
  // Strip ```json ... ``` fences if present, else take the outermost {...}.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) return fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

export async function claudeJson<T>(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const key = anthropicKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? ANTHROPIC_MODEL(),
      max_tokens: opts.maxTokens ?? 4_000,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
  return JSON.parse(extractJson(text)) as T;
}
