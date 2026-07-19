/**
 * Nightly rights-clean music-model lifecycle.
 *
 * Each pass continues the oldest durable receipt before considering a new
 * corpus: queued kickoff -> provider polling -> candidate receipt -> measured
 * evaluation -> promotion or rejection. No candidate routes traffic without a
 * bound score receipt, and every active pointer keeps one-click rollback state.
 */
import { createHash } from "node:crypto";
import { isOutsideRenderLearningEnabled, prisma } from "@afrohit/db";
import JSZip from "jszip";
import {
  beatIngredientIds,
  manifestFromCatalog,
  resolveTrainingConsent,
  TRAINING_LICENSE_CLAUSE,
  type TrainingManifest,
  type TrainingOrigin,
} from "@afrohit/shared";
import {
  buildTrainerDataset,
  evaluateAndPromote,
  musicCandidateModelRef,
  musicTrainerConfig,
  musicTrainerEnabled,
  minCorpusSize,
  parseMusicModelRoute,
  pollMusicTraining,
  promoteMusicModelRoute,
  rollbackMusicModelRoute,
  trainingDatasetHash,
  type MusicModelRouteState,
  type MusicTrainerConfig,
} from "@afrohit/ai";
import { kickoffMusicTraining } from "@afrohit/ai";
import { downloadToBuffer, uploadBytes } from "./storage";

const TRAINING_WORKSPACE_ID = "training";
export const ACTIVE_MUSIC_MODEL_SETTING_KEY = "music.training.activeModel.v1";
export const LAST_MUSIC_DATASET_SETTING_KEY = "music.training.lastDataset.v1";
export const MUSIC_TRAINING_EVALUATION_PREFIX = "music.training.evaluation.v1.";

/** Cap one dataset so a nightly run cannot consume unbounded disk or egress. */
const MAX_DATASET_ASSETS = Math.max(
  1,
  Number.parseInt(process.env.MUSIC_TRAINER_MAX_ASSETS ?? "200", 10) || 200
);

type JsonRecord = Record<string, unknown>;

interface TrainingSource {
  id: string;
  origin: TrainingOrigin;
  url: string;
  contentFingerprint: string;
  createdAt: Date;
}

interface TrainingJobRow {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  externalId: string | null;
  inputJson: unknown;
  outputJson: unknown;
}

export interface FlywheelResult {
  ran: boolean;
  reason?: string;
  eligible?: number;
  zipped?: number;
  trainingId?: string;
  datasetHash?: string;
  candidateModelRef?: string;
}

export interface MusicTrainingEvaluationReceipt {
  candidateModelRef: string;
  datasetHash: string;
  candidateScore: number;
  evaluator: string;
  measuredAt: string;
  minGain?: number;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function jsonRecord(raw: string | null | undefined): JsonRecord {
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/** Strict parser: an evaluation cannot promote a different artifact or corpus. */
export function parseMusicTrainingEvaluation(
  raw: string | null | undefined
): MusicTrainingEvaluationReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as JsonRecord;
    const candidateScore = finiteScore(value.candidateScore);
    const minGain = value.minGain == null ? undefined : finiteScore(value.minGain);
    if (
      typeof value.candidateModelRef !== "string" || !value.candidateModelRef.trim() ||
      typeof value.datasetHash !== "string" || !/^[a-f0-9]{64}$/.test(value.datasetHash) ||
      candidateScore == null ||
      typeof value.evaluator !== "string" || !value.evaluator.trim() ||
      typeof value.measuredAt !== "string" || !Number.isFinite(Date.parse(value.measuredAt)) ||
      (value.minGain != null && minGain == null)
    ) return null;
    return {
      candidateModelRef: value.candidateModelRef.trim(),
      datasetHash: value.datasetHash,
      candidateScore,
      evaluator: value.evaluator.trim(),
      measuredAt: value.measuredAt,
      ...(minGain == null ? {} : { minGain }),
    };
  } catch {
    return null;
  }
}

export async function readActiveMusicModelRoute(): Promise<MusicModelRouteState> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
  });
  return parseMusicModelRoute(row?.value);
}

/** Routing seam for inference consumers. Rendering changes are intentionally
 * outside this bounded subtask, so callers opt in by reading this pointer. */
