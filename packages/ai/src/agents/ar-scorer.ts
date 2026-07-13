/**
 * A&R SCORER — the scoring half of the Catalogue QA Agent (#7).
 *
 * Owner directive (2026-07-12, the multi-agent producer spec): the studio is a
 * disciplined team, not one text generator, and NO agent writes a component AND
 * is its only evaluator. This module is the A&R half of the LAST gate: it reads
 * a finished topline/lyric and scores it across the twelve QaScores dimensions,
 * then lets the shared, code-enforced gate (qaVerdict + FATAL_QA_DIMENSIONS)
 * decide the fate. It NEVER declares a song "mastered" or "10/10" — the only
 * outcomes are the three producer Decisions, and any single score is capped at 9
 * because a perfect score needs external-listener evidence this pipeline cannot
 * yet produce.
 *
 * Two design laws are load-bearing here:
 *  1. HONEST AUDIO. No hosted, controllable singing engine exists yet, so there
 *     is no rendered-audio id to hand back — that field stays null everywhere in
 *     the state, and hookSound / vocalPerformance / replayBehavior are judged
 *     from lyric + structure signals ONLY, flagged provisional in the note. We
 *     refuse to fabricate a "we listened" verdict.
 *  2. DEFAULT-CLOSED GATE. If the model cannot return a complete, well-formed
 *     score set we throw rather than emit a fabricated pass/fail — refusing beats
 *     rejecting-and-restarting a real record on a missing number.
 *
 * Cost law: this analysis/structuring work runs tier:'bulk' (Cerebras-first,
 * laddering up on failure); only final human taste is a 'judgment' call, and a
 * gate score is analysis, not taste. Task label 'catalogue-qa-ar' for the log.
 *
 * The scorer also ships two PURE (no-LLM) catalogue-originality helpers used by
 * the orchestrator's Stage 0 precheck and here in the note:
 *  - hookRhythmFingerprint(): a deterministic syllable-rhythm skeleton so two
 *    hooks with the same beat shape (reworded but identical cadence) collide.
 *  - titleTooClose(): near-duplicate title detection against the live catalogue.
 */
import { qaVerdict, FATAL_QA_DIMENSIONS, type QaScores } from '@afrohit/shared';
import { generateJson } from '../generate';

/** The only verdicts this gate may reach (a subset of ProducerDecision). */
export type ArVerdict = 'REJECT_AND_RESTART' | 'REVISE_FROM_STAGE_X' | 'CANDIDATE_FOR_HUMAN_AR';

export interface ArScoreResult {
  scores: QaScores;
  verdict: ArVerdict;
  /** The fatal dimensions that scored < 7 (empty when the gate is cleared). */
  failedDimensions: string[];
  /** Honest, human-readable rationale — includes the no-audio caveat. */
  note: string;
}

/** The twelve QaScores keys, in the canonical order we score and validate them. */
const QA_DIMENSIONS: Array<keyof QaScores> = [
  'artistIdentity', 'hookSound', 'melodicMemory', 'rhythmicPocket', 'emotionalTruth',
  'naturalLanguage', 'vocalPerformance', 'productionIdentity', 'structurePacing',
  'catalogueOriginality', 'culturalAuthenticity', 'replayBehavior',
];

/** One-line scoring rubric per dimension, injected into the strict-JSON prompt. */
const DIMENSION_GUIDE: Record<keyof QaScores, string> = {
  artistIdentity: 'does one specific artist own this, or could anyone have sung it (POV, attitude, voice)?',
  hookSound: 'is the hook cell undeniable and chantable on first pass, not generic filler?',
  melodicMemory: 'can a listener hum the melodic idea back after one listen (shape, motif, singability)?',
  rhythmicPocket: 'do the words sit in the groove — pickups, stresses and rests land in the pocket?',
  emotionalTruth: 'is there one true feeling landed, or vague mood words standing in for it?',
  naturalLanguage: 'does every line read as something a real person would actually say/sing (no translationese, no filler)?',
  vocalPerformance: 'do the phrasing choices imply a performable, dynamic vocal (judged from text — NO audio exists)?',
  productionIdentity: 'does the implied arrangement have one record-specific signature, not a stock lane preset?',
  structurePacing: 'does the section flow earn attention across its length without dead bars or a bloated back half?',
  catalogueOriginality: 'is the premise/hook shape fresh vs. worn cliches (true dedup runs separately via the fingerprint/title helpers)?',
  culturalAuthenticity: 'is heritage-language / cultural material used accurately and respectfully, tone and meaning intact?',
  replayBehavior: 'is there a reason to press repeat — a loopable moment or an unresolved pull?',
};

