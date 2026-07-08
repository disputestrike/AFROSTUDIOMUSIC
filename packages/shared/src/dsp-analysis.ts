/**
 * THE EAR — measured audio analysis, with provenance.
 *
 * Phase 0 of the Lane doctrine: given a rendered track, return MUSICAL FACTS that
 * were actually measured by a DSP detector — clearly separated from values that
 * were inferred (genre defaults / LLM guesses) or simply unknown.
 *
 * THE HONESTY LAW (non-negotiable): a LaneComplianceScore may only be computed
 * from fields whose source is 'measured'. A missing detector returns 'unknown' —
 * never a fabricated number. This extends "no fake audio, ever" to "no fake
 * analysis, ever." A flattering fake 87 is more damaging than an honest
 * "6 of 10 dimensions measured; here are the 4 I could not."
 */

export type MeasuredSource = 'measured' | 'inferred' | 'unknown';

export interface Measured<T> {
  value: T | null;
  source: MeasuredSource;
  /** 0–1. Meaningful only when source === 'measured'. */
  confidence: number;
  /** e.g. 'librosa.beat.beat_track' | 'genre-default' | 'none'. */
  method: string;
}

export const unknownField = <T>(method = 'none'): Measured<T> => ({ value: null, source: 'unknown', confidence: 0, method });
export const measured = <T>(value: T, confidence: number, method: string): Measured<T> => ({ value, source: 'measured', confidence, method });
export const inferred = <T>(value: T, method: string): Measured<T> => ({ value, source: 'inferred', confidence: 0, method });

/**
 * The full measured feature set. Every field is a Measured<T>. Grouped as global /
 * groove / spectral-instrument / arrangement / vocal per the Phase-0 spec.
 */
export interface MeasuredAnalysis {
  // Global
  durationS: Measured<number>;
  tempoBpm: Measured<number>;
  key: Measured<string>; // e.g. "A"
  mode: Measured<string>; // "major" | "minor"
  timeSignature: Measured<string>; // e.g. "4/4"

  // Groove
  swingRatio: Measured<number>; // measured 16th-note swing, %
  microtiming: Measured<Record<string, number>>; // per percussion class, signed ms vs grid
  syncopationIndex: Measured<number>;
  fourOnFloor: Measured<boolean>;

  // Spectral / instrument presence (per-stem via Demucs when available)
  lowEndProfile: Measured<number>; // 30–120 Hz energy ratio
  logDrumLikelihood: Measured<number>; // 0–1 composite (pitched+percussive+sub+portamento)
  shakerContinuity: Measured<number>; // 0–1 proportion of 16th slots with HF percussive energy
  kickDensity: Measured<number>;
  clapBackbeat: Measured<number>;
  hatRollPresence: Measured<number>;
  harmonicRichness: Measured<number>; // chord-extension density proxy

  // Arrangement
  sectionBoundaries: Measured<number[]>; // seconds
  firstDropAtS: Measured<number>;
  introLengthBars: Measured<number>;

  // Vocal
  vocalPresenceRatio: Measured<number>;
  sungVsSpoken: Measured<string>; // "sung" | "spoken" | "mixed"
  adLibDensity: Measured<number>;

  // Meta
  /** Did the DSP engine run at all? false => every field is 'unknown'. */
  engineOk: boolean;
  analyzedAt: string | null;
}

export interface AnalysisCoverage {
  measured: number;
  inferred: number;
  unknown: number;
  total: number;
  /** measured / total, 0–1 — a compliance score computed below this is "partial". */
  ratio: number;
}

/** The 20 scored feature keys (meta fields excluded). */
export const ANALYSIS_FEATURE_KEYS = [
  'durationS', 'tempoBpm', 'key', 'mode', 'timeSignature',
  'swingRatio', 'microtiming', 'syncopationIndex', 'fourOnFloor',
  'lowEndProfile', 'logDrumLikelihood', 'shakerContinuity', 'kickDensity', 'clapBackbeat', 'hatRollPresence', 'harmonicRichness',
  'sectionBoundaries', 'firstDropAtS', 'introLengthBars',
  'vocalPresenceRatio', 'sungVsSpoken', 'adLibDensity',
] as const;

/** Count how much of the analysis was truly heard vs inferred vs unknown. */
export function analysisCoverage(a: MeasuredAnalysis): AnalysisCoverage {
  let m = 0, i = 0, u = 0;
  for (const k of ANALYSIS_FEATURE_KEYS) {
    const f = (a as unknown as Record<string, Measured<unknown>>)[k];
    if (!f || f.source === 'unknown') u++;
    else if (f.source === 'inferred') i++;
    else m++;
  }
  const total = ANALYSIS_FEATURE_KEYS.length;
  return { measured: m, inferred: i, unknown: u, total, ratio: total ? m / total : 0 };
}

/** An all-unknown analysis — the honest result when the DSP engine can't run. */
export function unknownAnalysis(method = 'engine-unavailable'): MeasuredAnalysis {
  const u = <T>() => unknownField<T>(method);
  return {
    durationS: u(), tempoBpm: u(), key: u(), mode: u(), timeSignature: u(),
    swingRatio: u(), microtiming: u(), syncopationIndex: u(), fourOnFloor: u(),
    lowEndProfile: u(), logDrumLikelihood: u(), shakerContinuity: u(), kickDensity: u(), clapBackbeat: u(), hatRollPresence: u(), harmonicRichness: u(),
    sectionBoundaries: u(), firstDropAtS: u(), introLengthBars: u(),
    vocalPresenceRatio: u(), sungVsSpoken: u(), adLibDensity: u(),
    engineOk: false, analyzedAt: null,
  };
}
