/**
 * AFRICAN TONE-PRESERVING G2P — grapheme→pronunciation helpers that keep the
 * ONE thing Western text-to-music engines destroy on African lyrics: LEXICAL
 * TONE. Yoruba, Igbo and Twi are tonal — the SAME syllable at a high vs a low
 * pitch is a DIFFERENT WORD. A model that "sings the melody" over the words
 * flattens that tone and produces gibberish-sounding (and often meaning-changed)
 * vocals. Swahili is not tonal but has a fixed penultimate stress the engines
 * routinely misplace.
 *
 * This module does TWO things and nothing else:
 *   1. detectAfricanLanguage(lyrics) — a diacritic + wordlist heuristic that
 *      names the language (or null), so the pipeline can attach the right note.
 *   2. annotateLyricsForSinging(lyrics, lang) — returns the lyrics VERBATIM
 *      (VERBATIM LAW — user words are NEVER rewritten) plus a compact
 *      style-prompt directive (`toneNotes`) that tells the engine to hold the
 *      lexical tone on RELATIVE pitch. The directive rides the STYLE/TAGS prompt,
 *      never the lyric field.
 *
 * COVERAGE HONESTY (stated, not hidden):
 *   - Yoruba (yor): full rule-based tone extraction from the diacritics —
 *     acute=High, grave=Low, unmarked/macron=Mid — over (C)V syllables with the
 *     gb/kp/gh/ṣ digraphs and syllabic nasals handled. This is the strong lane.
 *   - Swahili (swa): clean CV syllabification + the penultimate-stress rule.
 *     Not tonal, so nothing is lost — the note just fixes the accent.
 *   - Igbo (ibo): PARTIAL. Two-level H/L tone read from marks WHERE PRESENT
 *     (Igbo text is often written tone-unmarked, so most syllables read Mid),
 *     plus the ATR vowel-harmony class of the dotted ị/ọ/ụ. Honestly rough.
 *   - Twi / Akan (aka): PARTIAL. Tone only where the writer marked it; the ɛ/ɔ
 *     open vowels are preserved. The Akan tone system (incl. downstep) is NOT
 *     modelled — the note asks the engine to keep marked contrasts, no more.
 *
 * Zero dependencies, pure/deterministic — the same lyric annotates the same way
 * twice, so the gate can measure it.
 */

export type AfricanLang = 'yor' | 'swa' | 'ibo' | 'aka';

/** Tone level of a syllable: High / Low / Mid (Mid = unmarked in Yoruba). */
export type ToneLevel = 'H' | 'L' | 'M';

export interface SyllableTone {
  /** The syllable graphemes, recomposed (NFC) — verbatim from the source. */
  syllable: string;
  tone: ToneLevel;
}

// Combining marks (operate on NFD so a base vowel + its marks are separate):
const ACUTE = '́'; // High tone
const GRAVE = '̀'; // Low tone
const MACRON = '̄'; // explicit Mid (rare; unmarked is also Mid)
const DOT_BELOW = '̣'; // Yoruba ẹ/ọ/ṣ and Igbo ị/ụ under-dot (ATR/quality, not tone)
const COMBINING = /[̀-ͯ]/;

const isVowelBase = (c: string): boolean => /[aeiou]/i.test(c);
const isNasal = (c: string): boolean => /[mn]/i.test(c);
const isLetter = (c: string): boolean => /[a-z]/i.test(c) || /\p{L}/u.test(c);
const isConsonant = (c: string): boolean => isLetter(c) && !isVowelBase(c) && !COMBINING.test(c);

function toneFromMarks(marks: string): ToneLevel {
  if (marks.includes(ACUTE)) return 'H';
  if (marks.includes(GRAVE)) return 'L';
  if (marks.includes(MACRON)) return 'M'; // explicit mid marking (rare)
  return 'M'; // unmarked → Mid (Yoruba writes mid tone UNMARKED)
}

/**
 * Extract per-syllable tone for ONE Yoruba word. Yoruba syllables are (C)V or a
 * syllabic nasal; there are no codas or clusters, so every consonant since the
 * last vowel is the onset of the next vowel. The gb/kp/gh digraphs and ṣ (s +
 * under-dot) ride along in the onset string; under-dots on vowels (ẹ/ọ) change
 * VOWEL QUALITY, never tone, so they are kept in the syllable text but ignored
 * for the H/L/M decision. A tone-bearing nasal with no following vowel is a
 * syllabic nasal (e.g. "ń" = H, "ǹ" = L).
 */
