import type { AfroOneDirection } from "./afroone-render";

/** Retained so historical evidence remains readable. New packs use v2. */
export const PRODUCER_EVIDENCE_VERSION = "producer-evidence-v1";
export const PRODUCER_EVIDENCE_CURRENT_VERSION = "producer-evidence-v2";
export const PRODUCER_EVIDENCE_FOLLOWUP_VERSION =
  "producer-evidence-followup-v1";
export const PRODUCER_EVIDENCE_REPORT_VERSION = "producer-readiness-v1";
export const PRODUCER_PANEL_SIZE = 5;
export const PRODUCER_MIN_INDEPENDENT_REVIEWERS = 2;
export const PRODUCER_MIN_AI_SKEPTICAL_REVIEWERS = 1;
export const UNPROMPTED_RETURN_MIN_DELAY_MS = 7 * 24 * 60 * 60_000;

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

/** Historical v1 score contract. Caller-supplied outcome flags are not certifying. */
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

export interface ProducerPanelScoreEvidence {
  reviewerId: string;
  independent: boolean;
  aiSkeptical: boolean;
  percussionRoleCorrectness: number;
  logDrumPlacement: number;
  arrangementSpace: number;
  hookLift: number;
  lagosFeel: number;
  feelsWestern: boolean;
  choseOverManualRebuild: boolean;
  wouldPay: boolean;
  preferredComparatorLabel: string;
}

export type ProducerShelfMode = "ready" | "cold";
export type ProducerTechnicalCorrectionCategory =
  | "phase"
  | "timing"
  | "swing"
  | "gain_staging"
  | "tail_cleanup"
  | "frequency_overlap"
  | "missing_stem"
  | "other";

export interface ProducerTechnicalCorrection {
  category: ProducerTechnicalCorrectionCategory;
  durationMs: number;
}

export interface ProducerExperimentSession {
  briefStartedAt: string;
  firstUsableDirectionAt: string;
  allDirectionsReadyAt: string;
  dawImportedAt: string;
  manualBaselineMs: number;
  shelfMode: ProducerShelfMode;
  onboardingDurationMs: number;
  technicalCorrections: ProducerTechnicalCorrection[];
  blindedComparatorLabels: string[];
}

/** Historical v1 pack. It can be scored for display but never certifies readiness. */
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

export interface ProducerEvidencePackV2 {
  version: typeof PRODUCER_EVIDENCE_CURRENT_VERSION;
  workspaceId: string;
  songId: string;
  shelfSnapshotHash: string;
  lane: string;
  ontologyVersion: string;
  seed: number;
  directions: ProducerDirectionEvidence[];
  producerScores: ProducerPanelScoreEvidence[];
  session: ProducerExperimentSession;
  totalWorkflowMs: number;
  daw: "fl_studio" | "ableton" | "other";
  createdAt: string;
}

export type ProducerEvidenceAnyPack =
  | ProducerEvidencePack
  | ProducerEvidencePackV2;

export type ProducerEvidenceFollowupType =
  | "paid_session_use"
  | "unprompted_return";

export interface ProducerEvidenceFollowupEvent {
  version: typeof PRODUCER_EVIDENCE_FOLLOWUP_VERSION;
  packId: string;
  reviewerId: string;
  type: ProducerEvidenceFollowupType;
  recordedAt: string;
}

export interface ProducerEvidenceVerdict {
  /** v1 keeps its historical quality result, but certifying is always false. */
  pass: boolean;
  certifying: boolean;
  legacy: boolean;
  regressions: string[];
  averageGrooveScore: number | null;
  reviewerCount: number;
  independentReviewerCount: number;
  aiSkepticalReviewerCount: number;
  paidSessionCount: number;
  unpromptedReturnCount: number;
  choseOverManualCount: number;
  wouldPayCount: number;
  comparatorPreferenceCounts: Record<string, number>;
  speedImprovement: number | null;
  totalWorkflowMs: number;
  manualBaselineMs: number | null;
  timeToFirstUsableMs: number | null;
  timeToDawImportMs: number | null;
  onboardingDurationMs: number | null;
  technicalCorrectionCount: number;
  technicalCorrectionDurationMs: number;
}

