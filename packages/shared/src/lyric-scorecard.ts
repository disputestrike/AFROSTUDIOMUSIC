/**
 * LYRIC SCORECARD — the measurable gate for the Singing Brain.
 *
 * Doctrine (owner-approved research): songs are weighted MOMENTS, not
 * sentences. The Writing Brain hands us a SEMANTIC lyric; the Singing Brain
 * returns the SUNG form a vocalist actually delivers — clipped function
 * words, held vowels, repeated cells ("I was thinking about you all night"
 * → "Thinkin' 'bout you / all night / all ni-i-ight"). This file is the
 * RECEIPT for that conversion: pure, zero-dependency measurements the Truth
 * report can display. Numbers, never vibes — a sung lyric either recurs its
 * hook, simplifies its chorus, holds its vowels, repeats its cell and
 * contrasts its sections, or it fails with the exact metric that broke.
 */

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export type SectionKind = 'verse' | 'hook' | 'bridge' | 'intro' | 'outro' | 'prehook' | 'other';

export interface LyricSection {
  /** Header text as written, brackets stripped (e.g. "Verse 2", "Pre-Hook"). */
  name: string;
  kind: SectionKind;
  /** Non-empty lyric lines under the header (headers themselves excluded). */
  lines: string[];
}

const HEADER_RX = /^\s*\[([^\]]+)\]\s*$/;

/** Chorus≈Hook, Pre-Chorus≈Pre-Hook — checked BEFORE hook/chorus so the
 *  "pre" prefix wins; numbers ("Verse 2") and casing never matter. */
export function sectionKindOf(name: string): SectionKind {
  const n = name.toLowerCase();
  if (/pre[\s-]?(hook|chorus)/.test(n)) return 'prehook';
  if (/hook|chorus|refrain/.test(n)) return 'hook';
  if (/verse/.test(n)) return 'verse';
  if (/bridge/.test(n)) return 'bridge';
  if (/intro/.test(n)) return 'intro';
  if (/outro/.test(n)) return 'outro';
  return 'other';
}

/** Split a lyric on [Section] headers. Lines before any header (rare — a
 *  cold-open ad-lib) land in a nameless 'other' section rather than vanish. */
