/**
 * MUSIC PRODUCER — agent #2 of the multi-agent producer studio.
 *
 * Owner directive (2026-07-12, the multi-agent producer spec): the studio must
 * behave like a disciplined team, not one text generator. This agent owns ONE
 * thing — the GROOVE BEHAVIOR and the ARRANGEMENT of a single record — and it is
 * held to a hard doctrine that exists because the old single-prompt pipeline kept
 * producing "same-y" beats:
 *
 *   1. Behavior over inventory. A beat is NOT a list of instruments. Naming
 *      "log drum" / "gbedu" / "shaker" / "808" is BANNED as a way to describe the
 *      record — it says nothing about how the thing actually moves. We describe
 *      WHERE the kick sits against the beat, how the swing leans, what syncopates
 *      against what, and how every element answers or clears space for the voice.
 *   2. Vocal pocket first — the beat is built around where the lead breathes.
 *   3. Energy is a CURVE across sections, never a flat wall of loud.
 *   4. Negative space is a design tool, not an accident.
 *   5. Exactly ONE record-specific signature event — the gesture that makes THIS
 *      song identifiable in two seconds. Never a genre cliché.
 *   6. Arrangement follows FUNCTION. We do NOT default to
 *      Intro/Verse/Pre-Hook/Hook/Verse2/Bridge/Outro — sections are derived from
 *      what this record has to DO to the listener in the stated moment.
 *   7. Every ban from Stage 0 (catalogue precheck) and Stage 1 (the brief's
 *      forbidden list) is honored as a prohibited move — enforced in code below,
 *      not left to the model's memory.
 *
 * Cost law: this is structuring/analysis work, so it runs tier:'bulk' (Cerebras
 * first). tier:'judgment' is reserved for final taste passes elsewhere.
 *
 * Honesty law: there is NO hosted, controllable beat-render engine yet. This
 * agent emits a DIRECTIVE (the DNA + arrangement), not audio. Any rendered-audio
 * id therefore stays null — we never fabricate a stem that doesn't exist.
 */
import type {
  CreativeBrief,
  CatalogueSimilarity,
  BeatDna,
  ArrangementSection,
} from '@afrohit/shared';
import { generateJson } from '../generate';
import { getSoundDNA, soundBrief, blendSoundBrief } from '../sound-dna';

/** What the LLM is asked to return — validated/coerced before it becomes BeatDna. */
interface RawArrangementSection {
  name?: unknown;
  bars?: unknown;
  role?: unknown;
}
interface RawEnergyPoint {
  section?: unknown;
  energy?: unknown;
}
interface RawBeatResponse {
  bpm?: unknown;
  key?: unknown;
  grooveBehavior?: unknown;
  vocalPocket?: unknown;
  arrangement?: unknown;
  energyCurveBySection?: unknown;
  signatureEvent?: unknown;
  prohibitedMoves?: unknown;
  negativeSpace?: unknown;
}

// ---- tiny defensive coercions (bulk brains return imperfect JSON) ----------
const asStr = (x: unknown, fallback = ''): string =>
  typeof x === 'string' ? x.trim() : x == null ? fallback : String(x).trim();

const asNum = (x: unknown, fallback: number): number => {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
};

const asStrArr = (x: unknown): string[] =>
  Array.isArray(x) ? x.map((v) => asStr(v)).filter((s) => s.length > 0) : [];

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
};

/**
 * The lane reference for the LLM. We accept a pre-computed genreDna string from
 * the orchestrator; otherwise we derive one from the brief's genre (+ fusion) via
 * the Sound DNA library. This is CONTEXT for the lane's feel — the prompt forbids
 * the model from copying its instrument names into the output.
 */
function resolveGenreBrief(
  brief: CreativeBrief,
  provided?: string,
): string {
  const explicit = provided?.trim();
  if (explicit) return explicit;
  const fusion = (brief.fusion ?? []).map((g) => g.trim()).filter((g) => g.length > 0);
  const res = fusion.length
    ? blendSoundBrief([brief.genre, ...fusion])
    : soundBrief(brief.genre);
  return (res.brief ?? '').trim();
}

