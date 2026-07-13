/**
 * LANGUAGE & CULTURAL AUTHENTICITY AGENT (#6) — the native-ear gate.
 *
 * Owner directive (2026-07-12, the multi-agent producer spec): the studio is a
 * disciplined team, and THIS agent guards the one failure that instantly brands
 * an Afro record as fake to the people who actually speak the language — wrong,
 * unnatural, or culturally implausible non-English lines, and (worse) a melody
 * that flips a tonal word's meaning. Stage 5 (`language_review`) reads the
 * fitted lyric and writes LanguageReviewEntry verdicts; it NEVER rewrites lines
 * itself (that routes back to the Songwriter) and NEVER declares a record clean.
 *
 * TWO doctrines are enforced in CODE, not left to the model's goodwill:
 *
 *  1. REFUSE > FABRICATE (house law). Correct spelling is NOT approval. A verdict
 *     that fails to parse falls SAFE to HUMAN_NATIVE_REVIEW_REQUIRED — the agent
 *     never silently stamps "APPROVED".
 *
 *  2. TONE-MELODY HONESTY. In Yoruba/Igbo/Zulu/Xhosa and their kin, pitch is
 *     lexical: the sung melody can override a word's tone and change what it
 *     means. This function is handed only a `hasMelody` flag — not the melody —
 *     and there is NO hosted, controllable singing engine to hear the take (so
 *     any rendered-audio id stays out of scope / null with an honest note). So
 *     once a tone-language phrase will be sung, its tone-melody fit is
 *     UNVERIFIABLE by the AI: we set toneMelodyConflict and route it to a human
 *     native speaker. blocksRelease trips whenever ANY tone-language phrase needs
 *     that human review.
 *
 * Cost law: tier 'bulk' (Cerebras-first, laddering up), task 'language-review'.
 */
import type { LanguageReviewEntry, LanguageVerdict } from '@afrohit/shared';
import { generateJson } from '../generate';

/** The three legal verdicts — anything else is untrusted and fails safe. */
const VALID_VERDICTS: ReadonlySet<string> = new Set<string>([
  'APPROVED',
  'REWRITE',
  'HUMAN_NATIVE_REVIEW_REQUIRED',
]);

/**
 * Tonal languages where a sung melody can change a word's meaning. ISO 639-1/3
 * codes AND English names, because the model may tag a phrase either way. This
 * list deliberately EXCLUDES the widely-sung African languages that are NOT
 * tonal — Swahili, Wolof, Fula/Fulfulde, Amharic, and English-based creoles
 * (Nigerian Pidgin, Krio) — so we neither over-block them nor under-protect the
 * genuinely tonal ones. "and similar" (owner spec) is read generously toward
 * bona-fide tone languages of the Afro catalogue.
 */
const TONE_LANGUAGE_KEYS: ReadonlySet<string> = new Set<string>([
  // codes
  'yo', 'yor', 'ig', 'ibo', 'ha', 'hau', 'zu', 'zul', 'xh', 'xho',
  'ak', 'aka', 'tw', 'twi', 'fat', 'ee', 'ewe', 'gaa', 'ga', 'fon',
  'sn', 'sna', 'nd', 'nde', 'nr', 'nbl', 'ss', 'ssw', 'ki', 'kik',
  'lg', 'lug', 'ln', 'lin', 'kg', 'kon', 'bm', 'bam', 'dyu', 'nup',
  'lu', 'lub', 'bem', 'ven', 'tso', 'nso', 'st', 'sot', 'ny', 'nya',
  'sg', 'sag',
  // english names
  'yoruba', 'igbo', 'hausa', 'zulu', 'xhosa', 'akan', 'twi', 'fante',
  'ewe', 'fon', 'shona', 'ndebele', 'swati', 'swazi', 'kikuyu', 'gikuyu',
  'ganda', 'luganda', 'lingala', 'kongo', 'kikongo', 'bambara', 'dyula',
  'jula', 'dioula', 'nupe', 'tiv', 'efik', 'ibibio', 'luba', 'bemba',
  'venda', 'tsonga', 'sotho', 'sesotho', 'pedi', 'chichewa', 'chewa',
  'nyanja', 'sango',
]);

const ENGLISH_KEYS: ReadonlySet<string> = new Set<string>(['en', 'eng', 'english']);

