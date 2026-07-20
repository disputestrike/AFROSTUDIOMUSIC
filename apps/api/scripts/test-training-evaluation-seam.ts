/**
 * TRAINING EVALUATION SEAM gate (owner order 2026-07-19 night) — the loop that
 * was open: a finished candidate sat at "awaiting evaluation" forever because
 * submitMusicTrainingEvaluation had no route, no UI, no caller. This proves:
 *  1. the receipt builder + strict parser fail closed (bad score, empty
 *     evaluator, unbound hash),
 *  2. the promotion decision is the SAME single-sourced gate the worker runs
 *     (win-by-minGain, tie holds, mismatch refuses, already-active holds),
 *  3. the admin routes exist, are requireAdmin-gated, and audit-log the actor,
 *  4. nothing validation-critical is duplicated outside @afrohit/ai.
 * No DB, no network. Run: pnpm --filter @afrohit/api exec tsx scripts/test-training-evaluation-seam.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVE_MUSIC_MODEL_SETTING_KEY,
  MUSIC_TRAINING_CANDIDATE_READY_PHASE,
  MUSIC_TRAINING_EVALUATION_PREFIX,
  MUSIC_TRAINING_JOB_KIND,
  MUSIC_TRAINING_WORKSPACE_ID,
  buildMusicTrainingEvaluationReceipt,
  decideMusicCandidatePromotion,
  emptyMusicModelRoute,
  musicTrainingCandidateFromJob,
  musicTrainingEvaluationKey,
  parseMusicTrainingEvaluation,
  promoteMusicModelRoute,
  rollbackMusicModelRoute,
} from '@afrohit/ai';

const datasetHash = 'a'.repeat(64);
const modelRef = 'afrohit/music:abcdef123456';

// --- 1. RECEIPT BUILDER — the only constructor, fails closed -----------------
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash, candidateScore: 101, evaluator: 'ear' }),
  /between 0 and 100/,
  'score above 100 rejected'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash, candidateScore: -1, evaluator: 'ear' }),
  /between 0 and 100/,
  'negative score rejected'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash, candidateScore: Number.NaN, evaluator: 'ear' }),
  /between 0 and 100/,
  'NaN score rejected'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash, candidateScore: 80, evaluator: '   ' }),
  /requires an evaluator/,
  'blank evaluator rejected'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash, candidateScore: 80, evaluator: 'ear', minGain: 101 }),
  /minimum gain must be between 0 and 100/,
  'out-of-range minGain rejected'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: undefined, datasetHash, candidateScore: 80, evaluator: 'ear' }),
  /candidate receipt is incomplete/,
  'missing candidate model ref refused (binding is by construction)'
);
assert.throws(
  () => buildMusicTrainingEvaluationReceipt({ candidateModelRef: modelRef, datasetHash: 'not-a-hash', candidateScore: 80, evaluator: 'ear' }),
  /receipt is invalid/,
  'a non-sha256 dataset hash cannot produce a receipt'
);
const receipt = buildMusicTrainingEvaluationReceipt({
  candidateModelRef: modelRef,
  datasetHash,
  candidateScore: 84,
  evaluator: '  benjamin-ear ',
  measuredAt: '2026-07-19T22:00:00.000Z',
  minGain: 2,
});
assert.equal(receipt.evaluator, 'benjamin-ear', 'evaluator is trimmed');
assert.equal(receipt.candidateScore, 84);
assert.equal(receipt.minGain, 2);
const roundTripped = parseMusicTrainingEvaluation(JSON.stringify(receipt));
assert.deepEqual(roundTripped, receipt, 'builder output round-trips the strict parser exactly');
const defaulted = buildMusicTrainingEvaluationReceipt({
  candidateModelRef: modelRef, datasetHash, candidateScore: 50, evaluator: 'ear',
});
assert.ok(Number.isFinite(Date.parse(defaulted.measuredAt)), 'measuredAt defaults to now (ISO)');

// --- strict parser stays strict (single source of truth) ---------------------
assert.equal(parseMusicTrainingEvaluation(null), null);
assert.equal(parseMusicTrainingEvaluation('not json'), null);
assert.equal(
  parseMusicTrainingEvaluation(JSON.stringify({ ...receipt, datasetHash: 'b'.repeat(63) })),
  null,
  'wrong-length hash fails closed'
);
assert.equal(
  parseMusicTrainingEvaluation(JSON.stringify({ ...receipt, evaluator: '' })),
  null,
  'empty evaluator fails closed'
);
assert.equal(
  parseMusicTrainingEvaluation(JSON.stringify({ ...receipt, candidateScore: 200 })),
  null,
  'out-of-range score fails closed'
);

// --- 2. THE PROMOTION GATE (shared decision; worker and API run this) --------
delete process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN;
const candidate = { providerJobId: 'job-1', candidateModelRef: modelRef, trainingId: 'train-1', datasetHash };

// no incumbent → the first measured candidate becomes the baseline
const baseline = decideMusicCandidatePromotion({
  candidate, evaluation: receipt, currentRoute: emptyMusicModelRoute(),
});
assert.equal(baseline.verdict, 'promoted', 'no incumbent: candidate becomes the baseline');
assert.equal(baseline.route?.active?.modelRef, modelRef);
assert.equal(baseline.route?.active?.providerJobId, 'job-1');
assert.equal(baseline.route?.previous, null);
assert.equal(baseline.evaluationSummary.promote, true);

// build an incumbent route (score 84) to test holds and wins against
const incumbentRoute = baseline.route!;

// tie → hold
const rivalHash = 'c'.repeat(64);
const rival = { providerJobId: 'job-2', candidateModelRef: 'afrohit/music:v2v2v2v2', trainingId: 'train-2', datasetHash: rivalHash };
const tie = decideMusicCandidatePromotion({
  candidate: rival,
  evaluation: buildMusicTrainingEvaluationReceipt({
    candidateModelRef: rival.candidateModelRef, datasetHash: rivalHash, candidateScore: 84, evaluator: 'ear',
  }),
  currentRoute: incumbentRoute,
});
assert.equal(tie.verdict, 'rejected', 'tie holds the incumbent');
assert.equal(tie.route, null, 'no route change on a hold');

// win by >= minGain → promote, incumbent preserved as previous
const win = decideMusicCandidatePromotion({
  candidate: rival,
  evaluation: buildMusicTrainingEvaluationReceipt({
    candidateModelRef: rival.candidateModelRef, datasetHash: rivalHash, candidateScore: 90, evaluator: 'ear',
  }),
  currentRoute: incumbentRoute,
});
assert.equal(win.verdict, 'promoted', 'measured win promotes');
assert.equal(win.route?.previous?.modelRef, modelRef, 'former active kept as rollback pointer');
assert.equal(win.route?.events.at(-1)?.type, 'promoted');

// mismatched receipt → fail closed even though the score would win
const smuggled = decideMusicCandidatePromotion({
  candidate: rival,
  evaluation: receipt, // bound to job-1's model+dataset, not rival's
  currentRoute: incumbentRoute,
});
assert.equal(smuggled.verdict, 'mismatch', 'a receipt for a different artifact/corpus can NEVER promote');
assert.equal(smuggled.route, null);

// re-scoring the already-active model → hold, never a self-promotion loop
const rescored = decideMusicCandidatePromotion({
  candidate,
  evaluation: buildMusicTrainingEvaluationReceipt({
    candidateModelRef: modelRef, datasetHash, candidateScore: 99, evaluator: 'ear',
  }),
  currentRoute: incumbentRoute,
});
assert.equal(rescored.verdict, 'rejected');
assert.match(rescored.reason, /already the active model/);

// env minGain respected when the receipt carries none
process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN = '5';
const shortWin = decideMusicCandidatePromotion({
  candidate: rival,
  evaluation: buildMusicTrainingEvaluationReceipt({
    candidateModelRef: rival.candidateModelRef, datasetHash: rivalHash, candidateScore: 88, evaluator: 'ear',
  }),
  currentRoute: incumbentRoute, // incumbent 84; +4 < 5
});
assert.equal(shortWin.verdict, 'rejected', 'env MUSIC_TRAINER_PROMOTION_MIN_GAIN raises the bar');
const clearWin = decideMusicCandidatePromotion({
  candidate: rival,
  evaluation: buildMusicTrainingEvaluationReceipt({
    candidateModelRef: rival.candidateModelRef, datasetHash: rivalHash, candidateScore: 89, evaluator: 'ear',
  }),
  currentRoute: incumbentRoute,
});
assert.equal(clearWin.verdict, 'promoted', 'clearing the env bar promotes');
delete process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN;

// rollback state math (shared): no previous → honest refusal
assert.equal(rollbackMusicModelRoute({ current: emptyMusicModelRoute(), reason: 'x' }).rolledBack, false);
const rolled = rollbackMusicModelRoute({ current: win.route!, reason: 'underperformed live' });
assert.equal(rolled.rolledBack, true);
assert.equal(rolled.route.active?.modelRef, modelRef, 'rollback restores the previous model');
assert.equal(rolled.route.previous?.modelRef, rival.candidateModelRef, 'rollback itself is reversible');
assert.equal(rolled.route.events.at(-1)?.reason, 'underperformed live', 'reason retained in history');

// --- candidate extraction from the durable ProviderJob receipt ---------------
const jobRow = {
  id: 'job-9',
  externalId: 'train-9',
  inputJson: { datasetHash },
  outputJson: { phase: MUSIC_TRAINING_CANDIDATE_READY_PHASE, candidateModelRef: modelRef, trainingId: 'train-9' },
};
const extracted = musicTrainingCandidateFromJob(jobRow);
assert.equal(extracted?.candidateModelRef, modelRef);
assert.equal(extracted?.datasetHash, datasetHash);
assert.equal(extracted?.phase, MUSIC_TRAINING_CANDIDATE_READY_PHASE);
assert.equal(extracted?.evaluationKey, `${MUSIC_TRAINING_EVALUATION_PREFIX}job-9`);
assert.equal(
  musicTrainingCandidateFromJob({ id: 'job-10', inputJson: {}, outputJson: { candidateModelRef: modelRef } }),
  null,
  'incomplete candidate receipt extracts to null (fail closed)'
);

// --- keys and identity pinned (worker and API can never drift) ---------------
assert.equal(ACTIVE_MUSIC_MODEL_SETTING_KEY, 'music.training.activeModel.v1');
assert.equal(MUSIC_TRAINING_EVALUATION_PREFIX, 'music.training.evaluation.v1.');
assert.equal(musicTrainingEvaluationKey('abc'), 'music.training.evaluation.v1.abc');
assert.equal(MUSIC_TRAINING_WORKSPACE_ID, 'training');
assert.equal(MUSIC_TRAINING_JOB_KIND, 'music-training');
assert.ok(promoteMusicModelRoute, 'route promotion stays exported from the shared surface');

// --- 3. ROUTE + UI SOURCE SHAPE (the seam is actually wired) ------------------
const root = join(__dirname, '..', '..', '..');
const adminRoutes = readFileSync(join(root, 'apps/api/src/routes/admin.ts'), 'utf8');
for (const route of ['/training/candidates', '/training/evaluation', '/training/rollback']) {
  const at = adminRoutes.indexOf(`'${route}'`);
  assert.ok(at > 0, `admin route ${route} exists`);
  const block = adminRoutes.slice(at, at + 900);
  assert.match(block, /requireAdmin\(req\)/, `${route} is admin-gated`);
}
assert.match(adminRoutes, /MUSIC TRAINING EVALUATION submitted/, 'evaluation submissions are audit-logged');
assert.match(adminRoutes, /MUSIC MODEL ROLLBACK requested/, 'rollbacks are audit-logged');
const evalAt = adminRoutes.indexOf("'/training/evaluation'");
assert.match(adminRoutes.slice(evalAt - 1200, evalAt), /min\(0\)\.max\(100\)/, 'route schema bounds the score 0-100');
assert.match(adminRoutes.slice(evalAt, evalAt + 2400), /req\.log\.warn/, 'evaluation route logs the acting admin');
assert.match(adminRoutes, /training_evaluation_failed/, 'evaluation failures surface real errors');
assert.match(adminRoutes, /rollback_unavailable/, 'nothing-to-restore is an honest 409, not a fake success');

const apiSeam = readFileSync(join(root, 'apps/api/src/lib/training-evaluation.ts'), 'utf8');
assert.match(apiSeam, /from '@afrohit\/ai'/, 'API seam imports the shared law');
assert.match(apiSeam, /buildMusicTrainingEvaluationReceipt/, 'API uses the shared receipt builder');
assert.match(apiSeam, /decideMusicCandidatePromotion/, 'API runs the shared promotion decision');
assert.doesNotMatch(apiSeam, /function parseMusicTrainingEvaluation/, 'no duplicate parser in the API');
assert.doesNotMatch(apiSeam, /candidateScore\s*>=/, 'no duplicate gate math in the API');
assert.doesNotMatch(apiSeam, /music\.training\.activeModel/, 'no hand-typed setting keys in the API (constants only)');

const flywheel = readFileSync(join(root, 'apps/worker/src/lib/training-flywheel.ts'), 'utf8');
assert.match(flywheel, /export \{ ACTIVE_MUSIC_MODEL_SETTING_KEY, MUSIC_TRAINING_EVALUATION_PREFIX, parseMusicTrainingEvaluation \}/, 'worker re-exports the single-sourced seam');
assert.match(flywheel, /decideMusicCandidatePromotion/, 'worker runs the SAME shared promotion decision');
assert.match(flywheel, /buildMusicTrainingEvaluationReceipt/, 'worker submit uses the shared receipt builder');
assert.doesNotMatch(flywheel, /function parseMusicTrainingEvaluation/, 'no duplicate parser in the worker');

const adminPage = readFileSync(join(root, 'apps/web/app/(app)/admin/page.tsx'), 'utf8');
assert.match(adminPage, /TrainingCandidatesCard/, 'admin console renders the candidates card');
assert.match(adminPage, /\/admin\/training\/candidates/, 'card loads the candidate list');
assert.match(adminPage, /\/admin\/training\/evaluation/, 'card submits scores');
assert.match(adminPage, /\/admin\/training\/rollback/, 'card can roll back');
const rollbackFnAt = adminPage.indexOf('async function rollback()');
assert.ok(rollbackFnAt > 0, 'rollback handler exists');
assert.match(adminPage.slice(rollbackFnAt, rollbackFnAt + 700), /confirm\(/, 'rollback demands an explicit confirm');
assert.match(adminPage.slice(rollbackFnAt, rollbackFnAt + 900), /prompt\('Rollback reason/, 'rollback records a reason');

console.log('training evaluation seam: receipt law, shared gate, admin routes, and console card all verified.');
