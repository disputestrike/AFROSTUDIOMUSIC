import assert from 'node:assert/strict';
import {
  PRODUCER_EVIDENCE_CURRENT_VERSION,
  PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
  PRODUCER_EVIDENCE_VERSION,
  UNPROMPTED_RETURN_MIN_DELAY_MS,
  buildProducerReadinessReport,
  evaluateProducerEvidence,
  validateProducerPanel,
  type ProducerEvidenceFollowupEvent,
  type ProducerEvidencePack,
  type ProducerEvidencePackV2,
  type ProducerPanelScoreEvidence,
} from '@afrohit/shared';
import { createProducerEvidenceSchema } from '../src/routes/producer-evidence';

const reviewerIds = [
  'reviewer-secret-1',
  'reviewer-secret-2',
  'reviewer-secret-3',
  'reviewer-secret-4',
  'reviewer-secret-5',
];

function score(reviewerId: string, index: number): ProducerPanelScoreEvidence {
  return {
    reviewerId,
    independent: index < 2,
    aiSkeptical: index === 4,
    percussionRoleCorrectness: 4.4,
    logDrumPlacement: 4.2,
    arrangementSpace: 4.3,
    hookLift: 4.5,
    lagosFeel: 4.4,
    feelsWestern: false,
    choseOverManualRebuild: true,
    wouldPay: true,
    preferredComparatorLabel: index % 2 === 0 ? 'BLIND_A' : 'BLIND_B',
  };
}

const createdAt = '2026-07-10T12:20:00.000Z';
const currentPack: ProducerEvidencePackV2 = {
  version: PRODUCER_EVIDENCE_CURRENT_VERSION,
  workspaceId: 'workspace-1',
  songId: 'song-1',
  shelfSnapshotHash: 'shelf-sha256',
  lane: 'afrobeats',
  ontologyVersion: 'afroone-ontology-2026-07',
  seed: 42,
  directions: ['commercial_safe', 'spacious_restrained', 'energetic_hook_forward'].map(
    (direction, index) => ({
      direction: direction as ProducerEvidencePackV2['directions'][number]['direction'],
      jobId: `job-${index}`,
      beatId: `beat-${index}`,
      contentHash: `hash-${index}`,
      stemCount: 8,
      stemsClean: true,
      replayVerified: true,
    })
  ),
  producerScores: reviewerIds.map(score),
  session: {
    briefStartedAt: '2026-07-10T12:00:00.000Z',
    firstUsableDirectionAt: '2026-07-10T12:06:00.000Z',
    allDirectionsReadyAt: '2026-07-10T12:14:00.000Z',
    dawImportedAt: '2026-07-10T12:16:00.000Z',
    manualBaselineMs: 24 * 60_000,
    shelfMode: 'cold',
    onboardingDurationMs: 7 * 60_000,
    technicalCorrections: [],
    blindedComparatorLabels: ['BLIND_A', 'BLIND_B'],
  },
  totalWorkflowMs: 14 * 60_000,
  daw: 'fl_studio',
  createdAt,
};

function followup(
  reviewerId: string,
  type: ProducerEvidenceFollowupEvent['type'],
  offsetMs: number
): ProducerEvidenceFollowupEvent {
  return {
    version: PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
    packId: 'pack-current',
    reviewerId,
    type,
    recordedAt: new Date(Date.parse(createdAt) + offsetMs).toISOString(),
  };
}

const initial = evaluateProducerEvidence(currentPack);
assert.equal(initial.certifying, true);
assert.equal(initial.pass, false);
assert.equal(initial.paidSessionCount, 0);
assert.equal(initial.unpromptedReturnCount, 0);
assert.match(initial.regressions.join(' | '), /paid session/);
assert.match(initial.regressions.join(' | '), /seven days/);

const outcomeEvents = [
  followup(reviewerIds[0]!, 'paid_session_use', 60_000),
  followup(reviewerIds[1]!, 'paid_session_use', 120_000),
  followup(reviewerIds[2]!, 'paid_session_use', 180_000),
  followup(reviewerIds[0]!, 'unprompted_return', UNPROMPTED_RETURN_MIN_DELAY_MS + 1),
  followup(reviewerIds[1]!, 'unprompted_return', UNPROMPTED_RETURN_MIN_DELAY_MS + 2),
  followup(reviewerIds[2]!, 'unprompted_return', UNPROMPTED_RETURN_MIN_DELAY_MS + 3),
];
const ready = evaluateProducerEvidence(currentPack, outcomeEvents);
assert.equal(ready.pass, true);
assert.equal(ready.paidSessionCount, 3);
assert.equal(ready.unpromptedReturnCount, 3);
assert.ok((ready.speedImprovement ?? 0) >= 0.3);
assert.equal(ready.timeToFirstUsableMs, 6 * 60_000);
assert.equal(ready.timeToDawImportMs, 16 * 60_000);
assert.deepEqual(ready.comparatorPreferenceCounts, { BLIND_A: 3, BLIND_B: 2 });

