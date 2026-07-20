import { createHash } from "node:crypto";
import { parseMusicModelRoute, trainingDatasetHash } from "@afrohit/ai";
import { prisma } from "@afrohit/db";
import {
  AFROONE_DIRECTIONS,
  PRODUCER_EVIDENCE_CURRENT_VERSION,
  SINGING_EXTERNAL_SCORE_EVENT,
  SINGING_EXTERNAL_SCORE_VERSION,
  buildProducerReadinessReport,
  isLegacyProducerEvidencePack,
  isAfroOneRenderSpecification,
  isProducerEvidenceFollowupEvent,
  isProducerEvidencePackV2,
  isSingingExternalScoreReceipt,
  type ProducerEvidenceAnyPack,
  type ProducerEvidenceFollowupEvent,
  type ProducerEvidencePackV2,
  type ProducerEvidenceRecord,
  type ProducerReadinessReport,
  type SingingExternalScoreReceipt,
} from "@afrohit/shared";
import {
  assemblyEvidenceCompleteness,
  sceneEvidenceCompleteness,
} from "./video-evidence";
import {
  ACTIVE_MUSIC_MODEL_SETTING_KEY,
  MUSIC_TRAINING_EVALUATION_PREFIX,
  parseMusicTrainingEvaluation,
} from "./training-flywheel";

export const ACCEPTANCE_READINESS_VERSION = "acceptance-readiness-v1";
export { SINGING_EXTERNAL_SCORE_EVENT, SINGING_EXTERNAL_SCORE_VERSION };
export type { SingingExternalScoreReceipt };

const TRAINING_WORKSPACE_ID = "training";
const SHA256 = /^[a-f0-9]{64}$/i;
const COLD_SHELF_TARGET_MS = 10 * 60_000;
const READY_SHELF_TARGET_MS = 20 * 60_000;

type JsonRecord = Record<string, unknown>;
type PersistedDate = string | Date | null;

export interface AcceptanceProviderJob {
  id: string;
  workspaceId: string;
  projectId: string | null;
  kind: string;
  provider: string;
  externalId: string | null;
  status: string;
  inputJson: unknown;
  outputJson: unknown;
  costUsd: number | null;
  startedAt: PersistedDate;
  finishedAt: PersistedDate;
  createdAt: PersistedDate;
}

export interface AcceptanceAnalyticsEvent {
  id: string;
  workspaceId: string | null;
  name: string;
  properties: unknown;
  createdAt: PersistedDate;
}

export interface AcceptanceVocalRender {
  id: string;
  projectId: string;
  songId: string | null;
  url: string;
  assetKind: string;
  performanceSource: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: PersistedDate;
  alignment: unknown;
  meta: unknown;
  approved: boolean;
}

export interface AcceptanceBeat {
  id: string;
  projectId: string;
  songId: string | null;
  url: string;
  provider: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: PersistedDate;
  approved: boolean;
}

export interface AcceptanceStem {
  id: string;
  beatId: string;
  role: string;
  url: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: PersistedDate;
  lineage: unknown;
}

export interface AcceptanceMaterialAsset {
  id: string;
  readiness: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: PersistedDate;
}

export interface AcceptanceMaterialUsage {
  providerJobId: string;
  beatId: string;
  materialId: string;
  materialContentHash: string | null;
}

export interface AcceptanceVideoRender {
  id: string;
  projectId: string;
  conceptId: string | null;
  url: string;
  durationS: number | null;
  provider: string;
  meta: unknown;
  createdAt: PersistedDate;
}

export interface AcceptanceVideoConcept {
  id: string;
  storyboard: unknown;
}

export interface AcceptanceAudioArtifact {
  id: string;
  kind: "beat" | "mix" | "master";
  projectId: string;
  songId: string | null;
  url: string;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: PersistedDate;
  approved: boolean;
}

export interface AcceptanceEvidenceSnapshot {
  generatedAt: string;
  workspaceId: string | null;
  systemSettings: Array<{ key: string; value: string }>;
  providerJobs: AcceptanceProviderJob[];
  analyticsEvents: AcceptanceAnalyticsEvent[];
  vocalRenders: AcceptanceVocalRender[];
  beats: AcceptanceBeat[];
  stems: AcceptanceStem[];
  materialAssets: AcceptanceMaterialAsset[];
  materialUsages: AcceptanceMaterialUsage[];
  videoRenders: AcceptanceVideoRender[];
  videoConcepts: AcceptanceVideoConcept[];
  audioArtifacts: AcceptanceAudioArtifact[];
}

export interface AcceptanceCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface AcceptanceGate {
  id: "training" | "singing" | "cold_shelf" | "producer" | "stems" | "video";
  status: "green" | "red";
  evidenceIds: string[];
  checks: AcceptanceCheck[];
  metrics: Record<string, string | number | boolean | null>;
}

export interface AcceptanceReadinessReport {
  version: typeof ACCEPTANCE_READINESS_VERSION;
  generatedAt: string;
  workspaceId: string | null;
  ready: boolean;
  summary: {
    green: number;
    red: number;
    total: number;
  };
  gates: AcceptanceGate[];
}