const SYSTEM = [
  'You are the MUSIC PRODUCER, agent #2 in AfroHit\'s multi-agent producer studio',
  '(owner spec, 2026-07-12). You receive ONE creative brief and design the BEAT DNA',
  'and the ARRANGEMENT for a single record. You do NOT write lyrics, topline, or mix —',
  'only how the record GROOVES and how it is SHAPED in time.',
  '',
  'DOCTRINE — non-negotiable:',
  '1. BEHAVIOR, NEVER AN INVENTORY. It is FORBIDDEN to define the record by naming',
  '   sounds ("log drum", "gbedu", "shaker", "808", "talking drum"). Those words are',
  '   banned from your output. Instead describe WHERE the kick sits relative to the',
  '   beat, how the swing leans, what syncopates against what, how the low end and the',
  '   percussion answer or clear space for the voice. A reader must FEEL the groove',
  '   without a single instrument named.',
  '2. VOCAL POCKET FIRST. State where the lead voice enters, rests, anticipates the',
  '   downbeat, and where the arrangement deliberately clears so it can breathe.',
  '3. ENERGY IS A CURVE (0-100 per section), not a constant — tension, restraint,',
  '   release, payoff. The curve must tell a story.',
  '4. NEGATIVE SPACE is a tool: name the sections/moments where elements drop out and',
  '   answer the vocal.',
  '5. EXACTLY ONE signature event — a single, concrete, record-specific sonic gesture',
  '   that makes THIS song identifiable in two seconds (e.g. "the low end vanishes for',
  '   the last two bars of the drop so the ad-lib lands dry, then slams back on the',
  '   one"). Never a genre cliché, never more than one.',
  '6. ARRANGEMENT FOLLOWS FUNCTION. Do NOT default to',
  '   Intro/Verse/Pre-Hook/Hook/Verse2/Bridge/Outro. Derive each section from what THIS',
  '   record must DO to the listener in the stated moment; name sections by their',
  '   function; set bar counts that serve the energy curve.',
  '7. HONOR EVERY BAN — the forbidden structures/vocab/hook-shapes from the catalogue',
  '   precheck and the brief are prohibited moves for this beat.',
  '',
  'The GENRE DNA in the user message is REFERENCE for the lane\'s feel only. Translate',
  'it into behavior. Do NOT copy its instrument names into your output.',
  '',
  'Return STRICT JSON ONLY, exactly this shape:',
  '{',
  '  "bpm": number,                       // within the brief\'s tempo range',
  '  "key": string,                       // e.g. "F# minor"',
  '  "grooveBehavior": string,            // behavior only, zero instrument names',
  '  "vocalPocket": string,               // where the lead enters/rests/anticipates/leaves space',
  '  "arrangement": [                     // function-named sections, NOT the banned template',
  '    { "name": string, "bars": number, "role": string }',
  '  ],',
  '  "energyCurveBySection": [            // one point per arrangement section, same names',
  '    { "section": string, "energy": number }   // energy 0-100',
  '  ],',
  '  "signatureEvent": string,            // EXACTLY ONE record-specific moment',
  '  "prohibitedMoves": [string],         // cliches/structures this beat must avoid',
  '  "negativeSpace": [string]            // sections/moments elements drop to answer the vocal',
  '}',
].join('\n');

function buildUserPrompt(
  brief: CreativeBrief,
  similarity: CatalogueSimilarity | undefined,
  genreBrief: string,
): string {
  const [lo, hi] = brief.tempoRange;
  const parts: string[] = [
    'CREATIVE BRIEF (Stage 1):',
    `- Primary emotion: ${brief.primaryEmotion}`,
    `- Listener moment: ${brief.listenerMoment}`,
    `- Artist identity: ${brief.artistIdentity}`,
    `- Genre: ${brief.genre}${brief.fusion?.length ? ` (fusion: ${brief.fusion.join(' × ')})` : ''}`,
    `- Tempo range: ${lo}-${hi} bpm — choose a bpm inside this range that serves the emotion.`,
    `- Core premise: ${brief.corePremise}`,
    brief.tension ? `- Central tension: ${brief.tension}` : '',
    `- Lyric mode: ${brief.lyricMode}`,
    `- Borrowed market qualities (borrow the feel, never copy): ${brief.borrowedQualities.join('; ') || '(none)'}`,
    `- FORBIDDEN for this record (must not appear as moves): ${brief.forbidden.join('; ') || '(none)'}`,
  ];

  if (similarity) {
    parts.push(
      '',
      'CATALOGUE PRECHECK (Stage 0) — this record must NOT resemble these:',
      `- Nearest catalogue titles: ${similarity.nearestTitles.join(', ') || '(none)'}`,
      `- Forbidden structures: ${similarity.forbiddenStructures.join('; ') || '(none)'}`,
      `- Forbidden hook shapes: ${similarity.forbiddenHookShapes.join('; ') || '(none)'}`,
      `- Over-used vocab to avoid: ${similarity.forbiddenVocab.join(', ') || '(none)'}`,
    );
  }

  if (genreBrief) {
    parts.push(
      '',
      'GENRE DNA (lane reference — translate to BEHAVIOR, do not name instruments in your output):',
      genreBrief.slice(0, 1600),
    );
  }

  parts.push(
    '',
    'Design the beat DNA and arrangement now. Behavior over inventory. One signature event.',
    'Sections named by function. Return STRICT JSON only.',
  );

  return parts.filter((p) => p.length > 0).join('\n');
}

/**
 * produceBeatDna — Stage 2. Given the brief (and optionally the catalogue
 * similarity + a genre-DNA brief), design the groove BEHAVIOR, vocal pocket,
 * energy curve, negative space and the one signature event, plus a
 * function-derived arrangement.
 */