/** Normalise a language label to a base token: "Yoruba (Nigeria)" -> "yoruba", "yo-NG" -> "yo". */
function baseToken(label: string): string {
  const raw = label.toLowerCase().trim();
  const base = raw.split(/[\s\-_(/,]/)[0] ?? '';
  return base;
}

/** Is this language label English? (English lines never get language verdicts.) */
function isEnglish(label: string): boolean {
  const raw = label.toLowerCase().trim();
  return ENGLISH_KEYS.has(raw) || ENGLISH_KEYS.has(baseToken(label));
}

/**
 * Tone-language test, robust to codes, names, and decorated labels. Short keys
 * (<= 3 chars, e.g. "yo", "ewe") match only exactly or as the base token, so a
 * non-tonal word can't collide with them; long name keys also match as a
 * substring ("Yoruba (Nigeria)" -> yoruba).
 */
function isToneLanguage(label: string | undefined | null): boolean {
  if (!label) return false;
  const raw = label.toLowerCase().trim();
  if (!raw) return false;
  if (TONE_LANGUAGE_KEYS.has(raw)) return true;
  const base = baseToken(label);
  if (base && TONE_LANGUAGE_KEYS.has(base)) return true;
  for (const key of TONE_LANGUAGE_KEYS) {
    if (key.length >= 4 && raw.includes(key)) return true;
  }
  return false;
}

/** Append the honest limitation caveat to whatever the model noted. */
function withCaveat(note: string, caveat: string): string {
  const base = note.trim();
  return base ? `${base} — ${caveat}` : caveat;
}

/** The raw, untrusted shape the model returns. Every field is validated below. */
interface RawEntry {
  phrase?: unknown;
  language?: unknown;
  languageCode?: unknown;
  verdict?: unknown;
  toneMelodyConflict?: unknown;
  note?: unknown;
}

const LANGUAGE_SYSTEM = `You are the Language & Cultural Authenticity Agent (agent #6) in AfroHit's multi-agent producer studio (owner spec, 2026-07-12). You protect the record from the fastest way to sound fake: wrong, unnatural, or culturally implausible non-English lines. You DO NOT rewrite the lyric and you NEVER declare a song clean — you only judge each non-English phrase.

METHOD
- Scan the lyric for EVERY non-English word or phrase. Merge contiguous words of the same language into one phrase entry. Skip pure proper nouns, brand names, and non-lexical vocables/onomatopoeia (e.g. "eh eh", "na na") unless they carry real meaning.
- Give each phrase ONE verdict:
  - "APPROVED": a fluent native speaker would say exactly this — natural speech, real idiom, right register, culturally plausible in this line's context. Correct spelling ALONE is never enough.
  - "REWRITE": understood but wrong — dictionary/translation-ese, unnatural word order, wrong register or dialect mix, or an "idiom" that no native uses. The note must say precisely what is wrong.
  - "HUMAN_NATIVE_REVIEW_REQUIRED": you cannot responsibly clear it — subtle/ambiguous meaning, risky cultural connotation, or (tone languages) tone-melody safety you cannot verify.
- Note: ONE short, specific sentence. No praise, no hedging filler.

TONE LANGUAGES (Yoruba, Igbo, Hausa, Zulu, Xhosa, Akan/Twi, Ewe, Fon, Shona, Lingala, Kikuyu, Bambara, and similar): pitch is lexical — the SUNG melody can override a word's tone and change its meaning. You are told only whether a melody exists (MELODY EXISTS below); you are NOT given the melody and you cannot hear the sung take. So when a tone-language phrase will be sung, its tone-melody fit is UNVERIFIABLE by you: set "toneMelodyConflict": true and verdict "HUMAN_NATIVE_REVIEW_REQUIRED". If no melody exists yet, set "toneMelodyConflict": false and judge the words alone.

Never fabricate approval. When unsure, choose REWRITE or HUMAN_NATIVE_REVIEW_REQUIRED.

Return ONLY JSON:
{"entries":[{"phrase":"<verbatim>","language":"<english name>","languageCode":"<iso code or ''>","verdict":"APPROVED|REWRITE|HUMAN_NATIVE_REVIEW_REQUIRED","toneMelodyConflict":true,"note":"<one specific sentence>"}]}
If there is no non-English content, return {"entries":[]}. No prose, no markdown, no code fences.`;

export interface ReviewLanguageOptions {
  lyricBody: string;
  languages: string[];
  hasMelody?: boolean;
}

export interface ReviewLanguageResult {
  entries: LanguageReviewEntry[];
  blocksRelease: boolean;
}

/**
 * Review every non-English phrase in a lyric for native naturalness, idiom,
 * cultural plausibility, and (for tone languages) tone-melody safety.
 *
 * blocksRelease is true when ANY tone-language phrase ends up needing a human
 * native speaker — the studio cannot auto-clear the language gate on tonal
 * content it can neither fully verify nor hear sung.
 */
export async function reviewLanguage(opts: {
  lyricBody: string;
  languages: string[];
  hasMelody?: boolean;
}): Promise<ReviewLanguageResult> {
  const lyricBody = (opts.lyricBody ?? '').trim();
  const languages = Array.isArray(opts.languages) ? opts.languages.filter((l) => typeof l === 'string' && l.trim()) : [];
  const hasMelody = opts.hasMelody === true;

  // Nothing to review — do not invent phrases or verdicts.
  if (!lyricBody) return { entries: [], blocksRelease: false };

  let raw: RawEntry[] | null = null;
  try {
    const out = await generateJson<{ entries: RawEntry[] }>({
      tier: 'bulk',
      task: 'language-review',
      system: LANGUAGE_SYSTEM,
      user: [
        `DECLARED LANGUAGES: ${languages.length ? languages.join(', ') : '(none declared — detect any non-English content)'}`,
        `MELODY EXISTS (the words will be sung to a fixed melody): ${hasMelody ? 'yes' : 'no'}`,
        '',
        'LYRIC:',
        lyricBody.slice(0, 8000),
      ].join('\n'),
      temperature: 0.3,
      maxTokens: 1600,
    });
    if (out && Array.isArray(out.entries)) raw = out.entries;
    else console.warn('[language-agent] model returned no entries array — falling back to human-review posture');
  } catch (err) {
    console.warn(
      `[language-agent] review unavailable (${(err as Error)?.message?.slice(0, 120)}) — failing safe to human native review`,
    );
  }

  // TRANSPORT / PARSE FAILURE — refuse > fabricate. We do NOT know the phrases,
  // so we never claim clearance: every declared non-English language is flagged
  // for a human native speaker, and any tone language among them blocks release.
  if (!raw) return failSafe(languages, hasMelody);

  const entries: LanguageReviewEntry[] = [];
  let blocksRelease = false;

  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const phrase = typeof r.phrase === 'string' ? r.phrase.trim() : '';
    if (!phrase) continue;

    const langName =
      (typeof r.language === 'string' && r.language.trim()) ||
      (typeof r.languageCode === 'string' && r.languageCode.trim()) ||
      'unknown';

    // English lines are out of scope for this agent — skip them.
    if (isEnglish(langName) || isEnglish(typeof r.languageCode === 'string' ? r.languageCode : '')) continue;

    // Untrusted verdict fails SAFE to human review — never a silent APPROVED.
    let verdict: LanguageVerdict = VALID_VERDICTS.has(r.verdict as string)
      ? (r.verdict as LanguageVerdict)
      : 'HUMAN_NATIVE_REVIEW_REQUIRED';
    let note = typeof r.note === 'string' ? r.note.trim() : '';

    const tone =
      isToneLanguage(langName) || isToneLanguage(typeof r.languageCode === 'string' ? r.languageCode : '');

    let toneMelodyConflict: boolean | undefined;
    if (tone) {
      if (hasMelody) {
        // Sung tone language: pitch can flip meaning and we cannot hear the take.
        // Unverifiable by AI => a native human must confirm tone-melody fit. A
        // genuine word error (REWRITE) still takes precedence so it gets fixed.
        toneMelodyConflict = true;
        if (verdict !== 'REWRITE') verdict = 'HUMAN_NATIVE_REVIEW_REQUIRED';
        note = withCaveat(
          note,
          'tone language sung to a melody: pitch can change the lexical meaning and the sung take cannot be heard (no controllable singing engine), so a native speaker must confirm the melody preserves the words',
        );
      } else {
        // No melody yet: nothing to clash with. Judge the words; re-review later.
        toneMelodyConflict = false;
        note = withCaveat(
          note,
          'tone language: no melody is set yet, so tone-melody fit is unchecked and must be re-reviewed once a melody exists',
        );
      }
    }

    const entry: LanguageReviewEntry = { phrase, language: langName, verdict, note };
    if (toneMelodyConflict !== undefined) entry.toneMelodyConflict = toneMelodyConflict;
    entries.push(entry);

    if (tone && verdict === 'HUMAN_NATIVE_REVIEW_REQUIRED') blocksRelease = true;
  }

  return { entries, blocksRelease };
}

/**
 * Honest fallback when the review call fails: we cannot see the phrases, so we
 * refuse to certify anything. Each declared non-English language is routed to a
 * human native speaker; tone languages among them block the release gate.
 */
function failSafe(languages: string[], hasMelody: boolean): ReviewLanguageResult {
  const nonEnglish = languages.filter((l) => !isEnglish(l));
  if (nonEnglish.length === 0) return { entries: [], blocksRelease: false };

  const entries: LanguageReviewEntry[] = [];
  let blocksRelease = false;
  for (const lang of nonEnglish) {
    const tone = isToneLanguage(lang);
    const entry: LanguageReviewEntry = {
      phrase: `(all ${lang} content)`,
      language: lang,
      verdict: 'HUMAN_NATIVE_REVIEW_REQUIRED',
      note: `automated language review was unavailable; a native ${lang} speaker must review this record's ${lang} lines by hand`,
    };
    if (tone) {
      entry.toneMelodyConflict = hasMelody;
      blocksRelease = true;
    }
    entries.push(entry);
  }
  return { entries, blocksRelease };
}
