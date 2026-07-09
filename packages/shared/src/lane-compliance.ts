/**
 * PHASE 2 — LaneComplianceScorer + GenreDriftDetector.
 *
 * Given a track's MeasuredAnalysis and its lane's LaneProfile, score how well the
 * track sits in the lane, per dimension, and flag when it has drifted out of genre.
 *
 * THE HONESTY LAW carries through end to end: a dimension is scored ONLY when it is
 * BOTH 'measured' in the track AND profiled in the lane. A dimension that is unknown
 * in the track, or unprofiled in the lane, is SKIPPED — never scored as 0, never
 * faked. `coverage` reports how much of the lane could actually be checked, so an
 * "87" backed by 3 of 12 dimensions is never mistaken for a full verdict.
 */
import type { Measured, MeasuredAnalysis } from './dsp-analysis';
import { PROFILE_FEATURES, type FeatureStat, type LaneProfile } from './lane-profile';

export type LaneStatus = 'in-lane' | 'edge' | 'out-of-lane';

export interface DimensionScore {
  key: string;
  kind: 'numeric' | 'boolean' | 'categorical';
  trackValue: number | string | boolean;
  target: { median?: number; p10?: number; p90?: number; dominant?: string };
  match: number; // 0–1
  status: LaneStatus;
  weight: number;
  identity: boolean; // does this dimension define the genre?
}

export interface GenreDrift {
  drifted: boolean;
  severity: 'none' | 'minor' | 'major';
  reasons: string[];
}

export interface LaneComplianceScore {
  lane: string;
  overall: number; // 0–100, weighted mean of scored dimensions
  coverage: number; // scored dimensions / profiled dimensions (0–1)
  scored: number;
  dimensions: DimensionScore[];
  skipped: string[]; // profiled but the track's value is unknown (or vice versa)
  drift: GenreDrift;
  /** CORE identity dimensions (tempo/four-on-floor/log-drum) that fell OUT of lane.
   * A take with a non-empty failedCritical is not the record, however punchy — it
   * loses best-of-N ranking outright and blocks Hit Maker Mode. */
  failedCritical: string[];
}

// Dimensions that DEFINE the genre — a miss here is drift, not just a low score.
const IDENTITY = new Set(['tempoBpm', 'fourOnFloor', 'logDrumLikelihood', 'swingRatio', 'lowEndRatio', 'shakerContinuity']);
// Core identity — a miss here alone is a MAJOR drift.
const CORE = new Set(['tempoBpm', 'fourOnFloor', 'logDrumLikelihood']);

const WEIGHT: Record<string, number> = {
  tempoBpm: 3, fourOnFloor: 3, logDrumLikelihood: 3,
  swingRatio: 2, lowEndRatio: 2, shakerContinuity: 2,
  kickDensity: 1.5, microKick: 1.5, syncopationIndex: 1.5,
  mode: 1, timeSignature: 1, sungVsSpoken: 1, vocalPresenceRatio: 1,
};
const weightOf = (k: string) => WEIGHT[k] ?? 1;

/** Read a measured scalar from the analysis using a profile feature spec. */
function trackScalar(a: MeasuredAnalysis, spec: (typeof PROFILE_FEATURES)[number]): { v: number | string | boolean } | null {
  const m = spec.field(a) as Measured<unknown> | undefined;
  if (!m || m.source !== 'measured' || m.value == null) return null;
  if (spec.sub) {
    const obj = m.value as Record<string, unknown>;
    const v = obj?.[spec.sub];
    return typeof v === 'number' ? { v } : null;
  }
  const v = m.value;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { v };
  return null;
}

function numericMatch(v: number, s: FeatureStat['numeric']): number {
  if (!s) return 0;
  if (v >= s.p10 && v <= s.p90) return 1;
  const d = v < s.p10 ? s.p10 - v : v - s.p90;
  const spread = Math.max(s.mad, (s.p90 - s.p10) / 2, Math.abs(s.median) * 0.05, 1e-6);
  return Math.max(0, 1 - d / (2 * spread));
}

