/**
 * REFERENCE STEERING — the ONE home of the artist-influence + mood steering
 * strings, shared by the own engine (worker), the Producer Brain (packages/ai)
 * and the provider path (packages/ai/providers/music). Before this, the owner's
 * "make it FEEL LIKE Dre" reference was computed at the API and then DROPPED
 * before the default (own) renderer ever saw it.
 *
 * LEGAL LINE (owner directive 2026-07-21, keep it): "feel like Dre" is
 * PRODUCTION-STYLE steering — the west-coast/g-funk feel, laid-back tempo,
 * sparse minor keys, heavy 808s — and it MUST be honored. CLONING or imitating
 * a real, living person's VOICE, or producing them as a named artifact, is
 * forbidden. Every steering string built here carries
 * INFLUENCE_NEVER_CLONE_GUARD so the boundary can never silently detach as the
 * string travels through the enqueue -> payload -> brain -> engine pipeline.
 * This is arrangement / timbre / tempo steering only — never voice cloning.
 */
import { genreSignature } from './genre-signatures';

/** The never-a-clone guard that rides EVERY influence steering string. Kept as
 *  ONE canonical fragment so a test can assert its presence and so it can never
 *  drift out of sync across the three code paths that steer on a reference. */
export const INFLUENCE_NEVER_CLONE_GUARD =
  "production feel only — never a voice clone, never imitate a specific living person's voice";

/**
 * The full artist-influence directive: steer the PRODUCTION lane (tempo feel,
 * instrument palette, groove pocket, energy) toward the reference, with the
 * never-clone guard baked in. Used by the own-engine melody prompt and, as
 * `influenceLane`, by the Producer Brain. Returns null when no influence given.
 */
export function influenceDirective(influence?: string | null): string | null {
  const name = influence?.trim();
  if (!name) return null;
  return `in the production lane of ${name} — capture its tempo feel, instrument palette, groove pocket and energy (${INFLUENCE_NEVER_CLONE_GUARD})`;
}

/**
 * The provider-path front-loaded influence token — a terser sibling of
 * influenceDirective for composeStyleTags. Same guard, same boundary; front-
 * loaded so it survives the style-prompt char cap instead of being truncated
 * away at the tail of a 160-char vibe. Returns null when no influence given.
 */
export function influenceStyleToken(influence?: string | null): string | null {
  const name = influence?.trim();
  if (!name) return null;
  return `production lane: like ${name} — capture tempo feel, groove and instrument palette (${INFLUENCE_NEVER_CLONE_GUARD})`;
}

/**
 * MOOD STEERING — the mood colour, from the SAME home as the influence steering
 * (this module's contract). Before this, mood was honoured only on the OWN
 * engine (moodMelodyPhrase, below, threaded into the melody prompt) while the
 * provider prompt got no mood token — the request's mood reached a black-box
 * engine only INDIRECTLY, coloured into the Sound-DNA brief. These two helpers
 * make mood engine-agnostic: the provider style prompt (composeStyleTags) front-
 * loads moodStyleToken so MiniMax / Suno / ACE-Step / Eleven all carry the mood,
 * and the own engine keeps moodMelodyPhrase — one home, every engine.
 */

/** The mood colour as a compact, front-loadable STYLE token for the provider
 *  prompt (composeStyleTags), parallel to influenceStyleToken. Front-loaded so
 *  it survives the style-prompt char cap. Returns null when no mood given. */
export function moodStyleToken(mood?: string | null): string | null {
  const m = mood?.trim();
  if (!m) return null;
  return `mood: ${m} — carry this emotional tone in the melody, harmony, energy and delivery`;
}

/** The mood colour as the own-engine melody-prompt phrase ("<mood> mood"). Kept
 *  here so mood steering has ONE source across the own engine and the provider
 *  path. Returns null when no mood given. */
export function moodMelodyPhrase(mood?: string | null): string | null {
  const m = mood?.trim();
  return m ? `${m} mood` : null;
}

/**
 * Build the own engine's ENRICHED melody prompt: the lane's signature melody
 * brief FIRST (genre identity), then the mood colour, the artist-influence
 * directive and any free-text vibe — so the reference the owner actually picked
 * reaches planProduction (theme) and the conditioned melody layer, instead of
 * the bare per-genre table string that dropped it. The lane brief always leads,
 * so genre identity is never displaced by the steering.
 */
export function enrichedOwnMelodyPrompt(opts: {
  genre: string;
  mood?: string | null;
  influence?: string | null;
  vibePrompt?: string | null;
}): string {
  const moodText = moodMelodyPhrase(opts.mood);
  const vibe = opts.vibePrompt?.trim() || null;
  return [
    genreSignature(opts.genre).melodyPrompt,
    moodText,
    influenceDirective(opts.influence),
    vibe,
  ]
    .filter(Boolean)
    .join('. ');
}