function record(value: unknown): JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function dateMs(value: PersistedDate | unknown): number | null {
  if (!(typeof value === "string" || value instanceof Date)) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ids(value: unknown): string[] {
  return Array.isArray(value) && value.every(nonEmpty)
    ? [...new Set(value)]
    : [];
}

function check(id: string, passed: boolean, detail: string): AcceptanceCheck {
  return { id, passed, detail };
}

function gate(
  id: AcceptanceGate["id"],
  checks: AcceptanceCheck[],
  evidenceIds: Array<string | null | undefined>,
  metrics: AcceptanceGate["metrics"] = {}
): AcceptanceGate {
  return {
    id,
    status: checks.every(row => row.passed) ? "green" : "red",
    evidenceIds: [...new Set(evidenceIds.filter(nonEmpty))],
    checks,
    metrics,
  };
}

function byNewest<T extends { createdAt: PersistedDate }>(rows: T[]): T[] {
  return [...rows].sort(
    (left, right) => (dateMs(right.createdAt) ?? 0) - (dateMs(left.createdAt) ?? 0)
  );
}

function parseProducerPack(
  event: AcceptanceAnalyticsEvent | undefined
): ProducerEvidenceAnyPack | null {
  const properties = record(event?.properties);
  const pack = properties.pack;
  return isProducerEvidencePackV2(pack) || isLegacyProducerEvidencePack(pack)
    ? pack
    : null;
}

function parseProducerFollowup(
  event: AcceptanceAnalyticsEvent
): ProducerEvidenceFollowupEvent | null {
  const followup = record(event.properties).event;
  if (!isProducerEvidenceFollowupEvent(followup)) return null;
  const recordedAt = dateMs(followup.recordedAt);
  const persistedAt = dateMs(event.createdAt);
  return recordedAt != null && persistedAt != null && persistedAt >= recordedAt
    ? followup
    : null;
}

export function parseSingingExternalScore(
  event: AcceptanceAnalyticsEvent | undefined
): SingingExternalScoreReceipt | null {
  const receipt = record(event?.properties).receipt;
  return isSingingExternalScoreReceipt(receipt) ? receipt : null;
}

function trainingGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const setting = snapshot.systemSettings.find(
    row => row.key === ACTIVE_MUSIC_MODEL_SETTING_KEY
  );
  const route = parseMusicModelRoute(setting?.value);
  const active = route.active;
  const job = active
    ? snapshot.providerJobs.find(row => row.id === active.providerJobId)
    : undefined;
  const input = record(job?.inputJson);
  const output = record(job?.outputJson);
  const evaluationOutput = record(output.evaluation);
  const evaluationRow = job
    ? snapshot.systemSettings.find(
        row => row.key === `${MUSIC_TRAINING_EVALUATION_PREFIX}${job.id}`
      )
    : undefined;
  const evaluation = parseMusicTrainingEvaluation(evaluationRow?.value);
  const trainingAssets = Array.isArray(input.trainingAssets)
    ? input.trainingAssets.map(record)
    : [];
  const consentSnapshot = Array.isArray(input.trainingConsentSnapshot)
    ? input.trainingConsentSnapshot.map(record)
    : [];
  const cleanOrigins = new Set([
    "own-master",
    "licensed-catalog",
    "live-session",
    "user-original",
  ]);
  const recomputedDatasetHash = trainingAssets.length > 0 && trainingAssets.every(asset =>
    nonEmpty(asset.id) &&
    nonEmpty(asset.origin) &&
    cleanOrigins.has(asset.origin) &&
    validHash(asset.contentHash)
  )
    ? trainingDatasetHash(trainingAssets.map(asset => ({
        id: asset.id as string,
        origin: asset.origin as "own-master" | "licensed-catalog" | "live-session" | "user-original",
        contentFingerprint: asset.contentHash as string,
      })))
    : null;
  const normalizedConsentSnapshot = consentSnapshot
    .filter(receipt =>
      nonEmpty(receipt.id) &&
      nonEmpty(receipt.workspaceId) &&
      nonEmpty(receipt.consentVersion) &&
      validHash(receipt.consentTextHash) &&
      dateMs(receipt.signedAt) != null
    )
    .map(receipt => ({
      id: receipt.id as string,
      workspaceId: receipt.workspaceId as string,
      consentVersion: receipt.consentVersion as string,
      consentTextHash: receipt.consentTextHash as string,
      signedAt: receipt.signedAt as string,
    }))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const consentSnapshotHash = createHash("sha256")
    .update(JSON.stringify(normalizedConsentSnapshot), "utf8")
    .digest("hex");
  const consentedWorkspaces = new Set(
    normalizedConsentSnapshot.map(receipt => receipt.workspaceId)
  );
  const rightsManifestBound = Boolean(
    active &&
      trainingAssets.length > 0 &&
      recomputedDatasetHash === active.datasetHash &&
      input.datasetHash === active.datasetHash &&
      input.eligible === trainingAssets.length &&
      input.zipped === trainingAssets.length &&
      consentSnapshot.length === normalizedConsentSnapshot.length &&
      input.consentSnapshotHash === consentSnapshotHash &&
      trainingAssets.every(asset =>
        asset.origin !== "user-original" ||
        (nonEmpty(asset.workspaceId) && consentedWorkspaces.has(asset.workspaceId))
      )
  );
  const promotionEvent = active
    ? route.events.find(
        event =>
          event.type === "promoted" &&
          event.to === active.modelRef &&
          event.at === active.activatedAt
      )
    : undefined;
  const boundCandidate = Boolean(
    active &&
      job &&
      job.workspaceId === TRAINING_WORKSPACE_ID &&
      job.kind === "music-training" &&
      job.status === "SUCCEEDED" &&
      output.candidateModelRef === active.modelRef &&
      input.datasetHash === active.datasetHash &&
      (output.trainingId === active.trainingId || job.externalId === active.trainingId)
  );
  const boundEvaluation = Boolean(
    active &&
      evaluation &&
      evaluation.candidateModelRef === active.modelRef &&
      evaluation.datasetHash === active.datasetHash &&
      evaluation.candidateScore === active.score &&
      evaluation.measuredAt === active.evaluatedAt &&
      evaluationOutput.promote === true
  );
  const promoted = Boolean(
    active &&
      output.phase === "promoted" &&
      output.activeModelRef === active.modelRef &&
      output.promotedAt === active.activatedAt &&
      promotionEvent
  );
  const incumbentScore = finite(evaluationOutput.incumbentScore)
    ? evaluationOutput.incumbentScore
    : null;
  const minGain = finite(evaluationOutput.minGain)
    ? evaluationOutput.minGain
    : null;
  const measuredImprovement = Boolean(
    active &&
      route.previous &&
      incumbentScore != null &&
      minGain != null &&
      minGain >= 0 &&
      active.score >= incumbentScore + minGain &&
      route.previous.score === incumbentScore &&
      promotionEvent?.from === route.previous.modelRef
  );
  return gate(
    "training",
    [
      check("training.active_route", Boolean(active), "an active model route is persisted"),
      check("training.rights_manifest", rightsManifestBound, "the active dataset hash recomputes from rights-clean assets and current consent receipts"),
      check("training.candidate_bound", boundCandidate, "the active route is bound to the succeeded candidate, dataset, and provider training"),
      check("training.evaluation_bound", boundEvaluation, "a measured score receipt is bound to the exact candidate and dataset"),
      check("training.measured_improvement", measuredImprovement, "the candidate beat a persisted incumbent by the configured minimum gain"),
      check("training.promoted", promoted, "the candidate is actively promoted with a matching route event"),
    ],
    [setting?.key, job?.id, evaluationRow?.key],
    {
      activeModelRef: active?.modelRef ?? null,
      candidateScore: active?.score ?? null,
      incumbentScore,
      minGain,
      trainingAssetCount: trainingAssets.length,
      consentReceiptCount: normalizedConsentSnapshot.length,
      evaluatedAt: active?.evaluatedAt ?? null,
      activatedAt: active?.activatedAt ?? null,
    }
  );
}

function singingGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const event = byNewest(
    snapshot.analyticsEvents.filter(row => row.name === SINGING_EXTERNAL_SCORE_EVENT)
  )[0];
  const receipt = parseSingingExternalScore(event);
  const vocal = receipt
    ? snapshot.vocalRenders.find(row => row.id === receipt.vocalRenderId)
    : undefined;
  const job = receipt
    ? snapshot.providerJobs.find(row => row.id === receipt.providerJobId)
    : undefined;
  const jobInput = record(job?.inputJson);
  const jobOutput = record(job?.outputJson);
  const vocalMeta = record(vocal?.meta);
  const assetReceipt = record(vocalMeta.receipt ?? vocalMeta);
  const alignment = record(vocal?.alignment);
  const certified = Boolean(
    vocal &&
      nonEmpty(vocal.url) &&
      vocal.assetKind === "isolated_vocal" &&
      ["score_synth", "generative_singing", "voice_conversion"].includes(
        vocal.performanceSource
      ) &&
      vocal.qualityState === "passed" &&
      vocal.approved &&
      validHash(vocal.contentHash) &&
      dateMs(vocal.verifiedAt) != null &&
      alignment.pass === true
  );
  const genuineReceipt = Boolean(
    assetReceipt.schemaVersion === 1 &&
      assetReceipt.afroOneSinging === true &&
      assetReceipt.performanceKind === "sung_vocal" &&
      assetReceipt.assetKind === "isolated_vocal" &&
      assetReceipt.spokenGuideNotSung === false &&
      assetReceipt.placeholder === false &&
      nonEmpty(assetReceipt.engine) &&
      !/tts|speech|spoken|placeholder|stub|guide/i.test(assetReceipt.engine)
  );
  const jobBound = Boolean(
    vocal &&
      job &&
      job.workspaceId === snapshot.workspaceId &&
      job.kind === "voice" &&
      job.provider === "afroone-singing" &&
      job.status === "SUCCEEDED" &&
      jobOutput.vocalRenderId === vocal.id &&
      jobOutput.contentHash === vocal.contentHash &&
      jobOutput.approved === true &&
      jobOutput.performanceKind === "sung_vocal" &&
      ["lyricsHash", "scoreHash", "alignmentHash", "manifestHash"].every(
        key => validHash(jobInput[key]) && jobInput[key] === assetReceipt[key]
      )
  );
  const values = receipt ? Object.values(receipt.scores) : [];
  const average = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
  const externallyAccepted = Boolean(
    receipt &&
      vocal &&
      event?.workspaceId === snapshot.workspaceId &&
      receipt.contentHash === vocal.contentHash &&
      receipt.releaseUsable &&
      average != null &&
      average >= 4 &&
      Object.values(receipt.scores).every(value => value >= 4) &&
      (dateMs(receipt.measuredAt) ?? 0) >= (dateMs(vocal.verifiedAt) ?? Number.MAX_SAFE_INTEGER) &&
      (dateMs(event?.createdAt) ?? 0) >= (dateMs(receipt.measuredAt) ?? Number.MAX_SAFE_INTEGER)
  );
  return gate(
    "singing",
    [
      check("singing.external_receipt", Boolean(receipt), "an independent external-human score receipt is persisted"),
      check("singing.certified_render", certified, "the exact isolated vocal is approved, byte-certified, and alignment-passed"),
      check("singing.genuine_receipt", genuineReceipt, "the render receipt identifies genuine singing and rejects speech or placeholder output"),
      check("singing.lineage_bound", jobBound, "the provider job, melody contract, output, and certified vocal are identity-bound"),
      check("singing.external_acceptance", externallyAccepted, "all external dimensions are at least four and the evaluator marked it release-usable"),
    ],
    [event?.id, job?.id, vocal?.id],
    {
      averageExternalScore: average,
      evaluatorId: receipt?.evaluatorId ?? null,
      vocalRenderId: vocal?.id ?? null,
    }
  );
}

function coldShelfGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const parent = byNewest(
    snapshot.providerJobs.filter(
      row => row.kind === "material-orchestration" && row.status === "SUCCEEDED"
    )
  )[0];
  const input = record(parent?.inputJson);
  const output = record(parent?.outputJson);
  const childIds = ids(input.childJobIds);
  const children = childIds.map(id => snapshot.providerJobs.find(row => row.id === id));
  const assemblyJobId = nonEmpty(output.assemblyJobId) ? output.assemblyJobId : null;
  const assembly = assemblyJobId
    ? snapshot.providerJobs.find(row => row.id === assemblyJobId)
    : undefined;
  const childMaterialIds = children
    .map(row => record(row?.outputJson).materialId)
    .filter(nonEmpty);
  const materials = childMaterialIds.map(id =>
    snapshot.materialAssets.find(row => row.id === id)
  );
  const beatId = nonEmpty(output.beatId) ? output.beatId : null;
  const beat = beatId ? snapshot.beats.find(row => row.id === beatId) : undefined;
  const timedRows = [parent, assembly, ...children].filter(
    (row): row is AcceptanceProviderJob => Boolean(row)
  );
  const timestampsReal = Boolean(
    parent &&
      assembly &&
      childIds.length > 0 &&
      children.length === childIds.length &&
      timedRows.every(row => {
        const start = dateMs(row.startedAt);
        const finish = dateMs(row.finishedAt);
        return start != null && finish != null && finish >= start;
      })
  );
  const starts = timestampsReal
    ? timedRows.map(row => dateMs(row.startedAt) as number)
    : [];
  const finishes = timestampsReal
    ? timedRows.map(row => dateMs(row.finishedAt) as number)
    : [];
  const elapsedMs = timestampsReal
    ? Math.max(...finishes) - Math.min(...starts)
    : null;
  const childrenComplete = Boolean(
    childIds.length > 0 &&
      children.every(row =>
        row &&
        row.kind === "material" &&
        row.status === "SUCCEEDED" &&
        nonEmpty(record(row.outputJson).materialId)
      ) &&
      childMaterialIds.length === childIds.length &&
      new Set(childMaterialIds).size === childIds.length
  );
  const assetsCertified = Boolean(
    materials.length === childMaterialIds.length &&
      materials.every(row =>
        row &&
        row.readiness === "ready" &&
        row.qualityState === "passed" &&
        validHash(row.contentHash) &&
        dateMs(row.verifiedAt) != null
      )
  );
  const assemblyComplete = Boolean(
    parent &&
      assembly &&
      assembly.kind === "material" &&
      assembly.status === "SUCCEEDED" &&
      record(assembly.outputJson).beatId === beatId &&
      beat &&
      beat.provider === "material" &&
      beat.qualityState === "passed" &&
      beat.approved &&
      validHash(beat.contentHash) &&
      dateMs(beat.verifiedAt) != null &&
      Array.isArray(output.roles) &&
      new Set(output.roles.filter(nonEmpty)).size >= 4
  );
  return gate(
    "cold_shelf",
    [
      check("cold_shelf.orchestration", Boolean(parent), "a succeeded cold-shelf orchestration receipt exists"),
      check("cold_shelf.real_timestamps", timestampsReal, "every material, assembly, and parent job has persisted start and finish timestamps"),
      check("cold_shelf.material_jobs", childrenComplete, "all declared material jobs succeeded and produced distinct persisted material identities"),
      check("cold_shelf.material_certification", assetsCertified, "every produced shelf asset is ready, QC-passed, hashed, and verified"),
      check("cold_shelf.assembly", assemblyComplete, "the orchestration produced a certified material beat with role coverage"),
      check("cold_shelf.under_ten_minutes", elapsedMs != null && elapsedMs <= COLD_SHELF_TARGET_MS, "real end-to-end job timestamps are within ten minutes"),
    ],
    [parent?.id, assembly?.id, beat?.id, ...childIds, ...childMaterialIds],
    {
      elapsedMs,
      targetMs: COLD_SHELF_TARGET_MS,
      materialJobCount: childIds.length,
      roleCount: Array.isArray(output.roles)
        ? new Set(output.roles.filter(nonEmpty)).size
        : 0,
    }
  );
}

