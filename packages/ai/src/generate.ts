/**
 * Unified creative generation — CLAUDE IS THE BRAIN.
 *
 * Benjamin's call: Claude leads the creative work (hooks, lyrics, brief, vocal
 * arrangement) because it's stronger for Afro songwriting taste + coherence.
 * OpenAI stays as breadth/fallback so the pipeline never hard-fails.
 *
 * Order: STUB_AI (tests) → Claude (when ANTHROPIC key present) → OpenAI.
 * Claude has no JSON mode, so we append a strict JSON-only instruction and let
 * claudeJson strip fences / extract the object.
 */
import { claudeJson, anthropicEnabled } from './anthropic-client';
import { responsesJson } from './providers/text';
import { cerebrasJson, cerebrasEnabled, lastCerebrasUsage } from './cerebras-client';
import { recordLlmUsage } from './llm-usage';

export type Brain = 'claude' | 'openai' | 'cerebras' | 'stub';

/**
 * Assemble prompt briefs with a HARD total cap. Stacking every brief (sound DNA
 * + learned refs + lyric craft + hit-craft + freshness + word palette + trends)
 * made prompts huge → slow calls AND the model choking on unparseable output.
 * Order the parts by priority; this keeps the most important ones and drops the
 * overflow so generation stays fast and reliable.
 */
export function joinBriefs(parts: Array<string | undefined | null | false>, maxChars = 4200): string {
  const out: string[] = [];
  let used = 0;
  for (const p of parts) {
    if (!p) continue;
    const s = String(p).trim();
    if (!s) continue;
    if (used + s.length > maxChars) {
      const room = maxChars - used;
      if (room > 300) out.push(s.slice(0, room)); // partial keep if meaningful
      break;
    }
    out.push(s);
    used += s.length + 2;
  }
  return out.join('\n\n');
}

export interface GenerateOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Force a brain. Default: Claude when configured, else OpenAI. */
  brain?: 'claude' | 'openai';
  /** Longer Claude timeout for big/slow calls (e.g. lyrics). Default 55s. */
  timeoutMs?: number;
  /**
   * A3-5 BRAIN TIERS. 'judgment' (default) = Anthropic, ALWAYS — lyrics, hooks,
   * A&R, anything user-facing creative; quality work never routes down.
   * 'bulk' = Cerebras first (radar craft extraction, gloss/classification,
   * caption drafting, internal summaries), laddering to Anthropic on failure —
   * never a silent drop. Guards: prompts > ~7K tokens auto-route up (Cerebras
   * context is small — size defensively).
   */
  tier?: 'judgment' | 'bulk';
  /** Task label for the economics log (A3-6). */
  task?: string;
}

const JSON_ONLY =
  '\n\nCRITICAL OUTPUT RULE: Respond with ONLY one valid JSON object matching the requested schema. No prose, no markdown, no code fences before or after.';

/** Last brain used — handy for diagnostics/telemetry (e.g. /debug/ai). */
export let lastBrain: Brain = 'openai';

/**
 * Generate a JSON object. Drop-in replacement for responsesJson, but routes to
 * Claude first. Returns the parsed object; read `lastBrain` if you need to know
 * which model produced it.
 */
export async function generateJson<T>(opts: GenerateOptions): Promise<T> {
  // Tests: keep the deterministic OpenAI stub path (keyed off the system prompt).
  if (process.env.STUB_AI === '1') {
    lastBrain = 'stub';
    return responsesJson<T>({
      system: opts.system,
      user: opts.user,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens,
    });
  }

  const wantClaude = (opts.brain ?? (anthropicEnabled() ? 'claude' : 'openai')) === 'claude';
  const callClaude = () =>
    claudeJson<T>({ system: opts.system + JSON_ONLY, user: opts.user, maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: opts.timeoutMs });

  // A3-5 — BULK TIER: Cerebras first for non-creative bulk work. Context guard:
  // ~7K tokens ≈ 28K chars auto-routes UP (never truncate to fit down). Ladder:
  // any Cerebras failure falls to the judgment path below with a logged reason.
  const promptChars = opts.system.length + opts.user.length;
  if (opts.tier === 'bulk' && cerebrasEnabled() && promptChars < 28_000) {
    const t0 = Date.now();
    try {
      const data = await cerebrasJson<T>({ system: opts.system + JSON_ONLY, user: opts.user, maxTokens: opts.maxTokens });
      lastBrain = 'cerebras';
      recordLlmUsage({ tier: 'bulk', task: opts.task ?? 'unlabeled', brain: 'cerebras', ms: Date.now() - t0, estCostUsd: lastCerebrasUsage?.estCostUsd ?? null });
      return data;
    } catch (err) {
      console.warn(`[brains] bulk tier failed (${(err as Error).message.slice(0, 120)}) — laddering to judgment brain`);
      recordLlmUsage({ tier: 'bulk', task: opts.task ?? 'unlabeled', brain: 'cerebras', ms: Date.now() - t0, estCostUsd: null, degraded: (err as Error).message.slice(0, 160) });
    }
  } else if (opts.tier === 'bulk' && cerebrasEnabled()) {
    console.log(`[brains] bulk prompt ${promptChars} chars > context guard — routed to judgment brain`);
  }

  if (wantClaude && anthropicEnabled()) {
    const t0 = Date.now();
    try {
      const data = await callClaude();
      lastBrain = 'claude';
      recordLlmUsage({ tier: opts.tier ?? 'judgment', task: opts.task ?? 'unlabeled', brain: 'claude', ms: Date.now() - t0, estCostUsd: null });
      return data;
    } catch {
      // Claude erred (transient/parse) → try OpenAI so we don't hard-fail.
    }
  }

  try {
    lastBrain = 'openai';
    return await responsesJson<T>({ system: opts.system, user: opts.user, temperature: opts.temperature, maxOutputTokens: opts.maxTokens });
  } catch (e) {
    // OpenAI billing can be exhausted (429 insufficient_quota). Rather than
    // surface a confusing quota error, give Claude a real second attempt —
    // it's the only working brain in that state.
    if (anthropicEnabled() && /quota|insufficient|429|rate limit/i.test((e as Error).message)) {
      await new Promise((r) => setTimeout(r, 1200));
      const data = await callClaude();
      lastBrain = 'claude';
      return data;
    }
    throw e;
  }
}
