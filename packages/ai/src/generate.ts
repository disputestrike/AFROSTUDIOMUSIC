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

export type Brain = 'claude' | 'openai' | 'stub';

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
    claudeJson<T>({ system: opts.system + JSON_ONLY, user: opts.user, maxTokens: opts.maxTokens, temperature: opts.temperature });

  if (wantClaude && anthropicEnabled()) {
    try {
      const data = await callClaude();
      lastBrain = 'claude';
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
