import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { familyOf, isMaterialRole, type MeasuredAnalysis } from '@afrohit/shared';
import { measureAudioQuality, measureLoudnorm, runFfmpeg, type AudioQuality } from './ffmpeg';
import { dspAvailable, measureAudio } from './dsp';

// ---------------------------------------------------------------------------
// PURE FORGE MATH — exported from HERE (not the processor) so the offline gate
// suite can assert it without importing material.ts, whose @afrohit/db import
// would drag a PrismaClient into a unit test.
// ---------------------------------------------------------------------------

/** Providers cap a render request at ~30s. */
export const FORGE_PROVIDER_CAP_S = 30;

/**
 * SLOW-BPM BARS CAP (source-truth wave, arithmetic certainty): the forge asks
 * the provider for min(loopDur, 30)s but used to ALWAYS trim 8 bars — at slow
 * tempos 8 bars simply don't fit in a 30s render, so trimToLoop read past the
 * end of the file and the row recorded fictional bars/duration. Halve the bar
 * count (8→4→2) until the bars PLUS the 3s trim headroom fit inside the
 * provider cap; the caller records the ACTUAL bars on the row.
 */
export function forgeBarsWithinCap(bpm: number, requestedBars: number, providerCapS = FORGE_PROVIDER_CAP_S): number {
  let bars = Math.max(1, Math.floor(requestedBars));
  while (bars > 2 && Math.ceil((60 / bpm) * 4 * bars) + 3 > providerCapS) {
    bars = Math.floor(bars / 2);
  }
  return bars;
}

/**
 * OCTAVE-FOLDED tempo delta. Beat trackers are octave-ambiguous by nature (a
 * 100bpm groove with strong 8ths reads as 200; a half-time feel reads as 50),
 * so a raw |detected − prompted| comparison would reject perfectly good loops.
 * Test the detection at ×1, ×0.5 and ×2 and score the CLOSEST interpretation —
 * only a loop whose best interpretation still misses the prompt is truly at
 * the wrong tempo.
 */
export function foldedTempoDelta(promptedBpm: number, detectedBpm: number): { foldedBpm: number; delta: number } {
  let foldedBpm = detectedBpm;
  let delta = Number.POSITIVE_INFINITY;
  for (const candidate of [detectedBpm, detectedBpm * 0.5, detectedBpm * 2]) {
    const d = Math.abs(candidate - promptedBpm) / promptedBpm;
    if (d < delta) {
      delta = d;
      foldedBpm = candidate;
    }
  }
  return { foldedBpm, delta };
}

/** A forge whose measured tempo misses the prompt by more than 4% after
 * octave-folding did not render the requested groove. */
export const FORGE_TEMPO_TOLERANCE = 0.04;

// ---------------------------------------------------------------------------
// ROLE PURITY — absence gates (source-truth wave item 4).
// ---------------------------------------------------------------------------

/**
 * The presence-only evidence check had an inversion: a 'shaker' loop hiding a
 * kick+bass FULL MIX passed *more* easily than a real shaker bed, because
 * rhythm evidence is max(kickDensity, shakerContinuity, clapBackbeat) — the
 * hidden kick supplied the "rhythm" proof. These are the ABSENCE gates: what a
 * clean loop of each class must NOT contain.
 *
 * Units (from analyze_dsp.py): kickDensity = 30-150Hz percussive onsets per
 * BAR; lowEndProfile.ratio = 30-120Hz share of total energy (0-1);
 * clapBackbeat = even/odd beat alternation strength (0-1).
 *
 * Classes:
 *  - hf_perc  (hats/shakers/rides): a true HF-percussion bed has essentially
 *    zero kicks and negligible sub energy → kickDensity ≤ 1/bar AND
 *    lowEnd ratio ≤ 0.10.
 *  - mid_perc (congas/bongos/talking drum/coarse 'percussion'): fundamentals
 *    live in the mids, but a talking drum can dip low — looser thresholds →
 *    kickDensity ≤ 2/bar AND lowEnd ratio ≤ 0.18.
 *  - tonal    (harmony/melody/mallets/coarse 'chords'): a chord or lead bed
 *    carries no drum kit → kickDensity ≤ 1/bar AND clapBackbeat ≤ 0.30.
 *    (No low-end gate: a piano's left hand is legitimate low energy.)
 *  - exempt   (bass family/log_drum, drum-kit backbone incl. coarse 'drums',
 *    fx, vocals, fill): kicks/sub ARE these roles' content, or current DSP
 *    cannot separate their claim from bleed.
 * A null measurement skips ONLY its own check (unknown is honorable) — the
 * gate never fabricates a failure from a missing number.
 */