export async function resolveActiveMusicModelRef(): Promise<string | null> {
  return (await readActiveMusicModelRoute()).active?.modelRef ?? null;
}

/** Operator-safe rollback. The former active remains as `previous`, so the
 * operation is reversible and its reason is retained in route history. */
export async function rollbackActiveMusicModel(reason: string): Promise<{
  rolledBack: boolean;
  route: MusicModelRouteState;
  reason: string;
}> {
  if (!reason.trim()) throw new Error("music model rollback requires a reason");
  const result = rollbackMusicModelRoute({
    current: await readActiveMusicModelRoute(),
    reason: reason.trim(),
  });
  if (result.rolledBack) {
    await prisma.systemSetting.upsert({
      where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
      create: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY, value: JSON.stringify(result.route) },
      update: { value: JSON.stringify(result.route) },
    });
  }
  return result;
}

/** Persist a score against the exact candidate receipt and immediately run the
 * promotion gate. An admin/API surface can call this without constructing
 * SystemSetting keys or copying model identities by hand. */
export async function submitMusicTrainingEvaluation(input: {
  providerJobId: string;
  candidateScore: number;
  evaluator: string;
  measuredAt?: string;
  minGain?: number;
}): Promise<{
  receipt: MusicTrainingEvaluationReceipt;
  pending: boolean;
  reason: string;
  candidateModelRef?: string;
}> {
  const score = finiteScore(input.candidateScore);
  const minGain = input.minGain == null ? undefined : finiteScore(input.minGain);
  if (score == null) throw new Error("music training score must be between 0 and 100");
  if (input.minGain != null && minGain == null) {
    throw new Error("music training minimum gain must be between 0 and 100");
  }
  if (!input.evaluator.trim()) throw new Error("music training evaluation requires an evaluator");
  const job = await prisma.providerJob.findFirst({
    where: {
      id: input.providerJobId,
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      status: "SUCCEEDED",
    },
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
    },
  });
  if (!job || record(job.outputJson).phase !== "candidate_ready") {
    throw new Error("music training candidate is not ready for evaluation");
  }
  const output = record(job.outputJson);
  const jobInput = record(job.inputJson);
  if (
    typeof output.candidateModelRef !== "string" ||
    typeof jobInput.datasetHash !== "string"
  ) {
    throw new Error("music training candidate receipt is incomplete");
  }
  const receipt: MusicTrainingEvaluationReceipt = {
    candidateModelRef: output.candidateModelRef,
    datasetHash: jobInput.datasetHash,
    candidateScore: score,
    evaluator: input.evaluator.trim(),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    ...(minGain == null ? {} : { minGain }),
  };
  if (!parseMusicTrainingEvaluation(JSON.stringify(receipt))) {
    throw new Error("music training evaluation receipt is invalid");
  }
  const key = `${MUSIC_TRAINING_EVALUATION_PREFIX}${job.id}`;
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(receipt) },
    update: { value: JSON.stringify(receipt) },
  });
  const result = await evaluateCandidateJob(job as TrainingJobRow);
  return { receipt, ...result };
}

/** Workspaces holding a current, unrevoked, hash-bound training grant. */
async function consentedWorkspaceIds(): Promise<Set<string>> {
  const expectedHash = createHash("sha256")
    .update(TRAINING_LICENSE_CLAUSE, "utf8")
    .digest("hex");
  const rows = await prisma.trainingConsent.findMany({
    where: { revokedAt: null },
    select: {
      workspaceId: true,
      consentVersion: true,
      signedAt: true,
      consentTextHash: true,
      revokedAt: true,
    },
    orderBy: { signedAt: "desc" },
    take: 10_000,
  });
  const granted = new Set<string>();
  for (const row of rows) {
    if (granted.has(row.workspaceId)) continue;
    const verdict = resolveTrainingConsent(
      {
        version: row.consentVersion,
        acceptedAt: row.signedAt,
        textHash: row.consentTextHash,
        revokedAt: row.revokedAt,
      },
      { expectedHash }
    );
    if (verdict.granted && verdict.current) granted.add(row.workspaceId);
  }
  return granted;
}