export function parseLyricSections(lyric: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: LyricSection | null = null;
  for (const raw of lyric.split(/\r?\n/)) {
    const m = HEADER_RX.exec(raw);
    if (m) {
      current = { name: m[1]!.trim(), kind: sectionKindOf(m[1]!), lines: [] };
      sections.push(current);
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    if (!current) {
      current = { name: '', kind: 'other', lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Token weighing — what counts as a WORD vs pure melody-carrier
// ---------------------------------------------------------------------------

/** Pure vocables — they carry melody, not meaning, so they never count as
 *  lexical weight. Deliberately small and spec-derived (oh/eh/ah/mm/na/la/
 *  yeah/hey + obvious stretched forms); real Pidgin words like "dey"/"wan"
 *  stay lexical — Pidgin compresses on its own, we don't erase it. */
const VOCABLES = new Set([
  'oh', 'ooh', 'oooh', 'o', 'oo', 'eh', 'ehh', 'ah', 'ahh', 'aah', 'mm', 'mmm',
  'hm', 'hmm', 'mhm', 'na', 'la', 'yeah', 'yea', 'ye', 'hey', 'ay', 'aye',
  'uh', 'uhh', 'whoa', 'woah', 'yo',
]);

const collapse1 = (w: string) => w.replace(/(.)\1+/g, '$1');
const collapse2 = (w: string) => w.replace(/(.)\1{2,}/g, '$1$1');

/** A stretched melisma fragment standing alone ("i-i-i", "o-o-oh", "ya-a-ay")
 *  — hyphen-chained vowel-ish syllables with no real consonant skeleton. */
const MELISMA_FRAGMENT_RX = /^[aeiouhmy]+(?:-[aeiouhmy]+)+$/i;

/** True when a token is pure vocable — checked raw, letter-run-collapsed to
 *  one ("heyyy"→"hey", dehyphenated "o-o-oh"→"oooh"→"oh") and to two
 *  ("mmm"→"mm") so stretched notation still reads as the same vocable. */
export function isVocable(token: string): boolean {
  const w = token.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return true; // punctuation-only fragment — no lexical weight
  return VOCABLES.has(w) || VOCABLES.has(collapse1(w)) || VOCABLES.has(collapse2(w));
}

/** Lexical words of a line: parentheticals (backing/ad-lib layer) stripped,
 *  vocables and melisma extension fragments excluded. "ni-i-ight" is ONE
 *  lexical word ("night" stretched), "o-o-oh" is none. */
export function lexicalWords(line: string): string[] {
  return line
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-zA-Z']+/, '').replace(/[^a-zA-Z']+$/, ''))
    .filter((t) => t.length > 0 && !MELISMA_FRAGMENT_RX.test(t) && !isVocable(t));
}

/** Normalize sung text for phrase/line comparison: melisma folds back into
 *  the base word ("ni-i-ight"→"night", "all"→"al" — consistent on BOTH sides
 *  of every comparison, so matches survive), punctuation and parentheticals
 *  go, whitespace collapses. */
export function normalizeSung(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/([aeiouy])(?:-\1)+/g, '$1') // ni-i-ight → night, o-o-oh → oh
    .replace(/-/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/(.)\1+/g, '$1') // heyyy → hey, oooh → oh (both sides, so it's fair)
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

export type LyricTokenAction = 'A' | 'B' | 'G' | 'O'; // Anchor / Bridge / Ghost / Ornament

export interface LyricAlignmentEntry {
  token: string;
  action: LyricTokenAction;
  note?: string;
}

export interface SungLyricMetrics {
  /** Normalized occurrences of the hook cell across the whole sung lyric. */
  hookRecurrence: number;
  /** Avg lexical words per line, verse 1. */
  verseLexicalDensity: number;
  /** Avg lexical words per line, all hook sections. */
  hookLexicalDensity: number;
  /** 1 - hook/verse density. Negative = hook is DENSER than the verse. */
  chorusLexicalReduction: number;
  /** Held-vowel / melisma events across hook + outro sections. */
  melismaEvents: number;
  /** Repeated lines/fragments found inside hook sections. */
  repeatCells: number;
  /** Relative verse↔hook density gap (0 = verbally identical sections). */
  sectionContrastDelta: number;
  /** Relative verse↔hook line-length (raw tokens/line) gap. */
  lineProfileDelta: number;
  /** Clipped/dropped share of B+G tokens. -1 = not measured (no alignment). */
  clipRatio: number;
  /** B+G population the clip ratio was measured over. */
  clippableTokens: number;
}

export interface SungLyricScore {
  pass: boolean;
  metrics: SungLyricMetrics;
  failures: string[];
  warnings: string[];
}

/** Non-overlapping, word-boundary-safe phrase count on normalized text. */
function countPhrase(hayNorm: string, needleNorm: string): number {
  if (!needleNorm) return 0;
  const hay = ` ${hayNorm} `;
  const needle = ` ${needleNorm} `;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length - 1); // shared boundary space can open the next match
  }
  return n;
}

/** Melisma events per token: hyphen-stretched vowel inside a word
 *  ("ni-i-ight", "o-o-oh"), a 3+ vowel run ("heyyy", "oooh"), or a stretched
 *  standalone vocable ("mmm", "ohhh"). Parentheticals COUNT — a backing
 *  "oooh" is still a held vowel the render engine performs. */
