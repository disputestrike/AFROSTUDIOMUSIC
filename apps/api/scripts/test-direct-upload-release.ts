import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachSongUploadSchema, importUrlSchema } from '@afrohit/shared';
import {
  buildDirectUploadReattachmentMeta,
  hasImmutableDirectUploadContentMismatch,
} from '../src/routes/mixes';

const rightsConfirmation = { version: 1, confirmed: true } as const;
const objectKey = 'workspace-1/uploads/owned-song.wav';
const sourceContentHash = 'a'.repeat(64);
const differentContentHash = 'b'.repeat(64);
const recordedAt = '2026-07-15T12:00:00.000Z';
const certifiedAt = '2026-07-15T12:01:00.000Z';
const receiptCertifiedAt = '2026-07-15T12:02:00.000Z';
const reattachedAt = '2026-07-15T13:00:00.000Z';
const releaseLineageReceipt = {
  schemaVersion: 1,
  receiptId: 'receipt-1',
  receiptHash: 'c'.repeat(64),
  sourceContentHash,
  certifiedAt: receiptCertifiedAt,
};
const certifiedMix = {
  preset: 'uploaded',
  url: 's3://afrohit-studio/workspace-1/mixes/certified.wav',
  approved: true,
  qualityState: 'passed',
  contentHash: sourceContentHash,
  verifiedAt: new Date(certifiedAt),
  meta: {
    directOwnedUpload: {
      schemaVersion: 1,
      sourceKind: 'workspace_upload',
      rightsConfirmation,
      recordedAt,
      objectKey,
      sourceContentHash,
      certifiedAt,
    },
    qc: { verdict: 'passed' },
    releaseLineageCertified: true,
    releaseLineageReceipt,
  },
};

function directUpload(meta: Record<string, unknown>): Record<string, unknown> {
  assert.ok(
    meta.directOwnedUpload && typeof meta.directOwnedUpload === 'object'
  );
  return meta.directOwnedUpload as Record<string, unknown>;
}

const exactReattachment = buildDirectUploadReattachmentMeta({
  existingMix: certifiedMix,
  objectKey,
  uploadedContentHash: sourceContentHash,
  rightsConfirmation,
  recordedAt: reattachedAt,
});
assert.equal(exactReattachment.preservesSourceCertification, true);
assert.equal(exactReattachment.preservesReleaseReceipt, true);
assert.equal(
  directUpload(exactReattachment.meta).sourceContentHash,
  sourceContentHash
);
assert.equal(directUpload(exactReattachment.meta).certifiedAt, certifiedAt);
assert.equal(
  directUpload(exactReattachment.meta).recordedAt,
  recordedAt,
  'reattachment must retain the timestamp that the source certification covers'
);
assert.deepEqual(
  exactReattachment.meta.releaseLineageReceipt,
  releaseLineageReceipt
);
assert.equal(exactReattachment.meta.releaseLineageCertified, true);
assert.equal(
  hasImmutableDirectUploadContentMismatch({
    existingMix: certifiedMix,
    objectKey,
    uploadUrl: `s3://afrohit-studio/${objectKey}`,
    uploadedContentHash: sourceContentHash,
  }),
  false
);
assert.equal(
  hasImmutableDirectUploadContentMismatch({
    existingMix: certifiedMix,
    objectKey,
    uploadUrl: `s3://afrohit-studio/${objectKey}`,
    uploadedContentHash: differentContentHash,
  }),
  true,
  'changed bytes at a certified object key must be rejected instead of creating a new Mix'
);
assert.equal(
  hasImmutableDirectUploadContentMismatch({
    existingMix: {
      ...certifiedMix,
      url: `s3://afrohit-studio/${objectKey}`,
    },
    objectKey: 'workspace-1/uploads/replacement.wav',
    uploadUrl: `s3://afrohit-studio/${objectKey}`,
    uploadedContentHash: differentContentHash,
  }),
  true,
  'a certified Mix still pointing at the upload URL must also enforce immutable bytes'
);

for (const mismatch of [
  { objectKey, uploadedContentHash: differentContentHash },
  {
    objectKey: 'workspace-1/uploads/replacement.wav',
    uploadedContentHash: sourceContentHash,
  },
]) {
  const result = buildDirectUploadReattachmentMeta({
    existingMix: certifiedMix,
    ...mismatch,
    rightsConfirmation,
    recordedAt: reattachedAt,
  });
  const direct = directUpload(result.meta);
  assert.equal(result.preservesSourceCertification, false);
  assert.equal(result.preservesReleaseReceipt, false);
  assert.equal(Object.hasOwn(direct, 'sourceContentHash'), false);
  assert.equal(Object.hasOwn(direct, 'certifiedAt'), false);
  assert.equal(result.meta.releaseLineageCertified, false);
  assert.equal(Object.hasOwn(result.meta, 'releaseLineageReceipt'), false);
}