function mergeManifests(a: TrainingManifest, b: TrainingManifest): TrainingManifest {
  const byOrigin: Record<string, number> = { ...a.counts.byOrigin };
  for (const [key, count] of Object.entries(b.counts.byOrigin)) {
    byOrigin[key] = (byOrigin[key] ?? 0) + count;
  }
  return {
    eligible: [...a.eligible, ...b.eligible],
    rejected: [...a.rejected, ...b.rejected],
    counts: {
      total: a.counts.total + b.counts.total,
      eligible: a.counts.eligible + b.counts.eligible,
      byOrigin,
    },
  };
}

async function liveManifest(): Promise<{
  manifest: TrainingManifest;
  sources: Map<string, Omit<TrainingSource, "id" | "origin">>;
}> {
  const take = 5_000;
  const [materials, beats, vocals, granted] = await Promise.all([
    prisma.materialAsset.findMany({
      where: { readiness: "ready", qualityState: { notIn: ["failed", "duplicate"] } },
      select: {
        id: true,
        source: true,
        rightsBasis: true,
        url: true,
        contentHash: true,
        workspaceId: true,
        createdAt: true,
      },
      take,
    }),
    prisma.beatAsset.findMany({
      where: { approved: true },
      select: {
        id: true,
        provider: true,
        meta: true,
        url: true,
        contentHash: true,
        createdAt: true,
        project: { select: { workspaceId: true } },
      },
      take,
    }),
    prisma.vocalRender.findMany({
      where: { approved: true },
      select: {
        id: true,
        performanceSource: true,
        url: true,
        contentHash: true,
        createdAt: true,
        project: { select: { workspaceId: true } },
      },
      take,
    }),
    consentedWorkspaceIds(),
  ]);

  const ingredientIds = [...new Set(beats.flatMap(row => beatIngredientIds(row.meta)))];
  const rightsById = new Map<string, string | null>();
  if (ingredientIds.length) {
    const rows = await prisma.materialAsset.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true, rightsBasis: true },
    });
    for (const row of rows) rightsById.set(row.id, row.rightsBasis);
  }
  const enrichedBeats = beats.map(row => {
    const ids = beatIngredientIds(row.meta);
    return ids.length
      ? { ...row, ingredientRights: ids.map(id => rightsById.get(id) ?? "unknown") }
      : row;
  });

  const isGranted = (workspaceId?: string | null) => !!workspaceId && granted.has(workspaceId);
  const split = <T>(rows: T[], workspace: (row: T) => string | null | undefined) => ({
    yes: rows.filter(row => isGranted(workspace(row))),
    no: rows.filter(row => !isGranted(workspace(row))),
  });
  const materialSplit = split(materials, row => row.workspaceId);
  const beatSplit = split(enrichedBeats, row => row.project?.workspaceId);
  const vocalSplit = split(vocals, row => row.project?.workspaceId);

  const policy = { allowThirdPartyRenders: await isOutsideRenderLearningEnabled() };
  if (policy.allowThirdPartyRenders) {
    console.warn("[flywheel] outside-render learning is ON; provenance remains labeled and trainer re-validation still applies");
  }
  const manifest = mergeManifests(
    manifestFromCatalog(
      { materials: materialSplit.yes, beats: beatSplit.yes, vocals: vocalSplit.yes },
      true,
      policy
    ),
    manifestFromCatalog(
      { materials: materialSplit.no, beats: beatSplit.no, vocals: vocalSplit.no },
      false,
      policy
    )
  );

  const sources = new Map<string, Omit<TrainingSource, "id" | "origin">>();
  for (const row of materials) {
    sources.set(`material:${row.id}`, {
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      createdAt: row.createdAt,
    });
  }
  for (const row of beats) {
    sources.set(`beat:${row.id}`, {
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      createdAt: row.createdAt,
    });
  }
  for (const row of vocals) {
    sources.set(`vocal:${row.id}`, {
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      createdAt: row.createdAt,
    });
  }
  console.log(
    `[flywheel] consent door: ${granted.size} workspace(s) granted; eligible ${manifest.eligible.length} of ${manifest.counts.total}`
  );
  return { manifest, sources };
}

function manifestForAssets(
  assets: Array<{ id: string; origin: TrainingOrigin }>
): TrainingManifest {
  const byOrigin: Record<string, number> = {};
  for (const asset of assets) byOrigin[asset.origin] = (byOrigin[asset.origin] ?? 0) + 1;
  return {
    eligible: assets,
    rejected: [],
    counts: { total: assets.length, eligible: assets.length, byOrigin },
  };
}

