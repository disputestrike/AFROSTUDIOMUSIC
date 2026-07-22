/**
 * Nightly rights-clean music-model lifecycle.
 *
 * Each pass continues the oldest durable receipt before considering a new
 * corpus: queued kickoff -> provider polling -> candidate receipt -> measured
 * evaluation -> promotion or rejection. No candidate routes traffic without a
 * bound score receipt, and every active pointer keeps one-click rollback state.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isOutsideRenderLearningEnabled, Prisma, prisma } from "@afrohit/db";
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
  ACTIVE_MUSIC_MODEL_SETTING_KEY,
  MUSIC_ADAPTER_ROUTE_SETTING_KEY,
  MUSIC_DEV_MODEL_SETTING_KEY,
  MUSIC_TRAINING_AUDIO_METRICS_PREFIX,
  MUSIC_TRAINING_EVALUATION_PREFIX,
  MUSIC_TRAINING_WORKSPACE_ID,
  activeProductionModelRef,
  buildMusicTrainingEvaluationReceipt,
  buildTrainerDataset,
  decideMusicCandidatePromotion,
  musicCandidateModelRef,
  musicTrainerConfig,
  musicTrainerEnabled,
  minCorpusSize,
  parseMusicAudioMetricsReceipt,
  parseMusicModelRoute,
  parseMusicTrainingEvaluation,
  pollMusicTraining,
  resolveTrainedAdapterForRender,
  rollbackMusicModelRoute,
  trainingDatasetHash,
  type MusicModelRouteState,
  type MusicTrainerConfig,
  type MusicTrainingEvaluationReceipt,
} from "@afrohit/ai";
import { kickoffMusicTraining } from "@afrohit/ai";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "./storage";
import {
  earHoldoutExclusions,
  type EarHoldoutExclusions,
} from "./ear-corpus";

/** EVALUATION SEAM (2026-07-19 night): the receipt shape, strict parser, key
 * constants, and the promotion decision are single-sourced in @afrohit/ai
 * (music-training-evaluation.ts) so the API admin seam and this flywheel can
 * never drift. Re-exported here so existing worker imports keep working. */
const TRAINING_WORKSPACE_ID = MUSIC_TRAINING_WORKSPACE_ID;
export { ACTIVE_MUSIC_MODEL_SETTING_KEY, MUSIC_TRAINING_EVALUATION_PREFIX, parseMusicTrainingEvaluation };
export type { MusicTrainingEvaluationReceipt };
export const LAST_MUSIC_DATASET_SETTING_KEY = "music.training.lastDataset.v1";

/** Cap one dataset so a nightly run cannot consume unbounded disk or egress. */
const MAX_DATASET_ASSETS = Math.max(
  1,
  Number.parseInt(process.env.MUSIC_TRAINER_MAX_ASSETS ?? "200", 10) || 200
);
const MAX_TRAINING_RETRIES = Math.max(
  0,
  Number.parseInt(process.env.MUSIC_TRAINER_MAX_RETRIES ?? "1", 10) || 0
);

type JsonRecord = Record<string, unknown>;

interface TrainingSource {
  id: string;
  origin: TrainingOrigin;
  workspaceId: string | null;
  url: string;
  contentFingerprint: string;
  sourceFamilyId: string;
  createdAt: Date;
}

