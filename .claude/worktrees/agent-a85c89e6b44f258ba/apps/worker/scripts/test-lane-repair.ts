/**
 * PHASE 3 unit test — planRepairs. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-repair.ts
 *
 * Verifies: an in-lane track yields NO repairs (clean); an out-of-lane track yields
 * concrete, prioritized repairs with a real steering addendum; identity misses are
 * 'critical' and ranked first; and the honesty rule — no repair is emitted for a
 * dimension that was never scored (unverified).
 */
import {
  buildLaneProfile, scoreLaneCompliance, planRepairs, describeRepairPlan,
  measured, unknownField, unknownAnalysis, type MeasuredAnalysis,
} from '@afrohit/shared';

function amapiano(tempo: number, four: boolean, swing: number, lowEnd: number, logdrum: number): MeasuredAnalysis {
  const a = unknownAnalysis('test');
  a.tempoBpm = measured(tempo, 0.7, 'test');
  a.fourOnFloor = measured(four, 0.9, 'test');
  a.swingRatio = measured(swing, 0.8, 'test');
  a.shakerContinuity = measured(0.7, 0.6, 'test');
  a.lowEndProfile = measured({ ratio: lowEnd, crest: 6 }, 0.9, 'test');
  a.logDrumLikelihood = measured(logdrum, 0.6, 'test');
  a.engineOk = true;
  return a;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

const refs = [amapiano(110, true, 52, 0.40, 0.62), amapiano(112, true, 54, 0.42, 0.66), amapiano(112, true, 50, 0.38, 0.64), amapiano(114, true, 55, 0.44, 0.68), amapiano(113, true, 53, 0.41, 0.65)];
const profile = buildLaneProfile('amapiano', 'genre', refs, { minRefs: 3 });

// 1) In-lane -> clean, no repairs.
const clean = planRepairs(scoreLaneCompliance(amapiano(112, true, 53, 0.41, 0.65), profile));
assert(clean.clean && clean.repairs.length === 0, 'in-lane track -> no repairs (clean)');
assert(clean.laneSteeringAddendum === '', 'clean plan has empty steering addendum');

// 2) Out-of-lane (house tempo, no 4OTF, no log-drum, thin low end) -> concrete repairs.
const plan = planRepairs(scoreLaneCompliance(amapiano(128, false, 50, 0.2, 0.05), profile));
console.log('\n' + describeRepairPlan(plan) + '\n');
console.log('ADDENDUM Phase 4 would inject:\n' + plan.laneSteeringAddendum + '\n');
assert(!plan.clean && plan.repairs.length >= 3, 'out-of-lane -> multiple repairs');
assert(plan.repairs[0]!.severity === 'critical', 'top repair is critical (identity miss)');
assert(['tempoBpm', 'fourOnFloor', 'logDrumLikelihood'].includes(plan.repairs[0]!.key), 'top repair targets an identity dimension');
assert(plan.repairs.some((r) => r.key === 'fourOnFloor' && /four-on-floor/i.test(r.instruction)), 'four-on-floor repair is actionable');
assert(plan.repairs.some((r) => r.key === 'logDrumLikelihood' && /log-drum/i.test(r.instruction) && /glide|portamento/i.test(r.instruction)), 'log-drum repair names the glide signature');
assert(plan.repairs.some((r) => r.key === 'tempoBpm' && /Lower the tempo from 128/.test(r.instruction)), 'tempo repair gives a concrete number');
assert(plan.laneSteeringAddendum.includes('LANE REPAIR') && plan.laneSteeringAddendum.includes('amapiano'), 'steering addendum is populated');
// priorities strictly non-increasing
assert(plan.repairs.every((r, i) => i === 0 || r.priority <= plan.repairs[i - 1]!.priority), 'repairs ordered by priority');

// 3) HONESTY: no repair for a dimension that was never scored.
const partial = amapiano(128, false, 50, 0.2, 0.05);
partial.swingRatio = unknownField('no-16th'); // unverified -> must not produce a swing repair
const pplan = planRepairs(scoreLaneCompliance(partial, profile));
assert(!pplan.repairs.some((r) => r.key === 'swingRatio'), 'no repair emitted for an unverified dimension');

console.log(process.exitCode ? '\n❌ RepairPlanner test FAILED' : '\n✅ RepairPlanner test PASSED');