function storedTrainingManifest(value: unknown): TrainingManifest | null {
  if (!Array.isArray(value)) return null;
  const assets: Array<{ id: string; origin: TrainingOrigin }> = [];
  for (const item of value) {
    const row = record(item);
    if (typeof row.id !== "string" || typeof row.origin !== "string") return null;
    assets.push({ id: row.id, origin: row.origin as TrainingOrigin });
  }
  const manifest = manifestForAssets(assets);
  try {
    buildTrainerDataset(manifest);
    return manifest;
  } catch {
    return null;
  }
}

async function rememberLastDataset(input: {
  catalogHash: string;
  datasetHash: string;
  providerJobId: string;
  trainingId: string;
}): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: LAST_MUSIC_DATASET_SETTING_KEY },
    create: { key: LAST_MUSIC_DATASET_SETTING_KEY, value: JSON.stringify(input) },
    update: { value: JSON.stringify(input) },
  });
}

async function kickoffQueuedJob(job: TrainingJobRow): Promise<{ pending: boolean; reason: string }> {
  const input = record(job.inputJson);
  const manifest = storedTrainingManifest(input.trainingAssets);
  const datasetZipUrl = typeof input.datasetZipUrl === "string" ? input.datasetZipUrl : null;
  if (!manifest || !datasetZipUrl) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorJson: { message: "training receipt is missing a valid dataset URL or rights-clean manifest" } as never,
      },
    });
    return { pending: false, reason: "invalid queued receipt failed closed" };
  }

  // Atomic claim: concurrent nightly workers can find the same idempotent
  // receipt, but only one may cross the provider-spend boundary.
  const claimTime = new Date();
  const claimed = await prisma.providerJob.updateMany({
    where: { id: job.id, status: "QUEUED" },
    data: {
      status: "RUNNING",
      startedAt: claimTime,
      outputJson: {
        phase: "kickoff_claimed",
        claimedAt: claimTime.toISOString(),
      } as never,
    },
  });
  if (claimed.count !== 1) {
    return { pending: true, reason: "training kickoff already claimed by another worker" };
  }

  try {
    const result = await kickoffMusicTraining({ manifest, datasetZipUrl });
    if (!result.started || !result.trainingId) {
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorJson: { message: result.reason ?? "training kickoff refused" } as never,
        },
      });
      return { pending: false, reason: result.reason ?? "training kickoff refused" };
    }
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        externalId: result.trainingId,
        startedAt: claimTime,
        outputJson: {
          phase: "training_started",
          trainingId: result.trainingId,
          trainerModel: result.model,
          trainerVersion: result.version,
          trainerKind: result.kind,
          destination: result.destination,
          datasetHash: input.datasetHash,
          startedAt: claimTime.toISOString(),
        } as never,
        errorJson: undefined,
      },
    });
    if (typeof input.catalogHash === "string" && typeof input.datasetHash === "string") {
      await rememberLastDataset({
        catalogHash: input.catalogHash,
        datasetHash: input.datasetHash,
        providerJobId: job.id,
        trainingId: result.trainingId,
      });
    }
    console.log(`[flywheel] training started: ${result.trainingId}`);
    return { pending: true, reason: "training started" };
  } catch (error) {
    const message = (error as Error)?.message?.slice(0, 300) || "training kickoff failed";
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorJson: { message } as never,
      },
    });
    return { pending: false, reason: message };
  }
}