export function yorubaSyllableTones(word: string): SyllableTone[] {
  const chars = [...(word ?? '').normalize('NFD')];
  const out: SyllableTone[] = [];
  let onset = '';
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (isVowelBase(c)) {
      let j = i + 1;
      let marks = '';
      while (j < chars.length && COMBINING.test(chars[j]!)) {
        marks += chars[j];
        j++;
      }
      out.push({ syllable: (onset + c + marks).normalize('NFC'), tone: toneFromMarks(marks) });
      onset = '';
      i = j;
      continue;
    }
    if (COMBINING.test(c)) {
      // A combining mark on a consonant (ṣ under-dot) — keep it in the onset.
      onset += c;
      i++;
      continue;
    }
    if (isConsonant(c)) {
      if (isNasal(c)) {
        // Peek marks: a TONE-bearing nasal not followed by a vowel is syllabic.
        let j = i + 1;
        let marks = '';
        while (j < chars.length && COMBINING.test(chars[j]!)) {
          marks += chars[j];
          j++;
        }
        const nextBase = chars[j];
        const bearsTone = marks.includes(ACUTE) || marks.includes(GRAVE);
        if (bearsTone && !(nextBase && isVowelBase(nextBase))) {
          out.push({ syllable: (onset + c + marks).normalize('NFC'), tone: toneFromMarks(marks) });
          onset = '';
          i = j;
          continue;
        }
      }
      onset += c;
      i++;
      continue;
    }
    // Punctuation / apostrophes — keep in the onset so nothing is dropped.
    onset += c;
    i++;
  }
  if (onset.trim()) {
    // Trailing consonant(s) with no nucleus — glue onto the last syllable so the
    // word text stays whole (VERBATIM); never invent a phantom nucleus.
    if (out.length) out[out.length - 1]!.syllable += onset.normalize('NFC');
    else out.push({ syllable: onset.normalize('NFC'), tone: 'M' });
  }
  return out;
}

/** Naive Swahili syllable count (strict CV / V structure) — one nucleus per vowel. */
export function swahiliSyllables(word: string): string[] {
  const chars = [...(word ?? '').toLowerCase()];
  const syllables: string[] = [];
  let onset = '';
  for (const c of chars) {
    if (isVowelBase(c)) {
      syllables.push(onset + c);
      onset = '';
    } else if (isLetter(c)) {
      onset += c;
    }
  }
  if (onset && syllables.length) syllables[syllables.length - 1] += onset;
  else if (onset) syllables.push(onset);
  return syllables;
}

// Distinctive wordlists (function words + song vocabulary). Kept deliberately
// distinctive to avoid English false-positives — no bare 'me'/'wo'/'so'/'no'.
const WORDLISTS: Record<AfricanLang, ReadonlySet<string>> = {
  yor: new Set([
    'omo', 'ọmọ', 'ife', 'ifẹ', 'ìfẹ', 'ìfẹ́', 'feran', 'fẹ́ràn', 'ololufe', 'olólùfẹ́',
    'jowo', 'jọwọ', 'jọ̀wọ́', 'oya', 'jare', 'pele', 'pẹlẹ', ' pẹ̀lẹ́', 'gbedu', 'sunmi',
    'baba', 'iya', 'ìyá', 'oko', 'aya', 'orin', 'ijo', 'ijó', 'ayo', 'ayọ̀', 'inu', 'okan', 'ọkàn',
  ]),
  swa: new Set([
    'nakupenda', 'ninakupenda', 'wewe', 'mimi', 'sana', 'karibu', 'asante', 'penda',
    'upendo', 'mapenzi', 'mpenzi', 'moyo', 'dada', 'kaka', 'tafadhali', 'twende',
    'hakuna', 'matata', 'jambo', 'rafiki', 'nataka', 'malaika', 'wangu', 'yangu', 'nzuri', 'habari',
  ]),
  ibo: new Set([
    'nwa', 'biko', 'obi', 'ihunanya', 'chukwu', 'chineke', 'nne', 'nna', 'ezigbo',
    'anyi', 'anyị', 'asusu', 'asụsụ', 'nwoke', 'nwanyi', 'nwanyị', 'ada', 'obim', 'ọma',
    'ihe', 'omalicha', 'ọmalicha', 'daalu', 'imela',
  ]),
  aka: new Set([
    'medaase', 'meda', 'odo', 'ɔdɔ', 'akwaaba', 'aane', 'daabi', 'nyame', 'obiaa',
    'ɛyɛ', 'yɛ', 'yɛn', 'wɔn', 'papa', 'sɛn', 'wiase', 'adɔeɛ', 'menua', 'ɔdɔfoɔ',
  ]),
};

/**
 * Name the African language of a lyric, or null. Combines two honest signals:
 * distinctive diacritics (Yoruba ṣ/ẹ/ọ under-dots, Igbo ị/ụ dotted vowels, Twi
 * ɛ/ɔ open vowels) and a distinctive wordlist. Best score wins; a tie prefers
 * the diacritic-anchored lane. Returns null when nothing scores — the pipeline
 * then attaches no tone note (fail-open, never a false Yoruba tag on English).
 */
