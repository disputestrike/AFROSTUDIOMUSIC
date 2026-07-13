/**
 * CATALOGUE QA GATE — the validator that should have blocked the garbage.
 *
 * Owner audit (2026-07-12, external A&R pass over all 100 songs) found that
 * empty output ("osheyy"), misspelled hooks ("Sonmething"), scratchpad debris,
 * "same skeleton / same flow" meta-notes, and exact duplicates all reached
 * MASTERED status. No gate existed. This is that gate: pure, zero-dependency,
 * measurement-based (numbers, never vibes — same discipline as lyric-scorecard).
 *
 * BLOCKS are fatal — a blocked lyric must never save/advance/release. WARNINGS
 * are advisory (over-length, template rut, ad-lib spam, English drift) and ride
 * into the Truth report. Duplicate detection needs the caller to pass the rest
 * of the catalogue (normalized bodies); everything else is self-contained.
 */

import { detectCatalogueContamination, type ContaminationResult } from './contamination';

/** Normalize a lyric body for duplicate comparison and word counting: strip
 *  [section headers] and (parentheticals/ad-libs), lowercase, drop punctuation,
 *  collapse whitespace. Stable — both sides of a dup check run through it. */
export function normalizeLyricBody(body: string): string {
  return (body ?? '')
    .replace(/^\s*\[[^\]]*\]\s*$/gm, ' ') // section headers
    .replace(/\([^)]*\)/g, ' ') // ad-libs / backing
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'i', 'you', 'we', 'my', 'your', 'na', 'dey', 'go', 'wey', 'don', 'no', 'e', 'am', 'me', 'my', 'im', 'de']);

/** Content-word tokens (stopwords + pure vocables removed) of a normalized body. */
function contentWords(bodyNorm: string): string[] {
  return bodyNorm.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
}