function producerAcceptanceState(snapshot: AcceptanceEvidenceSnapshot): {
  report: ProducerReadinessReport | null;
  event: AcceptanceAnalyticsEvent | undefined;
  pack: ProducerEvidencePackV2 | null;
  panel: ProducerReadinessReport["panels"][number] | null;
  followupEvents: AcceptanceAnalyticsEvent[];
} {
  const packEvents = snapshot.analyticsEvents.filter(
    row =>
      row.name === "producer.evidence_pack" &&
      row.workspaceId === snapshot.workspaceId
  );
  const records: ProducerEvidenceRecord[] = packEvents.flatMap(event => {
    const pack = parseProducerPack(event);
    const createdAt =
      typeof event.createdAt === "string"
        ? event.createdAt
        : event.createdAt?.toISOString();
    return pack && createdAt
      ? [{ id: event.id, createdAt, pack }]
      : [];
  });
  const followupEvents = snapshot.analyticsEvents.filter(
    row =>
      row.name === "producer.evidence_followup" &&
      row.workspaceId === snapshot.workspaceId &&
      Boolean(parseProducerFollowup(row))
  );
  const followups = followupEvents
    .map(parseProducerFollowup)
    .filter((row): row is ProducerEvidenceFollowupEvent => Boolean(row));
  let report: ProducerReadinessReport | null = null;
  try {
    report = buildProducerReadinessReport({ packs: records, followups });
  } catch {
    // Corrupt JSON evidence is non-certifying, never an operational crash.
  }
  const panelId = report?.latestCertifyingPanelId ?? null;
  const recordRow = panelId
    ? records.find(row => row.id === panelId)
    : undefined;
  const event = panelId
    ? packEvents.find(row => row.id === panelId)
    : undefined;
  const pack = recordRow && isProducerEvidencePackV2(recordRow.pack)
    ? recordRow.pack
    : null;
  const panel = panelId
    ? report?.panels.find(row => row.id === panelId) ?? null
    : null;
  return { report, event, pack, panel, followupEvents };
}

function producerGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const state = producerAcceptanceState(snapshot);
  const { event, pack } = state;
  const jobsById = new Map(snapshot.providerJobs.map(row => [row.id, row]));
  const beatsById = new Map(snapshot.beats.map(row => [row.id, row]));
  const originalJobs = pack?.directions.map(row => jobsById.get(row.jobId)) ?? [];
  const originalBeatIds = pack?.directions.map(row => row.beatId as string) ?? [];
  const replayJobs = pack
    ? pack.directions.map(row =>
        snapshot.providerJobs.find(job =>
          job.provider === "afrohit-own" &&
          job.status === "SUCCEEDED" &&
          record(job.inputJson).replayOfBeatId === row.beatId
        )
      )
    : [];
  const allJobs = [...originalJobs, ...replayJobs];
  const jobEvidenceComplete = Boolean(
    pack &&
      allJobs.length === 6 &&
      allJobs.every(job =>
        job &&
        job.workspaceId === snapshot.workspaceId &&
        job.provider === "afrohit-own" &&
        job.kind === "music" &&
        job.status === "SUCCEEDED" &&
        dateMs(job.startedAt) != null &&
        dateMs(job.finishedAt) != null
      )
  );
  const controlled = Boolean(
    pack &&
      originalJobs.every((job, index) => {
        const spec = record(job?.inputJson).renderSpec;
        return (
          isAfroOneRenderSpecification(spec) &&
          spec.direction === pack.directions[index]?.direction &&
          spec.genre === pack.lane &&
          spec.ontologyVersion === pack.ontologyVersion &&
          record(job?.inputJson).batchSeed === pack.seed &&
          record(job?.outputJson).beatId === pack.directions[index]?.beatId
        );
      }) &&
      new Set(pack.directions.map(row => row.direction)).size === 3 &&
      AFROONE_DIRECTIONS.every(direction =>
        pack.directions.some(row => row.direction === direction)
      )
  );
  const starts = originalJobs.map(job => dateMs(job?.startedAt));
  const finishes = originalJobs.map(job => dateMs(job?.finishedAt));
  const measuredRenderMs =
    starts.every((value): value is number => value != null) &&
    finishes.every((value): value is number => value != null)
      ? Math.max(...finishes) - Math.min(...starts)
      : null;
  const sessionStart = dateMs(pack?.session.briefStartedAt);
  const sessionReady = dateMs(pack?.session.allDirectionsReadyAt);
  const sessionImport = dateMs(pack?.session.dawImportedAt);
  const measuredWorkflowMs =
    sessionStart != null && sessionReady != null
      ? sessionReady - sessionStart
      : null;
  const realTiming = Boolean(
    pack &&
      starts.every((value): value is number => value != null) &&
      finishes.every((value): value is number => value != null) &&
      sessionStart != null &&
      sessionReady != null &&
      sessionImport != null &&
      Math.min(...(starts as number[])) >= sessionStart &&
      Math.max(...(finishes as number[])) <= sessionReady + 1_000 &&
      sessionImport >= sessionReady &&
      measuredWorkflowMs != null &&
      Math.abs(measuredWorkflowMs - pack.totalWorkflowMs) <= 1_000 &&
      measuredWorkflowMs <= READY_SHELF_TARGET_MS
  );
  const usages = snapshot.materialUsages.filter(row =>
    originalBeatIds.includes(row.beatId)
  );
  const shelfReceipt = usages
    .map(row => `${row.materialId}:${row.materialContentHash ?? "unverified"}`)
    .sort()
    .join("|");
  const shelfHash = shelfReceipt
    ? createHash("sha256").update(shelfReceipt).digest("hex")
    : null;
  const shelfBound = Boolean(
    pack &&
      usages.length > 0 &&
      originalBeatIds.every(id => usages.some(row => row.beatId === id)) &&
      usages.every(row => validHash(row.materialContentHash)) &&
      shelfHash === pack.shelfSnapshotHash
  );
  const artifactBindings = Boolean(
    pack &&
      pack.directions.every((direction, index) => {
        const original = beatsById.get(direction.beatId as string);
        const replayId = nonEmpty(record(replayJobs[index]?.outputJson).beatId)
          ? (record(replayJobs[index]?.outputJson).beatId as string)
          : null;
        const replay = replayId ? beatsById.get(replayId) : undefined;
        return Boolean(
          original &&
            replay &&
            original.songId === pack.songId &&
            original.approved &&
            original.qualityState === "passed" &&
            validHash(original.contentHash) &&
            dateMs(original.verifiedAt) != null &&
            original.contentHash === direction.contentHash &&
            replay.contentHash === original.contentHash &&
            record(replayJobs[index]?.inputJson).replayOfBeatId === original.id
        );
      })
  );
  const scores = pack?.producerScores ?? [];
  const panel = Boolean(
    state.panel &&
      state.panel.certifying &&
      !state.panel.legacy &&
      state.panel.reviewerCount === 5 &&
      state.panel.independentReviewerCount >= 2 &&
      state.panel.aiSkepticalReviewerCount >= 1 &&
      state.panel.paidSessionCount >= 3 &&
      state.panel.unpromptedReturnCount >= 3 &&
      state.panel.choseOverManualCount >= 3 &&
      state.panel.wouldPayCount >= 3 &&
      state.panel.technicalCorrectionCount === 0
  );
  const speedProven = Boolean(
    state.panel?.speedImprovement != null &&
      state.panel.speedImprovement >= 0.3
  );
  const packBound = Boolean(
    pack &&
      pack.version === PRODUCER_EVIDENCE_CURRENT_VERSION &&
      event?.workspaceId === snapshot.workspaceId &&
      pack.workspaceId === snapshot.workspaceId &&
      (dateMs(event.createdAt) ?? 0) >=
        (dateMs(pack.createdAt) ?? Number.MAX_SAFE_INTEGER)
  );
  return gate(
    "producer",
    [
      check("producer.pack", packBound, "the latest producer Evidence Pack is structurally valid and bound to this workspace"),
      check("producer.real_jobs", jobEvidenceComplete, "all original and replay jobs are succeeded persisted AfroOne jobs with real timestamps"),
      check("producer.controlled_directions", controlled, "all three named directions share one lane, ontology, and batch seed"),
      check("producer.real_timing", realTiming, "the reported ready-shelf time equals persisted job timestamps and is within twenty minutes"),
      check("producer.shelf_bound", shelfBound, "the shelf snapshot hash recomputes from actual material usage"),
      check("producer.artifacts_bound", artifactBindings, "certified original and replay beats are hash-identical and bound to the song"),
      check("producer.panel", panel, "the v2 panel has five unique reviewers, required independence, no DAW corrections, and three choice and pay signals"),
      check("producer.followups", Boolean(state.report?.ready && state.panel?.pass), "later persisted events prove three paid-session uses and three unprompted returns after seven days"),
      check("producer.speed_advantage", speedProven, "real workflow time beats the declared manual baseline by at least thirty percent"),
    ],
    [
      event?.id,
      ...state.followupEvents.map(row => row.id),
      ...allJobs.map(row => row?.id),
      ...originalBeatIds,
    ],
    {
      reviewerCount: scores.length,
      independentReviewerCount: state.panel?.independentReviewerCount ?? 0,
      averageGrooveScore: state.panel?.averageGrooveScore ?? null,
      paidSessionCount: state.panel?.paidSessionCount ?? 0,
      unpromptedReturnCount: state.panel?.unpromptedReturnCount ?? 0,
      measuredWorkflowMs,
      measuredRenderMs,
      manualWorkflowMs: state.panel?.manualBaselineMs ?? null,
      speedImprovement: state.panel?.speedImprovement ?? null,
      readinessAsOf: state.report?.asOf ?? null,
      legacyPanelCount: state.report?.legacyPanelCount ?? 0,
    }
  );
}

function stemsGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const pack = producerAcceptanceState(snapshot).pack;
  const beatsById = new Map(snapshot.beats.map(row => [row.id, row]));
  const directionChecks = pack?.directions.map(direction => {
    const beat = beatsById.get(direction.beatId as string);
    const stems = snapshot.stems.filter(row => row.beatId === direction.beatId);
    const roles = new Set(stems.map(row => row.role));
    const contentHashes = new Set(stems.map(row => row.contentHash));
    const complete = Boolean(
      beat &&
        stems.length === direction.stemCount &&
        stems.length > 0 &&
        roles.size === stems.length &&
        contentHashes.size === stems.length &&
        direction.stemsClean &&
        stems.every(stem => {
          const lineage = record(stem.lineage);
          const source = record(lineage.source);
          const derivation = record(lineage.derivation);
          return (
            nonEmpty(stem.url) &&
            stem.qualityState === "passed" &&
            validHash(stem.contentHash) &&
            dateMs(stem.verifiedAt) != null &&
            lineage.schemaVersion === 1 &&
            lineage.role === stem.role &&
            source.kind === "beat" &&
            source.assetId === beat.id &&
            source.contentHash === beat.contentHash &&
            ["native_bus", "separation"].includes(String(derivation.kind)) &&
            nonEmpty(derivation.engine) &&
            derivation.jobId === direction.jobId &&
            dateMs(lineage.createdAt) != null
          );
        })
    );
    return check(
      `stems.direction.${direction.direction}`,
      complete,
      `${direction.direction} stems are byte-certified and lineage-bound to the exact beat`
    );
  }) ?? [];
  return gate(
    "stems",
    [
      check("stems.producer_pack_bound", Boolean(pack), "stem acceptance is anchored to the latest producer Evidence Pack"),
      ...directionChecks,
    ],
    pack
      ? pack.directions.flatMap(direction => [
          direction.beatId,
          ...snapshot.stems
            .filter(row => row.beatId === direction.beatId)
            .map(row => row.id),
        ])
      : [],
    {
      certifiedStemCount: pack
        ? snapshot.stems.filter(row =>
            pack.directions.some(direction => direction.beatId === row.beatId)
          ).length
        : 0,
      directionCount: directionChecks.length,
    }
  );
}

