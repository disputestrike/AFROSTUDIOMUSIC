/** Focused music training lifecycle laws. No DB, network, or provider spend. */
import assert from 'node:assert/strict';
import {
  buildTrainerDataset,
  emptyMusicModelRoute,
  evaluateAndPromote,
  minCorpusSize,
  musicCandidateModelRef,
  musicTrainerConfig,
  musicTrainerEnabled,
  promoteMusicModelRoute,
  rollbackMusicModelRoute,
  trainingDatasetHash,
} from '../src/lib/music-training';
import type { TrainingManifest } from '@afrohit/shared';

// The arming flag remains the only switch that can spend money.
delete process.env.MUSIC_TRAINER_ENABLED;
assert.equal(musicTrainerEnabled(), false, 'trainer is off unless explicitly armed');
process.env.MUSIC_TRAINER_ENABLED = '1';
assert.equal(musicTrainerEnabled(), true, 'arming flag enables the lifecycle');

// One pinned, live-verified default; explicit environment overrides still win.
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;
assert.equal(
  musicTrainerConfig()?.model,
  'sakemin/musicgen-fine-tuner',
  'no override uses the pinned default trainer'
);
process.env.MUSIC_TRAINER_MODEL = 'someorg/musicgen-fine-tuner';
process.env.MUSIC_TRAINER_VERSION = 'abc123';
assert.equal(
  musicTrainerConfig()?.model,
  'someorg/musicgen-fine-tuner',
  'explicit trainer override wins'
);

// Rights re-validation rejects any poisoned eligible manifest.
const clean: TrainingManifest = {
  eligible: [
    { id: 'own1', origin: 'own-master' },
    { id: 'lic1', origin: 'licensed-catalog' },
    { id: 'usr1', origin: 'user-original' },
  ],
  rejected: [],
  counts: { total: 3, eligible: 3, byOrigin: {} },
};
assert.equal(buildTrainerDataset(clean).size, 3, 'clean corpus assembles');

const poisoned: TrainingManifest = {
  eligible: [
    { id: 'own1', origin: 'own-master' },
    { id: 'outside1', origin: 'third-party-render' as never },
  ],
  rejected: [],
  counts: { total: 2, eligible: 2, byOrigin: {} },
};
assert.throws(
  () => buildTrainerDataset(poisoned),
  /ineligible origin 'third-party-render'/,
  'a third-party asset aborts the trainer dataset'
);
assert.ok(minCorpusSize() >= 1, 'minimum corpus size is positive');

// Measured improvement is the only promotion gate.
assert.equal(evaluateAndPromote({ candidateScore: 82, incumbentScore: 80 }).promote, true);
assert.equal(evaluateAndPromote({ candidateScore: 80, incumbentScore: 80 }).promote, false);
assert.equal(evaluateAndPromote({ candidateScore: 70, incumbentScore: 80 }).promote, false);
assert.equal(evaluateAndPromote({ candidateScore: null, incumbentScore: 80 }).promote, false);
assert.equal(evaluateAndPromote({ candidateScore: 75, incumbentScore: null }).promote, true);

// Dataset hash is order-independent and content-sensitive.
const hashA = trainingDatasetHash([
  { id: 'material:a', origin: 'own-master', contentFingerprint: 'sha-a' },
  { id: 'beat:b', origin: 'licensed-catalog', contentFingerprint: 'sha-b' },
]);
const hashB = trainingDatasetHash([
  { id: 'beat:b', origin: 'licensed-catalog', contentFingerprint: 'sha-b' },
  { id: 'material:a', origin: 'own-master', contentFingerprint: 'sha-a' },
]);
assert.equal(hashA, hashB, 'dataset hash survives query reordering');
assert.notEqual(
  hashA,
  trainingDatasetHash([{ id: 'material:a', origin: 'own-master', contentFingerprint: 'changed' }]),
  'dataset hash changes with corpus content'
);

// Provider output becomes a candidate only with a runnable artifact.
assert.equal(
  musicCandidateModelRef({ version: 'abcdef123456' }, 'afrohit/music'),
  'afrohit/music:abcdef123456'
);
assert.equal(musicCandidateModelRef({}, 'afrohit/music'), null);

// Promotion persists a reversible route pointer.
const at1 = '2026-07-19T01:00:00.000Z';
const at2 = '2026-07-19T02:00:00.000Z';
const baseline = promoteMusicModelRoute({
  current: emptyMusicModelRoute(),
  candidate: {
    modelRef: 'afrohit/music:baseline1',
    providerJobId: 'job-1',
    trainingId: 'train-1',
    datasetHash: 'a'.repeat(64),
    score: 80,
    evaluatedAt: at1,
  },
  reason: 'first measured baseline',
  at: at1,
});
const promoted = promoteMusicModelRoute({
  current: baseline,
  candidate: {
    modelRef: 'afrohit/music:candidate2',
    providerJobId: 'job-2',
    trainingId: 'train-2',
    datasetHash: 'b'.repeat(64),
    score: 84,
    evaluatedAt: at2,
  },
  reason: 'candidate wins',
  at: at2,
});
assert.equal(promoted.previous?.modelRef, baseline.active?.modelRef, 'promotion preserves incumbent');
const rolledBack = rollbackMusicModelRoute({
  current: promoted,
  reason: 'operator rollback',
  at: at2,
});
assert.equal(rolledBack.rolledBack, true, 'route supports rollback');
assert.equal(rolledBack.route.active?.modelRef, baseline.active?.modelRef, 'rollback restores incumbent');

delete process.env.MUSIC_TRAINER_ENABLED;
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;

console.log('music training lifecycle: gates, dedupe hash, candidate receipt, promotion, and rollback passed.');
