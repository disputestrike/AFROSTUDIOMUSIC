/**
 * A3-5 — CEREBRAS, the BULK brain (OpenAI-compatible chat completions).
 *
 * Used ONLY for tier:'bulk' work (radar craft extraction, gloss/classification,
 * caption drafting, internal summaries). Judgment work — lyrics, hooks, A&R,
 * anything user-facing creative — NEVER routes here (the weak-fallback lesson
 * is law). One org, Developer tier; CEREBRAS_API_KEYS accepts a comma list for
 * concurrency WITHIN that org — never multi-account free-tier rotation (same
 * ToS-fragile dependency class the wall exists to prevent).
 */

let keyCursor = 0;
/** All configured Cerebras keys (comma list). Accept common env spellings (the
 *  elevenKey lesson): a naming mismatch on Railway must never silently disable
 *  the bulk brain. Operator note: provision as many keys as you have — the more
 *  keys, the less any single one is rate-limited; how you source them is your
 *  provisioning call (paid concurrency, or additional keys). */
export function cerebrasKeys(): string[] {
  return (process.env.CEREBRAS_API_KEYS ?? process.env.CEREBRAS_API_KEY ?? process.env.CEREBRAS_KEY ?? process.env.CEREBRASAI_API_KEY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
export function cerebrasKey(): string | undefined {
  const list = cerebrasKeys();
  if (!list.length) return undefined;
  return list[keyCursor++ % list.length];
}

export const cerebrasEnabled = (): boolean => !!cerebrasKey();
export const CEREBRAS_MODEL = (): string => process.env.CEREBRAS_MODEL ?? 'gpt-oss-120b';

// Approximate published rates for gpt-oss-120b class models (per 1M tokens).
// Stated as ASSUMPTIONS on /admin/economics — not billing truth.
const IN_PER_M = 0.35;
const OUT_PER_M = 0.75;

function extractJson(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) return fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

export interface CerebrasUsage { inTokens: number; outTokens: number; estCostUsd: number }
export let lastCerebrasUsage: CerebrasUsage | null = null;

async function cerebrasCall<T>(key: string, opts: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CEREBRAS_MODEL(),
        max_tokens: opts.maxTokens ?? 2_000,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      // 400 = a bad request body — the SAME for every key, so don't waste the
      // rotation on it. Everything else (429 rate limit, 401 bad key, 5xx,
      // network) is per-key and retryable on the next key.
      const err = Object.assign(new Error(`cerebras ${res.status}: ${body}`), { status: res.status, retryable: res.status !== 400 });
      throw err;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = data.choices?.[0]?.message?.content ?? '';
    lastCerebrasUsage = {
      inTokens: data.usage?.prompt_tokens ?? 0,
      outTokens: data.usage?.completion_tokens ?? 0,
      estCostUsd: ((data.usage?.prompt_tokens ?? 0) * IN_PER_M + (data.usage?.completion_tokens ?? 0) * OUT_PER_M) / 1_000_000,
    };
    return JSON.parse(extractJson(text)) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bulk generation on Cerebras with KEY ROTATION + RETRY (owner 2026-07-13: "we
 * should round-robin multiple keys so we can never hit rate limits"). A 429 (or
 * any per-key failure — bad key, 5xx, network, timeout) rotates to the NEXT key
 * and retries; only when EVERY key fails does it throw and let the caller ladder
 * up. With several keys a rate limit is invisible, so bulk work stays on Cerebras
 * (cheap + fast) and never even reaches the OpenAI/Claude fallback. A 400 (bad
 * request) is not retried — it would fail identically on every key.
 */
export async function cerebrasJson<T>(opts: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<T> {
  const keys = cerebrasKeys();
  if (!keys.length) throw new Error('CEREBRAS_API_KEY missing');
  const start = keyCursor++; // rotate the starting key for load spread
  let lastErr: unknown;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length]!;
    try {
      return await cerebrasCall<T>(key, opts);
    } catch (err) {
      lastErr = err;
      const retryable = (err as { retryable?: boolean }).retryable;
      if (retryable === false) throw err; // 400: same for every key — stop.
      if (i < keys.length - 1) console.warn(`[cerebras] key ${i + 1}/${keys.length} failed (${(err as Error).message.slice(0, 80)}) — rotating to next key`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('cerebras: all keys failed');
}

/**
 * Live health check: ping EVERY configured key with the real model and report
 * which work (owner 2026-07-13: "make sure ALL cerebras are working and with the
 * right model"). Surfaced on /debug/ai so the operator can verify at a glance.
 */
export async function cerebrasHealth(): Promise<{
  model: string; keyCount: number; allOk: boolean;
  keys: Array<{ index: number; ok: boolean; error?: string }>;
}> {
  const keys = cerebrasKeys();
  const model = CEREBRAS_MODEL();
  const results: Array<{ index: number; ok: boolean; error?: string }> = [];
  for (let i = 0; i < keys.length; i++) {
    try {
      await cerebrasCall<{ ok?: boolean }>(keys[i]!, { system: 'Reply with JSON {"ok":true} only.', user: 'ping', maxTokens: 50, timeoutMs: 15_000 });
      results.push({ index: i + 1, ok: true });
    } catch (e) {
      results.push({ index: i + 1, ok: false, error: (e as Error).message.slice(0, 140) });
    }
  }
  return { model, keyCount: keys.length, allOk: keys.length > 0 && results.every((r) => r.ok), keys: results };
}
