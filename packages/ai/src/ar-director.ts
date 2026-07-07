/**
 * A&R Director — the convergent half of the multi-model pipeline.
 *
 * GPT (the "writer") generates draft hooks for breadth. Claude (the "A&R
 * director") critiques, kills clichés, verifies heritage-language authenticity,
 * refines weak lines, and scores/ranks with reasons — biased by the artist's
 * taste memory.
 *
 * Degrades gracefully: if Anthropic isn't configured or errors, returns null
 * and the caller keeps the GPT drafts. The pipeline never breaks.
 */
import { anthropicEnabled, claudeJson } from './anthropic-client';
import { AR_DIRECTOR_SYSTEM, arDirectorUserPrompt } from './prompts/ar-director';
import type { ArtistDna, Brief } from '@afrohit/shared';

/**
 * ONE-CALL hooks: write AND A&R-score in a single Claude pass. Replaces the old
 * two-call "GPT drafts → Claude refines" dance (which meant two sequential ~30s
 * Claude calls = ~67s + timeouts). Claude is the brain now, so it drafts and
 * judges together — roughly 2x faster, and the A&R score never goes missing.
 */
export async function writeAndScoreHooks(opts: {
  artist: ArtistDna;
  brief?: Brief;
  count: number;
  tasteMemory?: { approvedExamples: string[]; rejectedExamples: string[] };
  trends?: string;
  soundDna?: string;
}): Promise<ARHook[] | null> {
  if (!anthropicEnabled() || process.env.STUB_AI === '1') return null;
  const n = Math.max(3, Math.min(opts.count || 8, 12));
  try {
    const out = await claudeJson<{ hooks: ARHook[] }>({
      system:
        AR_DIRECTOR_SYSTEM +
        `\n\nYOU ARE ALSO THE WRITER: FIRST write ${n} distinct, original Afrobeats hooks, THEN score each as A&R in the SAME response. ` +
        'Each hook: text (2-4 chantable lines), language (codes present), score (0-10 overall), viralScore (0-10 short-form), reason (one line), needsNativeReview (bool), tiktokMoment (string or null). ' +
        'Return strict JSON {"hooks":[...]}. No two hooks may share the same core phrase; kill clichés.',
      user: arDirectorUserPrompt({ ...opts, drafts: [`Write ${n} fresh hooks from the brief above — do not refine an existing list, CREATE them.`] }),
      maxTokens: 2_600,
      temperature: 0.9,
    });
    const hooks = (out.hooks ?? []).filter((h) => h && typeof h.text === 'string');
    return hooks.length ? hooks : null;
  } catch {
    return null;
  }
}

export interface ARHook {
  text: string;
  language: string[];
  score: number;
  /** Short-form / TikTok breakout potential (0-10) — the virality signal. */
  viralScore?: number;
  /** Per-dimension A&R breakdown (hookStrength, firstEightSeconds, tiktokLoop, …). */
  dimensions?: Record<string, number>;
  /** The named short-form moment, if any. */
  tiktokMoment?: string;
  reason?: string;
  needsNativeReview?: boolean;
}

/**
 * Run GPT's draft hooks through Claude as A&R director.
 * Returns refined + scored + ranked hooks, or null to fall back to the drafts.
 */
export async function directorRefineHooks(opts: {
  artist: ArtistDna;
  brief?: Brief;
  drafts: string[];
  tasteMemory?: { approvedExamples: string[]; rejectedExamples: string[] };
  trends?: string;
  soundDna?: string;
}): Promise<ARHook[] | null> {
  if (opts.drafts.length === 0) return null;
  // STUB_AI: deterministic A&R pass (no Anthropic call) so tests can exercise
  // the multi-model path for free.
  if (process.env.STUB_AI === '1') {
    return opts.drafts.map((text, i) => ({
      text,
      language: ['pcm', 'yo'],
      score: 8.5 - i * 0.2,
      reason: 'Stub A&R: strong pocket, clean lane.',
      needsNativeReview: false,
    }));
  }
  if (!anthropicEnabled()) return null;
  try {
    const out = await claudeJson<{ hooks: ARHook[] }>({
      system: AR_DIRECTOR_SYSTEM,
      user: arDirectorUserPrompt(opts),
      temperature: 0.4,
      maxTokens: 4_000,
    });
    const hooks = (out.hooks ?? []).filter((h) => h && typeof h.text === 'string');
    return hooks.length ? hooks : null;
  } catch {
    // Anthropic unavailable / bad model / parse error → caller keeps GPT drafts.
    return null;
  }
}
