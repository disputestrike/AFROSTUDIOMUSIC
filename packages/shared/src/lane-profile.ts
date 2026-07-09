/**
 * PHASE 1 — LaneProfile: the measured fingerprint of a lane.
 *
 * A "lane" is a genre (amapiano, afrobeats…) or an artist style-lane. Its profile is
 * built by aggregating the MeasuredAnalysis of the reference tracks in that lane into
 * a per-feature central tendency + spread + coverage. This is the TARGET the Phase-2
 * LaneComplianceScorer compares a new track against.
 *
 * THE HONESTY LAW carries through: a feature is profiled ONLY from values whose
 * source is 'measured'. 'inferred' (e.g. an uncalibrated logDrumLikelihood) and
 * 'unknown' never enter a profile — a dimension with too few measured references
 * lands in `unprofiled` and simply cannot be scored yet, rather than being faked.
 * When logDrumLikelihood is calibrated (source flips to 'measured'), it profiles
 * automatically with no code change.
 */
import type { Measured, MeasuredAnalysis } from './dsp-analysis';

export interface NumericStat {
  median: number;
  mad: number; // median absolute deviation — robust spread
  p10: number;
  p90: number; // the target range a compliant track should fall within
}

export interface FeatureStat {
  kind: 'numeric' | 'boolean' | 'categorical';
  n: number; // # references with this feature 'measured'
  coverage: number; // n / totalRefs
  confidence: number; // mean measured-confidence across contributing refs
  numeric?: NumericStat;
  distribution?: Record<string, number>; // value -> fraction (boolean/categorical)
  dominant?: string; // most common value (boolean/categorical)
}

export interface LaneProfile {
  lane: string; // e.g. "amapiano" or "artist:Asake"
  laneKind: 'genre' | 'artist';
  totalRefs: number;
  minRefs: number; // a feature needs this many measured refs to be profiled
  features: Record<string, FeatureStat>;
  unprofiled: string[]; // features with < minRefs measured refs (incl. reason where useful)
  coverageRatio: number; // profiled features / profileable features
  builtAt: string | null;
}

type Extract = (a: MeasuredAnalysis) => Measured<unknown> | undefined;

interface FeatureSpec {
  key: string;
  kind: 'numeric' | 'boolean' | 'categorical';
  /** the Measured<T> field to read */
  field: Extract;
  /** for object-valued fields (lowEndProfile/microtiming), pull a scalar sub-value */
  sub?: string;
}

const f = (k: keyof MeasuredAnalysis): Extract => (a) => a[k] as unknown as Measured<unknown>;

/**
 * The features a lane is profiled on. Array-valued shapes (sectionBoundaries,
 * energyCurve) and durationS are intentionally excluded — they describe an
 * individual track, not a lane target. logDrumLikelihood is listed but only
 * contributes once its source is 'measured' (i.e. calibrated).
 */
export const PROFILE_FEATURES: FeatureSpec[] = [
  { key: 'tempoBpm', kind: 'numeric', field: f('tempoBpm') },
  { key: 'swingRatio', kind: 'numeric', field: f('swingRatio') },
  { key: 'syncopationIndex', kind: 'numeric', field: f('syncopationIndex') },
  { key: 'shakerContinuity', kind: 'numeric', field: f('shakerContinuity') },
  { key: 'kickDensity', kind: 'numeric', field: f('kickDensity') },
  { key: 'clapBackbeat', kind: 'numeric', field: f('clapBackbeat') },
  { key: 'firstDropAtS', kind: 'numeric', field: f('firstDropAtS') },
  { key: 'introLengthBars', kind: 'numeric', field: f('introLengthBars') },
  { key: 'vocalPresenceRatio', kind: 'numeric', field: f('vocalPresenceRatio') },
  { key: 'logDrumLikelihood', kind: 'numeric', field: f('logDrumLikelihood') },
  { key: 'lowEndRatio', kind: 'numeric', field: f('lowEndProfile'), sub: 'ratio' },
  { key: 'lowEndCrest', kind: 'numeric', field: f('lowEndProfile'), sub: 'crest' },
  { key: 'microKick', kind: 'numeric', field: f('microtiming'), sub: 'kick' },
  { key: 'microSnareClap', kind: 'numeric', field: f('microtiming'), sub: 'snareClap' },
  { key: 'microHat', kind: 'numeric', field: f('microtiming'), sub: 'hat' },
  { key: 'fourOnFloor', kind: 'boolean', field: f('fourOnFloor') },
  { key: 'mode', kind: 'categorical', field: f('mode') },
  { key: 'key', kind: 'categorical', field: f('key') },
  { key: 'timeSignature', kind: 'categorical', field: f('timeSignature') },
  { key: 'sungVsSpoken', kind: 'categorical', field: f('sungVsSpoken') },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 1) return xs[0]!;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

