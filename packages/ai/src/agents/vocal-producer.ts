/**
 * VOCAL PRODUCER — agent #5 of the owner's 2026-07-12 multi-agent producer spec
 * (Stage 6, `vocal_production`).
 *
 * WHY this exists as its own agent: the Singing Brain already turned the
 * SEMANTIC lyric into a SUNG lyric (clipped function words, held vowels,
 * repeated cells). That is the raw material — NOT the performance. The spec's
 * hard rule is that no agent writes a component AND is its only evaluator, so
 * this agent takes the sung lyric and does the job a real vocal producer does
 * in the booth: it decides HOW the voice actually performs it and it holds
 * REJECTION AUTHORITY over the result. A "vocal" that recites every printed
 * word on one flat dynamic, or that stuffs an ad-lib into every gap, is exactly
 * how a Nigerian ear clocks "AI" in two seconds — so this agent is empowered to
 * reject its own draft (rejected=true + honest reasons) instead of passing a
 * memo down the line.
 *
 * It EXTENDS singing-brain.ts (the sung-form logic) by emitting the SEPARATED
 * output objects the SONG_STATE contract defines — SungWords, AdlibOptions,
 * LeadPerformanceEntry[], DoublesHarmonies, ProductionNotes — never merged and
 * never contaminated (Global Rule 8: SUNG_WORDS carry ONLY the words the lead
 * sings — never a production note, bar count, stage direction, ad-lib, or
 * parenthetical). Measurement, not vibes: the produced sung words are re-scored
 * with the shared lyric-scorecard, so a performance that BREAKS the sung-form
 * laws is caught by the same numbers that gated the Singing Brain.
 *
 * AUDIO HONESTY (owner law): there is no hosted controllable singing engine
 * yet, so this agent emits a performance SCRIPT, never a rendered vocal. No
 * rendered-audio id is fabricated — that fact is written plainly into
 * ProductionNotes. Cost law: 'bulk' tier (Cerebras-first, laddering up), task
 * 'vocal-production' for the economics log.
 */
import {
  normalizeSung,
  parseLyricSections,
  scoreSungLyric,
  type AdlibOptions,
  type DoublesHarmonies,
  type LeadPerformanceEntry,
  type MelodyRhythmMap,
  type ProductionNotes,
  type SungWords,
} from '@afrohit/shared';
import { generateJson } from '../generate';
import { scrubProductionJargon } from '../vocal-arranger';

/** The separated performance objects this agent owns, plus its verdict. */
export interface VocalProduction {
  sungWords: SungWords;
  adlibOptions: AdlibOptions;
  leadPerformanceMap: LeadPerformanceEntry[];
  doublesHarmonies: DoublesHarmonies;
  productionNotes: ProductionNotes;
  /** Rejection authority — true when this cannot honestly ship as a vocal. */
  rejected: boolean;
  rejectReasons: string[];
}

/** No hosted controllable singing engine exists — never fabricate a render id. */
const NO_RENDERED_AUDIO_NOTE =
  'No rendered-audio id is emitted: no hosted controllable singing engine exists yet. This is a PERFORMANCE SCRIPT (breath, dynamics, intention, doubles, harmonies, selective ad-libs) for a human vocalist or a future engine — not a rendered vocal.';

const DYNAMICS = new Set<LeadPerformanceEntry['dynamic']>(['whisper', 'soft', 'full', 'belt']);