const HF_PERC_ROLES = new Set([
  'closed_hat', 'open_hat', 'ride', 'trap_hat_roll', 'drill_hat_slide',
  'shaker', 'shekere', 'cabasa', 'maraca', 'guiro', 'triangle',
]);

export type MaterialPurityClass = 'hf_perc' | 'mid_perc' | 'tonal' | 'exempt';

export interface MaterialRolePurityVerdict {
  ok: boolean;
  purityClass: MaterialPurityClass;
  /** machine-readable, e.g. 'kick-bleed(3.2/bar)' — null when ok */
  reason: string | null;
  checks: { kickDensity: number | null; lowEndRatio: number | null; clapBackbeat: number | null };
}

function purityClassOf(role: string): MaterialPurityClass {
  if (HF_PERC_ROLES.has(role)) return 'hf_perc';
  if (role === 'percussion') return 'mid_perc';
  if (role === 'chords') return 'tonal';
  if (!isMaterialRole(role)) return 'exempt'; // coarse drums/bass, fill, instrumental…
  const family = familyOf(role);
  if (family === 'african_perc' || family === 'global_perc') return 'mid_perc';
  if (family === 'harmony' || family === 'melody' || family === 'mallets') return 'tonal';
  return 'exempt'; // drumkit backbone, bass, fx, vocals
}

function measuredValue<T>(field: { value?: T | null; source?: string } | undefined): T | null {
  return field?.source !== 'unknown' && field?.value != null ? field.value : null;
}

export function materialRolePurity(role: string, measured: MeasuredAnalysis | null): MaterialRolePurityVerdict {
  const purityClass = purityClassOf(role);
  const kickDensity = measured ? measuredValue(measured.kickDensity) : null;
  const lowEndRatio = measured ? (measuredValue(measured.lowEndProfile)?.ratio ?? null) : null;
  const clapBackbeat = measured ? measuredValue(measured.clapBackbeat) : null;
  const checks = { kickDensity, lowEndRatio, clapBackbeat };
  const verdict = (reason: string | null): MaterialRolePurityVerdict => ({ ok: reason == null, purityClass, reason, checks });
  if (!measured?.engineOk || purityClass === 'exempt') return verdict(null);

  if (purityClass === 'hf_perc') {
    if (kickDensity != null && kickDensity > 1.0) return verdict(`kick-bleed(${kickDensity}/bar)`);
    if (lowEndRatio != null && lowEndRatio > 0.10) return verdict(`low-end-bleed(ratio=${lowEndRatio})`);
    return verdict(null);
  }
  if (purityClass === 'mid_perc') {
    if (kickDensity != null && kickDensity > 2.0) return verdict(`kick-bleed(${kickDensity}/bar)`);
    if (lowEndRatio != null && lowEndRatio > 0.18) return verdict(`low-end-bleed(ratio=${lowEndRatio})`);
    return verdict(null);
  }
  // tonal
  if (kickDensity != null && kickDensity > 1.0) return verdict(`kick-bleed(${kickDensity}/bar)`);
  if (clapBackbeat != null && clapBackbeat > 0.30) return verdict(`backbeat-bleed(${clapBackbeat})`);
  return verdict(null);
}

// ---------------------------------------------------------------------------
// INSPECTION
// ---------------------------------------------------------------------------

export interface MaterialInspection {
  contentHash: string;
  readiness: 'ready' | 'pending' | 'rejected';
  qualityState: 'passed' | 'unmeasured' | 'failed';
  roleEvidence: string;
  reasons: string[];
  qc: AudioQuality | null;
  measured: MeasuredAnalysis | null;
  detectedBpm: number | null;
  detectedKey: string | null;
  /** measured first-downbeat time of THIS audio (null = grid unstable / no DSP) */
  detectedDownbeatS: number | null;
  /** absence-gate verdict — null when the gate did not apply (no deep DSP, or
   * evidence class other than provider-prompted) */
  purity: MaterialRolePurityVerdict | null;
  verifiedAt: Date | null;
}

function valueOf<T>(field: { value?: T | null; source?: string } | undefined): T | null {
  return field?.source !== 'unknown' && field?.value != null ? field.value : null;
}

