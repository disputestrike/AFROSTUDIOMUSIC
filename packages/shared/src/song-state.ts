/**
 * SONG_STATE — the shared, versioned object every studio agent reads and writes.
 *
 * Owner directive (2026-07-12, the multi-agent producer spec): the studio must
 * behave like a disciplined team, not one text generator. Each specialist agent
 * (Executive Producer, Music Producer, Topline, Songwriter, Vocal Producer,
 * Language, Catalogue QA, Listening Evaluator) mutates ONE versioned SONG_STATE
 * and states what it preserved, changed, why, and what to test next. No agent
 * writes a component AND is its only evaluator. No agent may declare a song
 * MASTERED or 10/10 — the only valid AI verdicts are the three Decisions below.
 *
 * This file is the CONTRACT (types + helpers) only — the agents live in
 * packages/ai (prompts + calls) and the orchestrator in apps/api. Pure, zero-dep.
 */

/** The pipeline stages, in order (Stage 0-10 of the spec). */
export type ProducerStage =
  | 'catalogue_precheck'
  | 'creative_brief'
  | 'beat_lab'
  | 'topline'
  | 'lyric_fitting'
  | 'language_review'
  | 'vocal_production'
  | 'beat_revision'
  | 'render_listen'
  | 'catalogue_qa'
  | 'decision';

export const PRODUCER_STAGES: ProducerStage[] = [
  'catalogue_precheck', 'creative_brief', 'beat_lab', 'topline', 'lyric_fitting',
  'language_review', 'vocal_production', 'beat_revision', 'render_listen', 'catalogue_qa', 'decision',
];

/** The ONLY verdicts an AI agent may reach — never "mastered"/"release-ready"/"10/10". */
export type ProducerDecision =
  | 'IN_PROGRESS'
  | 'TOPLINE_NOT_PROVEN' // the topline has no audio artifacts — the songwriter is BLOCKED
  | 'REJECT_AND_RESTART'
  | 'REVISE_FROM_STAGE_X'
  | 'CANDIDATE_FOR_HUMAN_AR';

/** The audio artifacts a topline must have before the songwriter is allowed to
 *  run (owner feedback 2026-07-13: "a written description of a melody does not
 *  count"). HONESTY: the hook renders are SYNTHESIZED melody guides (the composed
 *  notes rendered to a tone/vowel), NOT a voice singing a hum — no engine sings a
 *  hum yet. The melody is proven audibly; the timbre is not. */
export interface ToplineProof {
  beatSketchUrl: string | null;
  hookRenderUrls: string[]; // >= 3 required; synthesized melody guides
  selectedContour: string | null;
  syllableCap: number | null;
  breathSlots: number[] | null;
}

/** True only when the topline is genuinely proven with audio artifacts. */
export function toplineProven(p: ToplineProof | undefined | null): boolean {
  return !!(p && p.beatSketchUrl && p.hookRenderUrls.length >= 3 && p.selectedContour && p.syllableCap && p.breathSlots);
}

/** Stage 1 — the Executive Producer's brief (creative identity). */
export interface CreativeBrief {
  primaryEmotion: string; // one sentence
  listenerMoment: string; // club/headphones/wedding/worship/drive/dance challenge/...
  artistIdentity: string; // age, attitude, vocal character, POV
  genre: string;
  fusion?: string[];
  tempoRange: [number, number];
  corePremise: string; // ONE premise
  tension?: string; // one contradiction (optional — not every record needs one)
  borrowedQualities: string[]; // 3 market qualities to borrow, never copy
  forbidden: string[]; // 5+ catalogue cliches/structures banned FOR THIS record
  lyricMode: LyricMode;
}

export type LyricMode =
  | 'chant' | 'flirtation' | 'image_collage' | 'confession'
  | 'snapshot' | 'narrative' | 'testimony' | 'brag';

/** Stage 0 — the forbidden-list built from the nearest catalogue songs. */
export interface CatalogueSimilarity {
  nearestTitles: string[];
  forbiddenStructures: string[];
  forbiddenVocab: string[]; // over-used catalogue words to avoid
  forbiddenHookShapes: string[];
  note?: string;
}

/** Stage 2 — Music Producer output. Groove BEHAVIOR, never instrument-naming. */
export interface BeatDna {
  bpm: number;
  key: string;
  grooveBehavior: string; // where the kick sits, swing, syncopation, how it moves
  vocalPocket: string; // where the lead enters/rests/anticipates/leaves space
  energyCurveBySection: Array<{ section: string; energy: number }>;
  signatureEvent: string; // one record-specific sonic moment
  prohibitedMoves: string[];
  negativeSpace: string[]; // sections where instruments drop/answer the vocal
  audioSketchId?: string | null; // the playable beat this stage rendered
}

export interface ArrangementSection {
  name: string; // NOT forced to Intro/Verse/Pre-Hook/Hook/Verse2/Bridge/Outro
  bars: number;
  role: string; // what this section DOES for the record
}

/** Stage 3 — Topline melody candidates + the selected one. Audio ids are
 *  present only when a controllable singing engine rendered them (honest null
 *  until then — the guide WAV / hum-convert is the closest today). */