interface TrainingConsentSnapshot {
  id: string;
  workspaceId: string;
  consentVersion: string;
  consentTextHash: string;
  signedAt: string;
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

async function ensureTrainingWorkspace(): Promise<void> {
  await prisma.workspace.upsert({
    where: { id: TRAINING_WORKSPACE_ID },
    create: {
      id: TRAINING_WORKSPACE_ID,
      name: "AfroOne Training",
      slug: "afroone-training-system",
    },
    update: {},
    select: { id: true },
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stableSourceFamilyId(input: {
  kind: "material" | "beat" | "vocal";
  id: string;
  songId?: string | null;
  meta?: unknown;
}): string {
  if (input.songId) return `song:${input.songId}`;
  const meta = record(input.meta);
  const explicit = meta.sourceFamilyId;
  if (
    typeof explicit === "string" &&
    /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/.test(explicit)
  )
    return explicit;
  for (const [field, prefix] of [
    ["originSongId", "song"],
    ["songId", "song"],
    ["originBeatId", "beat"],
    ["beatId", "beat"],
  ] as const) {
    const value = meta[field];
    if (typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value))
      return `${prefix}:${value}`;
  }
  return `${input.kind}:${input.id}`;
}

function emptyHoldoutExclusions(): EarHoldoutExclusions {
  return {
    sourceAssetIds: new Set(),
    sourceFamilyIds: new Set(),
    contentHashes: new Set(),
  };
}

async function loadEarHoldoutPolicy(): Promise<{
  exclusions: EarHoldoutExclusions;
  manifestHash: string | null;
}> {
  const required = process.env.EAR_HOLDOUT_REQUIRED === "1";
  const path = resolve(
    process.env.EAR_HOLDOUT_MANIFEST_PATH ??
      resolve(__dirname, "..", "..", "py", "fixtures", "manifest.json")
  );
  try {
    const bytes = await readFile(path);
    const exclusions = earHoldoutExclusions(JSON.parse(bytes.toString("utf8")));
    return {
      exclusions,
      manifestHash: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (required)
      throw new Error(
        `EAR_HOLDOUT_REQUIRED=1 but the frozen holdout is unavailable or invalid: ${(error as Error).message}`
      );
    return { exclusions: emptyHoldoutExclusions(), manifestHash: null };
  }
}

function jsonRecord(raw: string | null | undefined): JsonRecord {
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function readActiveMusicModelRoute(): Promise<MusicModelRouteState> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
  });
  return parseMusicModelRoute(row?.value);
}

/** The isolated dev-lane pointer — read/written by the promotion gate for
 * non-commercial-base candidates. NOTHING on a render path reads this. */
export async function readDevMusicModelRoute(): Promise<MusicModelRouteState> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: MUSIC_DEV_MODEL_SETTING_KEY },
  });
  return parseMusicModelRoute(row?.value);
}

/** Routing seam for inference consumers — PRODUCTION renders only.
 *
 * LICENSE LANE ENFORCEMENT (trainlegal): the pointer is honored ONLY when the
 * active entry sits in the 'production' lane. Legacy entries (promoted before
 * lanes existed) parse fail-closed to 'dev' — the pre-gate MusicGen fine-tune
 * is CC-BY-NC and may not back commercial renders, so it stops routing here
 * BY LAW, not by comment. A commercially-licensed promotion re-opens the tap. */
export async function resolveActiveMusicModelRef(): Promise<string | null> {
  return activeProductionModelRef(await readActiveMusicModelRoute());
}

/**
 * PER-GENRE/LANGUAGE ADAPTER ROUTE (trainlegal item 5) — flag-gated OFF by
 * default (MUSIC_ADAPTER_ROUTES_ENABLED=1 arms it). Resolves the matching
 * production-lane adapter for a render slice via the shared pure resolver in
 * @afrohit/ai providers/music.ts, falling back to the (lane-gated) base
 * pointer. Off or unreadable → the fallback, exactly today's behavior.
 */