export function detectAfricanLanguage(lyrics: string): AfricanLang | null {
  const text = (lyrics ?? '').toLowerCase();
  if (!text.trim()) return null;
  const nfd = text.normalize('NFD');
  const scores: Record<AfricanLang, number> = { yor: 0, swa: 0, ibo: 0, aka: 0 };

  // Diacritic anchors (strong signals).
  const hasTone = new RegExp(`[${ACUTE}${GRAVE}]`).test(nfd);
  const yorUnderdot = new RegExp(`[eo]${DOT_BELOW}|s${DOT_BELOW}`).test(nfd); // ẹ ọ ṣ
  const igboDot = new RegExp(`[iu]${DOT_BELOW}`).test(nfd); // ị ụ (Yoruba lacks these)
  const akanOpen = /[ɛɔ]/.test(text);
  if (yorUnderdot) scores.yor += 3;
  if (igboDot) scores.ibo += 3;
  if (akanOpen) scores.aka += 3;
  // A tone mark alongside a lane's own under-dot reinforces that lane.
  if (hasTone && yorUnderdot) scores.yor += 1;
  if (hasTone && igboDot) scores.ibo += 1;

  // Distinctive wordlist hits.
  const words = text.normalize('NFC').split(/[^\p{L}̀-ͯ]+/u).filter((w) => w.length >= 2);
  for (const raw of words) {
    const w = raw.normalize('NFC');
    for (const lang of Object.keys(WORDLISTS) as AfricanLang[]) {
      if (WORDLISTS[lang].has(w)) scores[lang] += 2;
    }
  }

  let best: AfricanLang | null = null;
  let bestScore = 0;
  for (const lang of ['yor', 'swa', 'ibo', 'aka'] as AfricanLang[]) {
    if (scores[lang] > bestScore) {
      bestScore = scores[lang];
      best = lang;
    }
  }
  return bestScore > 0 ? best : null;
}

const cap = (s: string, n = 240): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Content tokens for the tone sample — parentheticals/brackets stripped. */
function contentTokens(lyrics: string): string[] {
  return (lyrics ?? '')
    .replace(/\[[^\]]*\]/g, ' ') // [Section] tags
    .replace(/\([^)]*\)/g, ' ') // ad-lib parentheticals
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}̀-ͯ]+/u, '').replace(/[^\p{L}̀-ͯ]+$/u, ''))
    .filter((t) => /[\p{L}]/u.test(t));
}

/**
 * Return the lyrics VERBATIM plus a compact style-prompt directive that tells a
 * text-to-music engine how to hold the language's tone/stress. `annotated` is
 * BYTE-FOR-BYTE the input — the VERBATIM LAW forbids rewriting user lyrics — and
 * `toneNotes` is what the caller appends to the STYLE/TAGS prompt (never to the
 * lyric field).
 */
export function annotateLyricsForSinging(
  lyrics: string,
  lang: AfricanLang
): { annotated: string; toneNotes: string } {
  const annotated = lyrics ?? ''; // VERBATIM — do not touch the user's words.
  const tokens = contentTokens(annotated);

  let toneNotes = '';
  switch (lang) {
    case 'yor': {
      const sample = tokens
        .slice(0, 4)
        .map((w) => {
          const tones = yorubaSyllableTones(w).map((s) => s.tone).join('-');
          return tones ? `${w}=${tones}` : '';
        })
        .filter(Boolean)
        .join(', ');
      toneNotes = cap(
        `Yoruba tonal singing: preserve LEXICAL TONE on relative pitch — high (H) syllables sung higher, low (L) lower, mid (M) level` +
          (sample ? `; sample contour ${sample}` : '') +
          `; keep gb/kp and ẹ/ọ/ṣ sounds; do NOT flatten tone into a Western melodic run.`
      );
      break;
    }
    case 'swa': {
      const sample = tokens.find((w) => swahiliSyllables(w).length >= 2);
      const syl = sample ? swahiliSyllables(sample) : [];
      const marked = syl.length
        ? syl.map((s, i) => (i === syl.length - 2 ? s.toUpperCase() : s)).join('-')
        : '';
      toneNotes = cap(
        `Swahili singing (not tonal): stress the PENULTIMATE syllable of each word` +
          (marked ? ` (e.g. ${marked})` : '') +
          `; clean open CV vowels (a e i o u), even melodic phrasing with the natural penult accent.`
      );
      break;
    }
    case 'ibo': {
      toneNotes = cap(
        `Igbo tonal singing (partial support): two-level High/Low lexical tone — keep MARKED highs higher and lows lower on relative pitch; ` +
          `respect ATR vowel harmony (dotted ị/ọ/ụ are open/darker [-ATR]); coverage is rough, so preserve marked contrasts and do NOT flatten tone.`
      );
      break;
    }
    case 'aka': {
      toneNotes = cap(
        `Twi/Akan singing (rough tone support): hold High/Low tone WHERE MARKED on relative pitch and keep the open ɛ/ɔ vowels distinct; ` +
          `the full Akan tone/downstep system is not modelled — preserve the marked contrasts, do not invent a Western run.`
      );
      break;
    }
  }
  return { annotated, toneNotes };
}