/** No rendered audio exists — say so, every time, so no one reads a listened-to verdict into this. */
const AUDIO_HONESTY =
  'No hosted controllable singing engine exists yet, so no rendered-audio id was produced; hookSound, vocalPerformance and replayBehavior are inferred from lyric and structure only and stay provisional until a human listens.';

const SYSTEM = `You are the A&R half of a music studio's final Catalogue QA gate. A separate agent wrote this song; you did NOT write it and you owe it no loyalty — score it the way a ruthless, fair label A&R would on first exposure.

Score EACH of these twelve dimensions from 0 to 9 (integers or one decimal). The dimensions marked [FATAL <7] cannot be hidden by a good average — a single one below 7 sinks the record, so score them honestly, never generously:

{DIMENSIONS}

HARD RULES:
- The maximum any dimension may receive is 9. NEVER give a 10 and NEVER call the song mastered, finished, or release-ready — a perfect score requires external listeners this pipeline does not have.
- You are scoring TEXT (title, hook cell, sung lyric). No audio has been rendered. Judge hookSound, vocalPerformance and replayBehavior from cadence, phrasing and structure signals only; do not pretend you heard a voice.
- Do not inflate scores to be kind. A weak hook or unnatural language must score below 7.

Return ONLY this JSON, no prose, no markdown fences:
{"scores":{"artistIdentity":n,"hookSound":n,"melodicMemory":n,"rhythmicPocket":n,"emotionalTruth":n,"naturalLanguage":n,"vocalPerformance":n,"productionIdentity":n,"structurePacing":n,"catalogueOriginality":n,"culturalAuthenticity":n,"replayBehavior":n},"reasons":{"<dimension>":"one short clause"},"note":"one honest sentence overall"}
"reasons" should cover at least the lowest-scoring dimensions.`;

export interface ArScoreInput {
  title: string;
  sungLyric: string;
  hookCell: string;
  genre: string;
  languages?: string[];
}

/**
 * Score a finished record for the A&R gate. Throws (default-closed) if the model
 * cannot return a complete, well-formed score set — we refuse to emit a
 * fabricated pass/fail, per the owner's "refuse beats fabricate" law.
 */
export async function scoreForAR(opts: ArScoreInput): Promise<ArScoreResult> {
  const fatalSet = new Set<string>(FATAL_QA_DIMENSIONS as ReadonlyArray<string>);
  const dimensionLines = QA_DIMENSIONS
    .map((d) => `- ${d}${fatalSet.has(d) ? ' [FATAL <7]' : ''}: ${DIMENSION_GUIDE[d]}`)
    .join('\n');
  const system = SYSTEM.replace('{DIMENSIONS}', dimensionLines);

  const fingerprint = hookRhythmFingerprint(opts.hookCell);
  const langs = (opts.languages ?? []).map((l) => l.trim()).filter(Boolean);
  const culturalApplies = culturalGateApplies(langs);

  const user = [
    `TITLE: ${opts.title || '(untitled)'}`,
    `GENRE: ${opts.genre || '(unspecified)'}`,
    `LANGUAGES: ${langs.length ? langs.join(', ') : '(unspecified)'}`,
    `HOOK CELL: ${opts.hookCell || '(none)'}`,
    `HOOK RHYTHM FINGERPRINT (deterministic, for your reference): ${fingerprint || '(empty)'}`,
    `CULTURAL AUTHENTICITY IS ${culturalApplies ? 'A FATAL GATE for this record.' : 'NOT gated (no heritage language declared) — score it for reference only.'}`,
    '',
    'SUNG LYRIC:',
    opts.sungLyric.slice(0, 4000) || '(empty)',
  ].join('\n');

  // BULK tier (cost law): scoring is analysis/structuring, not final human taste.
  const data = await generateJson<ArScoreRaw>({
    tier: 'bulk',
    task: 'catalogue-qa-ar',
    system,
    user,
    temperature: 0.2,
    maxTokens: 900,
  });

  const { scores, missing } = parseScores(data);
  if (missing.length > 0) {
    // DEFAULT-CLOSED: never fabricate the missing numbers, and never reject-and-
    // restart a real record on a scorer hiccup — refuse and let the orchestrator
    // re-run the gate.
    throw new Error(
      `A&R scorer returned an incomplete score set (missing/invalid: ${missing.join(', ')}) — refusing to emit a fabricated gate result`,
    );
  }

  const { pass, failed } = qaVerdict(scores, culturalApplies);
  const failedDimensions = failed.map((d) => String(d));
  const verdict = mapVerdict(pass, failed);

  const note = buildNote({ verdict, failed, culturalApplies, fingerprint, modelNote: data.note, reasons: data.reasons });
  return { scores, verdict, failedDimensions, note };
}

