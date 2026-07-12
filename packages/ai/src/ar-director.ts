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
import { responsesJson } from './providers/text';
import { MODELS } from './openai-client';
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
  // LEAN scoring pass — the full 7-dimension + rewrite prompt generated ~4k
  // tokens and timed out (~55s). This keeps the SAME A&R judgment but emits a
  // compact result (score/viral/reason), so it's ~3x faster and never stalls.
  const rubric =
    'You are a ruthless Afrobeats A&R. Score each draft hook 0-10 for HIT potential (weighted to virality: undeniable hook + first-8-seconds + a 5-15s loopable TikTok moment matter most; kill generic filler like "we dey vibe/shine/energy"). ' +
    'Return ONLY JSON {"hooks":[{"text","language":["pcm"],"score":8.2,"viralScore":8,"reason":"one line","needsNativeReview":false}]} — keep each hook\'s text, add the scores, rank best-first. Do NOT rewrite the hooks, do NOT add dimension breakdowns.';
  // trending_now rides in the lean payload (owner directive: the A&R must know
  // the wave before naming a favorite) — sliced hard so the pass stays fast.
  const userPayload = JSON.stringify({
    genre_lane: (opts.soundDna || '').slice(0, 600),
    languages: opts.artist.languages,
    trending_now: (opts.trends || '').slice(0, 400) || undefined,
    draft_hooks: opts.drafts,
  });
  if (anthropicEnabled()) {
    try {
      const out = await claudeJson<{ hooks: ARHook[] }>({ system: rubric, user: userPayload, maxTokens: 1_400, timeoutMs: 35_000 });
      const hooks = (out.hooks ?? []).filter((h) => h && typeof h.text === 'string');
      if (hooks.length) return hooks;
    } catch {
      // fall through to the flagship-GPT fallback below
    }
  }
  // OWNER DIRECTIVE (2026-07-13): the brain's fallback is the FLAGSHIP GPT,
  // wired 100% — a dead Anthropic account must never silently skip the A&R
  // pass (the drafts shipped unscored for hours during the credit outage).
  try {
    const out = await responsesJson<{ hooks: ARHook[] }>({ system: rubric, user: userPayload, maxOutputTokens: 1_400, model: MODELS.text });
    const hooks = (out.hooks ?? []).filter((h) => h && typeof h.text === 'string');
    return hooks.length ? hooks : null;
  } catch {
    return null; // both brains down → caller keeps the raw drafts
  }
}