export interface ProducerEvidenceRecord {
  id: string;
  createdAt: string;
  pack: ProducerEvidenceAnyPack;
}

export interface ProducerEvidencePanelSummary
  extends Omit<ProducerEvidenceVerdict, "legacy"> {
  id: string;
  createdAt: string;
  lane: string;
  ontologyVersion: string;
  shelfMode: ProducerShelfMode | "legacy_unknown";
  daw: "fl_studio" | "ableton" | "other";
  legacy: boolean;
}

export interface ProducerReadinessReport {
  version: typeof PRODUCER_EVIDENCE_REPORT_VERSION;
  asOf: string | null;
  ready: boolean;
  panelCount: number;
  certifyingPanelCount: number;
  legacyPanelCount: number;
  latestCertifyingPanelId: string | null;
  panels: ProducerEvidencePanelSummary[];
}

function normalizedReviewerId(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function scoreValues(
  row: ProducerScoreEvidence | ProducerPanelScoreEvidence
): number[] {
  return [
    row.percussionRoleCorrectness,
    row.logDrumPlacement,
    row.arrangementSpace,
    row.hookLift,
    row.lagosFeel,
  ];
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addRegression(regressions: string[], message: string): void {
  if (!regressions.includes(message)) regressions.push(message);
}

export function validateProducerPanel(
  scores: ProducerPanelScoreEvidence[]
): string[] {
  const regressions: string[] = [];
  const reviewerIds = new Set(scores.map(row => normalizedReviewerId(row.reviewerId)));
  if (scores.length !== PRODUCER_PANEL_SIZE || reviewerIds.size !== PRODUCER_PANEL_SIZE) {
    regressions.push("a final panel requires five unique reviewers");
  }
  if (scores.filter(row => row.independent).length < PRODUCER_MIN_INDEPENDENT_REVIEWERS) {
    regressions.push("a final panel requires at least two independent reviewers");
  }
  if (
    scores.filter(row => row.aiSkeptical).length <
    PRODUCER_MIN_AI_SKEPTICAL_REVIEWERS
  ) {
    regressions.push("a final panel requires at least one AI-skeptical reviewer");
  }
  if (scores.flatMap(scoreValues).some(value => !Number.isFinite(value) || value < 1 || value > 5)) {
    regressions.push("producer scores must be between one and five");
  }
  return regressions;
}

export function isProducerEvidencePackV2(
  value: unknown
): value is ProducerEvidencePackV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === PRODUCER_EVIDENCE_CURRENT_VERSION &&
    Array.isArray(row.directions) &&
    Array.isArray(row.producerScores) &&
    Boolean(row.session && typeof row.session === "object")
  );
}

export function isLegacyProducerEvidencePack(
  value: unknown
): value is ProducerEvidencePack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === PRODUCER_EVIDENCE_VERSION &&
    Array.isArray(row.directions) &&
    Array.isArray(row.producerScores)
  );
}

export function isProducerEvidenceFollowupEvent(
  value: unknown
): value is ProducerEvidenceFollowupEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === PRODUCER_EVIDENCE_FOLLOWUP_VERSION &&
    typeof row.packId === "string" &&
    typeof row.reviewerId === "string" &&
    (row.type === "paid_session_use" || row.type === "unprompted_return") &&
    typeof row.recordedAt === "string"
  );
}

function evaluateDirections(
  directions: ProducerDirectionEvidence[],
  regressions: string[]
): void {
  const directionIds = new Set(directions.map(row => row.direction));
  if (directions.length !== 3 || directionIds.size !== 3) {
    regressions.push("three distinct controlled directions are required");
  }
  if (directions.some(row => !row.stemsClean || row.stemCount < 1)) {
    regressions.push("one or more direction stem packages failed integrity");
  }
  if (directions.some(row => !row.replayVerified)) {
    regressions.push("one or more directions failed deterministic replay");
  }
}