/**
 * Map the shared gate result to a producer Decision, per the 2026-07-12 spec:
 *  - a fatal fail on the hook sound or on natural language means the foundation
 *    is wrong → REJECT_AND_RESTART.
 *  - any other fatal fail is fixable upstream → REVISE_FROM_STAGE_X.
 *  - all fatals cleared → CANDIDATE_FOR_HUMAN_AR (never "mastered").
 */
function mapVerdict(pass: boolean, failed: Array<keyof QaScores>): ArVerdict {
  if (pass || failed.length === 0) return 'CANDIDATE_FOR_HUMAN_AR';
  if (failed.includes('hookSound') || failed.includes('naturalLanguage')) return 'REJECT_AND_RESTART';
  return 'REVISE_FROM_STAGE_X';
}

/** Cultural authenticity is a fatal gate whenever a heritage (non-English) language
 *  is in play. With none declared we default it ON: this catalogue is heritage-
 *  rooted, so the honest default is to gate, not to skip. */
function culturalGateApplies(languages: string[]): boolean {
  const english = new Set(['en', 'eng', 'english']);
  const declared = languages.map((l) => l.toLowerCase());
  if (declared.length === 0) return true;
  return declared.some((l) => !english.has(l));
}

interface ArScoreRaw {
  scores?: Record<string, unknown>;
  reasons?: Record<string, unknown>;
  note?: unknown;
}

/** Validate + clamp the model's scores. Missing/invalid dims are reported, never
 *  guessed; a max of 9 is enforced (a 10 needs external-listener evidence). */
function parseScores(data: ArScoreRaw): { scores: QaScores; missing: string[] } {
  // Accept the scores nested under `scores` or, defensively, at the top level.
  const raw: Record<string, unknown> =
    data.scores && typeof data.scores === 'object'
      ? data.scores
      : (data as unknown as Record<string, unknown>);
  const partial: Partial<Record<keyof QaScores, number>> = {};
  const missing: string[] = [];
  for (const dim of QA_DIMENSIONS) {
    const clamped = clampScore(raw[dim]);
    if (clamped === null) missing.push(dim);
    else partial[dim] = clamped;
  }
  // Safe cast: only reached with an empty `missing`, i.e. all twelve present.
  return { scores: partial as QaScores, missing };
}

/** Clamp to [0, 9] (never 10), one decimal; null for anything not a finite number. */
function clampScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const capped = Math.max(0, Math.min(9, value));
  return Math.round(capped * 10) / 10;
}

