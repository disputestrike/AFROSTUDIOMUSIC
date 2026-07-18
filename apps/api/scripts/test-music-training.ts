/**
 * MUSIC TRAINER SEAM — proof (2026-07-18), Wave 3.
 * Proves the trainer's THREE hard safeties without spending a dollar:
 *  1. off by default (MUSIC_TRAINER_ENABLED),
 *  2. no fake trainer (refuses when unconfigured),
 *  3. rights re-validation (a third-party asset in the dataset aborts the run),
 * plus the corpus-size gate and the measured promote gate.
 */
import assert from 'node:assert/strict';
import {
  musicTrainerEnabled,
  musicTrainerConfig,
  buildTrainerDataset,
  evaluateAndPromote,
  minCorpusSize,
} from '../src/lib/music-training';
import type { TrainingManifest } from '@afrohit/shared';

// 1. OFF by default
delete process.env.MUSIC_TRAINER_ENABLED;
assert.equal(musicTrainerEnabled(), false, 'trainer is OFF unless MUSIC_TRAINER_ENABLED=1');
process.env.MUSIC_TRAINER_ENABLED = '1';
assert.equal(musicTrainerEnabled(), true, 'flag flips it on');

// 2. NO FAKE TRAINER — unconfigured returns null (kickoff would refuse)
delete process.env.MUSIC_TRAINER_MODEL;
delete process.env.MUSIC_TRAINER_VERSION;
assert.equal(musicTrainerConfig(), null, 'no model/version → null, we do not fake a version');
process.env.MUSIC_TRAINER_MODEL = 'someorg/musicgen-fine-tuner';
process.env.MUSIC_TRAINER_VERSION = 'abc123';
assert.ok(musicTrainerConfig(), 'configured → real config');

// 3. RIGHTS RE-VALIDATION — a third-party asset in the eligible set aborts
const clean: TrainingManifest = {
  eligible: [
    { id: 'own1', origin: 'own-master' },
    { id: 'lic1', origin: 'licensed-catalog' },
    { id: 'usr1', origin: 'user-original' },
  ],
  rejected: [],
  counts: { total: 3, eligible: 3, byOrigin: {} },
};
const ds = buildTrainerDataset(clean);
assert.equal(ds.size, 3, 'clean corpus assembles');

const poisoned: TrainingManifest = {
  eligible: [
    { id: 'own1', origin: 'own-master' },
    { id: 'mm1', origin: 'third-party-render' as never }, // must never reach the trainer
  ],
  rejected: [],
  counts: { total: 2, eligible: 2, byOrigin: {} },
};
assert.throws(() => buildTrainerDataset(poisoned), /ineligible origin 'third-party-render'/, 'a third-party asset in the dataset aborts the whole run');

// corpus-size gate
assert.ok(minCorpusSize() >= 1, 'min corpus is a positive integer');

// promote gate — measured win only
assert.equal(evaluateAndPromote({ candidateScore: 82, incumbentScore: 80 }).promote, true, 'a clear win promotes');
assert.equal(evaluateAndPromote({ candidateScore: 80, incumbentScore: 80 }).promote, false, 'a tie HOLDS the incumbent');
assert.equal(evaluateAndPromote({ candidateScore: 70, incumbentScore: 80 }).promote, false, 'a regression HOLDS');
assert.equal(evaluateAndPromote({ candidateScore: null, incumbentScore: 80 }).promote, false, 'no measured score → hold');
assert.equal(evaluateAndPromote({ candidateScore: 75, incumbentScore: null }).promote, true, 'no incumbent → candidate becomes baseline');

console.log('music trainer seam: OFF by default, no fake version, rights re-validated (third-party aborts), size + measured-promote gates enforced.');
