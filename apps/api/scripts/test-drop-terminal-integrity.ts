import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dropChildTerminalState,
  isCertifiedPlayableAsset,
  passedDropQualityGate,
} from '../src/routes/drop';

const succeeded = { id: 'child-a', status: 'SUCCEEDED', errorJson: null };
assert.equal(dropChildTerminalState(['child-a'], [succeeded]), 'succeeded');
assert.equal(
  dropChildTerminalState(['child-a'], [{ ...succeeded, status: 'QUEUED' }]),
  'pending'
);
assert.equal(
  dropChildTerminalState(['child-a'], [{ ...succeeded, status: 'RUNNING' }]),
  'pending'
);
assert.throws(() => dropChildTerminalState([], []), /zero render children/);
assert.throws(
  () => dropChildTerminalState(['child-a'], []),
  /missing or outside workspace\/project/
);
assert.throws(
  () => dropChildTerminalState(
    ['child-a'],
    [{ ...succeeded, status: 'FAILED', errorJson: { message: 'render failed QC' } }]
  ),
  /render failed QC/
);
assert.throws(
  () => dropChildTerminalState(['child-a'], [{ ...succeeded, status: 'CANCELED' }]),
  /canceled/
);

const certified = {
  url: 's3://workspace/project/master.wav',
  approved: true,
  qualityState: 'passed',
  contentHash: 'a'.repeat(64),
  verifiedAt: new Date('2026-07-15T12:00:00.000Z'),
};
assert.equal(isCertifiedPlayableAsset(certified), true);
assert.equal(isCertifiedPlayableAsset({ ...certified, approved: false }), false);
assert.equal(isCertifiedPlayableAsset({ ...certified, qualityState: 'failed' }), false);
assert.equal(isCertifiedPlayableAsset({ ...certified, contentHash: null }), false);
assert.equal(isCertifiedPlayableAsset({ ...certified, contentHash: 'not-a-sha256' }), false);
assert.equal(isCertifiedPlayableAsset({ ...certified, verifiedAt: null }), false);
assert.equal(isCertifiedPlayableAsset({ ...certified, url: '' }), false);

assert.deepEqual(
  passedDropQualityGate({ willBlow: true, bestScore: 93, blowPasses: 1 }, 90),
  { willBlow: true, bestScore: 93, passes: 1, target: 90 }
);
assert.equal(passedDropQualityGate(null, 90), null);
assert.equal(passedDropQualityGate({ willBlow: false, bestScore: 93 }, 90), null);
assert.equal(passedDropQualityGate({ willBlow: true, bestScore: 89 }, 90), null);

const dropSource = readFileSync(new URL('../src/routes/drop.ts', import.meta.url), 'utf8');
const terminalAt = dropSource.lastIndexOf('const directChildren = await waitForDropChildren');
const gateAt = dropSource.lastIndexOf('await willItBlowGate');
const playableAt = dropSource.lastIndexOf('await loadDropPlayableOutputs');
assert.ok(terminalAt > 0 && terminalAt < gateAt, 'drop must await render children before quality gate');
assert.ok(gateAt < playableAt, 'drop must run quality gate before returning playable evidence');
assert.match(dropSource, /kind: 'ar-read'/);

const workerSource = readFileSync(
  new URL('../src/lib/orchestration-worker.ts', import.meta.url),
  'utf8'
);
const pipelineAt = workerSource.lastIndexOf('const result = await runDropPipeline');
const parentSuccessAt = workerSource.indexOf('status: "SUCCEEDED"', pipelineAt);
const retryStateAt = workerSource.indexOf('status: finalAttempt ? "FAILED" : "QUEUED"', pipelineAt);
assert.ok(
  pipelineAt > 0 && parentSuccessAt > pipelineAt,
  'run-drop must write parent success only after the verified pipeline result'
);
assert.ok(retryStateAt > parentSuccessAt, 'run-drop must not expose intermediate retries as terminal failures');

const albumsSource = readFileSync(
  new URL('../../web/app/(app)/albums/page.tsx', import.meta.url),
  'utf8'
);
assert.match(albumsSource, /outputJson\?\.playableOutputs/);
assert.match(albumsSource, /qualityGate\?\.willBlow === true/);
assert.match(albumsSource, /`\/projects\/\$\{s\.projectId\}\?song=\$\{s\.id\}`/);
assert.doesNotMatch(albumsSource, /landed[^\n]*rendering finishes in the background/i);

console.log('drop terminal integrity: PASS');