function videoGate(snapshot: AcceptanceEvidenceSnapshot): AcceptanceGate {
  const assemblyRow = byNewest(
    snapshot.videoRenders.filter(row => {
      const assembly = record(record(row.meta).assembly);
      return row.provider === "assembler" && assembly.kind === "full";
    })
  )[0];
  const assembly = record(record(assemblyRow?.meta).assembly);
  const renderIds = ids(assembly.renderIdsUsed);
  const shotIndexes = Array.isArray(assembly.shotsUsed)
    ? assembly.shotsUsed.filter(value => Number.isInteger(value)).map(Number)
    : [];
  const scenes = renderIds.map(id => snapshot.videoRenders.find(row => row.id === id));
  const sourceHashes = Array.isArray(assembly.sourceSceneHashes)
    ? assembly.sourceSceneHashes.map(record)
    : [];
  const evidenceComplete = Boolean(
    assemblyRow && assemblyEvidenceCompleteness(assemblyRow).ok
  );
  const sourceEvidence = Boolean(
    scenes.length >= 2 &&
      scenes.every(
        scene =>
          scene &&
          sceneEvidenceCompleteness(scene, { requireVersion: true }).ok
      ) &&
      sourceHashes.length === scenes.length &&
      sourceHashes.every(source => {
        const scene = scenes.find(row => row?.id === source.renderId);
        return scene && record(scene.meta).contentHash === source.contentHash;
      })
  );
  const concept = snapshot.videoConcepts.find(row => row.id === assemblyRow?.conceptId);
  const storyboard = record(concept?.storyboard);
  const sequences = Array.isArray(storyboard.sequences)
    ? storyboard.sequences.map(record)
    : [];
  const storyboardShots = Array.isArray(storyboard.shots)
    ? storyboard.shots.map(record)
    : [];
  const representedSequences = new Set(
    shotIndexes
      .map(index => storyboardShots.find(row => row.index === index)?.sequenceIndex)
      .filter(value => Number.isInteger(value))
  );
  const multiSceneCoverage = Boolean(
      new Set(renderIds).size >= 2 &&
      new Set(shotIndexes).size >= 2 &&
      sequences.length > 0 &&
      representedSequences.size === sequences.length &&
      assembly.sequenceCount === sequences.length &&
      finite(assembly.coveredS) &&
      assembly.coveredS > 0 &&
      finite(assembly.songDurationS) &&
      assembly.songDurationS > 0 &&
      finite(assembly.durationS) &&
      assembly.durationS + 0.5 >= assembly.songDurationS &&
      Math.abs(assembly.durationS - (assemblyRow?.durationS ?? 0)) <= 0.5
  );
  const sourceJobIds = scenes
    .map(scene => record(scene?.meta).providerJobId)
    .filter(nonEmpty);
  const sourceJobs = [...new Set(sourceJobIds)].map(id =>
    snapshot.providerJobs.find(row => row.id === id)
  );
  const sourceCosts = sourceJobs.map(row => row?.costUsd ?? null);
  const costsComplete = Boolean(
    sourceJobIds.length === scenes.length &&
      sourceJobs.length > 0 &&
      sourceJobs.every(job => {
        const output = record(job?.outputJson);
        return (
          job?.status === "SUCCEEDED" &&
          job.costUsd != null &&
          Number.isFinite(job.costUsd) &&
          job.costUsd >= 0 &&
          output.costEvidenceComplete === true &&
          finite(output.knownCostUsd) &&
          Math.abs(output.knownCostUsd - job.costUsd) < 0.000001
        );
      })
  );
  const assemblyJobId = nonEmpty(assembly.providerJobId)
    ? assembly.providerJobId
    : null;
  const assemblyJob = assemblyJobId
    ? snapshot.providerJobs.find(row => row.id === assemblyJobId)
    : undefined;
  const assemblyJobBound = Boolean(
      assemblyRow &&
      assemblyJob &&
      assemblyJob.kind === "video" &&
      assemblyJob.provider === "assembler" &&
      assemblyJob.status === "SUCCEEDED" &&
      record(assemblyJob.outputJson).videoRenderId === assemblyRow.id &&
      record(record(assemblyJob.outputJson).assembly).contentHash ===
        assembly.contentHash &&
      dateMs(assemblyJob.startedAt) != null &&
      dateMs(assemblyJob.finishedAt) != null
  );
  const audio = record(assembly.audioSource);
  const audioArtifact = snapshot.audioArtifacts.find(
    row => row.id === audio.id && row.kind === audio.type
  );
  const audioBound = Boolean(
    audioArtifact &&
      nonEmpty(audioArtifact.url) &&
      audioArtifact.approved &&
      audioArtifact.qualityState === "passed" &&
      validHash(audioArtifact.contentHash) &&
      dateMs(audioArtifact.verifiedAt) != null &&
      (!nonEmpty(audio.songId) || audio.songId === audioArtifact.songId)
  );
  const knownCostUsd = sourceCosts.every(
    (value): value is number => value != null
  )
    ? Number(sourceCosts.reduce((sum, value) => sum + value, 0).toFixed(6))
    : null;
  return gate(
    "video",
    [
      check("video.full_assembly", evidenceComplete, "a completed full-cut assembly has complete measured evidence"),
      check("video.multi_scene_coverage", multiSceneCoverage, "at least two real scenes cover every storyboard sequence and the full song duration"),
      check("video.scene_lineage", sourceEvidence, "every source scene is certified and hash-bound into the assembly"),
      check("video.costs", costsComplete, "all source render jobs have complete reconciled cost receipts"),
      check("video.assembly_job", assemblyJobBound, "the completed assembly job is bound to the exact persisted video bytes"),
      check("video.audio_lineage", audioBound, "the soundtrack points to an approved byte-certified beat, mix, or master"),
    ],
    [
      assemblyRow?.id,
      assemblyJob?.id,
      audioArtifact?.id,
      ...renderIds,
      ...sourceJobIds,
    ],
    {
      sourceSceneCount: new Set(renderIds).size,
      coveredSequenceCount: representedSequences.size,
      requiredSequenceCount: sequences.length,
      outputDurationS: finite(assembly.durationS) ? assembly.durationS : null,
      songDurationS: finite(assembly.songDurationS) ? assembly.songDurationS : null,
      knownCostUsd,
    }
  );
}

