import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseReleaseMixLineage,
  releaseLineageEvidence,
} from '../src/processors/rights.ts';

const hash = (digit) => digit.repeat(64);

assert.deepEqual(
  parseReleaseMixLineage({
    source: { beatId: 'beat-1', vocalRenderIds: ['vocal-b', 'vocal-a'] },
  }),
  { beatId: 'beat-1', vocalRenderIds: ['vocal-a', 'vocal-b'] },
  'normal mix metadata must resolve one exact beat and a deterministic vocal set',
);
assert.deepEqual(
  parseReleaseMixLineage({
    source: { beatIds: ['beat-1'], vocalRenderIds: [] },
  }),
  { beatId: 'beat-1', vocalRenderIds: [] },
  'console metadata with one beat remains releasable',
);
assert.throws(
  () => parseReleaseMixLineage({}),
  /release_lineage_mix_source_missing/,
  'missing source metadata must fail closed',
);
assert.throws(
  () => parseReleaseMixLineage({ source: { beatIds: ['beat-1', 'beat-2'] } }),
  /release_lineage_requires_exactly_one_beat/,
  'ambiguous backing tracks must fail closed',
);
assert.throws(
  () => parseReleaseMixLineage({
    source: { beatId: 'beat-1', vocalRenderIds: ['vocal-a', 'vocal-a'] },
  }),
  /release_lineage_duplicate_vocal_render_ids/,
  'duplicate vocal identities must fail closed',
);

const evidence = releaseLineageEvidence({
  audio: { kind: 'master', id: 'master-1', contentHash: hash('a') },
  master: { id: 'master-1', contentHash: hash('a'), mixId: 'mix-1' },
  mix: { id: 'mix-1', contentHash: hash('b') },
  beat: {
    id: 'beat-1',
    url: 'private://beat',
    provider: 'internal',
    assetKind: 'instrumental',
    contentHash: hash('c'),
  },
  vocals: [
    {
      id: 'vocal-b',
      role: 'double',
      performanceSource: 'artist_upload',
      assetKind: 'isolated_vocal',
      voiceProfileId: null,
      contentHash: hash('e'),
    },
    {
      id: 'vocal-a',
      role: 'lead',
      performanceSource: 'artist_upload',
      assetKind: 'isolated_vocal',
      voiceProfileId: null,
      contentHash: hash('d'),
    },
  ],
  materials: [
    { usageId: 'usage-b', providerJobId: 'job-1', materialId: 'material-b', contentHash: hash('2') },
    { usageId: 'usage-a', providerJobId: 'job-1', materialId: 'material-a', contentHash: hash('1') },
  ],
  learnedReferences: [
    { usageId: 'ref-b', providerJobId: 'job-1', referenceId: 'reference-b', contentHash: hash('4') },
    { usageId: 'ref-a', providerJobId: 'job-1', referenceId: 'reference-a', contentHash: hash('3') },
  ],
});
assert.deepEqual(
  evidence.vocals.map((row) => row.id),
  ['vocal-a', 'vocal-b'],
  'vocal hashes must be canonically ordered',
);
assert.deepEqual(
  evidence.materials.map((row) => row.usageId),
  ['usage-a', 'usage-b'],
  'material evidence must be canonically ordered',
);
assert.equal('url' in evidence.beat, false, 'private asset URLs must not enter lineage fingerprints');

const rightsSource = readFileSync(new URL('../src/processors/rights.ts', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../src/processors/export.ts', import.meta.url), 'utf8');
assert.match(rightsSource, /row\.mixId/, 'master lineage must follow Master.mixId');
assert.match(rightsSource, /beatId: lineage\.beat\.id/, 'rights usages must be restricted to the exact beat');
assert.match(exportSource, /const backing = lineage\.beat/, 'export backing must use the exact lineage beat');
assert.match(exportSource, /receiptPayload\.lineage/, 'export must reject a stale or lineage-free rights receipt');
assert.match(exportSource, /lineage: exactLineage/, 'export fingerprint and manifest must include exact IDs and hashes');
assert.doesNotMatch(
  exportSource,
  /const backing = await prisma\.beatAsset\.findFirst/,
  'export must not fall back to the newest instrumental',
);

console.log('release lineage integrity tests passed');
