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
  /** Hard timeout (ms) so a hung/overloaded call fails fast instead of stalling
   *  a song the user is waiting on. Default 55s. */
  timeoutMs?: number;
}): Promise<T> {
  const key = anthropicKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const timeoutMs = opts.timeoutMs ?? 55_000;

  // Retry once on transient overload/timeout — Claude 529s under load; a hung
  // call is worse than a fast fallback, so we bound it and try again briefly.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        // NB: Claude 5-family models deprecated `temperature` (sending it → 400).
        body: JSON.stringify({
          model: opts.model ?? ANTHROPIC_MODEL(),
          max_tokens: opts.maxTokens ?? 4_000,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
      return JSON.parse(extractJson(text)) as T;
    } catch (e) {
      clearTimeout(timer);
      const msg = (e as Error).message;
      // Abort/timeout or transient → retry once, then let the caller fall back.
      if (attempt === 0 && /aborted|timeout|ECONNRESET|fetch failed|network/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw e;
    }
  }
  throw new Error('anthropic: exhausted retries');
}
