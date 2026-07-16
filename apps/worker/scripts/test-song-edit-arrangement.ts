import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cutTimeSlices,
  nonEmptyTimeSlices,
  planSongEditArrangement,
  reconcileArrangementDuration,
  segmentsFrom,
} from '../src/processors/song-edit';

assert.deepEqual(
  cutTimeSlices(60, 0, 5),
  [{ s: 5, e: 60 }],
  'a leading cut must not manufacture a prefix slice',
);

assert.deepEqual(
  nonEmptyTimeSlices([{ s: 0, e: 0 }, { s: 0, e: 5 }, { s: 5, e: 5 }]),
  [{ s: 0, e: 5 }],
  'zero-length concat slices are omitted',
);

assert.deepEqual(
  planSongEditArrangement(60, [5, 20, 40], { kind: 'cut', fromS: 0, toS: 5 }),
  {
    durationS: 55,
    boundaries: [15, 35],
    slices: [{ s: 5, e: 60 }],
  },
);

assert.deepEqual(
  planSongEditArrangement(60, [10, 20, 30, 40], { kind: 'cut', fromS: 20, toS: 30 }),
  {
    durationS: 50,
    boundaries: [10, 20, 30],
    slices: [{ s: 0, e: 20 }, { s: 30, e: 60 }],
  },
);

const duplicated = planSongEditArrangement(60, [10, 30], { kind: 'duplicate_section', index: 2 });
assert.deepEqual(duplicated, {
  durationS: 80,
  boundaries: [10, 30, 50],
  slices: [
    { s: 0, e: 10 },
    { s: 10, e: 30 },
    { s: 10, e: 30 },
    { s: 30, e: 60 },
  ],
});

assert.deepEqual(
  planSongEditArrangement(60, [10, 30], { kind: 'move_section', fromIndex: 3, toIndex: 1 }),
  {
    durationS: 60,
    boundaries: [30, 40],
    slices: [{ s: 30, e: 60 }, { s: 0, e: 10 }, { s: 10, e: 30 }],
  },
);

assert.deepEqual(segmentsFrom(60, [10, 30]), [
  { s: 0, e: 10 },
  { s: 10, e: 30 },
  { s: 30, e: 60 },
]);

assert.deepEqual(reconcileArrangementDuration(duplicated, 79.6), {
  durationS: 79.6,
  boundaries: [9.95, 29.85, 49.75],
});

assert.throws(
  () => cutTimeSlices(60, 0, 60),
  /cut must leave some audio/,
);

const source = readFileSync(new URL('../src/processors/song-edit.ts', import.meta.url), 'utf8');
assert.match(source, /resolveCertifiedDerivedAudioSource/);
assert.match(source, /assertStoredContentHash\(src, resolvedSource\.contentHash/);
assert.match(source, /const mix = await tx\.mix\.create/);
assert.match(source, /mixId: mix\.id/);
assert.match(source, /sourceMixId: mix\.id/);
assert.match(source, /preservesSourceContributors/);

console.log('song edit arrangement: slices, cuts, moves, duplicates, and measured duration passed');