export interface ToplineCandidate {
  id: string;
  contour: string; // shape description
  noteRhythmMapId?: string | null; // melody-score reference
  sparseWords?: string[]; // 2-5 word option
  moderateWords?: string[]; // 6-12 word option
  audioId?: string | null;
  singbackScore?: number | null; // delayed sing-back recall, null if not audio-tested
}

export interface SelectedTopline {
  candidateId: string;
  hookCell: string; // 2-7 syllables — the meaning spine
  melodyRhythmMap: MelodyRhythmMap;
  reason: string;
}

/** The separated output objects — NEVER merged, NEVER contaminated with
 *  production notes / bar counts / translations (Global Rule 8). */
export interface MelodyRhythmMap {
  syllableSlots: number; // total sung syllable slots the words must fit
  breaths: number[]; // slot indices where the singer breathes
  heldVowelSlots: number[]; // slots that sustain (open vowels belong here)
  pickups: number[]; // slots that anticipate the downbeat
}
export interface LeadPerformanceEntry {
  phrase: string;
  atBeat: number;
  vowel?: string;
  dynamic?: 'whisper' | 'soft' | 'full' | 'belt';
  intention?: string;
  clip?: boolean; // consonant clipped / word dropped
}
export interface SungWords { sections: Array<{ name: string; lines: string[] }>; }
export interface AdlibOptions { tags: string[]; placements: string[]; }
export interface DoublesHarmonies { doubles: string[]; harmonies: string[]; }
export interface ProductionNotes { notes: string[]; }

/** Stage 5 — Language & Cultural Authenticity verdicts, per non-English phrase. */
export type LanguageVerdict = 'APPROVED' | 'REWRITE' | 'HUMAN_NATIVE_REVIEW_REQUIRED';
export interface LanguageReviewEntry {
  phrase: string;
  language: string;
  verdict: LanguageVerdict;
  toneMelodyConflict?: boolean; // Yoruba etc. — melody changed the meaning
  note?: string;
}

/** Stage 9 — A&R scoring gates. Any of the fatal dimensions < 7 fails the record. */
export interface QaScores {
  artistIdentity: number;
  hookSound: number;      // FATAL < 7
  melodicMemory: number;
  rhythmicPocket: number;
  emotionalTruth: number;
  naturalLanguage: number; // FATAL < 7
  vocalPerformance: number; // FATAL < 7
  productionIdentity: number;
  structurePacing: number;
  catalogueOriginality: number; // FATAL < 7
  culturalAuthenticity: number; // FATAL < 7 where applicable
  replayBehavior: number;
}

/** Dimensions that cannot be hidden by a good average. */
export const FATAL_QA_DIMENSIONS: Array<keyof QaScores> = [
  'hookSound', 'naturalLanguage', 'vocalPerformance', 'catalogueOriginality', 'culturalAuthenticity',
];

export interface RejectionRecord {
  stage: ProducerStage;
  reason: string;
  by: string; // agent name
  atVersion: number;
}

/** The one object all agents share. Versioned; every change states its rationale. */
export interface SongState {
  songId: string;
  version: number;
  brief?: CreativeBrief;
  catalogueSimilarity?: CatalogueSimilarity;
  beatDna?: BeatDna;
  arrangementMap?: ArrangementSection[];
  hookCandidates?: ToplineCandidate[];
  selectedTopline?: SelectedTopline;
  toplineProof?: ToplineProof;
  sungWords?: SungWords;
  adlibOptions?: AdlibOptions;
  leadPerformanceMap?: LeadPerformanceEntry[];
  doublesHarmonies?: DoublesHarmonies;
  productionNotes?: ProductionNotes;
  languageReview?: LanguageReviewEntry[];
  audioRenderIds?: string[];
  qaScores?: QaScores;
  rejections: RejectionRecord[];
  decision: ProducerDecision;
  /** Free-form per-stage rationale: what was preserved/changed/why/test-next. */
  log: Array<{ stage: ProducerStage; by: string; preserved?: string; changed?: string; why?: string; testNext?: string; atVersion: number }>;
}

export function newSongState(songId: string): SongState {
  return { songId, version: 1, rejections: [], decision: 'IN_PROGRESS', log: [] };
}

/** Record a stage's work + rationale and bump the version. */
export function advanceState(
  s: SongState,
  patch: Partial<SongState>,
  entry: { stage: ProducerStage; by: string; preserved?: string; changed?: string; why?: string; testNext?: string },
): SongState {
  const version = s.version + 1;
  return { ...s, ...patch, version, log: [...s.log, { ...entry, atVersion: version }] };
}

/** Route a failure back to the responsible stage (REVISE_FROM_STAGE_X). */
export function rejectToStage(s: SongState, stage: ProducerStage, reason: string, by: string): SongState {
  return {
    ...s,
    decision: 'REVISE_FROM_STAGE_X',
    rejections: [...s.rejections, { stage, reason, by, atVersion: s.version }],
  };
}

/** The A&R gate: fatal if any FATAL dimension < 7. Never returns "mastered". */
export function qaVerdict(scores: QaScores, applicableCultural = true): { pass: boolean; failed: Array<keyof QaScores> } {
  const failed = FATAL_QA_DIMENSIONS.filter((d) => {
    if (d === 'culturalAuthenticity' && !applicableCultural) return false;
    return (scores[d] ?? 0) < 7;
  });
  return { pass: failed.length === 0, failed };
}