function catMatch(v: string, s: FeatureStat): number {
  if (v === s.dominant) return 1;
  return s.distribution?.[v] ?? 0;
}

const statusOf = (m: number): LaneStatus => (m >= 0.75 ? 'in-lane' : m >= 0.4 ? 'edge' : 'out-of-lane');

/**
 * Score a track against its lane. Pure — only measured+profiled dimensions count.
 */
export function scoreLaneCompliance(analysis: MeasuredAnalysis, profile: LaneProfile): LaneComplianceScore {
  const dimensions: DimensionScore[] = [];
  const skipped: string[] = [];

  for (const spec of PROFILE_FEATURES) {
    const stat = profile.features[spec.key];
    if (!stat) { continue; } // not profiled — silently not part of the lane's fingerprint
    const got = trackScalar(analysis, spec);
    if (!got) { skipped.push(`${spec.key} (unknown in track)`); continue; }

    let match: number;
    const target: DimensionScore['target'] = {};
    if (spec.kind === 'numeric' && stat.numeric && typeof got.v === 'number') {
      match = numericMatch(got.v, stat.numeric);
      target.median = stat.numeric.median; target.p10 = stat.numeric.p10; target.p90 = stat.numeric.p90;
    } else if (spec.kind !== 'numeric') {
      match = catMatch(String(got.v), stat);
      target.dominant = stat.dominant;
    } else {
      skipped.push(`${spec.key} (type mismatch)`);
      continue;
    }
    dimensions.push({
      key: spec.key, kind: spec.kind, trackValue: got.v, target,
      match: Math.round(match * 1000) / 1000, status: statusOf(match),
      weight: weightOf(spec.key), identity: IDENTITY.has(spec.key),
    });
  }

  const profiledCount = Object.keys(profile.features).length;
  const totWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const overall = totWeight ? Math.round((dimensions.reduce((s, d) => s + d.match * d.weight, 0) / totWeight) * 100) : 0;

  // ---- Genre drift: identity dimensions that fell out of lane ----
  const outIdentity = dimensions.filter((d) => d.identity && d.status === 'out-of-lane');
  const reasons = outIdentity.map((d) => {
    if (d.kind === 'numeric' && typeof d.trackValue === 'number' && d.target.p10 != null) {
      return `${d.key} ${d.trackValue} is outside the lane's ${d.target.p10}–${d.target.p90}`;
    }
    return `${d.key} is "${d.trackValue}", lane expects "${d.target.dominant}"`;
  });
  const coreOut = outIdentity.filter((d) => CORE.has(d.key));
  const severity: GenreDrift['severity'] = coreOut.length || outIdentity.length >= 2 ? 'major' : outIdentity.length === 1 ? 'minor' : 'none';

  return {
    lane: profile.lane,
    overall,
    coverage: profiledCount ? dimensions.length / profiledCount : 0,
    scored: dimensions.length,
    dimensions,
    skipped,
    drift: { drifted: severity !== 'none', severity, reasons },
    failedCritical: coreOut.map((d) => d.key),
  };
}

/** Compact human/LLM summary of a compliance result. */
export function describeCompliance(s: LaneComplianceScore): string {
  const lines = [`Lane compliance for "${s.lane}": ${s.overall}/100 (from ${s.scored} measured dimension(s), ${Math.round(s.coverage * 100)}% of the lane).`];
  if (s.drift.drifted) lines.push(`⚠ GENRE DRIFT (${s.drift.severity}): ${s.drift.reasons.join('; ')}`);
  const off = s.dimensions.filter((d) => d.status !== 'in-lane').sort((a, b) => a.match - b.match);
  for (const d of off.slice(0, 6)) {
    const tgt = d.target.p10 != null ? `${d.target.p10}–${d.target.p90}` : `"${d.target.dominant}"`;
    lines.push(`  ${d.status === 'out-of-lane' ? '✗' : '~'} ${d.key}: ${d.trackValue} (lane ${tgt}) match ${Math.round(d.match * 100)}%`);
  }
  if (s.skipped.length) lines.push(`  unverified: ${s.skipped.join(', ')}`);
  return lines.join('\n');
}
