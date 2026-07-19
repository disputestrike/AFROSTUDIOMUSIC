import type { AfroOneDirection } from "./afroone-render";

export const PRODUCER_EVIDENCE_VERSION = "producer-evidence-v1";

export interface ProducerDirectionEvidence {
  direction: AfroOneDirection;
  jobId: string;
  beatId?: string;
  audioUrl?: string;
  contentHash?: string;
  stemCount: number;
  stemsClean: boolean;
  replayVerified: boolean;
}

export interface ProducerScoreEvidence {
  reviewerId: string;
  independent: boolean;
  aiSkeptical: boolean;
  percussionRoleCorrectness: number;
  logDrumPlacement: number;
  arrangementSpace: number;
  hookLift: number;
  lagosFeel: number;
  feelsWestern: boolean;
  usedInPaidSession: boolean;
  choseOverManualRebuild: boolean;
  wouldPay: boolean;
  returnedUnprompted: boolean;
}

export interface ProducerEvidencePack {
  version: typeof PRODUCER_EVIDENCE_VERSION;
  workspaceId: string;
  songId: string;
  shelfSnapshotHash: string;
  lane: string;
  ontologyVersion: string;
  seed: number;
  directions: ProducerDirectionEvidence[];
  producerScores: ProducerScoreEvidence[];
  totalWorkflowMs: number;
  manualWorkflowMs?: number;
  daw: "fl_studio" | "ableton" | "other";
  createdAt: string;
}

export interface ProducerEvidenceVerdict {
  pass: boolean;
  regressions: string[];
  averageGrooveScore: number | null;
  paidSessionCount: number;
  unpromptedReturnCount: number;
  speedImprovement: number | null;
}

function scoreValues(row: ProducerScoreEvidence): number[] {
  return [
    row.percussionRoleCorrectness,
    row.logDrumPlacement,
    row.arrangementSpace,
    row.hookLift,
    row.lagosFeel,
  ];
}

export function evaluateProducerEvidence(
  pack: ProducerEvidencePack
): ProducerEvidenceVerdict {
  const regressions: string[] = [];
  const directionIds = new Set(pack.directions.map(row => row.direction));
  if (pack.directions.length !== 3 || directionIds.size !== 3)
    regressions.push("three distinct controlled directions are required");
  if (pack.directions.some(row => !row.stemsClean || row.stemCount < 1))
    regressions.push("one or more direction stem packages failed integrity");
  if (pack.directions.some(row => !row.replayVerified))
    regressions.push("one or more directions failed deterministic replay");
  if (pack.totalWorkflowMs > 20 * 60_000)
    regressions.push("ready-shelf workflow exceeded twenty minutes");

  const values = pack.producerScores.flatMap(scoreValues);
  const averageGrooveScore = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
  if (averageGrooveScore == null || averageGrooveScore < 4)
    regressions.push("average producer groove score is below four");
  if (pack.producerScores.some(row => row.feelsWestern))
    regressions.push("a producer marked the output as Westernized");

  const paidSessionCount = pack.producerScores.filter(row => row.usedInPaidSession).length;
  const unpromptedReturnCount = pack.producerScores.filter(row => row.returnedUnprompted).length;
  if (pack.producerScores.length >= 5 && paidSessionCount < 3)
    regressions.push("fewer than three producers used an output in a paid session");
  if (pack.producerScores.length >= 5 && unpromptedReturnCount < 3)
    regressions.push("fewer than three producers returned unprompted");

  const speedImprovement =
    pack.manualWorkflowMs && pack.manualWorkflowMs > 0
      ? Number((1 - pack.totalWorkflowMs / pack.manualWorkflowMs).toFixed(3))
      : null;
  if (speedImprovement != null && speedImprovement < 0.3)
    regressions.push("workflow did not beat the manual method by at least thirty percent");

  return {
    pass: regressions.length === 0,
    regressions,
    averageGrooveScore,
    paidSessionCount,
    unpromptedReturnCount,
    speedImprovement,
  };
}