/** 4-word shingles for near-duplicate Jaccard similarity. */
function shingles(bodyNorm: string, n = 4): Set<string> {
  const w = bodyNorm.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Meta-note / scratchpad / reference-copy contamination — text that proves the
// output is not a finished, original lyric. Case-insensitive.
const META_PATTERNS: Array<[RegExp, string]> = [
  [/same\s+(skeleton|flow|structure|pattern)/i, 'reference-mirroring instruction'],
  [/\[(artist|producer|prod|insert|placeholder|tbd|xxx|name|title)\s*[:\]]/i, 'placeholder token'],
  [/\btodo\b|\bfixme\b/i, 'TODO/scratchpad note'],
  [/-\s*\[\s?\]/, 'unchecked task box'],
  [/translation\s*(note|:)/i, 'translation note'],
  [/structure\s*map|section\s*map/i, 'structure map'],
  [/\bprod\.?\s*by\b/i, 'production credit inside lyric'],
  [/\bmirror\b.*\breference\b|\bcopy\b.*\bflow\b/i, 'reference-copy instruction'],
  [/as an ai|i cannot|here is the|here'?s the (song|lyric|rewrite)/i, 'model-instruction leak'],
  [/\bverse\s*\d+\s*:\s*$/im, 'bare structure label (empty section)'],
];

// Production/engineering cues that must never appear in SUNG words (section
// headers are handled separately and allowed).
const PRODUCTION_IN_LYRIC: Array<[RegExp, string]> = [
  [/\[(drum\s*fill|drop|beat|808|horn|bass|instrumental|break|build|riser|fx)\b/i, 'production tag in body'],
  [/\bbpm\b|\b\d+\s*bpm\b/i, 'BPM annotation'],
  [/\b\d+\s*bars?\b|\bbar\s*\d+\b/i, 'bar-count annotation'],
  [/\b(dj)\s+dey\s+(play|scratch|spin)\b/i, 'DJ production cue'],
  [/\b(log\s*drum|shekere|shaker|808|snare|kick)\s+dey\s+(knock|enter|drop|play)\b/i, 'instrument production cue'],
  [/\(?\s*(cadence|delivery|vocal)\s*note\s*:/i, 'cadence/vocal note'],
];

// Environment / setting / cultural-object nouns. The audit's #1 authenticity
// failure: the writer stuffs these into every line to manufacture "Nigerian-ness"
// instead of earning it. A record is not an inventory of its surroundings.
export const ENVIRONMENT_NOUNS = new Set([
  'streetlight', 'generator', 'nepa', 'danfo', 'keke', 'okada', 'bus', 'busstop', 'stop', 'conductor', 'garage', 'motor',
  'road', 'junction', 'park', 'town', 'city',
  'market', 'corner', 'gutter', 'compound', 'gate', 'shop', 'stall', 'counter', 'kiosk', 'mama',
  'pot', 'pepper', 'steam', 'broth', 'soup', 'suya', 'jollof', 'amala', 'eba', 'garri', 'zobo', 'malt', 'fanta',
  'gbedu', 'log', 'drum', 'shekere', 'shaker', 'talking', 'speaker', 'dj',
  'lagos', 'lekki', 'yaba', 'surulere', 'ajegunle', 'ladipo', 'oshodi', 'balogun',
  'ankara', 'gele', 'agbada', 'danfo', 'molue', 'ladle', 'crate', 'bench',
]);

// Confession-bridge markers — the catalogue's detectable "Truth be say…" tell.
const CONFESSION_MARKERS = /\b(truth be say|i no go lie|make i talk true|sometimes (the |i )?fear|the nights? (nobody|dem no|wey nobody)|deep down|behind the smile)\b/i;

function bodyLines(body: string): string[] {
  return body.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\[[^\]]*\]\s*$/.test(l));
}
function sectionsOfKind(body: string, rx: RegExp): string[] {
  const lines: string[] = [];
  let inSec = false;
  for (const raw of body.split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (h) { inSec = rx.test(h[1]!); continue; }
    if (inSec && raw.trim()) lines.push(raw.trim());
  }
  return lines;
}
function envDensity(lines: string[]): number {
  if (!lines.length) return 0;
  const hit = lines.filter((l) =>
    l.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).some((w) => ENVIRONMENT_NOUNS.has(w)),
  ).length;
  return hit / lines.length;
}

export type LyricBand = 'A' | 'B' | 'C' | 'F';

export interface LyricQaInput {
  title: string;
  body: string;
  hookCell?: string | null;
  languageMix?: Record<string, number> | null;
  /** Artist-written lyrics are exempt from craft WARNINGS (never their words),
   *  but still checked for the fatal integrity blocks (empty/dup/contamination). */
  artistAuthored?: boolean;
  /** Other catalogue lyrics for duplicate detection (normalized bodies). */
  catalogue?: Array<{ id: string; title: string; bodyNorm: string }>;
}

export interface LyricQaResult {
  ok: boolean; // no blocks
  blocks: string[];
  warnings: string[];
  band: LyricBand;
  bodyNorm: string;
  wordCount: number;
  duplicateOf?: string; // catalogue id of the exact/near match
  /** The 12-pattern catalogue-contamination read (owner 2026-07-13). Present for
   *  non-artist-authored lyrics; when decision is set it also raised a fatal block. */
  contamination?: ContaminationResult;
}

/** Total content-word count and distinct-word count of a body. */
function wordStats(bodyNorm: string): { total: number; distinct: number } {
  const cw = contentWords(bodyNorm);
  return { total: cw.length, distinct: new Set(cw).size };
}

/** The exact template that dominates the broken catalogue (40% of songs). */
const TEMPLATE_SEQ = ['intro', 'verse', 'prehook', 'hook', 'verse', 'bridge', 'outro'];
function sectionSequence(body: string): string[] {
  const seq: string[] = [];
  for (const m of body.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)) {
    const n = m[1]!.toLowerCase();
    if (/pre[\s-]?(hook|chorus)/.test(n)) seq.push('prehook');
    else if (/hook|chorus|refrain/.test(n)) seq.push('hook');
    else if (/verse/.test(n)) seq.push('verse');
    else if (/bridge/.test(n)) seq.push('bridge');
    else if (/intro/.test(n)) seq.push('intro');
    else if (/outro/.test(n)) seq.push('outro');
  }
  return seq;
}

