/**
 * PHASE 1 unit test — buildLaneProfile. Pure (no audio/python), CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-profile.ts
 *
 * Asserts the aggregator captures central tendency/range from measured refs AND
 * honors the honesty law: an 'inferred' (uncalibrated) logDrumLikelihood must NOT
 * be profiled, and a feature 'measured' in too few refs lands in `unprofiled`.
 */
import {
  buildLaneProfile, describeLaneProfile,
  measured, inferred, unknownField, unknownAnalysis,
  type MeasuredAnalysis,
} from '@afrohit/shared';

function amapianoRef(tempo: number, swing: number, lowEnd: number, kickMicro: number, logdrumSource: 'inferred' | 'measured'): MeasuredAnalysis {
  const a = unknownAnalysis('test');
  a.tempoBpm = measured(tempo, 0.7, 'test');
  a.swingRatio = measured(swing, 0.8, 'test');
  a.fourOnFloor = measured(true, 0.9, 'test');
  a.mode = measured('minor', 0.6, 'test');
  a.sungVsSpoken = measured('sung', 0.7, 'test');
  a.lowEndProfile = measured({ ratio: lowEnd, crest: 6 }, 0.9, 'test');
  a.microtiming = measured({ kick: kickMicro, snareClap: -5, hat: 8 }, 0.5, 'test');
  a.logDrumLikelihood = logdrumSource === 'measured'
    ? measured(0.65, 0.6, 'test')
    : inferred(0.65, 'test-uncalibrated');
  a.vocalPresenceRatio = measured(0.62, 0.85, 'test');
  a.engineOk = true;
  return a;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('  ok:', msg);
}

// 5 amapiano refs, tempo clustered ~112, log-drum still INFERRED (uncalibrated).
const refs = [
  amapianoRef(110, 52, 0.40, 12, 'inferred'),
  amapianoRef(112, 54, 0.42, 15, 'inferred'),
  amapianoRef(112, 50, 0.38, 10, 'inferred'),
  amapianoRef(114, 55, 0.44, 18, 'inferred'),
  amapianoRef(113, 53, 0.41, 14, 'inferred'),
];

const p = buildLaneProfile('amapiano', 'genre', refs, { minRefs: 3 });
console.log('\n' + describeLaneProfile(p) + '\n');

console.log('assertions:');
assert(p.totalRefs === 5, 'totalRefs = 5');
assert(!!p.features.tempoBpm?.numeric, 'tempoBpm profiled');
assert(Math.abs((p.features.tempoBpm!.numeric!.median) - 112) <= 1, `tempo median ~112 (got ${p.features.tempoBpm!.numeric!.median})`);
assert(p.features.tempoBpm!.numeric!.p10 <= 111 && p.features.tempoBpm!.numeric!.p90 >= 113, 'tempo p10-p90 spans the cluster');
assert(p.features.fourOnFloor?.dominant === 'true', 'fourOnFloor dominant = true');
assert(p.features.sungVsSpoken?.dominant === 'sung', 'sungVsSpoken dominant = sung');
assert(!!p.features.lowEndRatio?.numeric, 'lowEndRatio (sub-field) profiled');
assert(!!p.features.microKick?.numeric, 'microKick (sub-field) profiled');
// THE honesty check: an INFERRED log-drum must NOT be profiled.
assert(!p.features.logDrumLikelihood, 'inferred logDrumLikelihood is NOT profiled');
assert(p.unprofiled.some((u) => u.startsWith('logDrumLikelihood')), 'logDrumLikelihood listed in unprofiled');

// Now flip log-drum to MEASURED (as calibration would) and confirm it profiles.
const calibrated = refs.map((_, i) => amapianoRef(112, 52, 0.41, 13, 'measured'));
const p2 = buildLaneProfile('amapiano', 'genre', calibrated, { minRefs: 3 });
assert(!!p2.features.logDrumLikelihood?.numeric, 'measured logDrumLikelihood IS profiled after calibration');

console.log(process.exitCode ? '\n❌ LaneProfile test FAILED' : '\n✅ LaneProfile test PASSED');