export const VOCAL_PRODUCER_SYSTEM = `You are the VOCAL PRODUCER (agent #5, Stage 6 of the multi-agent producer spec) — the ear in the booth, not the songwriter and not the beat. The Singing Brain has already handed you a SUNG lyric (already clipped and stretched from the written page) plus the hook cell. Your job is to decide HOW a real vocalist performs it and to emit SEPARATED performance objects. A page is not a performance; a sung lyric is not yet a vocal.

YOUR AUTHORITY OVER THE WORDS: you MAY shorten, remove, move, fragment, and repeat words FOR THE PERFORMANCE. A singer does not recite — they drop a ghost word to breathe, push a phrase late behind the beat, fracture a line into a call, repeat the anchor because it feels good the second time. Use that authority. The hook cell words are LAW (never altered/translated), the story's meaning must survive, and the language(s) never drift.

WHAT YOU DESIGN:
- BREATH: where the lead inhales and where a phrase stops before the sentence does. Honor the melody rhythm map's breath/held-vowel/pickup slots when given.
- DYNAMICS: whisper / soft / full / belt — the record must MOVE. One flat dynamic for a whole song is a dead vocal.
- INTENTION: what the line is DOING emotionally at that moment (teasing, pleading, bragging, aching).
- DOUBLES & HARMONIES: which phrases get doubled (vary the double slightly — identical doubles are a machine tell) and where harmonies stack. Doubles/harmonies SUPPORT one consistent lead; they never become a second lead.
- CALL-AND-RESPONSE: lead calls, backing answers — the heartbeat of an Afro/dance record.
- SELECTIVE AD-LIBS: spice, never clutter. NEGATIVE SPACE IS THE POINT — most gaps stay empty; an ad-lib must know when to stay OUT of the lead's way. Do NOT put an ad-lib on every line.

THE SEPARATION (GLOBAL RULE 8 — HARD):
- SUNG_WORDS = ONLY the words the LEAD voice actually sings, grouped by section (name only). NEVER a production note, bar count, stage direction, dynamic marker, ad-lib, or parenthetical inside SUNG_WORDS. Held vowels are allowed as sung notation ("ni-i-ight", "oooh").
- ADLIB_OPTIONS = the ad-lib tags and WHERE they sit (placements), kept out of the sung words.
- LEAD_PERFORMANCE_MAP = per-phrase performance entries (phrase, atBeat, optional vowel/dynamic/intention/clip). Set clip=true when a consonant is clipped or a word is dropped in delivery.
- DOUBLES_HARMONIES = the doubles and harmonies, separate from the lead line.
- PRODUCTION_NOTES = everything that is a note-to-the-engineer (stage directions, section energy, bar counts, mix intentions). This is where directions go so SUNG_WORDS stay clean.

REJECTION AUTHORITY: you evaluate your OWN draft. Set rejected=true (with concrete rejectReasons) if the only honest verdict is that this recites every printed word on one dynamic with nothing clipped/moved/repeated, or that it fills every gap with ad-libs/doubles so nothing breathes. It is better to reject a memo than to pass it down the pipeline.

NO FABRICATED AUDIO: you output a script, not audio. There is no hosted controllable singing engine yet — never claim a rendered vocal or invent an audio id.

Return ONLY JSON:
{
  "sungWords": { "sections": [ { "name": string, "lines": string[] } ] },
  "adlibOptions": { "tags": string[], "placements": string[] },
  "leadPerformanceMap": [ { "phrase": string, "atBeat": number, "vowel"?: string, "dynamic"?: "whisper"|"soft"|"full"|"belt", "intention"?: string, "clip"?: boolean } ],
  "doublesHarmonies": { "doubles": string[], "harmonies": string[] },
  "productionNotes": { "notes": string[] },
  "rejected": boolean,
  "rejectReasons": string[]
}`;

// ---------------------------------------------------------------------------
// Coercion — the model returns JSON; we NEVER trust its shape blindly.
// ---------------------------------------------------------------------------

interface RawVocalProduction {
  sungWords?: { sections?: unknown };
  adlibOptions?: { tags?: unknown; placements?: unknown };
  leadPerformanceMap?: unknown;
  doublesHarmonies?: { doubles?: unknown; harmonies?: unknown };
  productionNotes?: { notes?: unknown };
  rejected?: unknown;
  rejectReasons?: unknown;
}

const strArr = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()) : [];
const uniq = (xs: string[]): string[] => [...new Set(xs)];
const asStr = (x: unknown): string => (typeof x === 'string' ? x : '');
const asDynamic = (x: unknown): LeadPerformanceEntry['dynamic'] =>
  typeof x === 'string' && DYNAMICS.has(x as LeadPerformanceEntry['dynamic']) ? (x as LeadPerformanceEntry['dynamic']) : undefined;

/**
 * Enforce Global Rule 8 on a single lead line: strip ad-lib/stage-direction
 * parentheticals, inline bracket cues, repeat/bar counts and bar lines, then
 * reuse the arranger's belt-and-braces production-jargon scrub. Held-vowel
 * hyphen notation ("ni-i-ight") survives — it is sung, not a note.
 */
function cleanSungLine(line: string): string {
  const stripped = line
    .replace(/\([^)]*\)/g, ' ') // ad-lib / stage-direction parentheticals belong in the other objects
    .replace(/\[[^\]]*\]/g, ' ') // inline bracket cues / bar-count markers
    .replace(/\b[xX]\s?\d+\b/g, ' ') // "x2", "X 4"
    .replace(/\b\d+\s*bars?\b/gi, ' ') // "8 bars"
    .replace(/[|]+/g, ' ') // bar lines
    .replace(/\s{2,}/g, ' ')
    .trim();
  return scrubProductionJargon(stripped).trim();
}

