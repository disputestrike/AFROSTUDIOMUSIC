/**
 * PHASE 5 unit test — laneMaterialNeeds + selectLaneMaterials. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-material.ts
 *
 * Verifies: needs are DERIVED from measured facts (log-drum + shaker become signature
 * roles only when the lane measured them); selection prefers artist stems + bpm match;
 * missing roles become forge gaps; and readiness gates on core roles.
 */
import {
  buildLaneProfile, laneMaterialNeeds, selectLaneMaterials, describeMaterialSelection, planFills,
  measured, unknownAnalysis, type MeasuredAnalysis, type MaterialLite,
} from '@afrohit/shared';

function amapiano(logdrum: number, shaker: number): MeasuredAnalysis {
  const a = unknownAnalysis('test');
  a.tempoBpm = measured(112, 0.7, 'test');
  a.fourOnFloor = measured(true, 0.9, 'test');
  a.shakerContinuity = measured(shaker, 0.6, 'test');
  a.logDrumLikelihood = measured(logdrum, 0.6, 'test');
  a.lowEndProfile = measured({ ratio: 0.4, crest: 6 }, 0.9, 'test');
  a.engineOk = true;
  return a;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// Lane with a measured log-drum + shakers -> signature roles required.
const profile = buildLaneProfile('amapiano', 'genre', [amapiano(0.62, 0.7), amapiano(0.66, 0.68), amapiano(0.64, 0.72)], { minRefs: 3 });
const needs = laneMaterialNeeds(profile);
console.log('\nneeds:', needs.roles.map((r) => `${r.role}(${r.importance})`).join(', '), '| bpm', needs.targetBpm, '| fills', needs.wantsFills);
assert(needs.roles.some((r) => r.role === 'log_drum' && r.importance === 'signature'), 'measured log-drum -> signature role required');
assert(needs.roles.some((r) => r.role === 'percussion'), 'measured shakers -> percussion role required');
assert(needs.roles.some((r) => r.role === 'drums' && r.importance === 'core'), 'drums is a core role');
assert(needs.wantsFills, 'lane wants fills at section boundaries');
assert(needs.targetBpm === 112, 'target bpm from measured tempo');

// A lane that measured NO log-drum -> no log_drum role (honest, derived).
const noLog = laneMaterialNeeds(buildLaneProfile('house', 'genre', [amapiano(0.08, 0.1), amapiano(0.05, 0.12), amapiano(0.07, 0.09)], { minRefs: 3 }));
assert(!noLog.roles.some((r) => r.role === 'log_drum'), 'no measured log-drum -> no log_drum role');

// Selection: artist_stem preferred, bpm-matched; missing role -> gap.
const available: MaterialLite[] = [
  { id: 'd1', role: 'drums', genre: 'amapiano', bpm: 112, source: 'forged', url: 'u' },
  { id: 'd2', role: 'drums', genre: 'amapiano', bpm: 113, source: 'artist_stem', url: 'u' },
  { id: 'b1', role: 'bass', genre: 'amapiano', bpm: 112, source: 'artist_stem', url: 'u' },
  { id: 'l1', role: 'log_drum', genre: 'amapiano', bpm: 128, source: 'forged', url: 'u' }, // bpm off
  // no 'chords', no 'percussion' -> gaps
];
const sel = selectLaneMaterials(needs, available);
console.log('\n' + describeMaterialSelection(sel) + '\n');
assert(sel.picks.find((p) => p.role === 'drums')?.source === 'artist_stem', 'drums pick prefers artist_stem over forged');
assert(sel.picks.some((p) => p.role === 'log_drum'), 'log_drum picked even with bpm off (only option)');
assert(sel.gaps.some((g) => g.role === 'chords') && sel.gaps.some((g) => g.role === 'percussion'), 'missing roles become forge gaps');
// Readiness gates on CORE roles only (drums + bass). Both covered -> ready.
assert(sel.picks.some((p) => p.role === 'drums') && sel.picks.some((p) => p.role === 'bass'), 'core drums+bass covered');
assert(sel.ready === true, 'ready when all CORE roles covered (chords is support, not core)');

// And when a CORE role is missing, NOT ready.
const missingCore = selectLaneMaterials(needs, available.filter((m) => m.role !== 'bass'));
assert(missingCore.ready === false, 'missing a core role (bass) -> not ready');

// A 'fill' role is always needed (the transition Benjamin keeps missing).
assert(needs.roles.some((r) => r.role === 'fill'), 'lane needs a fill role for section transitions');

// planFills: with measured boundaries -> a fill leads into each PLUS the Afro
// 16-bar pulse (Benjamin's law: 'you always hear them'), deduped, sorted.
const BND = [0, 30, 60, 120, 150];
const DUR = 180;
const secPerBar = (60 / 112) * 4;
const withBounds = planFills(112, DUR, BND);
console.log('\nfills (measured boundaries):', withBounds.map((f) => f.atS.toFixed(1) + 's').join(', '));
assert(
  BND.filter((b) => b > secPerBar && b < DUR - 0.25).every((b) => withBounds.some((f) => Math.abs(f.atS - (b - secPerBar)) < 0.05)),
  'every real section boundary still gets a fill one bar before (pulses are ADDITIVE, never replacements)'
);
assert(withBounds.some((f) => f.label.includes('16-bar pulse')), "the Afro pulse: 16-bar fills appear even when boundaries exist (Benjamin's law)");
const sortedFills = [...withBounds].sort((a, b) => a.atS - b.atS);
assert(sortedFills.every((f, i) => i === 0 || f.atS - sortedFills[i - 1]!.atS > secPerBar * 0.9), 'no two fills within the same bar (dedupe holds)');
assert(Math.abs(sortedFills[0]!.atS - (30 - secPerBar)) < 0.05, 'fill lands one bar before the first boundary');

const cadence = planFills(120, 60, null, 8); // no boundaries -> every 8 bars
console.log('fills (cadence, no boundaries):', cadence.map((f) => f.atS.toFixed(1) + 's').join(', '));
assert(cadence.length >= 1 && cadence.every((f) => f.atS < 60), 'cadence fills placed within the track');
assert(planFills(0, 60).length === 0 && planFills(120, 0).length === 0, 'no fills without bpm/duration (no fabrication)');

console.log(process.exitCode ? '\n❌ LaneMaterial test FAILED' : '\n✅ LaneMaterial test PASSED');
