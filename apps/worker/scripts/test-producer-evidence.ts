import assert from "node:assert/strict";
import {
  PRODUCER_EVIDENCE_VERSION,
  evaluateProducerEvidence,
  type ProducerEvidencePack,
  type ProducerScoreEvidence,
} from "@afrohit/shared";

const score = (reviewerId: string): ProducerScoreEvidence => ({
  reviewerId,
  independent: true,
  aiSkeptical: reviewerId === "p5",
  percussionRoleCorrectness: 4.4,
  logDrumPlacement: 4.2,
  arrangementSpace: 4.3,
  hookLift: 4.5,
  lagosFeel: 4.4,
  feelsWestern: false,
  usedInPaidSession: reviewerId !== "p5",
  choseOverManualRebuild: true,
  wouldPay: true,
  returnedUnprompted: reviewerId !== "p4",
});

const pack: ProducerEvidencePack = {
  version: PRODUCER_EVIDENCE_VERSION,
  workspaceId: "w1",
  songId: "s1",
  shelfSnapshotHash: "abc123",
  lane: "afrobeats",
  ontologyVersion: "afroone-ontology-2026-07",
  seed: 42,
  directions: ["commercial_safe", "spacious_restrained", "energetic_hook_forward"].map(
    (direction, index) => ({
      direction: direction as ProducerEvidencePack["directions"][number]["direction"],
      jobId: `j${index}`,
      beatId: `b${index}`,
      contentHash: `hash${index}`,
      stemCount: 8,
      stemsClean: true,
      replayVerified: true,
    })
  ),
  producerScores: ["p1", "p2", "p3", "p4", "p5"].map(score),
  totalWorkflowMs: 14 * 60_000,
  manualWorkflowMs: 24 * 60_000,
  daw: "fl_studio",
  createdAt: new Date(0).toISOString(),
};

const passing = evaluateProducerEvidence(pack);
assert.equal(passing.pass, true);
assert.equal(passing.paidSessionCount, 4);
assert.equal(passing.unpromptedReturnCount, 4);
assert.ok((passing.speedImprovement ?? 0) >= 0.3);

const regression = evaluateProducerEvidence({
  ...pack,
  totalWorkflowMs: 21 * 60_000,
  directions: pack.directions.map((row, index) =>
    index === 0 ? { ...row, stemsClean: false, replayVerified: false } : row
  ),
  producerScores: pack.producerScores.map((row, index) =>
    index === 0 ? { ...row, feelsWestern: true } : row
  ),
});
assert.equal(regression.pass, false);
assert.match(regression.regressions.join(" | "), /twenty minutes/);
assert.match(regression.regressions.join(" | "), /stem packages/);
assert.match(regression.regressions.join(" | "), /deterministic replay/);
assert.match(regression.regressions.join(" | "), /Westernized/);

console.log("Producer Evidence Pack pass/fail gates passed");