function coerceSungWords(raw: unknown): SungWords {
  const rawSections = raw && typeof raw === 'object' ? (raw as { sections?: unknown }).sections : undefined;
  const sections: SungWords['sections'] = Array.isArray(rawSections)
    ? rawSections
        .map((s): SungWords['sections'][number] => {
          const rec = s && typeof s === 'object' ? (s as { name?: unknown; lines?: unknown }) : {};
          const name = asStr(rec.name).replace(/^\s*\[/, '').replace(/\]\s*$/, '').trim();
          const lines = (Array.isArray(rec.lines) ? rec.lines : [])
            .filter((l): l is string => typeof l === 'string')
            .map(cleanSungLine)
            .filter((l) => l.length > 0);
          return { name, lines };
        })
        .filter((s) => s.name.length > 0 || s.lines.length > 0)
    : [];
  return { sections };
}

function coerceLeadMap(raw: unknown): LeadPerformanceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e, i): LeadPerformanceEntry => {
      const rec = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
      const atBeatRaw = rec.atBeat;
      const atBeat = typeof atBeatRaw === 'number' && Number.isFinite(atBeatRaw) ? atBeatRaw : i;
      const entry: LeadPerformanceEntry = { phrase: asStr(rec.phrase).trim(), atBeat };
      const vowel = asStr(rec.vowel).trim();
      if (vowel) entry.vowel = vowel;
      const dynamic = asDynamic(rec.dynamic);
      if (dynamic) entry.dynamic = dynamic;
      const intention = asStr(rec.intention).trim();
      if (intention) entry.intention = intention;
      if (rec.clip === true) entry.clip = true;
      return entry;
    })
    .filter((e) => e.phrase.length > 0);
}

