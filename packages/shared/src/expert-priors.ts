/**
 * EXPERT PRIORS — published production knowledge encoded as numbers, the legal
 * workaround for the cold start: what each lane MEASURES like is uncopyrightable
 * fact (tempo ranges, groove densities, keys presence). Three jittered pseudo-
 * analyses per genre flow through the SAME buildLaneProfile as real refs, every
 * field method-tagged 'expert-prior'. Powers correct scoring/ranking/repair on
 * day one; NEVER certifies — release still demands 3 authentic references.
 */
import type { MeasuredAnalysis } from './dsp-analysis';

interface Prior { bpm: number; four: number; log: number; swing: number; shaker: number; keys: number; kick?: number; clap?: number; hat?: number; sync?: number }

const P: Record<string, Prior> = {
  amapiano: { bpm: 112, four: 0.85, log: 0.8, swing: 0.55, shaker: 0.7, keys: 0.75, sync: 0.6 },
  afrobeats: { bpm: 104, four: 0.6, log: 0.35, swing: 0.58, shaker: 0.6, keys: 0.55, sync: 0.65 },
  afro_fusion: { bpm: 100, four: 0.55, log: 0.45, swing: 0.56, shaker: 0.55, keys: 0.6, sync: 0.6 },
  street_pop: { bpm: 102, four: 0.6, log: 0.6, swing: 0.56, shaker: 0.55, keys: 0.4, sync: 0.62 },
  afro_pop: { bpm: 102, four: 0.55, log: 0.3, swing: 0.55, shaker: 0.55, keys: 0.6, sync: 0.58 },
  afro_rnb: { bpm: 92, four: 0.4, log: 0.2, swing: 0.54, shaker: 0.4, keys: 0.75, sync: 0.5 },
  afro_dancehall: { bpm: 100, four: 0.55, log: 0.3, swing: 0.52, shaker: 0.5, keys: 0.5, sync: 0.58 },
  afro_gospel: { bpm: 105, four: 0.6, log: 0.3, swing: 0.55, shaker: 0.5, keys: 0.8, sync: 0.55 },
  gospel: { bpm: 100, four: 0.5, log: 0.1, swing: 0.52, shaker: 0.35, keys: 0.85, sync: 0.45 },
  highlife: { bpm: 112, four: 0.5, log: 0.1, swing: 0.56, shaker: 0.5, keys: 0.65, sync: 0.6 },
  hip_hop: { bpm: 92, four: 0.35, log: 0.15, swing: 0.5, shaker: 0.35, keys: 0.45, hat: 0.6, sync: 0.45 },
  trap: { bpm: 140, four: 0.35, log: 0.3, swing: 0.5, shaker: 0.3, keys: 0.35, hat: 0.85, sync: 0.45 },
  drill: { bpm: 142, four: 0.3, log: 0.45, swing: 0.5, shaker: 0.3, keys: 0.3, hat: 0.7, sync: 0.48 },
  rnb: { bpm: 88, four: 0.35, log: 0.1, swing: 0.52, shaker: 0.35, keys: 0.8, sync: 0.45 },
  soul: { bpm: 96, four: 0.45, log: 0.08, swing: 0.55, shaker: 0.45, keys: 0.75, sync: 0.5 },
  reggae: { bpm: 78, four: 0.35, log: 0.1, swing: 0.55, shaker: 0.4, keys: 0.6, sync: 0.55 },
  dancehall: { bpm: 102, four: 0.5, log: 0.2, swing: 0.5, shaker: 0.45, keys: 0.45, sync: 0.55 },
  reggaeton: { bpm: 96, four: 0.55, log: 0.2, swing: 0.5, shaker: 0.5, keys: 0.45, sync: 0.55 },
  latin_pop: { bpm: 100, four: 0.5, log: 0.1, swing: 0.52, shaker: 0.5, keys: 0.6, sync: 0.5 },
  pop: { bpm: 116, four: 0.6, log: 0.1, swing: 0.5, shaker: 0.45, keys: 0.65, sync: 0.45 },
  house: { bpm: 124, four: 0.95, log: 0.25, swing: 0.52, shaker: 0.6, keys: 0.6, sync: 0.5 },
  edm: { bpm: 128, four: 0.95, log: 0.15, swing: 0.5, shaker: 0.5, keys: 0.55, sync: 0.42 },
  country: { bpm: 100, four: 0.45, log: 0.05, swing: 0.5, shaker: 0.35, keys: 0.6, sync: 0.4 },
  rock: { bpm: 120, four: 0.5, log: 0.05, swing: 0.5, shaker: 0.3, keys: 0.5, sync: 0.4 },
};

const M = <T,>(v: T) => ({ value: v, source: 'measured', confidence: 0.5, method: 'expert-prior' });

/** Three lightly-jittered pseudo-analyses so variance/tolerance are sane. */
export function priorAnalyses(genre: string): MeasuredAnalysis[] {
  const pr = P[genre];
  if (!pr) return [];
  return [-1, 0, 1].map((j) => {
    const f = (x: number, amt = 0.05) => Math.max(0, Math.min(1, x + j * amt));
    return {
      engineOk: true,
      tempoBpm: M(pr.bpm + j * 2),
      // fourOnFloor is a BOOLEAN in every real MeasuredAnalysis — emitting the
      // prior as a number (0.85) made the profile build this dimension as
      // NUMERIC: the repair planner fell into the wrong branch ("drop the
      // four-on-floor" told to amapiano regens!) and a CORRECT true take could
      // even read out-of-lane (1.0 > p90 of 0.9). The prior's belief maps to
      // the boolean it describes.
      fourOnFloor: M(pr.four >= 0.5),
      logDrumLikelihood: M(f(pr.log)),
      swingRatio: M(f(pr.swing, 0.02)),
      shakerContinuity: M(f(pr.shaker)),
      harmonicRichness: M(f(pr.keys)),
      kickDensity: M(f(pr.kick ?? 0.5)),
      clapBackbeat: M(f(pr.clap ?? 0.55)),
      hatRollPresence: M(f(pr.hat ?? 0.4)),
      syncopationIndex: M(f(pr.sync ?? 0.5, 0.03)),
    } as unknown as MeasuredAnalysis;
  });
}

export function hasExpertPrior(genre?: string | null): boolean { return !!genre && !!P[genre]; }
