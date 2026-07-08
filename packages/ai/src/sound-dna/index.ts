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
import { GLOBAL_SOUND_DNA, GLOBAL_ENRICHMENT } from './global-genres';
import { GENRE_ENRICHMENT, type GenreEnrichment } from './enrichment';

export { SOUND_DNA };
export type { SoundDNA } from './recipes';
export type { GenreEnrichment } from './enrichment';
export { GENRE_ENRICHMENT } from './enrichment';

// The full library = Afro seed DNA + global genres (pop/rnb/dancehall/drill/…),
// and likewise for the current-trends enrichment. All lookups go through these.
const ALL_DNA: Record<string, SoundDNA> = { ...SOUND_DNA, ...GLOBAL_SOUND_DNA };
const ALL_ENRICHMENT: Record<string, GenreEnrichment> = { ...GENRE_ENRICHMENT, ...GLOBAL_ENRICHMENT };
/** Every enrichment record (Afro + global), keyed by genre. */
export const GENRE_ENRICHMENT_ALL = ALL_ENRICHMENT;

/** Look up the recipe for a genre (Afro OR global). Returns undefined if unknown. */
export function getSoundDNA(genre?: string | null): SoundDNA | undefined {
  if (!genre) return undefined;
  return ALL_DNA[genre];
}

/** Current-trends enrichment for a genre (Afro OR global). */
export function getEnrichment(genre?: string | null): GenreEnrichment | undefined {
  if (!genre) return undefined;
  return ALL_ENRICHMENT[genre];
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
    // SIGNATURE INSTRUMENTS LEAD — they're what makes the genre recognizable and
    // exactly what was going missing (e.g. amapiano LOG DRUM, shakers, talking
    // drum). Front-loaded + prominent so the model actually renders them.
    ...dna.instrumentation.signature.slice(0, 3).map((x) => `prominent ${shorten(x, 40)}`),
    ...dna.instrumentation.percussion.slice(0, 3).map((x) => shorten(x, 30)),
    shorten(dna.instrumentation.bass, 34),
    ...dna.signatureElements.slice(0, 2).map((x) => shorten(x, 40)),
    // Current trending sound tokens (2026) so the model reflects what's charting.
    ...(enr?.freshTokens ?? []).slice(0, 1).map((x) => shorten(x, 40)),
    shorten(dna.groove.feel, 36),
    dna.modalFlavor ? shorten(dna.modalFlavor, 32) : undefined,
    mood?.trim() ? `${mood.trim()} mood` : undefined,
  ]).slice(0, 12);
  // Hard cap the joined length so we never blow the model's style budget.
  const out: string[] = [];
  let len = 0;
  for (const t of tags) {
    if (len + t.length + 2 > 380) break;
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

/**
 * FUSION — blend 2-3 genres into something new (the artist's explicit mix, e.g.
 * amapiano × drill). The FIRST genre is the backbone (groove/tempo/arrangement);
 * the others contribute their most distinctive signature elements. Tags
 * interleave so the music model hears both identities; the brief instructs the
 * LLMs to fuse, not average.
 */
export function blendSoundBrief(genres: string[], mood?: string): { tags?: string[]; brief?: string; typicalBpm?: number } {
  const dnas = genres.map((g) => getSoundDNA(g)).filter((d): d is SoundDNA => !!d);
  if (dnas.length === 0) return {};
  if (dnas.length === 1) return soundBrief(dnas[0]!.genre, mood);
  const [primary, ...rest] = dnas as [SoundDNA, ...SoundDNA[]];
  // Interleave: primary leads, each fusion genre injects its top signatures early.
  const primaryTags = musicTags(primary, mood);
  const fusionTags = rest.flatMap((d) => [d.displayName, ...d.signatureElements.slice(0, 2).map((s) => s.split(/[—:;(,]/)[0]!.trim().slice(0, 40))]);
  const tags = [
    `${primary.displayName} x ${rest.map((d) => d.displayName).join(' x ')} fusion`,
    ...primaryTags.slice(0, 5),
    ...fusionTags,
    ...primaryTags.slice(5),
  ].slice(0, 14);
  const brief = [
    `GENRE FUSION — ${primary.displayName} × ${rest.map((d) => d.displayName).join(' × ')}: build something NEW from both lanes, never a genre averaged into mush.`,
    `BACKBONE (groove, tempo, arrangement, mix): ${primary.displayName}.`,
    llmBrief(primary),
    ...rest.map((d) =>
      [
        `FUSE IN from ${d.displayName} (its identity must be clearly audible):`,
        `  Signature sounds: ${d.signatureElements.slice(0, 3).join('; ')}`,
        `  Percussion/bass: ${d.instrumentation.percussion.slice(0, 2).join('; ')} · ${d.instrumentation.bass}`,
        `  Groove flavor: ${d.groove.feel}`,
        `  Vocal flavor: ${d.vocalStyle.delivery}`,
      ].join('\n')
    ),
  ].join('\n\n');
  return { tags, brief, typicalBpm: primary.typicalBpm };
}
