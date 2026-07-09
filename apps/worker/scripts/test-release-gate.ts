/**
 * PHASE 6 unit test — laneReleaseGate. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-release-gate.ts
 *
 * Verifies: broken audio (QC fail) BLOCKS; genre drift + low compliance WARN but do
 * NOT block (respect the ear); unmeasured signals are 'unverified' and never block.
 */
import { laneReleaseGate } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// 1) Clean, in-lane take -> not blocked, no warnings.
const good = laneReleaseGate({ compliance: { overall: 88, drift: { severity: 'none' } }, qc: { verdict: 'pass' } });
assert(!good.blocked, 'clean in-lane take not blocked');
assert(good.warnings.length === 0, 'clean take has no warnings');

// 2) Broken audio -> BLOCKED.
const broken = laneReleaseGate({ compliance: { overall: 90, drift: { severity: 'none' } }, qc: { verdict: 'fail', flags: ['clipping'] } });
assert(broken.blocked, 'QC fail BLOCKS release');
assert(broken.checks.some((c) => c.name === 'audio quality' && c.status === 'fail'), 'audio quality reported fail');

// 3) Major drift -> WARN, NOT blocked (respect the ear).
const drift = laneReleaseGate({ compliance: { overall: 34, drift: { severity: 'major', reasons: ['tempo 128 outside 110-114'] } }, qc: { verdict: 'pass' } });
assert(!drift.blocked, 'major drift does NOT block (artist may want it)');
assert(drift.warnings.some((w) => w.includes('in-lane')), 'drift surfaced as a warning');
assert(drift.warnings.some((w) => w.includes('lane compliance')), 'below-floor compliance warned');

// 4) Unmeasured -> unverified, never blocks.
const unmeasured = laneReleaseGate({ compliance: null, qc: null });
assert(!unmeasured.blocked, 'unmeasured never blocks');
assert(unmeasured.checks.every((c) => c.status === 'unverified'), 'unmeasured signals marked unverified');

console.log(process.exitCode ? '\n❌ ReleaseGate test FAILED' : '\n✅ ReleaseGate test PASSED');
