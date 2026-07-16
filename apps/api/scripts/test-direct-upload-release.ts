import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importUrlSchema } from '@afrohit/shared';

const parsed = importUrlSchema.parse({
  projectId: 'ckz1234567890123456789012',
  url: 'https://artist.example/owned-song.wav',
  kind: 'song',
  rightsConfirmation: { version: 1, confirmed: true },
});

assert.equal(parsed.autoMaster, true, 'owned song imports should enter certification by default');
assert.equal(parsed.masterPreset, 'afro_stream_-9');

const uploads = readFileSync(
  new URL('../src/routes/uploads.ts', import.meta.url),
  'utf8',
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
  'a stored import must remain a successful import when mastering cannot be charged',
);

const master = readFileSync(
  new URL('../../worker/src/processors/master.ts', import.meta.url),
  'utf8',
);
assert.match(master, /sourceContentHash: certifiedSource\.contentHash/);
assert.match(master, /certifiedAt: certifiedSource\.verifiedAt\.toISOString\(\)/);

const rights = readFileSync(
  new URL('../../worker/src/processors/rights.ts', import.meta.url),
  'utf8',
);
assert.match(rights, /kind: 'direct_owned_upload'/);
assert.match(rights, /release_lineage_direct_upload_hash_mismatch/);
assert.match(rights, /releaseLineageReceipt/);
assert.match(
  rights,
  /originKind: source\.kind,[\s\S]{0,500}beat: null/,
  'direct finished recordings must never receive fabricated beat lineage',
);

console.log('direct owned upload release pipeline: PASS');