async function evaluateCandidateJob(job: TrainingJobRow): Promise<{
  pending: boolean;
  reason: string;
  candidateModelRef?: string;
}> {
  const output = record(job.outputJson);
  const input = record(job.inputJson);
  const candidateModelRef = typeof output.candidateModelRef === "string"
    ? output.candidateModelRef
    : null;
  const datasetHash = typeof input.datasetHash === "string" ? input.datasetHash : null;
  const trainingId = typeof output.trainingId === "string"
    ? output.trainingId
    : job.externalId;
  if (!candidateModelRef || !datasetHash || !trainingId) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorJson: { message: "candidate receipt is missing model, dataset, or training identity" } as never,
      },
    });
    return { pending: false, reason: "invalid candidate receipt" };
  }

  const evaluationKey = `${MUSIC_TRAINING_EVALUATION_PREFIX}${job.id}`;
  const evaluationRow = await prisma.systemSetting.findUnique({ where: { key: evaluationKey } });
  const evaluation = parseMusicTrainingEvaluation(evaluationRow?.value);
  if (!evaluation) {
    return {
      pending: true,
      reason: `candidate awaits a bound score receipt at ${evaluationKey}`,
      candidateModelRef,
    };
  }
  if (
    evaluation.candidateModelRef !== candidateModelRef ||
    evaluation.datasetHash !== datasetHash
  ) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: {
          ...output,
          phase: "candidate_ready",
          evaluationKey,
          evaluationError: "score receipt does not match candidate model and dataset hash",
        } as never,
      },
    });
    return { pending: true, reason: "mismatched evaluation receipt held", candidateModelRef };
  }

  const current = await readActiveMusicModelRoute();
  const configuredGain = Number(process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN ?? "1");
  const minGain = evaluation.minGain ?? (
    Number.isFinite(configuredGain) && configuredGain >= 0 ? configuredGain : 1
  );
  const decision = evaluateAndPromote({
    candidateScore: evaluation.candidateScore,
    incumbentScore: current.active?.score ?? null,
    minGain,
  });
  const evaluatedOutput = {
    ...output,
    evaluation: {
      ...evaluation,
      incumbentModelRef: current.active?.modelRef ?? null,
      incumbentScore: current.active?.score ?? null,
      minGain,
      promote: decision.promote,
      reason: decision.reason,
    },
  };

  if (!decision.promote || current.active?.modelRef === candidateModelRef) {
    const reason = current.active?.modelRef === candidateModelRef
      ? "candidate is already the active model"
      : decision.reason;
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: { ...evaluatedOutput, phase: "rejected", decision: reason } as never,
        finishedAt: new Date(),
      },
    });
    return { pending: false, reason, candidateModelRef };
  }

  const route = promoteMusicModelRoute({
    current,
    candidate: {
      modelRef: candidateModelRef,
      providerJobId: job.id,
      trainingId,
      datasetHash,
      score: evaluation.candidateScore,
      evaluatedAt: evaluation.measuredAt,
    },
    reason: decision.reason,
  });
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
      create: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY, value: JSON.stringify(route) },
      update: { value: JSON.stringify(route) },
    }),
    prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: {
          ...evaluatedOutput,
          phase: "promoted",
          activeModelRef: route.active?.modelRef,
          previousModelRef: route.previous?.modelRef ?? null,
          promotedAt: route.updatedAt,
        } as never,
        finishedAt: new Date(),
      },
    }),
  ]);
  console.log(`[flywheel] promoted ${candidateModelRef}; rollback pointer preserved`);
  return { pending: false, reason: decision.reason, candidateModelRef };
}

async function pollRunningJob(job: TrainingJobRow): Promise<{
  pending: boolean;
  reason: string;
  candidateModelRef?: string;
}> {
  const output = record(job.outputJson);
  const input = record(job.inputJson);
  const trainingId = job.externalId || (
    typeof output.trainingId === "string" ? output.trainingId : null
  );
  if (!trainingId) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorJson: { message: "running training receipt has no provider id" } as never,
      },
    });
    return { pending: false, reason: "running receipt missing provider id" };
  }
  const kind: MusicTrainerConfig["kind"] = output.trainerKind === "prediction"
    ? "prediction"
    : "training";
  try {
    const state = await pollMusicTraining({ trainingId, kind });
    if (state.status === "starting" || state.status === "processing") {
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          outputJson: {
            ...output,
            phase: "training_running",
            providerStatus: state.status,
            lastPolledAt: new Date().toISOString(),
            metrics: state.metrics,
          } as never,
        },
      });
      return { pending: true, reason: `provider ${state.status}` };
    }
    if (state.status === "failed" || state.status === "canceled") {
      const message = state.error?.slice(0, 300) || `replicate training ${state.status}`;
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: state.status === "canceled" ? "CANCELED" : "FAILED",
          finishedAt: new Date(),
          outputJson: {
            ...output,
            phase: state.status,
            providerStatus: state.status,
            metrics: state.metrics,
          } as never,
          errorJson: { message } as never,
        },
      });
      return { pending: false, reason: message };
    }

    const destination = typeof output.destination === "string" ? output.destination : null;
    const candidateModelRef = musicCandidateModelRef(state.output, destination);
    if (!candidateModelRef) {
      const message = "replicate training succeeded without a runnable model artifact";
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorJson: { message } as never,
          outputJson: {
            ...output,
            phase: "artifact_missing",
            providerStatus: state.status,
            providerOutput: state.output,
          } as never,
        },
      });
      return { pending: false, reason: message };
    }

    const candidateOutput = {
      ...output,
      phase: "candidate_ready",
      providerStatus: state.status,
      candidateModelRef,
      datasetHash: input.datasetHash,
      evaluationKey: `${MUSIC_TRAINING_EVALUATION_PREFIX}${job.id}`,
      providerOutput: state.output,
      metrics: state.metrics,
      completedAt: new Date().toISOString(),
    };
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        outputJson: candidateOutput as never,
        errorJson: undefined,
      },
    });
    return evaluateCandidateJob({ ...job, status: "SUCCEEDED", outputJson: candidateOutput });
  } catch (error) {
    const message = (error as Error)?.message?.slice(0, 300) || "training poll failed";
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: {
          ...output,
          phase: "training_poll_retry",
          lastPollError: message,
          lastPolledAt: new Date().toISOString(),
        } as never,
      },
    });
    return { pending: true, reason: `poll will retry nightly: ${message}` };
  }
}

