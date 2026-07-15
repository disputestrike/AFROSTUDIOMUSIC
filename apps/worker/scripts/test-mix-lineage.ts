import assert from 'node:assert/strict';
import { buildMixSourceLineage, selectAudibleConsoleSettings } from '../src/processors/mix';

const hash = (digit: string) => digit.repeat(64);
const assets = new Map([
  ['beat-a', { id: 'beat-a', kind: 'beat' as const, contentHash: hash('a') }],
  ['beat-b', { id: 'beat-b', kind: 'beat' as const, contentHash: hash('b') }],
  ['vocal-a', { id: 'vocal-a', kind: 'vocal' as const, contentHash: hash('1') }],
  ['vocal-b', { id: 'vocal-b', kind: 'vocal' as const, contentHash: hash('2') }],
]);
const setting = (id: string, mute = false, solo = false) => ({ id, mute, solo });
const lineageFor = (settings: Array<ReturnType<typeof setting>>) => buildMixSourceLineage(
  selectAudibleConsoleSettings(settings).map(({ id }) => assets.get(id)!),
);

assert.deepEqual(buildMixSourceLineage([assets.get('beat-a')!, assets.get('vocal-b')!]), {
  beatId: 'beat-a', beatContentHash: hash('a'),
  vocalRenderIds: ['vocal-b'], vocalRenderContentHashes: [hash('2')],
});
assert.deepEqual(lineageFor([
  setting('beat-a'), setting('beat-b', true), setting('vocal-b'), setting('vocal-a'),
]), {
  beatId: 'beat-a', beatContentHash: hash('a'),
  vocalRenderIds: ['vocal-a', 'vocal-b'], vocalRenderContentHashes: [hash('1'), hash('2')],
});
const solo = [setting('beat-a', false, true), setting('beat-b'), setting('vocal-a'), setting('vocal-b', false, true)];
assert.deepEqual(selectAudibleConsoleSettings(solo).map(({ id }) => id), ['beat-a', 'vocal-b']);
assert.deepEqual(
  selectAudibleConsoleSettings([
    setting('beat-a', true, true),
    setting('vocal-a', false, true),
  ]).map(({ id }) => id),
  ['vocal-a'],
  'muted solo tracks are not audible lineage contributors',
);
assert.deepEqual(lineageFor(solo), {
  beatId: 'beat-a', beatContentHash: hash('a'),
  vocalRenderIds: ['vocal-b'], vocalRenderContentHashes: [hash('2')],
});
assert.throws(() => lineageFor([setting('beat-a', true), setting('vocal-a')]), /received 0/);
assert.throws(() => lineageFor([setting('beat-a'), setting('beat-b')]), /received 2/);
console.log('mix lineage tests passed');