export function evaluateAcceptanceReadiness(
  snapshot: AcceptanceEvidenceSnapshot
): AcceptanceReadinessReport {
  const gates = [
    trainingGate(snapshot),
    singingGate(snapshot),
    coldShelfGate(snapshot),
    producerGate(snapshot),
    stemsGate(snapshot),
    videoGate(snapshot),
  ];
  if (!snapshot.workspaceId) {
    for (const current of gates) {
      if (current.id === "training") continue;
      current.checks.unshift(
        check(
          "scope.workspace",
          false,
          "a workspace id is required to bind tenant acceptance evidence"
        )
      );
      current.status = "red";
    }
  }
  const green = gates.filter(current => current.status === "green").length;
  return {
    version: ACCEPTANCE_READINESS_VERSION,
    generatedAt: snapshot.generatedAt,
    workspaceId: snapshot.workspaceId,
    ready: green === gates.length,
    summary: { green, red: gates.length - green, total: gates.length },
    gates,
  };
}

function date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapJob(row: {
  id: string;
  workspaceId: string;
  projectId: string | null;
  kind: string;
  provider: string;
  externalId: string | null;
  status: string;
  inputJson: unknown;
  outputJson: unknown;
  cost: { toString(): string } | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): AcceptanceProviderJob {
  const costUsd = row.cost == null ? null : Number(row.cost.toString());
  return {
    ...row,
    status: String(row.status),
    costUsd: Number.isFinite(costUsd) ? costUsd : null,
    startedAt: date(row.startedAt),
    finishedAt: date(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function evidenceRefs(events: AcceptanceAnalyticsEvent[]) {
  const jobIds = new Set<string>();
  const beatIds = new Set<string>();
  const vocalIds = new Set<string>();
  for (const event of events) {
    const producer = parseProducerPack(event);
    for (const direction of producer?.directions ?? []) {
      jobIds.add(direction.jobId);
      if (direction.beatId) beatIds.add(direction.beatId);
    }
    const singing = parseSingingExternalScore(event);
    if (singing) {
      jobIds.add(singing.providerJobId);
      vocalIds.add(singing.vocalRenderId);
    }
  }
  return { jobIds, beatIds, vocalIds };
}

export async function loadAcceptanceReadiness(options: {
  workspaceId?: string | null;
  now?: Date;
} = {}): Promise<AcceptanceReadinessReport> {
  const workspaceId = options.workspaceId?.trim() || null;
  const settings = await prisma.systemSetting.findMany({
    where: {
      OR: [
        { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
        { key: { startsWith: MUSIC_TRAINING_EVALUATION_PREFIX } },
      ],
    },
    select: { key: true, value: true },
  });
  const active = parseMusicModelRoute(
    settings.find(row => row.key === ACTIVE_MUSIC_MODEL_SETTING_KEY)?.value
  ).active;
  const trainingJobs = await prisma.providerJob.findMany({
    where: {
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      ...(active ? { OR: [{ id: active.providerJobId }, { status: "SUCCEEDED" }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  if (!workspaceId) {
    return evaluateAcceptanceReadiness({
      generatedAt: (options.now ?? new Date()).toISOString(),
      workspaceId: null,
      systemSettings: settings,
      providerJobs: trainingJobs.map(mapJob),
      analyticsEvents: [],
      vocalRenders: [],
      beats: [],
      stems: [],
      materialAssets: [],
      materialUsages: [],
      videoRenders: [],
      videoConcepts: [],
      audioArtifacts: [],
    });
  }

  const [
    producerEventsRaw,
    producerFollowupsRaw,
    singingEventsRaw,
    orchestrationRows,
    assemblyRows,
  ] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { workspaceId, name: "producer.evidence_pack" },
        orderBy: { createdAt: "desc" },
        take: 52,
      }),
      prisma.analyticsEvent.findMany({
        where: { workspaceId, name: "producer.evidence_followup" },
        orderBy: { createdAt: "asc" },
        take: 5_000,
      }),
      prisma.analyticsEvent.findMany({
        where: { workspaceId, name: SINGING_EXTERNAL_SCORE_EVENT },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.providerJob.findMany({
        where: { workspaceId, kind: "material-orchestration", status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.videoRender.findMany({
        where: { project: { workspaceId }, provider: "assembler" },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
  const analyticsEvents: AcceptanceAnalyticsEvent[] = [
    ...producerEventsRaw,
    ...producerFollowupsRaw,
    ...singingEventsRaw,
  ].map(row => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    properties: row.properties,
    createdAt: row.createdAt.toISOString(),
  }));
  const refs = evidenceRefs(analyticsEvents);
  const sourceRenderIds = new Set<string>();
  const conceptIds = new Set<string>();
  const audioIds = {
    beat: new Set<string>(),
    mix: new Set<string>(),
    master: new Set<string>(),
  };
  const jobIds = new Set(refs.jobIds);
  for (const parent of orchestrationRows) {
    jobIds.add(parent.id);
    for (const id of ids(record(parent.inputJson).childJobIds)) jobIds.add(id);
    const assemblyId = record(parent.outputJson).assemblyJobId;
    if (nonEmpty(assemblyId)) jobIds.add(assemblyId);
    const beatId = record(parent.outputJson).beatId;
    if (nonEmpty(beatId)) refs.beatIds.add(beatId);
  }
  for (const row of assemblyRows) {
    if (row.conceptId) conceptIds.add(row.conceptId);
    const assembly = record(record(row.meta).assembly);
    for (const id of ids(assembly.renderIdsUsed)) sourceRenderIds.add(id);
    if (nonEmpty(assembly.providerJobId)) jobIds.add(assembly.providerJobId);
    const audio = record(assembly.audioSource);
    if (
      nonEmpty(audio.id) &&
      (audio.type === "beat" || audio.type === "mix" || audio.type === "master")
    ) audioIds[audio.type].add(audio.id);
  }
  const sourceRows = sourceRenderIds.size
    ? await prisma.videoRender.findMany({
        where: {
          id: { in: [...sourceRenderIds] },
          project: { workspaceId },
        },
      })
    : [];
  for (const row of sourceRows) {
    const providerJobId = record(row.meta).providerJobId;
    if (nonEmpty(providerJobId)) jobIds.add(providerJobId);
  }
  const workspaceJobs = jobIds.size
    ? await prisma.providerJob.findMany({
        where: { id: { in: [...jobIds] }, workspaceId },
      })
    : [];
  const replayRows = refs.beatIds.size
    ? await prisma.providerJob.findMany({
        where: {
          workspaceId,
          kind: "music",
          provider: "afrohit-own",
          status: "SUCCEEDED",
          OR: [...refs.beatIds].map(beatId => ({
            inputJson: { path: ["replayOfBeatId"], equals: beatId },
          })),
        },
      })
    : [];
  const allJobs = [
    ...trainingJobs,
    ...orchestrationRows,
    ...workspaceJobs,
    ...replayRows,
  ];
  const uniqueJobs = [...new Map(allJobs.map(row => [row.id, row])).values()];
  const mappedJobs = uniqueJobs.map(mapJob);
  for (const job of mappedJobs) {
    const output = record(job.outputJson);
    if (job.kind === "material" && nonEmpty(output.materialId)) {
      continue;
    }
    if (job.provider === "afrohit-own" && nonEmpty(output.beatId)) {
      refs.beatIds.add(output.beatId);
    }
  }
  const materialIds = new Set<string>();
  for (const job of mappedJobs) {
    const materialId = record(job.outputJson).materialId;
    if (nonEmpty(materialId)) materialIds.add(materialId);
  }
  const [vocals, beats, concepts, materialAssets, beatAudio, mixAudio, masterAudio] =
    await Promise.all([
      refs.vocalIds.size
        ? prisma.vocalRender.findMany({
            where: { id: { in: [...refs.vocalIds] }, project: { workspaceId } },
          })
        : [],
      refs.beatIds.size
        ? prisma.beatAsset.findMany({
            where: { id: { in: [...refs.beatIds] }, project: { workspaceId } },
          })
        : [],
      conceptIds.size
        ? prisma.videoConcept.findMany({
            where: { id: { in: [...conceptIds] }, project: { workspaceId } },
            select: { id: true, storyboard: true },
          })
        : [],
      materialIds.size
        ? prisma.materialAsset.findMany({
            where: { id: { in: [...materialIds] }, workspaceId },
          })
        : [],
      audioIds.beat.size
        ? prisma.beatAsset.findMany({
            where: { id: { in: [...audioIds.beat] }, project: { workspaceId } },
          })
        : [],
      audioIds.mix.size
        ? prisma.mix.findMany({
            where: { id: { in: [...audioIds.mix] }, project: { workspaceId } },
          })
        : [],
      audioIds.master.size
        ? prisma.master.findMany({
            where: { id: { in: [...audioIds.master] }, project: { workspaceId } },
          })
        : [],
    ]);
  const producerJobIds = new Set<string>();
  for (const event of analyticsEvents) {
    const pack = parseProducerPack(event);
    for (const direction of pack?.directions ?? []) producerJobIds.add(direction.jobId);
  }
  const usages = producerJobIds.size
    ? await prisma.materialUsage.findMany({
        where: { workspaceId, providerJobId: { in: [...producerJobIds] } },
        select: {
          providerJobId: true,
          beatId: true,
          materialId: true,
          material: { select: { contentHash: true } },
        },
      })
    : [];
  for (const usage of usages) refs.beatIds.add(usage.beatId);
  const missingBeatIds = [...refs.beatIds].filter(
    id => !beats.some(row => row.id === id)
  );
  const extraBeats = missingBeatIds.length
    ? await prisma.beatAsset.findMany({
        where: { id: { in: missingBeatIds }, project: { workspaceId } },
      })
    : [];
  const allBeats = [...beats, ...extraBeats];
  const stems = allBeats.length
    ? await prisma.stem.findMany({
        where: { beatId: { in: allBeats.map(row => row.id) } },
      })
    : [];
  const videoRenders = [...assemblyRows, ...sourceRows].map(row => ({
    id: row.id,
    projectId: row.projectId,
    conceptId: row.conceptId,
    url: row.url,
    durationS: row.durationS,
    provider: row.provider,
    meta: row.meta,
    createdAt: row.createdAt.toISOString(),
  }));
  const audioArtifacts: AcceptanceAudioArtifact[] = [
    ...beatAudio.map(row => ({ ...row, kind: "beat" as const })),
    ...mixAudio.map(row => ({ ...row, kind: "mix" as const })),
    ...masterAudio.map(row => ({ ...row, kind: "master" as const })),
  ].map(row => ({
    id: row.id,
    kind: row.kind,
    projectId: row.projectId,
    songId: row.songId,
    url: row.url,
    qualityState: row.qualityState,
    contentHash: row.contentHash,
    verifiedAt: date(row.verifiedAt),
    approved: row.approved,
  }));
  return evaluateAcceptanceReadiness({
    generatedAt: (options.now ?? new Date()).toISOString(),
    workspaceId,
    systemSettings: settings,
    providerJobs: mappedJobs,
    analyticsEvents,
    vocalRenders: vocals.map(row => ({
      id: row.id,
      projectId: row.projectId,
      songId: row.songId,
      url: row.url,
      assetKind: row.assetKind,
      performanceSource: row.performanceSource,
      qualityState: row.qualityState,
      contentHash: row.contentHash,
      verifiedAt: date(row.verifiedAt),
      alignment: row.alignment,
      meta: row.meta,
      approved: row.approved,
    })),
    beats: allBeats.map(row => ({
      id: row.id,
      projectId: row.projectId,
      songId: row.songId,
      url: row.url,
      provider: row.provider,
      qualityState: row.qualityState,
      contentHash: row.contentHash,
      verifiedAt: date(row.verifiedAt),
      approved: row.approved,
    })),
    stems: stems.map(row => ({
      id: row.id,
      beatId: row.beatId,
      role: row.role,
      url: row.url,
      qualityState: row.qualityState,
      contentHash: row.contentHash,
      verifiedAt: date(row.verifiedAt),
      lineage: row.lineage,
    })),
    materialAssets: materialAssets.map(row => ({
      id: row.id,
      readiness: row.readiness,
      qualityState: row.qualityState,
      contentHash: row.contentHash,
      verifiedAt: date(row.verifiedAt),
    })),
    materialUsages: usages.map(row => ({
      providerJobId: row.providerJobId,
      beatId: row.beatId,
      materialId: row.materialId,
      materialContentHash: row.material.contentHash,
    })),
    videoRenders,
    videoConcepts: concepts,
    audioArtifacts,
  });
}

export function acceptanceExitCode(
  report: AcceptanceReadinessReport,
  strict: boolean
): number {
  return strict && !report.ready ? 2 : 0;
}