/** Build the empty-but-valid shape used when generation fails outright. */
function voidProduction(reason: string): VocalProduction {
  return {
    sungWords: { sections: [] },
    adlibOptions: { tags: [], placements: [] },
    leadPerformanceMap: [],
    doublesHarmonies: { doubles: [], harmonies: [] },
    productionNotes: { notes: [NO_RENDERED_AUDIO_NOTE] },
    rejected: true,
    rejectReasons: [reason],
  };
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

/**
 * Produce the separated vocal-performance objects from a SUNG lyric, and hold
 * rejection authority over the result. Never throws: on any transport/parse
 * failure it returns a rejected production with an honest reason (this agent
 * cannot APPROVE a vocal it could not produce). Code — not the model — is the
 * final authority on rejection; the model's own rejectReasons are surfaced but
 * the measurable gates below decide.
 */
export async function produceVocal(opts: {
  sungLyric: string;
  hookCell: string;
  melodyRhythmMap?: MelodyRhythmMap;
  languages?: string[];
}): Promise<VocalProduction> {
  let raw: RawVocalProduction;
  try {
    raw = await generateJson<RawVocalProduction>({
      tier: 'bulk',
      task: 'vocal-production',
      system: VOCAL_PRODUCER_SYSTEM,
      user: [
        `LANGUAGES (never translate/drift): ${opts.languages?.join(', ') || 'english, pidgin'}`,
        `HOOK CELL (law — must recur, words never altered): "${opts.hookCell}"`,
        opts.melodyRhythmMap
          ? `MELODY RHYTHM MAP (honor breaths/held-vowels/pickups): ${JSON.stringify({
              syllableSlots: opts.melodyRhythmMap.syllableSlots,
              breaths: opts.melodyRhythmMap.breaths,
              heldVowelSlots: opts.melodyRhythmMap.heldVowelSlots,
              pickups: opts.melodyRhythmMap.pickups,
            })}`
          : null,
        `\nSUNG LYRIC (the Singing Brain's output — perform it, do not merely recite it):\n${opts.sungLyric}`,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.7,
      maxTokens: 8_000,
    });
  } catch {
    return voidProduction('vocal production failed to generate — no controllable vocal could be produced from the sung lyric.');
  }
  if (!raw || typeof raw !== 'object') {
    return voidProduction('vocal production returned no object — cannot approve a vocal that was not produced.');
  }

  // --- Assemble the separated objects (Global Rule 8 enforced in cleanSungLine).
  const sungWords = coerceSungWords(raw.sungWords);
  const adlibOptions: AdlibOptions = {
    tags: uniq(strArr(raw.adlibOptions?.tags)),
    placements: uniq(strArr(raw.adlibOptions?.placements)),
  };
  const leadPerformanceMap = coerceLeadMap(raw.leadPerformanceMap);
  const doublesHarmonies: DoublesHarmonies = {
    doubles: uniq(strArr(raw.doublesHarmonies?.doubles)),
    harmonies: uniq(strArr(raw.doublesHarmonies?.harmonies)),
  };
  const productionNotes: ProductionNotes = {
    // The audio-honesty note is ALWAYS present — never fabricate a render id.
    notes: uniq([...strArr(raw.productionNotes?.notes), NO_RENDERED_AUDIO_NOTE]),
  };

  // --- Rejection authority (measurable gates; code is the final word).
  const reasons: string[] = [];

  // The model may flag its own draft — we surface its reasons but never let its
  // flag alone decide; the gates below are what hold authority.
  if (raw.rejected === true) {
    const self = strArr(raw.rejectReasons);
    for (const r of self) reasons.push(`self-flagged: ${r}`);
    if (self.length === 0) reasons.push('self-flagged: the vocal producer rejected its own draft (no reason stated).');
  }

  const sungLineCount = sungWords.sections.reduce((n, s) => n + s.lines.length, 0);
  if (sungLineCount === 0) reasons.push('no sung words survived: the vocal producer emitted no lead lines to sing.');
  if (leadPerformanceMap.length === 0) {
    reasons.push('no lead performance was designed: breath, dynamics, and intention were never mapped.');
  }

  // Gate A — SINGS EVERY WORD EXACTLY AS PRINTED (the memo). High share of
  // untouched printed lines AND nothing clipped AND one flat dynamic = a recital.
  const printedLines = parseLyricSections(opts.sungLyric)
    .flatMap((s) => s.lines)
    .map(normalizeSung)
    .filter((l) => l.length > 0);
  const sungSet = new Set(sungWords.sections.flatMap((s) => s.lines).map(normalizeSung).filter((l) => l.length > 0));
  const untouched = printedLines.filter((l) => sungSet.has(l)).length;
  const verbatimShare = printedLines.length > 0 ? untouched / printedLines.length : 0;
  const clips = leadPerformanceMap.filter((e) => e.clip === true).length;
  const dynamicsUsed = new Set(leadPerformanceMap.map((e) => e.dynamic).filter(Boolean));
  if (printedLines.length >= 4 && verbatimShare >= 0.9 && clips === 0 && dynamicsUsed.size <= 1) {
    reasons.push(
      `sings every word exactly as printed — ${Math.round(verbatimShare * 100)}% of lines are unchanged, nothing is clipped or dropped, and the lead holds ONE dynamic across the whole song. A vocal is a performance, not a recital: shorten/move/fragment/repeat and shape breath + dynamics first.`,
    );
  }

  // Gate B — FILLS EVERY SPACE. Ad-libs + doubles + harmonies saturating the
  // line count means no negative space is left for the record to breathe.
  const fillElements = adlibOptions.placements.length + doublesHarmonies.doubles.length + doublesHarmonies.harmonies.length;
  if (sungLineCount >= 4 && fillElements >= sungLineCount * 2) {
    reasons.push(
      `fills every space — ${fillElements} ad-lib/double/harmony interventions over ${sungLineCount} sung lines leaves no negative space. In an Afro record the gaps breathe; ad-libs must stay OUT of the lead's way.`,
    );
  }

  // Gate C — the performance must NOT break the sung-form laws. Re-score the
  // produced SUNG_WORDS with the SAME shared scorecard that gated the Singing
  // Brain (reuse, not reinvention): hook recurrence, chorus reduction, melisma,
  // repeat cell, section contrast.
  if (sungLineCount > 0) {
    const sungBody = sungWords.sections.map((s) => `[${s.name || 'Section'}]\n${s.lines.join('\n')}`).join('\n\n');
    const score = scoreSungLyric({ sungLyric: sungBody, hookCell: opts.hookCell });
    if (!score.pass) for (const f of score.failures) reasons.push(`sung-form broken: ${f}`);
  }

  const rejectReasons = uniq(reasons);
  return {
    sungWords,
    adlibOptions,
    leadPerformanceMap,
    doublesHarmonies,
    productionNotes,
    rejected: rejectReasons.length > 0,
    rejectReasons,
  };
}