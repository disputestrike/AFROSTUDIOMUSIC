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

/**
 * AUTH CIRCUIT-BREAKER (diagnosis 2026-07-18). anthropicEnabled() is true for
 * ANY present key — including a deliberately-bad one. That made every judgment
 * call try Claude, eat a guaranteed 401, log a false "Claude degraded" line, and
 * only THEN ladder to OpenAI. When a real 401/403 comes back we open a short
 * cooldown so the hot path skips Claude entirely and goes straight to the OpenAI
 * flagship — killing the per-call latency and the misleading telemetry. It
 * self-heals: the cooldown expires (one probe retries), and any success clears
 * it immediately, so a fixed key comes back on its own. Auth ONLY — 429/529/
 * timeouts are transient and must NOT open it (Claude stays primary when it's
 * merely overloaded).
 */
let anthropicAuthDeadUntil = 0;
const AUTH_COOLDOWN_MS = 5 * 60_000;

/** True when Claude auth is not in an open cooldown (i.e. worth attempting). */
export function anthropicAuthLive(): boolean {
  return Date.now() >= anthropicAuthDeadUntil;
}

/** A key is present AND its auth is not currently circuit-open. The hot-path
 *  gate: generate.ts uses this (not anthropicEnabled) to decide whether to
 *  actually attempt Claude. */
export function anthropicUsable(): boolean {
  return anthropicEnabled() && anthropicAuthLive();
}

/** Milliseconds until the auth cooldown lifts (0 when live) — for /debug/ai. */
export function anthropicAuthCooldownMs(): number {
  return Math.max(0, anthropicAuthDeadUntil - Date.now());
}

/**
 * THE BRAIN — SONNET 5 by owner directive (2026-07-10). The Fable 5 default
 * burned a $20 top-up in under two songs (Mythos-class per-token pricing: the
 * Jul-09/10 console bars were the whole balance each day, vs Sonnet's $6-16
 * days before). Sonnet 5 is the price/quality point the studio runs on;
 * Cerebras takes the bulk tier. Set ANTHROPIC_MODEL=claude-fable-5 explicitly
 * only for a deliberate, budgeted flagship pass — never as the daily driver.
 * NOTE: a deploy env var OVERRIDES this default — if Railway carries a stale
 * ANTHROPIC_MODEL, the app silently runs that brain instead.
 */
export const ANTHROPIC_MODEL = (): string =>
  process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/**
 * Fable 5 ships with safety classifiers that can decline a request: the API
 * returns HTTP 200 with stop_reason "refusal" (not an error). Anthropic's
 * documented pattern is to retry the request on Claude Opus 4.8. This is rare
 * (<5% of sessions, and our prompts are songwriting) but unhandled it would
 * surface as a mystery empty/failed generation.
 */
export const ANTHROPIC_FALLBACK_MODEL = (): string =>
  process.env.ANTHROPIC_FALLBACK_MODEL ?? 'claude-opus-4-8';

/** Diagnostic: make a tiny real call and surface the exact error (model, auth…). */
export async function anthropicPing(): Promise<{ ok: boolean; model: string; error?: string }> {
  const model = ANTHROPIC_MODEL();
  if (!anthropicEnabled()) return { ok: false, model, error: 'no ANTHROPIC_API_KEY' };
  try {
    // Roomy cap: Fable 5's adaptive thinking counts against max_tokens — at 20
    // the ping "fails" on a healthy account and the dashboard cries wolf.
    await claudeJson<{ ok: boolean }>({ system: 'Reply with JSON {"ok":true} only.', user: 'ping', maxTokens: 500, _probe: true });
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
      let s2 = false, e2 = false;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i]!;
        if (s2) { if (e2) e2 = false; else if (c === '\\') e2 = true; else if (c === '"') s2 = false; continue; }
        if (c === '"') s2 = true;
        else if (c === '{') open.push('}');
        else if (c === '[') open.push(']');
        else if (c === '}' || c === ']') open.pop();
      }
      candidate += open.reverse().join('');
      return JSON.parse(candidate) as T;
    }
    throw new Error('unparseable JSON (no salvageable prefix)');
  }
}

/** Diagnostic: return Claude's RAW text + whether it parses, without the
 *  fallback chain — so we can see what actually breaks a generation. */
