import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseReleaseMixLineage,
  releaseLineageEvidence,
} from '../src/processors/rights.ts';

const hash = (digit) => digit.repeat(64);

assert.deepEqual(
  parseReleaseMixLineage({
    source: {
      beatId: 'beat-1',
      beatContentHash: hash('a'),
      vocalRenderIds: ['vocal-b', 'vocal-a'],
      vocalRenderContentHashes: [hash('2'), hash('1')],
    },
  }),
  {
    kind: 'derived_mix',
    beatId: 'beat-1',
    beatContentHash: hash('a'),
    vocalRenderIds: ['vocal-a', 'vocal-b'],
    vocalRenderContentHashes: [hash('1'), hash('2')],
    derivation: null,
  },
  'normal mix metadata must resolve one exact beat and a deterministic vocal set',
);
assert.deepEqual(
  parseReleaseMixLineage({
    source: {
      beatIds: ['beat-1'],
      beatContentHash: hash('a'),
      vocalRenderIds: [],
      vocalRenderContentHashes: [],
    },
  }),
  {
    kind: 'derived_mix',
    beatId: 'beat-1',
    beatContentHash: hash('a'),
    vocalRenderIds: [],
    vocalRenderContentHashes: [],
    derivation: null,
  },
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
    source: {
      beatId: 'beat-1',
      beatContentHash: hash('a'),
      vocalRenderIds: ['vocal-a', 'vocal-a'],
      vocalRenderContentHashes: [hash('1'), hash('1')],
    },
  }),
  /release_lineage_duplicate_vocal_render_ids/,
  'duplicate vocal identities must fail closed',
);
const direct = parseReleaseMixLineage({
  directOwnedUpload: {
    schemaVersion: 1,
    sourceKind: 'workspace_upload',
    rightsConfirmation: { version: 1, confirmed: true },
    sourceContentHash: hash('9'),
    recordedAt: '2026-07-15T12:00:00.000Z',
    certifiedAt: '2026-07-15T12:01:00.000Z',
    objectKey: 'private/workspace/source.wav',
  },
});
assert.deepEqual(direct, {
  kind: 'direct_owned_upload',
  sourceKind: 'workspace_upload',
  sourceContentHash: hash('9'),
  parentSourceContentHash: null,
  parentClaimHash: null,
  rightsConfirmationVersion: 1,
  rightsConfirmed: true,
  recordedAt: '2026-07-15T12:00:00.000Z',
  certifiedAt: '2026-07-15T12:01:00.000Z',
  derivation: null,
});
assert.throws(
  () => parseReleaseMixLineage({
    source: { beatId: 'beat-1' },
    directOwnedUpload: {
      schemaVersion: 1,
      sourceKind: 'workspace_upload',
      rightsConfirmation: { version: 1, confirmed: true },
      sourceContentHash: hash('9'),
      recordedAt: '2026-07-15T12:00:00.000Z',
      certifiedAt: '2026-07-15T12:01:00.000Z',
    },
  }),
  /release_lineage_mix_source_ambiguous/,
  'direct and derived source claims must never coexist',
);
assert.throws(
  () => parseReleaseMixLineage({
    directOwnedUpload: {
      schemaVersion: 1,
      sourceKind: 'url_import',
      rightsConfirmation: { version: 1, confirmed: true },
      sourceContentHash: 'not-a-certified-hash',
      recordedAt: '2026-07-15T12:00:00.000Z',
      certifiedAt: '2026-07-15T12:01:00.000Z',
    },
  }),
  /release_lineage_uncertified_direct_upload_source_hash/,
  'direct uploads must bind a certified content hash',
);

const evidence = releaseLineageEvidence({
  audio: { kind: 'master', id: 'master-1', contentHash: hash('a') },
  master: { id: 'master-1', contentHash: hash('a'), mixId: 'mix-1' },
  mix: { id: 'mix-1', contentHash: hash('b') },
  originKind: 'derived_mix',
  directUpload: null,
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

const directEvidence = releaseLineageEvidence({
  audio: { kind: 'mix', id: 'mix-direct', contentHash: hash('9') },
  master: null,
  mix: { id: 'mix-direct', contentHash: hash('9') },
  originKind: 'direct_owned_upload',
  directUpload: {
    sourceKind: 'workspace_upload',
    sourceContentHash: hash('9'),
    parentSourceContentHash: null,
    parentClaimHash: null,
    rightsConfirmationVersion: 1,
    rightsConfirmed: true,
    recordedAt: '2026-07-15T12:00:00.000Z',
    certifiedAt: '2026-07-15T12:01:00.000Z',
  },
  beat: null,
  vocals: [],
  materials: [],
  learnedReferences: [],
});
assert.equal(directEvidence.schemaVersion, 2);
assert.equal(directEvidence.beat, null);
assert.equal(directEvidence.source.sourceContentHash, hash('9'));
assert.equal(JSON.stringify(directEvidence).includes('objectKey'), false);
assert.equal(JSON.stringify(directEvidence).includes('recordedAt'), false);
assert.equal(JSON.stringify(directEvidence).includes('certifiedAt'), false);

const rightsSource = readFileSync(new URL('../src/processors/rights.ts', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../src/processors/export.ts', import.meta.url), 'utf8');
assert.match(rightsSource, /row\.mixId/, 'master lineage must follow Master.mixId');
assert.match(rightsSource, /const beatIds = lineage\.beat/, 'rights usages must be restricted to certified current and inherited beats');
assert.match(rightsSource, /release_lineage_direct_upload_hash_mismatch/, 'direct uploads must match the certified mix bytes');
assert.match(rightsSource, /release_lineage_master_source_receipt_mismatch/, 'master metadata must bind its exact source mix');
assert.match(rightsSource, /vocalRenderContentHashes/, 'component lineage must bind exact vocal hashes');
assert.match(exportSource, /const backing = lineage\.beat/, 'export backing must use the exact lineage beat');
assert.match(exportSource, /if \(lineage\.beat\)/, 'direct uploads must not fabricate a backing track');
assert.match(exportSource, /receiptPayload\.lineage/, 'export must reject a stale or lineage-free rights receipt');
assert.match(exportSource, /lineage: exactLineage/, 'export fingerprint and manifest must include exact IDs and hashes');
assert.doesNotMatch(
  exportSource,
  /const backing = await prisma\.beatAsset\.findFirst/,
  'export must not fall back to the newest instrumental',
);

console.log('release lineage integrity tests passed');
