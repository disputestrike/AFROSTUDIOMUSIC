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
export function cerebrasKey(): string | undefined {
  // Accept common env spellings (the elevenKey lesson): a naming mismatch on
  // Railway must never silently disable the bulk brain.
  const list = (process.env.CEREBRAS_API_KEYS ?? process.env.CEREBRAS_API_KEY ?? process.env.CEREBRAS_KEY ?? process.env.CEREBRASAI_API_KEY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

export async function cerebrasJson<T>(opts: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<T> {
  const key = cerebrasKey();
  if (!key) throw new Error('CEREBRAS_API_KEY missing');
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
    if (!res.ok) throw new Error(`cerebras ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
