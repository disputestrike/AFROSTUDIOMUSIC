/**
 * TITLE LAW — what a hit title looks like, enforced in code (owner directive
 * 2026-07-12: "how can a song like this go global?" — titles were sentence-soup
 * spun off lyric text because no doctrine existed).
 *
 * The evidence base is the actual Afro global canon: Essence. Calm Down. Rush.
 * Water. Terminator. Soso. Unavailable. Ozeba. MMS. One to three words —
 * chantable, searchable, ownable. A title is a BRAND ASSET, not a summary.
 *
 * Pure TS, zero deps — mechanics never need a brain (BRAIN ≠ MECHANICS law).
 * The brain DRAFTS candidates; this law GATES them; a deterministic sanitizer
 * rescues a lawful title from any text when every candidate fails.
 */

export interface TitleLawResult {
  ok: boolean;
  reasons: string[];
  wordCount: number;
}

/** Hard ceiling — 4 words covers the real canon's tail ("Lonely at the Top"). */
export const TITLE_MAX_WORDS = 4;
export const TITLE_MAX_CHARS = 28;

/** Characters that make a title read as a SENTENCE, not a brand. */
const SENTENCE_PUNCTUATION = /[.,;:!?"()[\]{}<>]|—|–| - /;

/** Filler heads that signal a clause got promoted to a title. */
const CLAUSE_HEADS = new Set(['wetin', 'because', 'maybe', 'perhaps', 'when', 'how', 'what', 'this', 'that', 'the']);

export function titleLawCheck(raw: string): TitleLawResult {
  const title = (raw ?? '').trim();
  const reasons: string[] = [];
  const words = title.split(/\s+/).filter(Boolean);

  if (!title) reasons.push('empty');
  if (/\r|\n/.test(title)) reasons.push('multiline');
  if (title.length > TITLE_MAX_CHARS) reasons.push(`over ${TITLE_MAX_CHARS} chars`);
  if (words.length > TITLE_MAX_WORDS) reasons.push(`over ${TITLE_MAX_WORDS} words (sentence, not a title)`);
  if (SENTENCE_PUNCTUATION.test(title)) reasons.push('sentence punctuation');
  if (/\b(feat|ft)\.?\b/i.test(title)) reasons.push('featuring credit does not belong in a title');
  // A 3+ word title opening on a clause head ("Wetin We Go...", "This Block Na
  // ...") is a sentence fragment wearing a title's clothes.
  if (words.length >= 3 && CLAUSE_HEADS.has(words[0]!.toLowerCase())) {
    reasons.push('opens like a clause, not a brand');
  }

  return { ok: reasons.length === 0, reasons, wordCount: words.length };
}

/** Title-case a word, preserving intentional ALL-CAPS (MMS, OZEBA). */
function titleCaseWord(w: string): string {
  if (w.length > 1 && w === w.toUpperCase()) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'we', 'i', 'my', 'your', 'na', 'dey', 'go', 'this', 'that', 'wetin', 'kind', 'like', 'is', 'it', 'no', 'oh', 'eh', 'o', 'ooo']);

/**
 * Deterministically rescue a lawful title from any text (a hook line, a hook
 * cell, a lyric fragment): keep the strongest 1-3 content words, title-cased.
 * Never returns empty — falls back to the first words when everything is a
 * stop word.
 */
export function sanitizeTitle(text: string): string {
  const words = (text ?? '')
    .replace(/\(.*?\)/g, ' ') // drop parentheticals (ad-libs)
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Untitled';
  const content = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const picked = (content.length ? content : words).slice(0, 3);
  let title = picked.map(titleCaseWord).join(' ');
  if (title.length > TITLE_MAX_CHARS) title = picked.slice(0, 2).map(titleCaseWord).join(' ').slice(0, TITLE_MAX_CHARS).trim();
  return title || 'Untitled';
}

/**
 * The gate every title-setting site uses: first candidate that passes the law
 * wins; when none do, the sanitizer derives a lawful title from the fallback
 * text (usually the hook cell). Deterministic, brain-optional.
 */
export function pickLawfulTitle(candidates: string[], fallbackText: string): string {
  for (const c of candidates) {
    if (titleLawCheck(c).ok) return c.trim();
  }
  return sanitizeTitle(fallbackText);
}

/** Injected into the drafting prompt so the brain aims at the law, not around it. */
export const TITLE_LAW_BRIEF = `TITLE LAWS (hard requirements):
- 1-3 words strongly preferred; 4 words absolute maximum; ${TITLE_MAX_CHARS} characters max.
- Never a sentence or clause. No punctuation. Chantable in one breath.
- Searchable and ownable: unique enough to own the search result, natural enough that a fan types it after one listen.
- The canon to beat: Essence. Calm Down. Rush. Water. Terminator. Soso. Unavailable. One-word titles with texture win.
- Pidgin/Yoruba/Igbo words welcome when they are the hook's identity.`;