function promptedEvidence(role: string, measured: MeasuredAnalysis | null, purity: MaterialRolePurityVerdict | null): string {
  if (!measured?.engineOk) return 'provider-prompted-unconfirmed';
  // ABSENCE GATE FIRST (item 4): a loop that measurably contains a foreign
  // family (the kick+bass mix hiding inside a "shaker") can never be called
  // dsp-consistent, whatever presence its features show — the presence features
  // may literally BE the bleed.
  if (purity && !purity.ok) return 'provider-prompted-unconfirmed';
  const low = valueOf(measured.lowEndProfile)?.ratio ?? 0;
  const rhythm = Math.max(
    valueOf(measured.kickDensity) ?? 0,
    valueOf(measured.shakerContinuity) ?? 0,
    valueOf(measured.clapBackbeat) ?? 0,
  );
  const harmonic = valueOf(measured.harmonicRichness) ?? 0;
  if (role === 'log_drum' && (valueOf(measured.logDrumLikelihood) ?? 0) >= 0.25) return 'provider-prompted-dsp-consistent';
  if (!isMaterialRole(role)) {
    if (role === 'bass' && low >= 0.08) return 'provider-prompted-dsp-consistent';
    if ((role === 'drums' || role === 'percussion') && rhythm >= 0.15) return 'provider-prompted-dsp-consistent';
    if (role === 'chords' && harmonic >= 0.1) return 'provider-prompted-dsp-consistent';
    return 'provider-prompted-unconfirmed';
  }
  const family = familyOf(role);
  if (family === 'bass' && low >= 0.08) return 'provider-prompted-dsp-consistent';
  if ((family === 'drumkit' || family === 'african_perc' || family === 'global_perc') && rhythm >= 0.15) {
    return 'provider-prompted-dsp-consistent';
  }
  if ((family === 'harmony' || family === 'melody' || family === 'mallets') && harmonic >= 0.1) {
    return 'provider-prompted-dsp-consistent';
  }
  if (family === 'fx' || family === 'vocals') return 'provider-prompted-technical-only';
  return 'provider-prompted-unconfirmed';
}

/** Technical audio gate plus honest role evidence. This never calls a prompted
 * role "verified" when the available DSP can only establish a broad family,
 * and it REFUSES a loop whose measurements prove a foreign family is riding
 * inside it (role bleed) — refusing a muddy brick is honorable. */
export async function inspectMaterialAudio(opts: {
  bytes: Buffer;
  url: string;
  role: string;
  roleEvidence: string;
  deep?: boolean;
}): Promise<MaterialInspection> {
  const contentHash = createHash('sha256').update(opts.bytes).digest('hex');
  const qc = await measureAudioQuality(opts.url).catch(() => null);
  const reasons: string[] = [];
  if (!qc) reasons.push('technical-qc-unavailable');
  if (qc?.integratedLufs != null && qc.integratedLufs < -38) reasons.push('near-silent');
  if ((qc?.flags ?? []).includes('clipping')) reasons.push('clipping');
  if (qc && qc.durationS < (opts.role === 'fill' ? 0.4 : 0.75)) reasons.push('too-short');

  let measured: MeasuredAnalysis | null = null;
  if (opts.deep && await dspAvailable().catch(() => false)) {
    measured = await measureAudio(opts.bytes).catch(() => null);
    if (measured && !measured.engineOk) measured = null;
  }
  const detectedBpm = measured ? valueOf(measured.tempoBpm) : null;
  const key = measured ? valueOf(measured.key) : null;
  const mode = measured ? valueOf(measured.mode) : null;
  const detectedKey = key ? `${key}${mode ? ` ${mode}` : ''}` : null;
  const detectedDownbeatS = measured ? valueOf(measured.firstDownbeatS) : null;

  // ROLE PURITY (item 4): absence gates apply to prompt-evidenced loops that we
  // actually deep-measured. Failing purity is a QUALITY failure, not just an
  // evidence downgrade — the loop is rejected with reason 'role-bleed' so it
  // can never be assembled as the claimed instrument.
  const purity = opts.roleEvidence.startsWith('provider-prompted') && measured
    ? materialRolePurity(opts.role, measured)
    : null;
  if (purity && !purity.ok) reasons.push('role-bleed');

  const failed = reasons.some((reason) => reason !== 'technical-qc-unavailable');
  const roleEvidence = opts.roleEvidence.startsWith('provider-prompted')
    ? promptedEvidence(opts.role, measured, purity)
    : opts.roleEvidence;

  return {
    contentHash,
    readiness: failed ? 'rejected' : qc ? 'ready' : 'pending',
    qualityState: failed ? 'failed' : qc ? 'passed' : 'unmeasured',
    roleEvidence,
    reasons,
    qc,
    measured,
    detectedBpm,
    detectedKey,
    detectedDownbeatS,
    purity,
    verifiedAt: qc ? new Date() : null,
  };
}

// ---------------------------------------------------------------------------
// DOWNBEAT-TRUE CUT POINT (item 2)
// ---------------------------------------------------------------------------