function countMelismaEvents(lines: string[]): number {
  let events = 0;
  for (const line of lines) {
    for (const raw of line.split(/\s+/)) {
      const t = raw.replace(/^[^a-zA-Z]+/, '').replace(/[^a-zA-Z]+$/, '');
      if (!t) continue;
      const lower = t.toLowerCase();
      const hyphenStretch = /([aeiouy])-\1/.test(lower);
      const vowelRun = /([aeiouy])\1{2,}/.test(lower);
      const stretchedVocable = /(.)\1{2,}/.test(lower) && isVocable(t);
      if (hyphenStretch || vowelRun || stretchedVocable) events++;
    }
  }
  return events;
}

/** Repeat cells inside hook sections: exact duplicate lines (normalized),
 *  near-duplicates (one line wholly contains the other, ≥2 words), and
 *  within-line repeated 2-word fragments ("all night … all night"). */
function countRepeatCells(hookSections: LyricSection[]): number {
  let cells = 0;
  for (const sec of hookSections) {
    const norm = sec.lines.map((l) => normalizeSung(l)).filter((l) => l.length > 0);
    const seen = new Map<string, number>();
    for (const l of norm) seen.set(l, (seen.get(l) ?? 0) + 1);
    for (const n of seen.values()) if (n > 1) cells += n - 1;
    const uniq = [...seen.keys()];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const [long, short] = uniq[i]!.length >= uniq[j]!.length ? [uniq[i]!, uniq[j]!] : [uniq[j]!, uniq[i]!];
        if (short.split(' ').length >= 2 && ` ${long} `.includes(` ${short} `)) cells++;
      }
    }
    for (const l of norm) {
      const w = l.split(' ');
      const grams = new Set<string>();
      for (let i = 0; i + 1 < w.length; i++) {
        const g = `${w[i]} ${w[i + 1]}`;
        if (grams.has(g)) { cells++; break; }
        grams.add(g);
      }
    }
  }
  return cells;
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const rel = (a: number, b: number) => { const m = Math.max(a, b); return m <= 0 ? 0 : Math.abs(a - b) / m; };
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** Raw tokens per line (parentheticals stripped) — the line-length profile. */
const rawLineLen = (line: string) => line.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).length;

/** A note that proves a B/G token was actually clipped or dropped. */
const CLIP_NOTE_RX = /clip|drop|elid|ghost|omit|swallow|contract|silent/i;

/**
 * Score a SUNG lyric against the singing-brain laws. Thresholds are from the
 * research doc; every metric ships as a NUMBER so the Truth report can show
 * the measurement, not just the verdict.
 */
