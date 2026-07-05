/**
 * Afro Sound DNA — retrieval + projection.
 *
 * The seed library (recipes.ts) is FACTS/analysis about each genre's lane. Two
 * projections feed the pipeline:
 *   - musicTags(dna): concise, ORDERED signature tokens for the hosted music
 *     model. Front-loaded so the genre's identity (log drum, shaker pocket,
 *     highlife guitar) outweighs generic "radio-ready" filler — the fix for
 *     "same-y SOUND".
 *   - llmBrief(dna): a rich production brief for the LLMs (hooks, lyrics,
 *     ad-lib arranger, A&R) so the WORDS + arrangement fit the lane — the fix
 *     for "same-y WORDS".
 *
 * Legal: this reads only the uncopyrightable factual library. No copyrighted
 * audio, lyrics, or verbatim third-party prose is ever involved.
 */
import { SOUND_DNA, type SoundDNA } from './recipes';
import { getEnrichment } from './enrichment';

export { SOUND_DNA };
export type { SoundDNA } from './recipes';
export { GENRE_ENRICHMENT, getEnrichment, type GenreEnrichment } from './enrichment';

/** Look up the recipe for a genre. Returns undefined for unknown genres. */
export function getSoundDNA(genre?: string | null): SoundDNA | undefined {
  if (!genre) return undefined;
  return SOUND_DNA[genre as keyof typeof SOUND_DNA];
}

function dedupe(items: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = (raw ?? '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Reduce a long signature sentence to a short, model-friendly token. */
function shorten(s: string, max = 48): string {
  const firstClause = (s.split(/[—:;(]/)[0] ?? s).split(',')[0] ?? s;
  const clause = firstClause.trim();
  const t = clause.length ? clause : s.trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

/**
 * Ordered signature tokens for the MUSIC model. Kept short — models weight by
 * position and truncate, so the genre's identity must lead. mood (optional)
 * COLORS the sound but is appended as a modifier, never overriding identity.
 */
export function musicTags(dna: SoundDNA, mood?: string): string[] {
  // Every token must be TERSE — models weight the first tokens and truncate, so
  // signature sounds beat verbose descriptions. Shorten everything to a phrase.
  const enr = getEnrichment(dna.genre);
  const tags = dedupe([
    dna.displayName,
    ...dna.signatureElements.slice(0, 2).map((x) => shorten(x, 40)),
    // Current trending sound tokens (2026) so the model reflects what's charting.
    ...(enr?.freshTokens ?? []).slice(0, 2).map((x) => shorten(x, 40)),
    ...dna.instrumentation.signature.slice(0, 3).map((x) => shorten(x, 36)),
    ...dna.instrumentation.percussion.slice(0, 2).map((x) => shorten(x, 28)),
    shorten(dna.instrumentation.bass, 32),
    shorten(dna.groove.feel, 36),
    dna.modalFlavor ? shorten(dna.modalFlavor, 32) : undefined,
    mood?.trim() ? `${mood.trim()} mood` : undefined,
  ]).slice(0, 11);
  // Hard cap the joined length so we never blow the model's style budget.
  const out: string[] = [];
  let len = 0;
  for (const t of tags) {
    if (len + t.length + 2 > 320) break;
    out.push(t);
    len += t.length + 2;
  }
  return out;
}

/** Rich production brief for the LLM prompts (hooks / lyrics / arranger / A&R). */
export function llmBrief(dna: SoundDNA): string {
  const chords = dna.chordProgressions
    .slice(0, 3)
    .map((c) => `${c.roman} (${c.description})`)
    .join('; ');
  const arrangement = dna.arrangement
    .map((a) => `${a.section} [${a.bars}]: ${a.whatHappens}`)
    .join('\n  ');
  // "What's working NOW" — web-researched current trends (facts only). Reflect
  // what's charting; never chase or clone. Empty for genres not yet researched.
  const enr = getEnrichment(dna.genre);
  const trending = enr
    ? [
        `TRENDING NOW (researched ${enr.researchedAt}, ${enr.confidence} confidence) — reflect what's charting, don't chase or clone:`,
        enr.trendingProductionMoves.length ? `  Current production moves: ${enr.trendingProductionMoves.slice(0, 6).join('; ')}` : '',
        enr.whatMakesItHitNow.length ? `  What's hitting / short-form: ${enr.whatMakesItHitNow.slice(0, 5).join('; ')}` : '',
        enr.currentSubgenres.length ? `  Live subgenres: ${enr.currentSubgenres.slice(0, 6).join(', ')}` : '',
        enr.currentReferenceLanes.length ? `  Reference LANES (capture the feel, never clone/name): ${enr.currentReferenceLanes.slice(0, 5).join('; ')}` : '',
        enr.bpmDriftNote ? `  Tempo drift: ${enr.bpmDriftNote}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  return [
    `AFRO SOUND DNA — ${dna.displayName} (stay in this LANE; never copy a specific song):`,
    dna.productionPromptSnippet,
    `Tempo ${dna.bpmRange[0]}–${dna.bpmRange[1]} bpm (typ. ${dna.typicalBpm}). Common keys: ${dna.commonKeys.slice(0, 4).join(', ')}. ${dna.modalFlavor ?? ''}`.trim(),
    `Groove/pocket: ${dna.groove.feel}. ${dna.groove.pocketNotes}`,
    `Chord loops: ${chords}`,
    `Signature sounds: ${dna.signatureElements.slice(0, 4).join('; ')}`,
    `Arrangement map:\n  ${arrangement}`,
    `Vocal delivery: ${dna.vocalStyle.delivery}. Ad-libs to weave in naturally: ${dna.vocalStyle.adLibs.slice(0, 8).join(', ')}.`,
    trending,
    `Freshness guardrail: ${dna.freshnessGuardrails}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * One-call convenience for produce call-sites: returns the music-model tags and
 * the LLM brief for a genre (empty/undefined when the genre is unknown).
 */
export function soundBrief(genre?: string | null, mood?: string): { tags?: string[]; brief?: string; typicalBpm?: number } {
  const dna = getSoundDNA(genre);
  if (!dna) return {};
  return { tags: musicTags(dna, mood), brief: llmBrief(dna), typicalBpm: dna.typicalBpm };
}
