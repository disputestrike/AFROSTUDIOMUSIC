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

/**
 * Parse JSON, and if it's TRUNCATED (the model hit max_tokens mid-array — a
 * common cause of "Expected ',' or ']'"), salvage the complete prefix: keep
 * everything up to the last complete top-level element and close the brackets.
 * Turns a hard failure into "we got 6 of the 8 hooks" instead of losing the take.
 */
/**
 * LLMs returning long multi-line text (a full lyric body) often put LITERAL
 * newlines/tabs inside JSON string values — which is invalid JSON and makes
 * JSON.parse throw (the "empty lyric" bug: ~1 in 3 lyrics came back blank).
 * This escapes raw control chars that appear INSIDE strings so the JSON parses.
 */
function escapeRawControlChars(raw: string): string {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') { out += c; inStr = false; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      out += c;
      continue;
    }
    if (c === '"') inStr = true;
    out += c;
  }
  return out;
}

function parseJsonLoose<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // First: literal control chars inside strings (the common long-text failure).
    try {
      return JSON.parse(escapeRawControlChars(raw)) as T;
    } catch { /* fall through to bracket salvage */ }
    // Walk the string tracking string/escape + bracket depth; remember the last
    // index where depth returned to a safe "between elements" state.
    const src = escapeRawControlChars(raw);
    let depth = 0, inStr = false, esc = false, lastGood = -1;
    const stack: string[] = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); depth++; }
      else if (c === '}' || c === ']') { stack.pop(); depth--; if (depth >= 0) lastGood = i; }
      else if (c === ',' && depth > 0) lastGood = i - 1; // safe cut before a dangling comma
    }
    if (lastGood > 0) {
      let candidate = src.slice(0, lastGood + 1).replace(/,\s*$/, '');
      // Close whatever is still open, innermost-first.
      const open: string[] = [];
      let s2 = false, e2 = false, d = 0;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i]!;
        if (s2) { if (e2) e2 = false; else if (c === '\\') e2 = true; else if (c === '"') s2 = false; continue; }
        if (c === '"') s2 = true;
        else if (c === '{') open.push('}');
        else if (c === '[') open.push(']');
        else if (c === '}' || c === ']') open.pop();
        void d;
      }
      candidate += open.reverse().join('');
      return JSON.parse(candidate) as T;
    }
    throw new Error('unparseable JSON (no salvageable prefix)');
  }
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

  // Retry on transient overload/timeout — Claude 529s under load. With OpenAI
  // billing exhausted, Claude is the only brain, so we try harder (3 attempts,
  // growing backoff) before giving up rather than bounce to a dead fallback.
  for (let attempt = 0; attempt < 3; attempt++) {
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
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2)); continue; } // 1.5s, 6s
        throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
      return parseJsonLoose<T>(extractJson(text));
    } catch (e) {
      clearTimeout(timer);
      const msg = (e as Error).message;
      // Abort/timeout or transient network → retry with growing backoff.
      if (attempt < 2 && /aborted|timeout|ECONNRESET|fetch failed|network/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('anthropic: exhausted retries');
}