export async function produceBeatDna(opts: {
  brief: CreativeBrief;
  similarity?: CatalogueSimilarity;
  genreDna?: string;
}): Promise<{ beatDna: BeatDna; arrangement: ArrangementSection[] }> {
  const { brief, similarity } = opts;
  const genreBrief = resolveGenreBrief(brief, opts.genreDna);

  const raw = await generateJson<RawBeatResponse>({
    system: SYSTEM,
    user: buildUserPrompt(brief, similarity, genreBrief),
    tier: 'bulk', // structuring work — Cerebras-first per the owner's cost law
    task: 'music_producer.beat_dna',
    temperature: 0.7,
    maxTokens: 1500,
  });

  // ---- arrangement: coerce, then fall back to a FUNCTION-named skeleton -----
  const rawSections = Array.isArray(raw.arrangement) ? raw.arrangement : [];
  let arrangement: ArrangementSection[] = rawSections
    .map((s): ArrangementSection => {
      const o = (s && typeof s === 'object' ? s : {}) as RawArrangementSection;
      const bars = Math.round(asNum(o.bars, 8));
      return {
        name: asStr(o.name, 'Section'),
        bars: bars > 0 ? bars : 8,
        role: asStr(o.role, ''),
      };
    })
    .filter((s) => s.name.length > 0);

  if (arrangement.length === 0) {
    // Structural fallback — deliberately NOT the banned template. Three beats
    // named by function so downstream stages have real sections to work against.
    arrangement = [
      { name: 'Entry', bars: 8, role: 'establish the groove and pull the listener into the stated moment' },
      { name: 'Core', bars: 16, role: 'deliver the central hook at full pocket around the vocal' },
      { name: 'Release', bars: 8, role: 'open to negative space so the hook and ad-libs breathe, then resolve' },
    ];
  }

  // ---- energy curve: coerce, else derive a ramp keyed to the arrangement ----
  const rawEnergy = Array.isArray(raw.energyCurveBySection) ? raw.energyCurveBySection : [];
  let energyCurveBySection = rawEnergy
    .map((e) => {
      const o = (e && typeof e === 'object' ? e : {}) as RawEnergyPoint;
      return { section: asStr(o.section, ''), energy: clamp(Math.round(asNum(o.energy, 50)), 0, 100) };
    })
    .filter((e) => e.section.length > 0);

  if (energyCurveBySection.length === 0) {
    // Never ship an empty curve: a gentle rising ramp mapped to real sections.
    // Structural default, not a taste claim — a downstream evaluator can revise.
    const n = arrangement.length;
    energyCurveBySection = arrangement.map((s, i) => ({
      section: s.name,
      energy: n <= 1 ? 60 : clamp(Math.round(30 + (60 * i) / (n - 1)), 0, 100),
    }));
  }

  // ---- prohibited moves: union the model's list with every actual ban -------
  const prohibitedMoves = dedupe([
    ...asStrArr(raw.prohibitedMoves),
    ...(brief.forbidden ?? []),
    ...(similarity?.forbiddenStructures ?? []),
    ...(similarity?.forbiddenHookShapes ?? []),
  ]);

  // ---- exactly ONE signature event (flag, never fabricate, when missing) ----
  const sigRaw = raw.signatureEvent;
  const signatureEvent =
    (Array.isArray(sigRaw) ? asStr(sigRaw[0], '') : asStr(sigRaw, '')) ||
    'UNSPECIFIED — the producer pass did not commit to one signature event; revise before render.';

  // ---- key: model value, else the lane's first common key -------------------
  const dna = getSoundDNA(brief.genre);
  const key = asStr(raw.key, '') || asStr(dna?.commonKeys?.[0], 'A minor');

  // ---- bpm: clamp into the brief's tempo range ------------------------------
  const [tLo, tHi] = brief.tempoRange;
  const midBpm = Math.round((tLo + tHi) / 2);
  const bpm = clamp(Math.round(asNum(raw.bpm, midBpm)), tLo, tHi);

  const grooveBehavior =
    asStr(raw.grooveBehavior, '') ||
    'UNSPECIFIED groove behavior — revise the beat pass.';
  const vocalPocket =
    asStr(raw.vocalPocket, '') ||
    'UNSPECIFIED vocal pocket — revise the beat pass.';

  const beatDna: BeatDna = {
    bpm,
    key,
    grooveBehavior,
    vocalPocket,
    energyCurveBySection,
    signatureEvent,
    prohibitedMoves,
    negativeSpace: asStrArr(raw.negativeSpace),
    // HONEST NULL: no hosted, controllable beat-render engine exists yet. This
    // stage emits a directive, not a rendered stem — we never fabricate an id.
    audioSketchId: null,
  };

  return { beatDna, arrangement };
}