export function lyricQaCheck(input: LyricQaInput): LyricQaResult {
  const body = input.body ?? '';
  const bodyNorm = normalizeLyricBody(body);
  const { total, distinct } = wordStats(bodyNorm);
  const blocks: string[] = [];
  const warnings: string[] = [];
  let duplicateOf: string | undefined;

  // --- FATAL BLOCKS (integrity — apply even to artist-authored) --------------

  // 1. Empty / near-empty ("osheyy").
  if (total < 20 || distinct < 10) {
    blocks.push(`empty_or_near_empty: ${total} content words, ${distinct} distinct — this is not a song`);
  }

  // 2. Meta-note / scratchpad / reference-copy contamination.
  for (const [rx, label] of META_PATTERNS) {
    if (rx.test(body)) { blocks.push(`meta_contamination: ${label}`); break; }
  }

  // 3. Production notes inside the sung lyric.
  for (const [rx, label] of PRODUCTION_IN_LYRIC) {
    if (rx.test(body)) { blocks.push(`production_notes_in_lyric: ${label}`); break; }
  }

  // 4. Exact / near duplicate of another catalogue song.
  if (bodyNorm && input.catalogue?.length) {
    const mine = shingles(bodyNorm);
    for (const other of input.catalogue) {
      if (!other.bodyNorm) continue;
      if (other.bodyNorm === bodyNorm) { blocks.push(`exact_duplicate: same lyric as "${other.title}"`); duplicateOf = other.id; break; }
      const sim = jaccard(mine, shingles(other.bodyNorm));
      if (sim >= 0.85) { blocks.push(`near_duplicate: ${(sim * 100).toFixed(0)}% overlap with "${other.title}"`); duplicateOf = other.id; break; }
    }
  }

  // 5. ENVIRONMENT STUFFING (owner feedback 2026-07-13: "an inventory of the
  //    surroundings, not a song"). A record is not a screenplay establishing
  //    shot. Block when a setting/food/transport/place noun is in the majority of
  //    lines; warn from ~40%. (Skipped for artist-authored words.)
  const allLines = bodyLines(body);
  if (!input.artistAuthored && allLines.length >= 6) {
    const density = envDensity(allLines);
    if (density > 0.6) blocks.push(`environment_stuffing: ${(density * 100).toFixed(0)}% of lines lean on a place/food/transport noun — this is scenery, not a song (REJECT_AND_RESTART_FROM_TOPLINE)`);
  }

  // 6. HOOK IS A DESCRIPTION (owner feedback: strip setting words from the hook —
  //    if no emotional/attitude core survives, it is an advertisement, not a hook).
  if (!input.artistAuthored) {
    const hookLines = sectionsOfKind(body, /hook|chorus|refrain/i);
    if (hookLines.length) {
      const hookWords = hookLines.join(' ').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
      const core = hookWords.filter((w) => w.length > 1 && !STOP.has(w) && !ENVIRONMENT_NOUNS.has(w));
      if (hookWords.length >= 4 && core.length === 0) {
        blocks.push('hook_is_description: the hook is only setting/food/place words — strip them and nothing emotional remains (not a hook)');
      }
    }
  }

  // 7. CATALOGUE-TEMPLATE SIGNATURE (owner feedback: the location-open ->
  //    scene -> confession-bridge -> explained-outro architecture is the
  //    catalogue disease — force a structural restart, never a line-edit).
  if (!input.artistAuthored) {
    const first2 = allLines.slice(0, 2);
    const locationOpen = envDensity(first2) >= 0.5;
    const bridge = sectionsOfKind(body, /bridge/i);
    const confession = bridge.some((l) => CONFESSION_MARKERS.test(l));
    const seq2 = sectionSequence(body);
    const hasBridge = seq2.includes('bridge');
    const hasOutro = seq2.includes('outro');
    if (locationOpen && confession && hasBridge && hasOutro) {
      blocks.push('catalogue_template_signature: location-open + confession-bridge + explained-outro — the catalogue template, restart from topline');
    }
  }

  // 8. CATALOGUE CONTAMINATION (owner 2026-07-13, the "Pepper Kiss" report). The
  //    writer ADAPTED around the scenery/confession gates above — fewer setting
  //    nouns per line, a DIALOGUE bridge, a literal object title, calendar
  //    dialogue, "gbam" filler, decorative Yoruba. This detects the owner's 12
  //    forbidden catalogue patterns; TWO OR MORE is a HARD rejection. Our writer's
  //    output only — the artist's own words are never "contaminated" by us.
  let contamination: ContaminationResult | undefined;
  if (!input.artistAuthored) {
    contamination = detectCatalogueContamination({ title: input.title, body, languageMix: input.languageMix });
    if (contamination.decision) {
      blocks.push(
        `catalogue_contamination_detected: ${contamination.count} patterns [${contamination.patterns.map((p) => p.code).join(', ')}] — resembles ${contamination.resembles}. ${contamination.decision}. Restart from emotion (${contamination.requiredEngine})`,
      );
    }
  }

  // --- ADVISORY WARNINGS (craft — skipped for artist-authored) ---------------
  if (!input.artistAuthored) {
    // Over-length: the audit's median was 353 words; hook-led Afro should be leaner.
    if (total > 260) warnings.push(`over_length: ${total} content words — hook-led Afro records run lean (target < 220)`);

    // Ad-lib density: 43.6% of lines carried parenthetical echoes in the audit.
    const lines = body.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\[[^\]]*\]\s*$/.test(l));
    const withEcho = lines.filter((l) => /\([^)]*\)/.test(l)).length;
    const echoRate = lines.length ? withEcho / lines.length : 0;
    if (echoRate > 0.30) warnings.push(`adlib_density: ${(echoRate * 100).toFixed(0)}% of lines carry a parenthetical — ad-libs are events, not punctuation (target < 20%)`);

    // Template rut: the exact Intro→Verse→Pre-Hook→Hook→Verse→Bridge→Outro spine.
    const seq = sectionSequence(body);
    if (seq.length >= 6 && TEMPLATE_SEQ.every((k, i) => seq[i] === k)) {
      warnings.push('template_structure: the default Intro/Verse/Pre-Hook/Hook/Verse/Bridge/Outro skeleton — vary the structure to the record');
    }

    // English drift on an Afro record.
    const en = input.languageMix?.en ?? 0;
    if (en > 0.6) warnings.push(`english_heavy: ${(en * 100).toFixed(0)}% English — Afro records live in Pidgin/vernacular; English-pop-with-seasoning reads inauthentic`);

    // Environment density in the warn band (below the block threshold).
    if (allLines.length >= 6) {
      const density = envDensity(allLines);
      if (density > 0.4 && density <= 0.6) warnings.push(`environment_density: ${(density * 100).toFixed(0)}% of lines carry a place/food/transport noun — keep only detail that changes the character's choice/emotion/hook`);
    }

    // Title / hook cell should actually appear in the body (title-hook lock).
    const cell = normalizeLyricBody(input.hookCell || input.title || '');
    if (cell && cell.split(' ').length <= 4 && bodyNorm && !(` ${bodyNorm} `).includes(` ${cell} `)) {
      warnings.push(`title_hook_mismatch: the hook cell "${input.hookCell || input.title}" does not appear in the lyric`);
    }
  }

  const ok = blocks.length === 0;
  const band: LyricBand = !ok ? 'F' : warnings.length >= 3 ? 'C' : warnings.length >= 1 ? 'B' : 'A';
  return { ok, blocks, warnings, band, bodyNorm, wordCount: total, duplicateOf, contamination };
}