export async function resolveTrainedAdapterRefForRender(input: {
  genre?: string | null;
  language?: string | null;
  fallback: string | null;
}): Promise<string | null> {
  if (process.env.MUSIC_ADAPTER_ROUTES_ENABLED !== "1") return input.fallback;
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: MUSIC_ADAPTER_ROUTE_SETTING_KEY },
    });
    const resolved = resolveTrainedAdapterForRender({
      routeTableRaw: row?.value ?? null,
      genre: input.genre,
      language: input.language,
      lane: "production",
      baseModelRef: input.fallback,
    });
    return resolved.modelRef;
  } catch {
    return input.fallback; // route table unavailable != render failure
  }
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
  // The shared builder is the ONLY receipt constructor (score 0-100, evaluator
  // required, binding by construction, strict re-parse) — same code as the API.
  const receipt = buildMusicTrainingEvaluationReceipt({
    candidateModelRef: output.candidateModelRef,
    datasetHash: jobInput.datasetHash,
    candidateScore: input.candidateScore,
    evaluator: input.evaluator,
    measuredAt: input.measuredAt,
    minGain: input.minGain,
  });
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
async function consentedWorkspaceIds(): Promise<Map<string, TrainingConsentSnapshot>> {
  const expectedHash = createHash("sha256")
    .update(TRAINING_LICENSE_CLAUSE, "utf8")
    .digest("hex");
  const rows = await prisma.trainingConsent.findMany({
    where: { revokedAt: null },
    select: {
      id: true,
      workspaceId: true,
      consentVersion: true,
      signedAt: true,
      consentTextHash: true,
      revokedAt: true,
    },
    orderBy: { signedAt: "desc" },
    take: 10_000,
  });
  const granted = new Map<string, TrainingConsentSnapshot>();
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
    if (
      verdict.granted &&
      verdict.current &&
      typeof row.consentTextHash === "string" &&
      /^[a-f0-9]{64}$/i.test(row.consentTextHash)
    ) {
      granted.set(row.workspaceId, {
        id: row.id,
        workspaceId: row.workspaceId,
        consentVersion: row.consentVersion,
        consentTextHash: row.consentTextHash,
        signedAt: row.signedAt.toISOString(),
      });
    }
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
  consents: Map<string, TrainingConsentSnapshot>;
}> {
  const take = 5_000;
  // Keep this scan sequential. The flywheel runs off-peak and reliability is
  // more important than opening four simultaneous production DB connections,
  // especially through managed Postgres public proxies.
  const materials = await prisma.materialAsset.findMany({
      where: { readiness: "ready", qualityState: { notIn: ["failed", "duplicate"] } },
      select: {
        id: true,
        source: true,
        rightsBasis: true,
        url: true,
        contentHash: true,
        meta: true,
        workspaceId: true,
        createdAt: true,
      },
      take,
    });
  const beats = await prisma.beatAsset.findMany({
      where: { approved: true },
      select: {
        id: true,
        provider: true,
        meta: true,
        url: true,
        contentHash: true,
        songId: true,
        createdAt: true,
        project: { select: { workspaceId: true } },
      },
      take,
    });
  const vocals = await prisma.vocalRender.findMany({
      where: { approved: true },
      select: {
        id: true,
        performanceSource: true,
        url: true,
        contentHash: true,
        songId: true,
        createdAt: true,
        project: { select: { workspaceId: true } },
      },
      take,
    });
  const granted = await consentedWorkspaceIds();

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

  const outsideRenderLearning = await isOutsideRenderLearningEnabled();
  if (outsideRenderLearning) {
    console.log(
      "[flywheel] outside-render learning is ON for reference analysis; third-party render bytes remain excluded from model training"
    );
  }
  // Provider output can teach metadata and evaluation, never model weights.
  // The final trainer gate already enforces this; keeping the manifest equally
  // strict prevents an operator setting from creating a contradictory corpus.
  const policy = { allowThirdPartyRenders: false };
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
      workspaceId: row.workspaceId,
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      sourceFamilyId: stableSourceFamilyId({
        kind: "material",
        id: row.id,
        meta: row.meta,
      }),
      createdAt: row.createdAt,
    });
  }
  for (const row of beats) {
    sources.set(`beat:${row.id}`, {
      workspaceId: row.project?.workspaceId ?? null,
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      sourceFamilyId: stableSourceFamilyId({
        kind: "beat",
        id: row.id,
        songId: row.songId,
        meta: row.meta,
      }),
      createdAt: row.createdAt,
    });
  }
  for (const row of vocals) {
    sources.set(`vocal:${row.id}`, {
      workspaceId: row.project?.workspaceId ?? null,
      url: row.url,
      contentFingerprint: row.contentHash?.trim() || row.url,
      sourceFamilyId: stableSourceFamilyId({
        kind: "vocal",
        id: row.id,
        songId: row.songId,
      }),
      createdAt: row.createdAt,
    });
  }
  console.log(
    `[flywheel] consent door: ${granted.size} workspace(s) granted; eligible ${manifest.eligible.length} of ${manifest.counts.total}`
  );
  return { manifest, sources, consents: granted };
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