const uncertifiedMix = {
  ...certifiedMix,
  approved: false,
  qualityState: 'unmeasured',
  contentHash: null,
  verifiedAt: null,
};
const uncertifiedReattachment = buildDirectUploadReattachmentMeta({
  existingMix: uncertifiedMix,
  objectKey,
  uploadedContentHash: sourceContentHash,
  rightsConfirmation,
  recordedAt: reattachedAt,
});
assert.equal(uncertifiedReattachment.preservesSourceCertification, false);
assert.equal(uncertifiedReattachment.meta.releaseLineageCertified, false);
assert.equal(
  Object.hasOwn(directUpload(uncertifiedReattachment.meta), 'certifiedAt'),
  false
);
assert.equal(
  hasImmutableDirectUploadContentMismatch({
    existingMix: uncertifiedMix,
    objectKey,
    uploadUrl: `s3://afrohit-studio/${objectKey}`,
    uploadedContentHash: differentContentHash,
  }),
  false,
  'an uncertified attachment can be refreshed but must not inherit certification'
);

const mismatchedReceipt = buildDirectUploadReattachmentMeta({
  existingMix: {
    ...certifiedMix,
    meta: {
      ...certifiedMix.meta,
      releaseLineageReceipt: {
        ...releaseLineageReceipt,
        sourceContentHash: differentContentHash,
      },
    },
  },
  objectKey,
  uploadedContentHash: sourceContentHash,
  rightsConfirmation,
  recordedAt: reattachedAt,
});
assert.equal(mismatchedReceipt.preservesSourceCertification, true);
assert.equal(mismatchedReceipt.preservesReleaseReceipt, false);
assert.equal(mismatchedReceipt.meta.releaseLineageCertified, false);
assert.equal(
  Object.hasOwn(mismatchedReceipt.meta, 'releaseLineageReceipt'),
  false
);

assert.equal(
  attachSongUploadSchema.safeParse({
    key: objectKey,
    rightsConfirmation,
    directOwnedUpload: certifiedMix.meta.directOwnedUpload,
    releaseLineageReceipt,
  }).success,
  false,
  'clients must not be allowed to submit direct-upload certification or receipts'
);

const parsed = importUrlSchema.parse({
  projectId: 'ckz1234567890123456789012',
  url: 'https://artist.example/owned-song.wav',
  kind: 'song',
  rightsConfirmation: { version: 1, confirmed: true },
});

assert.equal(
  parsed.autoMaster,
  true,
  'owned song imports should enter certification by default'
);
assert.equal(parsed.masterPreset, 'afro_stream_-9');

const mixes = readFileSync(
  new URL('../src/routes/mixes.ts', import.meta.url),
  'utf8'
);
assert.match(mixes, /fingerprintUploadedAudio\(workspaceId, input\.key\)/);
assert.match(
  mixes,
  /path:\s*\[["']directOwnedUpload["'],\s*["']objectKey["']\]/
);
assert.match(mixes, /preservesSourceCertification/);
assert.match(mixes, /preservesReleaseReceipt/);
assert.match(
  mixes,
  /reply\s*\.code\(409\)\s*\.send\(\{\s*error:\s*["']immutable_upload_content_mismatch["']\s*\}\)/
);

const uploads = readFileSync(
  new URL('../src/routes/uploads.ts', import.meta.url),
  'utf8'
);
assert.match(uploads, /directOwnedUpload/);
assert.match(uploads, /sourceKind: 'url_import'/);
assert.match(uploads, /createQueuedProviderJob\(\{/);
assert.match(uploads, /queue: app\.queues\.master/);
assert.match(uploads, /finished: true/);
assert.match(uploads, /arReadAfterRender/);
assert.match(
  uploads,
  /masterError: 'insufficient_credits'/,
  'a stored import must remain a successful import when mastering cannot be charged'
);

const master = readFileSync(
  new URL('../../worker/src/processors/master.ts', import.meta.url),
  'utf8'
);
assert.match(master, /sourceContentHash: certifiedSource\.contentHash/);
assert.match(
  master,
  /certifiedAt: certifiedSource\.verifiedAt\.toISOString\(\)/
);

const rights = readFileSync(
  new URL('../../worker/src/processors/rights.ts', import.meta.url),
  'utf8'
);
assert.match(rights, /kind:\s*["']direct_owned_upload["']/);
assert.match(rights, /release_lineage_direct_upload_hash_mismatch/);
assert.match(rights, /releaseLineageReceipt/);
assert.match(
  rights,
  /originKind: source\.kind,[\s\S]{0,500}beat: null/,
  'direct finished recordings must never receive fabricated beat lineage'
);

console.log('direct owned upload release pipeline: PASS');