function averageScores(
  scores: Array<ProducerScoreEvidence | ProducerPanelScoreEvidence>
): number | null {
  const values = scores.flatMap(scoreValues);
  return values.length
    ? Number(
        (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
      )
    : null;
}

function preferenceCounts(pack: ProducerEvidencePackV2): Record<string, number> {
  const counts = new Map<string, number>();
  for (const score of pack.producerScores) {
    const label = score.preferredComparatorLabel.trim().toLocaleUpperCase("en-US");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validFollowupReviewerIds(
  pack: ProducerEvidencePackV2,
  followups: ProducerEvidenceFollowupEvent[],
  regressions: string[]
): { paid: Set<string>; returned: Set<string> } {
  const panelIds = new Set(
    pack.producerScores.map(row => normalizedReviewerId(row.reviewerId))
  );
  const packCreatedAt = parseTimestamp(pack.createdAt);
  const paid = new Set<string>();
  const returned = new Set<string>();

  for (const event of [...followups].sort((left, right) => {
    const time = left.recordedAt.localeCompare(right.recordedAt);
    return time || left.type.localeCompare(right.type) || left.reviewerId.localeCompare(right.reviewerId);
  })) {
    const reviewerId = normalizedReviewerId(event.reviewerId);
    const recordedAt = parseTimestamp(event.recordedAt);
    if (!panelIds.has(reviewerId)) {
      addRegression(regressions, "a follow-up event references a reviewer outside the panel");
      continue;
    }
    if (packCreatedAt == null || recordedAt == null || recordedAt <= packCreatedAt) {
      addRegression(regressions, "a follow-up event was not recorded after panel creation");
      continue;
    }
    if (event.type === "paid_session_use") {
      paid.add(reviewerId);
      continue;
    }
    if (recordedAt - packCreatedAt < UNPROMPTED_RETURN_MIN_DELAY_MS) {
      addRegression(regressions, "an unprompted return was recorded before the seven-day window");
      continue;
    }
    returned.add(reviewerId);
  }
  return { paid, returned };
}

function evaluateLegacyProducerEvidence(
  pack: ProducerEvidencePack
): ProducerEvidenceVerdict {
  const regressions: string[] = [];
  evaluateDirections(pack.directions, regressions);
  if (pack.totalWorkflowMs > 20 * 60_000) {
    regressions.push("ready-shelf workflow exceeded twenty minutes");
  }
  const averageGrooveScore = averageScores(pack.producerScores);
  if (averageGrooveScore == null || averageGrooveScore < 4) {
    regressions.push("average producer groove score is below four");
  }
  if (pack.producerScores.some(row => row.feelsWestern)) {
    regressions.push("a producer marked the output as Westernized");
  }
  const paidSessionCount = pack.producerScores.filter(row => row.usedInPaidSession).length;
  const unpromptedReturnCount = pack.producerScores.filter(
    row => row.returnedUnprompted
  ).length;
  if (pack.producerScores.length >= PRODUCER_PANEL_SIZE && paidSessionCount < 3) {
    regressions.push("fewer than three producers used an output in a paid session");
  }
  if (
    pack.producerScores.length >= PRODUCER_PANEL_SIZE &&
    unpromptedReturnCount < 3
  ) {
    regressions.push("fewer than three producers returned unprompted");
  }
  const speedImprovement =
    pack.manualWorkflowMs && pack.manualWorkflowMs > 0
      ? Number((1 - pack.totalWorkflowMs / pack.manualWorkflowMs).toFixed(3))
      : null;
  if (speedImprovement != null && speedImprovement < 0.3) {
    regressions.push("workflow did not beat the manual method by at least thirty percent");
  }
  return {
    pass: regressions.length === 0,
    certifying: false,
    legacy: true,
    regressions,
    averageGrooveScore,
    reviewerCount: new Set(pack.producerScores.map(row => normalizedReviewerId(row.reviewerId))).size,
    independentReviewerCount: pack.producerScores.filter(row => row.independent).length,
    aiSkepticalReviewerCount: pack.producerScores.filter(row => row.aiSkeptical).length,
    paidSessionCount,
    unpromptedReturnCount,
    choseOverManualCount: pack.producerScores.filter(row => row.choseOverManualRebuild).length,
    wouldPayCount: pack.producerScores.filter(row => row.wouldPay).length,
    comparatorPreferenceCounts: {},
    speedImprovement,
    totalWorkflowMs: pack.totalWorkflowMs,
    manualBaselineMs: pack.manualWorkflowMs ?? null,
    timeToFirstUsableMs: null,
    timeToDawImportMs: null,
    onboardingDurationMs: null,
    technicalCorrectionCount: 0,
    technicalCorrectionDurationMs: 0,
  };
}

function evaluateCurrentProducerEvidence(
  pack: ProducerEvidencePackV2,
  followups: ProducerEvidenceFollowupEvent[]
): ProducerEvidenceVerdict {
  const regressions = validateProducerPanel(pack.producerScores);
  evaluateDirections(pack.directions, regressions);

  const labelSet = new Set(
    pack.session.blindedComparatorLabels.map(label => label.trim().toLocaleUpperCase("en-US"))
  );
  if (
    labelSet.size < 2 ||
    labelSet.size !== pack.session.blindedComparatorLabels.length
  ) {
    regressions.push("at least two unique blinded comparator labels are required");
  }
  if (
    pack.producerScores.some(
      row => !labelSet.has(row.preferredComparatorLabel.trim().toLocaleUpperCase("en-US"))
    )
  ) {
    regressions.push("a preferred comparator label is outside the blinded set");
  }
  if (
    pack.producerScores.some(row =>
      Object.prototype.hasOwnProperty.call(row, "usedInPaidSession") ||
      Object.prototype.hasOwnProperty.call(row, "returnedUnprompted")
    )
  ) {
    regressions.push("initial panel scores cannot claim paid use or return behavior");
  }

  const briefStartedAt = parseTimestamp(pack.session.briefStartedAt);
  const firstUsableAt = parseTimestamp(pack.session.firstUsableDirectionAt);
  const allDirectionsReadyAt = parseTimestamp(pack.session.allDirectionsReadyAt);
  const dawImportedAt = parseTimestamp(pack.session.dawImportedAt);
  const timelineValid =
    briefStartedAt != null &&
    firstUsableAt != null &&
    allDirectionsReadyAt != null &&
    dawImportedAt != null &&
    briefStartedAt <= firstUsableAt &&
    firstUsableAt <= allDirectionsReadyAt &&
    allDirectionsReadyAt <= dawImportedAt;
  if (!timelineValid) regressions.push("producer session timestamps are incomplete or out of order");

  const timeToFirstUsableMs = timelineValid
    ? firstUsableAt! - briefStartedAt!
    : null;
  const totalWorkflowMs = timelineValid
    ? allDirectionsReadyAt! - briefStartedAt!
    : pack.totalWorkflowMs;
  const timeToDawImportMs = timelineValid ? dawImportedAt! - briefStartedAt! : null;
  if (Math.abs(pack.totalWorkflowMs - totalWorkflowMs) > 1_000) {
    regressions.push("stored workflow duration does not match the session timeline");
  }
  if (totalWorkflowMs > 20 * 60_000) {
    regressions.push("three-direction workflow exceeded twenty minutes");
  }
  if (
    pack.session.shelfMode === "cold" &&
    pack.session.onboardingDurationMs > 10 * 60_000
  ) {
    regressions.push("cold-shelf onboarding exceeded ten minutes");
  }
  if (pack.session.technicalCorrections.length > 0) {
    regressions.push("DAW import required technical correction");
  }

  const averageGrooveScore = averageScores(pack.producerScores);
  if (averageGrooveScore == null || averageGrooveScore < 4) {
    regressions.push("average producer groove score is below four");
  }
  if (pack.producerScores.some(row => row.feelsWestern)) {
    regressions.push("a producer marked the output as Westernized");
  }

  const { paid, returned } = validFollowupReviewerIds(pack, followups, regressions);
  if (paid.size < 3) {
    regressions.push("fewer than three producers used an output in a paid session");
  }
  if (returned.size < 3) {
    regressions.push("fewer than three producers returned unprompted after seven days");
  }

  const speedImprovement =
    pack.session.manualBaselineMs > 0
      ? Number((1 - totalWorkflowMs / pack.session.manualBaselineMs).toFixed(3))
      : null;
  if (speedImprovement == null || speedImprovement < 0.3) {
    regressions.push("workflow did not beat the manual method by at least thirty percent");
  }

  return {
    pass: regressions.length === 0,
    certifying: true,
    legacy: false,
    regressions,
    averageGrooveScore,
    reviewerCount: new Set(pack.producerScores.map(row => normalizedReviewerId(row.reviewerId))).size,
    independentReviewerCount: pack.producerScores.filter(row => row.independent).length,
    aiSkepticalReviewerCount: pack.producerScores.filter(row => row.aiSkeptical).length,
    paidSessionCount: paid.size,
    unpromptedReturnCount: returned.size,
    choseOverManualCount: pack.producerScores.filter(row => row.choseOverManualRebuild).length,
    wouldPayCount: pack.producerScores.filter(row => row.wouldPay).length,
    comparatorPreferenceCounts: preferenceCounts(pack),
    speedImprovement,
    totalWorkflowMs,
    manualBaselineMs: pack.session.manualBaselineMs,
    timeToFirstUsableMs,
    timeToDawImportMs,
    onboardingDurationMs: pack.session.onboardingDurationMs,
    technicalCorrectionCount: pack.session.technicalCorrections.length,
    technicalCorrectionDurationMs: pack.session.technicalCorrections.reduce(
      (sum, correction) => sum + correction.durationMs,
      0
    ),
  };
}

export function evaluateProducerEvidence(
  pack: ProducerEvidenceAnyPack,
  followups: ProducerEvidenceFollowupEvent[] = []
): ProducerEvidenceVerdict {
  return isProducerEvidencePackV2(pack)
    ? evaluateCurrentProducerEvidence(pack, followups)
    : evaluateLegacyProducerEvidence(pack);
}

export function buildProducerReadinessReport(input: {
  packs: ProducerEvidenceRecord[];
  followups: ProducerEvidenceFollowupEvent[];
}): ProducerReadinessReport {
  const followupsByPack = new Map<string, ProducerEvidenceFollowupEvent[]>();
  for (const event of input.followups) {
    const current = followupsByPack.get(event.packId) ?? [];
    current.push(event);
    followupsByPack.set(event.packId, current);
  }

  const panels = input.packs
    .map(record => {
      const verdict = evaluateProducerEvidence(
        record.pack,
        followupsByPack.get(record.id) ?? []
      );
      const summary: ProducerEvidencePanelSummary = {
        id: record.id,
        createdAt: record.createdAt,
        lane: record.pack.lane,
        ontologyVersion: record.pack.ontologyVersion,
        shelfMode: isProducerEvidencePackV2(record.pack)
          ? record.pack.session.shelfMode
          : "legacy_unknown",
        daw: record.pack.daw,
        ...verdict,
      };
      return summary;
    })
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    );

  const latestCertifying = panels.find(panel => panel.certifying) ?? null;
  const timestamps = [
    ...input.packs.map(row => row.createdAt),
    ...input.followups.map(row => row.recordedAt),
  ].filter(value => parseTimestamp(value) != null);

  return {
    version: PRODUCER_EVIDENCE_REPORT_VERSION,
    asOf: timestamps.sort().at(-1) ?? null,
    ready: Boolean(latestCertifying?.pass),
    panelCount: panels.length,
    certifyingPanelCount: panels.filter(panel => panel.certifying).length,
    legacyPanelCount: panels.filter(panel => panel.legacy).length,
    latestCertifyingPanelId: latestCertifying?.id ?? null,
    panels,
  };
}