async function durableRetryCount(
  job: TrainingJobRow,
  output: JsonRecord
): Promise<number> {
  if (Number.isFinite(Number(output.retryCount))) {
    return Math.max(0, Math.trunc(Number(output.retryCount)));
  }
  // Compatibility for a job retried by the first production rollout before
  // retryCount was copied into every phase: the old completion marker retains
  // the first provider ID, so a different current ID proves one retry occurred.
  const remembered = await prisma.systemSetting.findUnique({
    where: { key: LAST_MUSIC_DATASET_SETTING_KEY },
    select: { value: true },
  });
  const last = jsonRecord(remembered?.value);
  return last.providerJobId === job.id &&
    typeof last.trainingId === "string" &&
    typeof job.externalId === "string" &&
    last.trainingId !== job.externalId
    ? 1
    : 0;
}

async function kickoffQueuedJob(job: TrainingJobRow): Promise<{ pending: boolean; reason: string }> {
  const input = record(job.inputJson);
  const priorOutput = record(job.outputJson);
  const retryCount = Number.isFinite(Number(priorOutput.retryCount))
    ? Math.max(0, Math.trunc(Number(priorOutput.retryCount)))
    : 0;
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
        retryCount,
        claimedAt: claimTime.toISOString(),
      } as never,
    },
  });
  if (claimed.count !== 1) {
    return { pending: true, reason: "training kickoff already claimed by another worker" };
  }

  try {
    const providerDatasetUrl = await resolveAssetForProvider(datasetZipUrl);
    const result = await kickoffMusicTraining({
      manifest,
      datasetZipUrl: providerDatasetUrl,
    });
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
          retryCount,
          startedAt: claimTime.toISOString(),
        } as never,
        errorJson: undefined,
      },
    });
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