export async function claudeRaw(opts: { system: string; user: string; maxTokens?: number }): Promise<{ ok: boolean; status?: number; rawLength: number; rawPreview: string; parseOk: boolean; parseError?: string; parsedBodyLen?: number }> {
  const key = anthropicKey();
  if (!key) return { ok: false, rawLength: 0, rawPreview: '', parseOk: false, parseError: 'no key' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL(), max_tokens: opts.maxTokens ?? 4000, system: opts.system, messages: [{ role: 'user', content: opts.user }] }),
    });
    if (!res.ok) return { ok: false, status: res.status, rawLength: 0, rawPreview: (await res.text()).slice(0, 200), parseOk: false };
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
    const text = data.content?.map((c) => c.text ?? '').join('') ?? '';
    let parseOk = false, parseError: string | undefined, parsedBodyLen: number | undefined;
    try { const p = parseJsonLoose<{ body?: string }>(extractJson(text)); parseOk = true; parsedBodyLen = (p?.body ?? '').length; }
    catch (e) { parseError = (e as Error).message.slice(0, 120); }
    return { ok: true, status: res.status, rawLength: text.length, rawPreview: text.slice(0, 400), parseOk, parseError, parsedBodyLen, ...(data.stop_reason ? { stopReason: data.stop_reason } as never : {}) };
  } catch (e) {
    return { ok: false, rawLength: 0, rawPreview: (e as Error).message.slice(0, 150), parseOk: false };
  }
}

export async function claudeJson<T>(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Hard timeout (ms) so a hung/overloaded call fails fast instead of stalling
   *  a song the user is waiting on. Default 90s — Fable 5's adaptive thinking on
   *  our 10k-char fused briefs regularly needs more than the old Sonnet-era 55s. */
  timeoutMs?: number;
  /** internal: set on the one automatic retry after a max_tokens truncation. */
  _grew?: boolean;
  /** internal: a health probe (/debug/ai) — bypasses the auth breaker so the
   *  diagnostic always sees the REAL key status, never "circuit-open". */
  _probe?: boolean;
}): Promise<T> {
  const key = anthropicKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  // Auth breaker: a recent 401/403 opened a cooldown — skip the guaranteed-dead
  // call so the caller ladders to OpenAI immediately (probe calls bypass this).
  if (!opts._probe && !anthropicAuthLive()) {
    throw new Error('anthropic auth circuit-open: key was rejected recently — skipping until cooldown lifts');
  }
  const timeoutMs = opts.timeoutMs ?? 90_000;

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
        // 529 = Anthropic says "overloaded RIGHT NOW" — a third 90s attempt
        // rarely lands and the user is waiting (live incident 2026-07-16:
        // lyric writes took 7-8 minutes riding full retry budgets during an
        // Anthropic overload event; the healthy OpenAI flagship fallback sat
        // unused the whole time). One quick retry for 529, then ladder fast.
        const maxAttempts = res.status === 529 ? 2 : 3;
        if (attempt < maxAttempts - 1) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2)); continue; } // 1.5s, 6s
        throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) {
        // A rejected KEY (401) or forbidden (403) is not transient — open the
        // auth breaker so the next judgment calls skip Claude until it lifts.
        if (res.status === 401 || res.status === 403) {
          anthropicAuthDeadUntil = Date.now() + AUTH_COOLDOWN_MS;
        }
        throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      // A real success means auth is healthy — clear any open cooldown at once so
      // a fixed key resumes immediately rather than waiting out the timer.
      if (anthropicAuthDeadUntil) anthropicAuthDeadUntil = 0;
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
      // Fable-5 classifier refusal: HTTP 200 + stop_reason "refusal", no usable
      // body. Retry ONCE on the documented fallback (Opus 4.8) instead of
      // surfacing a fake parse failure. Guard prevents infinite recursion.
      if (data.stop_reason === 'refusal') {
        const current = opts.model ?? ANTHROPIC_MODEL();
        const fb = ANTHROPIC_FALLBACK_MODEL();
        if (current !== fb) return claudeJson<T>({ ...opts, model: fb });
        throw new Error('anthropic: refusal on fallback model too');
      }
      // TRUNCATION GUARD: stop_reason 'max_tokens' = the JSON got cut mid-emit
      // (thinking also counts against the cap on Fable 5). Without this, the
      // parse fails and generateJson silently falls to the billing-dead OpenAI —
      // the exact failure class of the old hooks-429 bug. Retry once, doubled.
      if (data.stop_reason === 'max_tokens' && !opts._grew) {
        const grown = Math.min((opts.maxTokens ?? 4_000) * 2, 16_000);
        return claudeJson<T>({ ...opts, maxTokens: grown, _grew: true });
      }
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