const duplicateEvents = [...outcomeEvents, outcomeEvents[0]!, outcomeEvents[3]!];
const deduplicated = evaluateProducerEvidence(currentPack, duplicateEvents);
assert.equal(deduplicated.paidSessionCount, 3);
assert.equal(deduplicated.unpromptedReturnCount, 3);

const earlyReturn = evaluateProducerEvidence(currentPack, [
  ...outcomeEvents.filter(event => event.type === 'paid_session_use'),
  followup(reviewerIds[0]!, 'unprompted_return', UNPROMPTED_RETURN_MIN_DELAY_MS - 1),
]);
assert.equal(earlyReturn.unpromptedReturnCount, 0);
assert.match(earlyReturn.regressions.join(' | '), /before the seven-day window/);

const smuggledOutcomePack = {
  ...currentPack,
  producerScores: currentPack.producerScores.map((row, index) =>
    index === 0 ? { ...row, returnedUnprompted: true, usedInPaidSession: true } : row
  ),
} as ProducerEvidencePackV2;
assert.match(
  evaluateProducerEvidence(smuggledOutcomePack, outcomeEvents).regressions.join(' | '),
  /cannot claim paid use or return behavior/
);

assert.deepEqual(validateProducerPanel(currentPack.producerScores), []);
assert.match(
  validateProducerPanel([
    ...currentPack.producerScores.slice(0, 4),
    currentPack.producerScores[0]!,
  ]).join(' | '),
  /five unique reviewers/
);
assert.match(
  validateProducerPanel(
    currentPack.producerScores.map(row => ({ ...row, independent: false }))
  ).join(' | '),
  /two independent/
);
assert.match(
  validateProducerPanel(
    currentPack.producerScores.map(row => ({ ...row, aiSkeptical: false }))
  ).join(' | '),
  /AI-skeptical/
);

const legacyScores = reviewerIds.map((id, index) => ({
  ...score(id, index),
  usedInPaidSession: true,
  returnedUnprompted: true,
}));
const legacyPack: ProducerEvidencePack = {
  version: PRODUCER_EVIDENCE_VERSION,
  workspaceId: 'workspace-1',
  songId: 'song-legacy',
  shelfSnapshotHash: 'legacy-shelf',
  lane: 'afrobeats',
  ontologyVersion: 'legacy-ontology',
  seed: 1,
  directions: currentPack.directions,
  producerScores: legacyScores,
  totalWorkflowMs: 14 * 60_000,
  manualWorkflowMs: 24 * 60_000,
  daw: 'fl_studio',
  createdAt: '2026-06-01T00:00:00.000Z',
};
const legacyVerdict = evaluateProducerEvidence(legacyPack);
assert.equal(legacyVerdict.pass, true, 'historical quality scoring remains readable');
assert.equal(legacyVerdict.certifying, false, 'caller booleans can never certify legacy evidence');

const reportInput = {
  packs: [
    { id: 'pack-legacy', createdAt: legacyPack.createdAt, pack: legacyPack },
    { id: 'pack-current', createdAt: currentPack.createdAt, pack: currentPack },
  ],
  followups: outcomeEvents,
};
const report = buildProducerReadinessReport(reportInput);
assert.equal(report.ready, true);
assert.equal(report.certifyingPanelCount, 1);
assert.equal(report.legacyPanelCount, 1);
assert.equal(report.latestCertifyingPanelId, 'pack-current');
assert.doesNotMatch(JSON.stringify(report), /reviewer-secret/);
assert.deepEqual(
  buildProducerReadinessReport({
    packs: [...reportInput.packs].reverse(),
    followups: [...outcomeEvents].reverse(),
  }),
  report,
  'aggregate output must be deterministic regardless of database result order'
);

const validApiInput = {
  songId: 'cm12345678901234567890123',
  directions: [0, 1, 2].map(index => ({
    jobId: `cmjob0000000000000000000${index}`,
    replayJobId: `cmrpl0000000000000000000${index}`,
  })),
  producerScores: currentPack.producerScores,
  session: currentPack.session,
  daw: currentPack.daw,
};
assert.equal(createProducerEvidenceSchema.safeParse(validApiInput).success, true);
assert.equal(
  createProducerEvidenceSchema.safeParse({
    ...validApiInput,
    producerScores: validApiInput.producerScores.map((row, index) =>
      index === 0 ? { ...row, returnedUnprompted: true } : row
    ),
  }).success,
  false,
  'strict initial schema must reject caller-supplied return claims'
);
assert.equal(
  createProducerEvidenceSchema.safeParse({
    ...validApiInput,
    producerScores: validApiInput.producerScores.map(row => ({
      ...row,
      preferredComparatorLabel: 'NOT_IN_BLIND_SET',
    })),
  }).success,
  false
);

console.log('Producer longitudinal evidence and anonymous readiness gates passed');
