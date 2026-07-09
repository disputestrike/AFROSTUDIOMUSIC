/**
 * PHASE 2 unit test — scoreLaneCompliance + genre drift. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-compliance.ts
 *
 * Verifies: an in-lane amapiano track scores high with no drift; an out-of-lane
 * track (wrong tempo, no four-on-floor, no log-drum) scores low with MAJOR drift;
 * and the honesty law — an unknown track dimension is skipped (unverified), never
 * scored 0, and an uncalibrated (inferred) log-drum is neither profiled nor scored.
 */
import {
  buildLaneProfile, scoreLaneCompliance, describeCompliance,
  measured, inferred, unknownField, unknownAnalysis,
  type MeasuredAnalysis,
} from '@afrohit/shared';

function amapiano(tempo: number, four: boolean, swing: number, lowEnd: number, logdrum: number, logSrc: 'measured' | 'inferred'): MeasuredAnalysis {
  const a = unknownAnalysis('test');
  a.tempoBpm = measured(tempo, 0.7, 'test');
  a.fourOnFloor = measured(four, 0.9, 'test');
  a.swingRatio = measured(swing, 0.8, 'test');
  a.shakerContinuity = measured(0.7, 0.6, 'test');
  a.lowEndProfile = measured({ ratio: lowEnd, crest: 6 }, 0.9, 'test');
  a.mode = measured('minor', 0.6, 'test');
  a.logDrumLikelihood = logSrc === 'measured' ? measured(logdrum, 0.6, 'test') : inferred(logdrum, 'test');
  a.engineOk = true;
  return a;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// Build a CALIBRATED amapiano lane (log-drum measured, so it's profiled + scored).
const refs = [
  amapiano(110, true, 52, 0.40, 0.62, 'measured'),
  amapiano(112, true, 54, 0.42, 0.66, 'measured'),
  amapiano(112, true, 50, 0.38, 0.64, 'measured'),
  amapiano(114, true, 55, 0.44, 0.68, 'measured'),
  amapiano(113, true, 53, 0.41, 0.65, 'measured'),
];
const profile = buildLaneProfile('amapiano', 'genre', refs, { minRefs: 3 });
assert(!!profile.features.logDrumLikelihood, 'lane profiled log-drum (calibrated refs)');

// 1) An IN-LANE track.
const good = scoreLaneCompliance(amapiano(112, true, 53, 0.41, 0.65, 'measured'), profile);
console.log('\n' + describeCompliance(good) + '\n');
assert(good.overall >= 85, `in-lane track scores high (got ${good.overall})`);
assert(!good.drift.drifted, 'in-lane track: no drift');

// 2) An OUT-OF-LANE track: house tempo, no 4OTF, no log-drum, straight.
const bad = scoreLaneCompliance(amapiano(128, false, 50, 0.2, 0.05, 'measured'), profile);
console.log(describeCompliance(bad) + '\n');
assert(bad.overall < 55, `out-of-lane track scores low (got ${bad.overall})`);
assert(bad.drift.drifted && bad.drift.severity === 'major', `out-of-lane: MAJOR drift (got ${bad.drift.severity})`);
assert(bad.drift.reasons.some((r) => r.includes('fourOnFloor')) || bad.drift.reasons.some((r) => r.includes('tempoBpm')), 'drift names a real reason');

// 3) HONESTY: a track missing tempo -> that dimension is SKIPPED (unverified), not 0.
const partial = amapiano(112, true, 53, 0.41, 0.65, 'measured');
partial.tempoBpm = unknownField('no-grid');
const ps = scoreLaneCompliance(partial, profile);
assert(ps.skipped.some((s) => s.startsWith('tempoBpm')), 'unknown track tempo is skipped, not scored 0');
assert(ps.scored === good.scored - 1, 'skipped dimension drops out of scoring (coverage honest)');

// 4) HONESTY: an INFERRED (uncalibrated) log-drum lane doesn't profile it -> not scored.
const uncal = buildLaneProfile('amapiano', 'genre', refs.map((_, i) => amapiano(112, true, 53, 0.41, 0.65, 'inferred')), { minRefs: 3 });
assert(!uncal.features.logDrumLikelihood, 'uncalibrated lane does NOT profile log-drum');
const us = scoreLaneCompliance(amapiano(112, true, 53, 0.41, 0.65, 'measured'), uncal);
assert(!us.dimensions.some((d) => d.key === 'logDrumLikelihood'), 'log-drum not scored when lane cannot profile it');

console.log(process.exitCode ? '\n❌ LaneCompliance test FAILED' : '\n✅ LaneCompliance test PASSED');
