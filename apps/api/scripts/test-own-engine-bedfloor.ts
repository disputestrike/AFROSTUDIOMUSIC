/**
 * OWN-ENGINE BED FLOOR — proof (2026-07-19), fix #5.
 * The "verified shelf is incomplete" hard-fail root cause: gate demanded beds>=5
 * but the synth floor makes 4 for most genres. The floor is now an env knob
 * (default 5 = unchanged; set 4 to let a 4-role synth bed ship on cold lanes).
 */
import assert from 'node:assert/strict';
import { materialCoverage } from '../../../packages/shared/src/material-select';

// a realistic 4-bed synth floor (drums, percussion, bass, chords) + a fill
const fourBed = [
  { role: 'drums' }, { role: 'percussion' }, { role: 'bass' }, { role: 'chords' }, { role: 'fill' },
];

// DEFAULT (no env / 5): the 4-bed shelf is NOT ready — today's behavior, unchanged
delete process.env.OWN_ENGINE_MIN_BEDS;
const def = materialCoverage(fourBed);
assert.equal(def.minBeds, 5, 'default floor is 5');
assert.equal(def.beds, 4, 'counts 4 beds (fill excluded)');
assert.equal(def.ready, false, 'at floor 5, a 4-bed cold lane still fails (unchanged)');

// KNOB = 4: the same 4-bed shelf now SHIPS (cold-lane reliability), no deploy
process.env.OWN_ENGINE_MIN_BEDS = '4';
const relaxed = materialCoverage(fourBed);
assert.equal(relaxed.minBeds, 4, 'env knob lowers the floor to 4');
assert.equal(relaxed.ready, true, 'a 4-role synth bed ships instead of hard-failing');

// invalid inputs fall back safely: 0 is falsy -> default 5; negatives clamp to 1
process.env.OWN_ENGINE_MIN_BEDS = '0';
assert.equal(materialCoverage([{ role: 'drums' }]).minBeds, 5, '0 is falsy -> falls back to default 5');
process.env.OWN_ENGINE_MIN_BEDS = '-3';
assert.equal(materialCoverage(fourBed).minBeds, 1, 'a negative floor clamps to >=1');
process.env.OWN_ENGINE_MIN_BEDS = 'nonsense';
assert.equal(materialCoverage(fourBed).minBeds, 5, 'unparseable falls back to 5');

// a full 5-bed shelf is ready at either floor
delete process.env.OWN_ENGINE_MIN_BEDS;
const fiveBed = [
  { role: 'drums' }, { role: 'percussion' }, { role: 'bass' }, { role: 'log_drum' }, { role: 'chords' },
];
assert.equal(materialCoverage(fiveBed).ready, true, 'a full 5-bed shelf passes at floor 5');

console.log('own-engine bed floor: default 5 (unchanged); OWN_ENGINE_MIN_BEDS=4 lets cold lanes ship instead of hard-failing; clamped [1..], shared by router + worker.');