export function scoreSungLyric(opts: {
  sungLyric: string;
  hookCell: string;
  alignment?: LyricAlignmentEntry[];
}): SungLyricScore {
  const failures: string[] = [];
  const warnings: string[] = [];
  const sections = parseLyricSections(opts.sungLyric);
  const verse1 = sections.find((s) => s.kind === 'verse');
  const hooks = sections.filter((s) => s.kind === 'hook');
  const outros = sections.filter((s) => s.kind === 'outro');
  const allLines = sections.flatMap((s) => s.lines);

  // (a) hookRecurrence — the cell must come back at least 3 times, anywhere.
  // Counted per line (a hook cell never spans a line break) on normalized text.
  const cellNorm = normalizeSung(opts.hookCell);
  const hookRecurrence = allLines.reduce((n, l) => n + countPhrase(normalizeSung(l), cellNorm), 0);
  if (hookRecurrence < 3) {
    failures.push(`hookRecurrence: hook cell "${opts.hookCell}" appears ${hookRecurrence}x across the sung lyric — needs >= 3 (the cell IS the song)`);
  }

  // Structure guards — without a verse and a hook the reduction/contrast laws
  // have nothing to measure, so they fail loudly instead of dividing by zero.
  if (hooks.length === 0) failures.push('structure: no [Hook]/[Chorus] section found — a sung form without a hook cannot be scored');
  if (!verse1) failures.push('structure: no [Verse] section found — chorus reduction has no baseline');

  // (b) chorusLexicalReduction — the hook must SIMPLIFY vs verse 1.
  const verseDensity = r4(avg((verse1?.lines ?? []).map((l) => lexicalWords(l).length)));
  const hookDensity = r4(avg(hooks.flatMap((s) => s.lines).map((l) => lexicalWords(l).length)));
  const reduction = verseDensity > 0 ? r4(1 - hookDensity / verseDensity) : 0;
  if (verse1 && hooks.length > 0) {
    if (hookDensity > verseDensity) {
      failures.push(`chorusLexicalReduction: hook is DENSER than verse (${hookDensity} vs ${verseDensity} lexical words/line) — sung hooks simplify, they never crowd`);
    } else if (reduction < 0.10) {
      failures.push(`chorusLexicalReduction: ${reduction} < 0.10 — the hook barely simplifies vs the verse (needs >= 0.15, warns under it)`);
    } else if (reduction < 0.15) {
      warnings.push(`chorusLexicalReduction: ${reduction} is thin (0.10-0.15) — aim >= 0.15; ghost more function words in the hook`);
    }
  }

  // (c) melismaEvents — hook + outro must hold at least one vowel.
  const melismaEvents = countMelismaEvents([...hooks, ...outros].flatMap((s) => s.lines));
  if (melismaEvents < 1) {
    failures.push('melismaEvents: 0 held vowels across hook + outro — at least one melisma required (notate as "ni-i-ight" / "oooh")');
  }

  // (d) repeatCell — every song needs a repeated line/fragment inside a hook.
  const repeatCells = countRepeatCells(hooks);
  if (hooks.length > 0 && repeatCells < 1) {
    failures.push('repeatCell: no repeated line or fragment inside any hook section — hooks repeat, that is what makes them hooks');
  }

  // (e) sectionContrast — "verbally identical sections" is the classic tell of
  // a semantic lyric wearing a [Hook] label. Density within 5% AND the same
  // line-length profile = no sung differentiation at all.
  const verseLineLen = r4(avg((verse1?.lines ?? []).map(rawLineLen)));
  const hookLineLen = r4(avg(hooks.flatMap((s) => s.lines).map(rawLineLen)));
  const sectionContrastDelta = r4(rel(verseDensity, hookDensity));
  const lineProfileDelta = r4(rel(verseLineLen, hookLineLen));
  if (verse1 && hooks.length > 0 && sectionContrastDelta < 0.05 && lineProfileDelta < 0.05) {
    failures.push(`sectionContrast: verse and hook are verbally identical (density delta ${sectionContrastDelta}, line profile delta ${lineProfileDelta}) — sections must FEEL different when sung`);
  }

  // (f) clipRatio — only measurable when the Singing Brain handed us its
  // alignment receipts. Crowded phrases should clip/drop 20-40% of their
  // bridge+ghost tokens; under 20% is a WARN (the sung form may read stiff),
  // never a fail — clipping need varies with how crowded the writing was.
  let clippableTokens = 0;
  let clippedTokens = 0;
  for (const a of opts.alignment ?? []) {
    if (a.action === 'B' || a.action === 'G') {
      clippableTokens++;
      if (a.note && CLIP_NOTE_RX.test(a.note)) clippedTokens++;
    }
  }
  const clipRatio = opts.alignment ? r4(clippableTokens > 0 ? clippedTokens / clippableTokens : 0) : -1;
  if (opts.alignment && clippableTokens > 0 && clipRatio < 0.20) {
    warnings.push(`clipRatio: only ${clippedTokens}/${clippableTokens} bridge+ghost tokens clipped or dropped (${clipRatio}) — crowded phrases should clip 20-40%`);
  }

  const metrics: SungLyricMetrics = {
    hookRecurrence,
    verseLexicalDensity: verseDensity,
    hookLexicalDensity: hookDensity,
    chorusLexicalReduction: reduction,
    melismaEvents,
    repeatCells,
    sectionContrastDelta,
    lineProfileDelta,
    clipRatio,
    clippableTokens,
  };
  return { pass: failures.length === 0, metrics, failures, warnings };
}