function buildNote(args: {
  verdict: ArVerdict;
  failed: Array<keyof QaScores>;
  culturalApplies: boolean;
  fingerprint: string;
  modelNote: unknown;
  reasons: Record<string, unknown> | undefined;
}): string {
  const { verdict, failed, culturalApplies, fingerprint, modelNote, reasons } = args;
  const parts: string[] = [];
  parts.push(`Verdict: ${verdict}.`);
  parts.push(
    failed.length
      ? `Fatal dimensions below 7: ${failed.map((d) => String(d)).join(', ')}.`
      : 'All fatal dimensions cleared (>=7).',
  );
  parts.push(
    culturalApplies
      ? 'Cultural authenticity scored as a fatal gate (heritage-language / Afro lane).'
      : 'Cultural authenticity was NOT gated (English-only lyric declared) and counts for reference only.',
  );
  parts.push(`Hook rhythm fingerprint: ${fingerprint || '(empty hook)'}.`);
  parts.push(AUDIO_HONESTY);

  // Fold the model's reasons for the failed dimensions into the note when present.
  if (reasons && typeof reasons === 'object' && failed.length) {
    const reasonBits = failed
      .map((d) => {
        const r = (reasons as Record<string, unknown>)[d];
        return typeof r === 'string' && r.trim() ? `${d}: ${r.trim()}` : null;
      })
      .filter((x): x is string => x !== null);
    if (reasonBits.length) parts.push(`Why it failed — ${reasonBits.join('; ')}.`);
  }
  if (typeof modelNote === 'string' && modelNote.trim()) parts.push(`A&R note: ${modelNote.trim()}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// PURE catalogue-originality helpers (no LLM, deterministic, unit-testable).
// ---------------------------------------------------------------------------

/** Decompose to base Latin so tonal/diacritic marks don't split the rhythm count. */
function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Approximate sung-syllable count for one word: vowel groups, min 1 slot. We do
 *  NOT strip a silent trailing 'e' — in pidgin/Yoruba/most Afro lyric that vowel
 *  is voiced, so it earns its rhythmic slot. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1; // a non-alpha token (e.g. a number) still holds one rhythmic slot
  const groups = w.match(/[aeiouy]+/g);
  return groups && groups.length > 0 ? groups.length : 1;
}

/**
 * A deterministic rhythm skeleton for a hook cell: the per-word syllable pattern
 * plus the total. Two hooks with the same cadence collide even when reworded
 * (e.g. "Blue tick on my name" and "Green light in my lane" → "1.1.1.1.2#6"),
 * which is exactly what a catalogue-originality precheck needs. Empty in, empty
 * out — we never invent a fingerprint for nothing.
 */
export function hookRhythmFingerprint(hookCell: string): string {
  const words = stripDiacritics(hookCell).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  const counts = words.map(countSyllables);
  const total = counts.reduce((a, b) => a + b, 0);
  return `${counts.join('.')}#${total}`;
}

interface NormalizedTitle {
  norm: string;
  tokens: string[];
}

/** Normalize a title for comparison: drop diacritics, feature credits, and
 *  low-signal stop words; keep the meaning-bearing tokens. */
function normalizeTitle(title: string): NormalizedTitle {
  const stop = new Set(['the', 'a', 'an', 'my', 'your', 'our', 'of', 'to', 'in', 'on', 'and', 'feat', 'ft', 'featuring', 'with']);
  const base = stripDiacritics(title)
    .toLowerCase()
    .replace(/\(feat\.?[^)]*\)/g, ' ') // "(feat. X)"
    .replace(/\b(feat|ft|featuring)\b.*$/g, ' ') // trailing "feat X" / "ft X"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = base.split(' ').filter((w) => w && !stop.has(w));
  return { norm: tokens.join(' '), tokens };
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n] ?? 0;
}

/**
 * Return the FIRST existing title that is too close to `title` (so the caller can
 * name the clash), or null when the title is clear. "Too close" = an identical
 * normalized form, a heavy shared-word overlap (Jaccard >= 0.6), or a near-typo
 * edit distance (>= 0.85 similarity). Pure and deterministic — this is the
 * catalogue-originality precheck, not a taste call.
 */
export function titleTooClose(title: string, existingTitles: string[]): string | null {
  const cand = normalizeTitle(title);
  if (!cand.norm) return null; // nothing meaningful to compare
  for (const existing of existingTitles) {
    const other = normalizeTitle(existing);
    if (!other.norm) continue;
    if (cand.norm === other.norm) return existing;
    if (jaccard(cand.tokens, other.tokens) >= 0.6) return existing;
    const dist = levenshtein(cand.norm, other.norm);
    const sim = 1 - dist / Math.max(cand.norm.length, other.norm.length);
    if (sim >= 0.85) return existing;
  }
  return null;
}