/** Pull the scalar value from a measured field (respecting an optional sub-key). */
function measuredValue(m: Measured<unknown> | undefined, sub?: string): { v: unknown; conf: number } | null {
  if (!m || m.source !== 'measured' || m.value == null) return null;
  if (sub) {
    const obj = m.value as Record<string, unknown>;
    const v = obj?.[sub];
    if (v == null) return null;
    return { v, conf: m.confidence };
  }
  return { v: m.value, conf: m.confidence };
}

/**
 * Build a lane profile from the measured analyses of that lane's reference tracks.
 * Only 'measured' values contribute; features below minRefs land in `unprofiled`.
 */
export function buildLaneProfile(
  lane: string,
  laneKind: 'genre' | 'artist',
  analyses: MeasuredAnalysis[],
  opts?: { minRefs?: number },
): LaneProfile {
  const minRefs = Math.max(2, opts?.minRefs ?? 3);
  const features: Record<string, FeatureStat> = {};
  const unprofiled: string[] = [];

  for (const spec of PROFILE_FEATURES) {
    const vals: unknown[] = [];
    const confs: number[] = [];
    for (const a of analyses) {
      const got = measuredValue(spec.field(a), spec.sub);
      if (got) { vals.push(got.v); confs.push(got.conf); }
    }
    if (vals.length < minRefs) {
      unprofiled.push(`${spec.key} (${vals.length}/${minRefs} measured)`);
      continue;
    }
    const confidence = confs.reduce((s, c) => s + c, 0) / confs.length;
    const base: FeatureStat = { kind: spec.kind, n: vals.length, coverage: vals.length / analyses.length, confidence };

    if (spec.kind === 'numeric') {
      const nums = vals.filter((v) => typeof v === 'number') as number[];
      if (nums.length < minRefs) { unprofiled.push(`${spec.key} (non-numeric values)`); continue; }
      const med = median(nums);
      base.numeric = {
        median: med,
        mad: median(nums.map((x) => Math.abs(x - med))),
        p10: percentile(nums, 0.1),
        p90: percentile(nums, 0.9),
      };
    } else {
      const dist: Record<string, number> = {};
      for (const v of vals) {
        const key = String(v);
        dist[key] = (dist[key] ?? 0) + 1;
      }
      let dominant = ''; let best = -1;
      for (const [k, c] of Object.entries(dist)) {
        dist[k] = c / vals.length;
        if (dist[k]! > best) { best = dist[k]!; dominant = k; }
      }
      base.distribution = dist;
      base.dominant = dominant;
    }
    features[spec.key] = base;
  }

  const profileable = PROFILE_FEATURES.length;
  return {
    lane, laneKind, totalRefs: analyses.length, minRefs,
    features, unprofiled,
    coverageRatio: Object.keys(features).length / profileable,
    builtAt: null, // stamped by the caller (scripts can't call Date in some sandboxes)
  };
}

/** A compact human/LLM-readable summary of a lane profile (for display + later prompt injection). */
export function describeLaneProfile(p: LaneProfile): string {
  const lines: string[] = [`Lane "${p.lane}" (${p.laneKind}) from ${p.totalRefs} refs — ${Object.keys(p.features).length}/${PROFILE_FEATURES.length} features profiled:`];
  for (const [k, s] of Object.entries(p.features)) {
    if (s.numeric) {
      lines.push(`  ${k}: ~${round(s.numeric.median)} (${round(s.numeric.p10)}–${round(s.numeric.p90)}) [n=${s.n}]`);
    } else {
      const top = Object.entries(s.distribution ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([v, fr]) => `${v} ${Math.round(fr * 100)}%`).join(', ');
      lines.push(`  ${k}: ${top} [n=${s.n}]`);
    }
  }
  if (p.unprofiled.length) lines.push(`  unprofiled: ${p.unprofiled.join(', ')}`);
  return lines.join('\n');
}

function round(n: number): number {
  return Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
}