/** Continue durable jobs before starting new spend. */
async function continueTrainingLifecycle(options: { allowKickoff: boolean }): Promise<{
  blocking: boolean;
  reason?: string;
  candidateModelRef?: string;
}> {
  const rows = await prisma.providerJob.findMany({
    where: {
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
    },
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  for (const row of rows as TrainingJobRow[]) {
    if (row.status === "QUEUED") {
      if (!options.allowKickoff) {
        return {
          blocking: true,
          reason: "queued training is preserved but awaits the trainer arming gate",
        };
      }
      const result = await kickoffQueuedJob(row);
      if (result.pending) return { blocking: true, reason: result.reason };
      continue;
    }
    if (row.status === "RUNNING") {
      const result = await pollRunningJob(row);
      if (result.pending) {
        return {
          blocking: true,
          reason: result.reason,
          candidateModelRef: result.candidateModelRef,
        };
      }
      continue;
    }
    const phase = record(row.outputJson).phase;
    if (row.status === "SUCCEEDED" && phase === "candidate_ready") {
      const result = await evaluateCandidateJob(row);
      if (result.pending) {
        return {
          blocking: true,
          reason: result.reason,
          candidateModelRef: result.candidateModelRef,
        };
      }
    }
  }
  return { blocking: false };
}

export async function runTrainingFlywheel(): Promise<FlywheelResult> {
  const enabled = musicTrainerEnabled();
  const config = enabled ? musicTrainerConfig() : null;
  // Polling, candidate evaluation, and promotion spend no provider money and
  // must finish even if the operator disarms future training after kickoff.
  const continuation = await continueTrainingLifecycle({
    allowKickoff: enabled && !!config,
  });
  if (continuation.blocking) {
    console.log(`[flywheel] continuation: ${continuation.reason}`);
    return {
      ran: false,
      reason: continuation.reason,
      candidateModelRef: continuation.candidateModelRef,
    };
  }
  if (!enabled) {
    console.log("[flywheel] skipped new kickoff: MUSIC_TRAINER_ENABLED is not set");
    return { ran: false, reason: "trainer disabled (MUSIC_TRAINER_ENABLED)" };
  }
  if (!config) {
    console.log("[flywheel] skipped new kickoff: trainer unconfigured");
    return { ran: false, reason: "trainer unconfigured" };
  }

  const { manifest, sources } = await liveManifest();
  const selected: TrainingSource[] = manifest.eligible
    .map(asset => {
      const source = sources.get(asset.id);
      return source ? { ...asset, ...source } : null;
    })
    .filter((asset): asset is TrainingSource => !!asset)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_DATASET_ASSETS);

  if (selected.length < minCorpusSize()) {
    console.log(`[flywheel] corpus too small (${selected.length} < ${minCorpusSize()})`);
    return {
      ran: false,
      reason: "corpus too small",
      eligible: manifest.eligible.length,
    };
  }

  // Defense in depth before any byte download or provider spend.
  buildTrainerDataset(manifestForAssets(selected));
  const catalogHash = trainingDatasetHash(selected);
  const lastDataset = await prisma.systemSetting.findUnique({
    where: { key: LAST_MUSIC_DATASET_SETTING_KEY },
  });
  const last = jsonRecord(lastDataset?.value);
  if (last.catalogHash === catalogHash) {
    console.log(`[flywheel] dataset unchanged (${catalogHash.slice(0, 12)}); no retraining`);
    return {
      ran: false,
      reason: "dataset unchanged",
      eligible: manifest.eligible.length,
      datasetHash: typeof last.datasetHash === "string" ? last.datasetHash : undefined,
    };
  }

  const zip = new JSZip();
  const zippedAssets: Array<TrainingSource & { audioHash: string }> = [];
  for (const asset of selected) {
    try {
      const bytes = await downloadToBuffer(asset.url);
      const audioHash = createHash("sha256").update(bytes).digest("hex");
      zip.file(`dataset/${asset.id.replace(/[^a-zA-Z0-9_-]+/g, "_")}.wav`, bytes);
      zippedAssets.push({ ...asset, audioHash });
    } catch (error) {
      console.warn(`[flywheel] skipped ${asset.id}: ${(error as Error)?.message?.slice(0, 80)}`);
    }
  }
  if (zippedAssets.length < minCorpusSize()) {
    return {
      ran: false,
      reason: `reachable corpus too small (${zippedAssets.length} < ${minCorpusSize()})`,
      eligible: manifest.eligible.length,
      zipped: zippedAssets.length,
    };
  }

  const trainingAssets = zippedAssets.map(asset => ({ id: asset.id, origin: asset.origin }));
  const trainingManifest = manifestForAssets(trainingAssets);
  buildTrainerDataset(trainingManifest);
  const datasetHash = trainingDatasetHash(
    zippedAssets.map(asset => ({
      id: asset.id,
      origin: asset.origin,
      contentFingerprint: asset.audioHash,
    }))
  );
  const idempotencyKey = `dataset:${datasetHash}`;
  const duplicate = await prisma.providerJob.findFirst({
    where: {
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      idempotencyKey,
    },
    select: { id: true, externalId: true },
  });
  if (duplicate) {
    console.log(`[flywheel] dataset hash already has receipt ${duplicate.id}; no retraining`);
    return {
      ran: false,
      reason: "dataset hash already trained",
      eligible: manifest.eligible.length,
      zipped: zippedAssets.length,
      datasetHash,
      trainingId: duplicate.externalId ?? undefined,
    };
  }

  const zipBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const datasetZipUrl = await uploadBytes({
    workspaceId: TRAINING_WORKSPACE_ID,
    kind: "datasets",
    bytes: zipBytes,
    contentType: "application/zip",
    ext: "zip",
  });
  const receipt = await prisma.providerJob.upsert({
    where: {
      workspaceId_kind_idempotencyKey: {
        workspaceId: TRAINING_WORKSPACE_ID,
        kind: "music-training",
        idempotencyKey,
      },
    },
    create: {
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      provider: "replicate",
      status: "QUEUED",
      idempotencyKey,
      inputJson: {
        datasetZipUrl,
        datasetHash,
        catalogHash,
        eligible: manifest.eligible.length,
        zipped: zippedAssets.length,
        trainingAssets,
        byOrigin: trainingManifest.counts.byOrigin,
        trainerModel: config?.model,
        trainerVersion: config?.version,
        trainerKind: config?.kind,
      } as never,
      outputJson: {
        phase: "kickoff_queued",
        queuedAt: new Date().toISOString(),
      } as never,
    },
    update: {},
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
    },
  });
  if (receipt.status !== "QUEUED") {
    return {
      ran: false,
      reason: "dataset hash already has a durable receipt",
      eligible: manifest.eligible.length,
      zipped: zippedAssets.length,
      trainingId: receipt.externalId ?? undefined,
      datasetHash,
    };
  }
  const started = await kickoffQueuedJob(receipt as TrainingJobRow);
  const refreshed = await prisma.providerJob.findUnique({
    where: { id: receipt.id },
    select: { externalId: true },
  });
  return {
    ran: started.pending,
    reason: started.reason,
    eligible: manifest.eligible.length,
    zipped: zippedAssets.length,
    trainingId: refreshed?.externalId ?? undefined,
    datasetHash,
  };
}
