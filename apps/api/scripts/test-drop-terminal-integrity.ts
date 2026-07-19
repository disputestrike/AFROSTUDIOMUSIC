import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assetProducedByChild,
  dropChildTerminalState,
  dropQualityGateEvidence,
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

const childEvidence = {
  id: 'job-1',
  status: 'SUCCEEDED',
  idempotencyKey: null,
  inputJson: {},
  outputJson: {},
  errorJson: null,
  createdAt: new Date('2026-07-15T11:59:00.000Z'),
  startedAt: new Date('2026-07-15T12:00:00.000Z'),
  finishedAt: new Date('2026-07-15T12:01:00.000Z'),
};
const playableEvidence = {
  ...certified,
  assetType: 'beat' as const,
  id: 'beat-1',
  projectId: 'project-1',
  songId: 'song-1',
  createdAt: new Date('2026-07-15T12:00:30.000Z'),
  meta: {},
};
assert.equal(
  assetProducedByChild(
    playableEvidence,
    { ...childEvidence, outputJson: { beatId: playableEvidence.id } },
    'song-1'
  ),
  true
);
assert.equal(
  assetProducedByChild(
    playableEvidence,
    { ...childEvidence, outputJson: { url: playableEvidence.url } },
    'song-1'
  ),
  true
);
assert.equal(
  assetProducedByChild(
    { ...playableEvidence, id: 'beat-by-hash', url: 's3://different.wav' },
    { ...childEvidence, outputJson: { contentHash: playableEvidence.contentHash } },
    'song-1'
  ),
  true
);
assert.equal(
  assetProducedByChild(playableEvidence, childEvidence, 'song-1'),
  false,
  'a timestamp overlap alone must never bind a playable asset to a child job'
);
assert.equal(
  assetProducedByChild(
    playableEvidence,
    { ...childEvidence, outputJson: { beatId: playableEvidence.id } },
    'another-song'
  ),
  false,
  'exact evidence from a different song must fail closed'
);

assert.deepEqual(
  passedDropQualityGate({ willBlow: true, bestScore: 93, blowPasses: 1 }, 90),
  { passed: true, willBlow: true, bestScore: 93, passes: 1, target: 90 }
);
assert.equal(passedDropQualityGate(null, 90), null);
assert.equal(passedDropQualityGate({ willBlow: false, bestScore: 93 }, 90), null);
assert.equal(passedDropQualityGate({ willBlow: true, bestScore: 89 }, 90), null);

// DELIVER, DON'T DESTROY (live incident 2026-07-19): a below-bar read is honest
// EVIDENCE (passed:false), never a throw — the paid song ships, labeled. Only a
// read with no usable score at all is null (infrastructure error upstream).
assert.deepEqual(
  dropQualityGateEvidence({ willBlow: false, bestScore: 62, blowPasses: 2 }, 90),
  { passed: false, willBlow: false, bestScore: 62, passes: 2, target: 90 }
);
assert.equal(dropQualityGateEvidence({ willBlow: false }, 90), null);
// The drop path must not throw on a below-bar score anymore, and playables must
// carry the honest certification flag.
assert.doesNotMatch(dropSourceEarly(), /drop quality gate failed for song/);
assert.match(dropSourceEarly(), /certified: gate\.passed/);
function dropSourceEarly(): string {
  return readFileSync(new URL('../src/routes/drop.ts', import.meta.url), 'utf8');
}

const dropSource = readFileSync(new URL('../src/routes/drop.ts', import.meta.url), 'utf8');
// SING-IT-AGAIN LAW (2026-07-19): the await is now assignment-shaped (`let` +
// try/catch) because an auto-routed take that fails ONLY lyric alignment is
// re-sung once on the standard engine. Both assignment sites sit before the
// quality gate — the terminal-before-gate invariant is unchanged.
const terminalAt = dropSource.lastIndexOf('directChildren = await waitForDropChildren');
const gateAt = dropSource.lastIndexOf('await willItBlowGate');
const playableAt = dropSource.lastIndexOf('await loadDropPlayableOutputs');
assert.ok(terminalAt > 0 && terminalAt < gateAt, 'drop must await render children before quality gate');
// The re-sing fallback must keep its kill switch, honor explicit engine picks,
// and only ever fire on the alignment-mismatch failure class.
assert.match(dropSource, /DROP_ALIGN_FALLBACK/);
assert.match(dropSource, /rendered vocals did not match the approved lyrics/);
assert.match(dropSource, /const autoRouted = !input\.songEngine;/);
assert.ok(gateAt < playableAt, 'drop must run quality gate before returning playable evidence');
assert.match(dropSource, /kind: 'ar-read'/);

const workerSource = readFileSync(
  new URL('../src/lib/orchestration-worker.ts', import.meta.url),
  'utf8'
);
const pipelineAt = workerSource.lastIndexOf('const result = await runDropPipeline');
const parentSuccessAt = workerSource.indexOf('status: "SUCCEEDED"', pipelineAt);
const failureHelperAt = workerSource.indexOf('async function recordOrchestrationFailure');
const retryStateAt = workerSource.indexOf(
  'status: args.finalAttempt ? "FAILED" : "QUEUED"',
  failureHelperAt
);
const dropFailureAt = workerSource.indexOf(
  'fallbackMessage: "drop pipeline failed"',
  parentSuccessAt
);
const finalAttemptAt = workerSource.lastIndexOf(
  'finalAttempt: isFinalAttempt(bullJob)',
  dropFailureAt
);
assert.ok(
  pipelineAt > 0 && parentSuccessAt > pipelineAt,
  'run-drop must write parent success only after the verified pipeline result'
);
assert.ok(
  failureHelperAt > 0 && retryStateAt > failureHelperAt,
  'orchestration failures must persist retryable attempts as queued'
);
assert.ok(
  finalAttemptAt > parentSuccessAt && finalAttemptAt < dropFailureAt,
  'run-drop must pass BullMQ final-attempt state into durable failure handling'
);

const albumsSource = readFileSync(
  new URL('../../web/app/(app)/albums/page.tsx', import.meta.url),
  'utf8'
);
assert.match(albumsSource, /outputJson\?\.playableOutputs/);
assert.match(albumsSource, /qualityGate\?\.willBlow === true/);
assert.match(albumsSource, /`\/projects\/\$\{s\.projectId\}\?song=\$\{s\.id\}`/);
assert.doesNotMatch(albumsSource, /landed[^\n]*rendering finishes in the background/i);

console.log('drop terminal integrity: PASS');
