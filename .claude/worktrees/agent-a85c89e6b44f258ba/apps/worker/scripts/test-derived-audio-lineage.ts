import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derivedMixLineageMeta } from '../src/lib/derived-audio-lineage';

const hash = (digit: string) => digit.repeat(64);
const at = new Date('2026-07-15T12:00:00.000Z');

const component = derivedMixLineageMeta({
  source: {
    type: 'master',
    id: 'master-1',
    url: 's3://private/master.wav',
    contentHash: hash('a'),
    claim: {
      schemaVersion: 1,
      kind: 'derived_mix',
      beatId: 'beat-1',
      beatContentHash: hash('b'),
      vocalRenderIds: ['vocal-1'],
      vocalRenderContentHashes: [hash('c')],
    },
    claimHash: hash('d'),
  },
  outputContentHash: hash('e'),
  derivedAt: at,
  operation: { kind: 'transform', tempo: 1.1 },
  preservesSourceContributors: true,
});
assert.deepEqual(component.source, {
  beatId: 'beat-1',
  beatContentHash: hash('b'),
  vocalRenderIds: ['vocal-1'],
  vocalRenderContentHashes: [hash('c')],
});
assert.equal(JSON.stringify(component).includes('s3://'), false);

const direct = derivedMixLineageMeta({
  source: {
    type: 'mix',
    id: 'mix-upload',
    url: 's3://private/upload.wav',
    contentHash: hash('1'),
    claim: {
      schemaVersion: 1,
      kind: 'direct_owned_upload',
      sourceKind: 'workspace_upload',
      sourceContentHash: hash('1'),
      parentSourceContentHash: null,
      parentClaimHash: null,
      rightsConfirmationVersion: 1,
      rightsConfirmed: true,
    },
    claimHash: hash('2'),
  },
  outputContentHash: hash('3'),
  derivedAt: at,
  operation: { kind: 'cut', fromS: 10, toS: 20 },
  preservesSourceContributors: true,
});
assert.deepEqual(direct.directOwnedUpload, {
  schemaVersion: 1,
  sourceKind: 'owned_derivative',
  rightsConfirmation: { version: 1, confirmed: true },
  sourceContentHash: hash('3'),
  parentSourceContentHash: hash('1'),
  parentClaimHash: hash('2'),
  recordedAt: at.toISOString(),
  certifiedAt: at.toISOString(),
});

const additive = derivedMixLineageMeta({
  source: {
    type: 'mix',
    id: 'mix-1',
    url: 's3://private/mix.wav',
    contentHash: hash('4'),
    claim: component.source,
    claimHash: hash('5'),
  },
  outputContentHash: hash('6'),
  derivedAt: at,
  operation: { kind: 'add_layer', prompt: 'new guitar' },
  preservesSourceContributors: false,
});
assert.equal(additive.releaseLineageCertified, false);
assert.equal('source' in additive, false, 'additive edits must not inherit incomplete source claims');

const transformSource = readFileSync(new URL('../src/processors/transform.ts', import.meta.url), 'utf8');
const editSource = readFileSync(new URL('../src/processors/song-edit.ts', import.meta.url), 'utf8');
for (const source of [transformSource, editSource]) {
  assert.match(source, /assertStoredContentHash/);
  assert.match(source, /tx\.mix\.create/);
  assert.match(source, /mixId: mix\.id/);
  assert.match(source, /sourceMixId: mix\.id/);
  assert.match(source, /sourceContentHash: mix\.contentHash/);
}

console.log('derived audio lineage: PASS');