async function retryFailedTrainingJob(job: TrainingJobRow): Promise<{
  pending: boolean;
  reason: string;
  trainingId?: string;
}> {
  const output = record(job.outputJson);
  const retryCount = Number.isFinite(Number(output.retryCount))
    ? Math.max(0, Math.trunc(Number(output.retryCount)))
    : 0;
  if (retryCount >= MAX_TRAINING_RETRIES) {
    return {
      pending: false,
      reason: `training retry limit reached (${retryCount}/${MAX_TRAINING_RETRIES})`,
    };
  }
  const queued = await prisma.providerJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      externalId: null,
      startedAt: null,
      finishedAt: null,
      errorJson: Prisma.DbNull,
      outputJson: {
        phase: "retry_queued",
        retryCount: retryCount + 1,
        queuedAt: new Date().toISOString(),
      } as never,
    },
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
    },
  });
  const result = await kickoffQueuedJob(queued as TrainingJobRow);
  const refreshed = await prisma.providerJob.findUnique({
    where: { id: queued.id },
    select: { externalId: true },
  });
  return {
    ...result,
    trainingId: refreshed?.externalId ?? undefined,
  };
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
  const currentDev = await readDevMusicModelRoute();
  // MEASURED AUDIO (trainlegal item 3): an optional, candidate-bound receipt
  // persisted by the audio-metrics harness. Absent/unbound => text-only path.
  const audioMetricsRow = await prisma.systemSetting.findUnique({
    where: { key: `${MUSIC_TRAINING_AUDIO_METRICS_PREFIX}${job.id}` },
  });
  // SHARED GATE (single source of truth in @afrohit/ai): minGain resolution,
  // the win-by-minGain rule, the already-active hold, the LICENSE LANE split
  // (cc-by-nc/unknown bases can only win the isolated dev pointer), the audio
  // referee, and route construction are decided by the same pure code the API
  // admin seam runs.
  const decision = decideMusicCandidatePromotion({
    candidate: {
      providerJobId: job.id,
      candidateModelRef,
      trainingId,
      datasetHash,
      trainerModel: typeof input.trainerModel === "string" ? input.trainerModel : null,
    },
    evaluation,
    currentRoute: current,
    currentDevRoute: currentDev,
    audioMetrics: parseMusicAudioMetricsReceipt(audioMetricsRow?.value),
  });
  const evaluatedOutput = { ...output, evaluation: decision.evaluationSummary };

  // DEV-LANE PROMOTION: a real measured win, but the base model's license is
  // non-commercial — the PRODUCTION pointer is untouched by construction
  // (decision.route stays null); only the isolated dev pointer moves.
  if (decision.verdict === "promoted_dev" && decision.devRoute) {
    const devRoute = decision.devRoute;
    await prisma.$transaction([
      prisma.systemSetting.upsert({
        where: { key: MUSIC_DEV_MODEL_SETTING_KEY },
        create: { key: MUSIC_DEV_MODEL_SETTING_KEY, value: JSON.stringify(devRoute) },
        update: { value: JSON.stringify(devRoute) },
      }),
      prisma.providerJob.update({
        where: { id: job.id },
        data: {
          outputJson: {
            ...evaluatedOutput,
            phase: "promoted_dev",
            devModelRef: devRoute.active?.modelRef,
            previousDevModelRef: devRoute.previous?.modelRef ?? null,
            licenseReceipt: decision.licenseReceipt,
            promotedAt: devRoute.updatedAt,
          } as never,
          finishedAt: new Date(),
        },
      }),
    ]);
    console.log(`[flywheel] promoted ${candidateModelRef} to the DEV lane only — ${decision.licenseReceipt}`);
    return { pending: false, reason: decision.reason, candidateModelRef };
  }

  if (decision.verdict !== "promoted" || !decision.route) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: { ...evaluatedOutput, phase: "rejected", decision: decision.reason } as never,
        finishedAt: new Date(),
      },
    });
    return { pending: false, reason: decision.reason, candidateModelRef };
  }

  const route = decision.route;
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
          licenseReceipt: decision.licenseReceipt,
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
  const retryCount = await durableRetryCount(job, output);
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
            retryCount,
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
            retryCount,
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
            retryCount,
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
      retryCount,
      providerStatus: state.status,
      candidateModelRef,
      datasetHash: input.datasetHash,
      evaluationKey: `${MUSIC_TRAINING_EVALUATION_PREFIX}${job.id}`,
      providerOutput: state.output,
      metrics: state.metrics,
      completedAt: new Date().toISOString(),
    };
    if (
      typeof input.catalogHash === "string" &&
      typeof input.datasetHash === "string"
    ) {
      await rememberLastDataset({
        catalogHash: input.catalogHash,
        datasetHash: input.datasetHash,
        providerJobId: job.id,
        trainingId,
      });
    }
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
          retryCount,
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
  await ensureTrainingWorkspace();

  const { manifest, sources, consents } = await liveManifest();
  const holdout = await loadEarHoldoutPolicy();
  const heldOut = (asset: TrainingSource): boolean =>
    holdout.exclusions.sourceAssetIds.has(asset.id.toLowerCase()) ||
    holdout.exclusions.sourceFamilyIds.has(asset.sourceFamilyId.toLowerCase()) ||
    holdout.exclusions.contentHashes.has(asset.contentFingerprint.toLowerCase());
  const selected: TrainingSource[] = manifest.eligible
    .map(asset => {
      const source = sources.get(asset.id);
      return source ? { ...asset, ...source } : null;
    })
    .filter((asset): asset is TrainingSource => !!asset)
    .filter(asset => !heldOut(asset))
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
    const lastJob = typeof last.providerJobId === "string"
      ? await prisma.providerJob.findUnique({
          where: { id: last.providerJobId },
          select: {
            id: true,
            status: true,
            externalId: true,
            inputJson: true,
            outputJson: true,
          },
        })
      : null;
    if (lastJob?.status === "FAILED" || lastJob?.status === "CANCELED") {
      const retried = await retryFailedTrainingJob(lastJob as TrainingJobRow);
      return {
        ran: retried.pending,
        reason: retried.reason,
        eligible: manifest.eligible.length,
        trainingId: retried.trainingId,
        datasetHash:
          typeof last.datasetHash === "string" ? last.datasetHash : undefined,
      };
    }
    if (lastJob) {
      console.log(`[flywheel] dataset unchanged (${catalogHash.slice(0, 12)}); no retraining`);
      return {
        ran: false,
        reason: "dataset unchanged",
        eligible: manifest.eligible.length,
        datasetHash: typeof last.datasetHash === "string" ? last.datasetHash : undefined,
      };
    }
  }

  const zip = new JSZip();
  const zippedAssets: Array<TrainingSource & { audioHash: string }> = [];
  for (const asset of selected) {
    try {
      const bytes = await downloadToBuffer(asset.url);
      const audioHash = createHash("sha256").update(bytes).digest("hex");
      if (holdout.exclusions.contentHashes.has(audioHash)) {
        console.warn(`[flywheel] excluded frozen holdout bytes from ${asset.id}`);
        continue;
      }
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

  const trainingAssets = zippedAssets.map(asset => ({
    id: asset.id,
    origin: asset.origin,
    workspaceId: asset.workspaceId,
    contentHash: asset.audioHash,
    sourceFamilyId: asset.sourceFamilyId,
  }));
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
  const trainingConsentSnapshot = [...new Set(
    trainingAssets
      .filter(asset => asset.origin === "user-original")
      .map(asset => asset.workspaceId)
      .filter((workspaceId): workspaceId is string => Boolean(workspaceId))
  )]
    .map(workspaceId => consents.get(workspaceId))
    .filter((receipt): receipt is TrainingConsentSnapshot => Boolean(receipt))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  const consentedUserWorkspaces = new Set(
    trainingConsentSnapshot.map(receipt => receipt.workspaceId)
  );
  const unboundUserAssets = trainingAssets.filter(
    asset =>
      asset.origin === "user-original" &&
      (!asset.workspaceId || !consentedUserWorkspaces.has(asset.workspaceId))
  );
  if (unboundUserAssets.length > 0) {
    throw new Error(
      `refusing to train: ${unboundUserAssets.length} user-original asset(s) lack a current consent receipt`
    );
  }
  const consentSnapshotHash = createHash("sha256")
    .update(JSON.stringify(trainingConsentSnapshot), "utf8")
    .digest("hex");
  const duplicate = await prisma.providerJob.findFirst({
    where: {
      workspaceId: TRAINING_WORKSPACE_ID,
      kind: "music-training",
      idempotencyKey,
    },
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
    },
  });
  if (duplicate) {
    if (duplicate.status === "FAILED" || duplicate.status === "CANCELED") {
      const retried = await retryFailedTrainingJob(duplicate as TrainingJobRow);
      return {
        ran: retried.pending,
        reason: retried.reason,
        eligible: manifest.eligible.length,
        zipped: zippedAssets.length,
        datasetHash,
        trainingId: retried.trainingId,
      };
    }
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
  const receipt = await prisma.providerJob
    .upsert({
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
          holdoutManifestHash: holdout.manifestHash,
          trainingConsentSnapshot,
          consentSnapshotHash,
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
    })
    .catch(async error => {
      await deleteObjectByUrl(datasetZipUrl).catch(() => undefined);
      throw error;
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
