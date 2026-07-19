/**
 * OWN-ENGINE BED FLOOR — proof (2026-07-19), fix #5.
 * The "verified shelf is incomplete" hard-fail root cause: gate demanded beds>=5
 * but the synth floor makes 4 for most genres. The floor is now an env knob
 * (default 5 = unchanged; set 4 to let a 4-role synth bed ship on cold lanes).
 */
import assert from 'node:assert/strict';
import { materialCoverage } from '../../../packages/shared/src/material-select';
import { synthKitFor } from '../../../packages/shared/src/genre-kits';

// a realistic 4-bed synth floor (drums, percussion, bass, chords) + a fill
const fourBed = [
  { role: 'drums' }, { role: 'percussion' }, { role: 'bass' }, { role: 'chords' }, { role: 'fill' },
];

// DEFAULT is now 4 so the own engine RENDERS out of the box (owner: "our engine
// must work"). A 4-bed synth floor (drums/perc/bass/chords) passes.
delete process.env.OWN_ENGINE_MIN_BEDS;
const def = materialCoverage(fourBed);
assert.equal(def.minBeds, 4, 'default floor is now 4 (own engine works out of the box)');
assert.equal(def.beds, 4, 'counts 4 beds (fill excluded)');
assert.equal(def.ready, true, 'a 4-bed shelf now passes at the default floor');

// operators who want a fuller bar can raise it back to 5
process.env.OWN_ENGINE_MIN_BEDS = '5';
assert.equal(materialCoverage(fourBed).ready, false, 'OWN_ENGINE_MIN_BEDS=5 restores the stricter bar');
delete process.env.OWN_ENGINE_MIN_BEDS;

// ── TONAL GUARANTEE: every genre's synth kit must include a chords role, else
// the coverage gate's tonal>=1 can never pass (the street_pop failure).
for (const g of ['afrobeats', 'street_pop', 'drill', 'amapiano', 'trap', 'gospel', 'lofi', 'bongo_flava', 'afro_house']) {
  const k = synthKitFor(g);
  assert.ok(k.includes('chords'), `synthKitFor(${g}) must include a tonal 'chords' role (got ${k.join(',')})`);
  const cov = materialCoverage(k.map((role) => ({ role })));
  assert.ok(cov.tonal >= 1, `${g}: tonal>=1 (was 0 for street_pop) — got ${cov.tonal}`);
  assert.ok(cov.ready, `${g}: own-engine shelf is now COMPLETE (beds=${cov.beds} tonal=${cov.tonal})`);
}

// invalid inputs fall back safely: 0 is falsy -> default 5; negatives clamp to 1
process.env.OWN_ENGINE_MIN_BEDS = '0';
assert.equal(materialCoverage([{ role: 'drums' }]).minBeds, 4, '0 is falsy -> falls back to default 4');
process.env.OWN_ENGINE_MIN_BEDS = '-3';
assert.equal(materialCoverage(fourBed).minBeds, 1, 'a negative floor clamps to >=1');
process.env.OWN_ENGINE_MIN_BEDS = 'nonsense';
assert.equal(materialCoverage(fourBed).minBeds, 4, 'unparseable falls back to 4');

// a full 5-bed shelf is ready at either floor
delete process.env.OWN_ENGINE_MIN_BEDS;
const fiveBed = [
  { role: 'drums' }, { role: 'percussion' }, { role: 'bass' }, { role: 'log_drum' }, { role: 'chords' },
];
assert.equal(materialCoverage(fiveBed).ready, true, 'a full 5-bed shelf passes at floor 5');

console.log('own-engine bed floor: default 5 (unchanged); OWN_ENGINE_MIN_BEDS=4 lets cold lanes ship instead of hard-failing; clamped [1..], shared by router + worker.');