export interface LoopCutPoint {
  startS: number | null;
  confidence: number | null;
  method: string;
}

/**
 * Measure where "bar one" actually lands in a RAW provider render, BEFORE it is
 * trimmed — the number trimToLoop's opts.startS wants instead of the blind
 * legacy 0.5s. This is a second full DSP pass per forge (the post-trim
 * inspection re-measures the trimmed loop); on a ≤30s render that is seconds of
 * CPU against a minutes-long provider render, and it is the difference between
 * loops that phase-lock and loops that scatter. Fails honest: DSP down or grid
 * unstable → null, the caller keeps the legacy default and SAYS so in meta.
 */
export async function measureLoopCutPoint(bytes: Buffer): Promise<LoopCutPoint> {
  if (!(await dspAvailable().catch(() => false))) {
    return { startS: null, confidence: null, method: 'dsp-unavailable' };
  }
  const measured = await measureAudio(bytes).catch(() => null);
  if (!measured?.engineOk) return { startS: null, confidence: null, method: 'engine-failed' };
  const field = measured.firstDownbeatS;
  const value = valueOf(field);
  if (value != null && Number.isFinite(value) && value >= 0) {
    return { startS: value, confidence: field?.confidence ?? null, method: field?.method ?? 'measured' };
  }
  return { startS: null, confidence: null, method: field?.method ?? 'unknown' };
}

// ---------------------------------------------------------------------------
// PER-LOOP LOUDNESS NORMALIZATION (item 3)
// ---------------------------------------------------------------------------

/** Shelf level for material loops. -18 LUFS integrated leaves the assembly bus
 * its headroom (the role gains + density trim then work on KNOWN input levels)
 * while staying loud enough that a solo audition is audible. */
export const LOOP_LOUDNESS_TARGET = { lufs: -18, tp: -1.5 };

export interface LoopLoudnessResult {
  bytes: Buffer;
  preLufs: number | null;
  applied: boolean;
  /** why normalization was skipped, when it was */
  reason?: string;
}

/**
 * Normalize one material loop to ~-18 LUFS integrated. Forged/synth loops
 * upload at whatever level the provider happened to render, so the fixed
 * role-gain doctrine (drums 1.0, chords 0.7, …) was meaningless — the brick's
 * own loudness was a coin flip. SINGLE-PASS loudnorm by choice: the two-pass
 * linear machinery exists so a full master lands exactly on target without
 * pumping across a 3-minute arc; an 8-bar loop is one short, dynamically
 * uniform gesture where dynamic mode physically cannot pump audibly, and ±1 LU
 * on a shelf-leveling pass is inside the role-gain doctrine's tolerance.
 *
 * HONESTY GUARDS: a loop we cannot measure ships unmodified (never a blind
 * gain), and a near-silent render (< -38 LUFS, the inspection's own bar) is
 * NOT rescued — boosting junk 20 dB to -18 would fabricate loudness on noise
 * and mask the 'near-silent' rejection the loop deserves.
 */
export async function normalizeLoopLoudness(input: Buffer): Promise<LoopLoudnessResult> {
  const dir = await mkdtemp(join(tmpdir(), 'loop-lufs-'));
  const inPath = join(dir, 'in.wav');
  const outPath = join(dir, 'out.wav');
  try {
    await writeFile(inPath, input);
    const stats = await measureLoudnorm(inPath, LOOP_LOUDNESS_TARGET);
    const preLufs = stats?.input_i ?? null;
    if (preLufs === null) return { bytes: input, preLufs: null, applied: false, reason: 'unmeasurable' };
    if (preLufs < -38) return { bytes: input, preLufs, applied: false, reason: 'near-silent-left-for-rejection' };
    if (Math.abs(preLufs - LOOP_LOUDNESS_TARGET.lufs) <= 0.5) {
      return { bytes: input, preLufs, applied: false, reason: 'already-on-target' };
    }
    await runFfmpeg([
      '-i', inPath,
      '-af', `loudnorm=I=${LOOP_LOUDNESS_TARGET.lufs}:TP=${LOOP_LOUDNESS_TARGET.tp}:LRA=11`,
      '-ar', '44100', '-ac', '2', outPath,
    ]);
    return { bytes: await readFile(outPath), preLufs, applied: true };
  } catch (error) {
    // Best-effort by contract: a failed normalization keeps the original bytes
    // (the QC gate still measures what actually ships) rather than killing the
    // forge over a leveling nicety.
    return { bytes: input, preLufs: null, applied: false, reason: `ffmpeg-failed:${(error as Error).message.slice(0, 80)}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
