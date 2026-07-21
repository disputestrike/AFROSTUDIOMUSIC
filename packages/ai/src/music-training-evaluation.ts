/**
 * TRAINING EVALUATION SEAM — the single source of truth for the candidate
 * score receipt and the promotion decision (owner order 2026-07-19 night:
 * "awaiting evaluation" must not mean waiting forever).
 *
 * WHY THIS FILE: the worker's nightly flywheel (apps/worker lib/training-
 * flywheel.ts) and the API's admin seam (apps/api lib/training-evaluation.ts)
 * both score candidates against the SAME gate. apps/api cannot import from
 * apps/worker, so everything validation-critical lives HERE and both sides are
 * thin prisma wrappers around it:
 *   - the receipt shape + strict parser (a score is useless unless bound to the
 *     exact candidate artifact AND the exact corpus hash),
 *   - the receipt builder (score 0-100, evaluator required, minGain 0-100),
 *   - the promotion decision (evaluateAndPromote + route construction), which
 *     FAILS CLOSED on a receipt that names a different model or dataset.
 * Neither side may re-implement any of this. SystemSetting keys and the
 * ProviderJob identity (workspace 'training', kind 'music-training') are also
 * pinned here so the two processes can never drift onto different rows.
 */
import {
  emptyMusicModelRoute,
  evaluateAndPromote,
  promoteMusicModelRoute,
  type MusicModelRouteState,
} from './music-trainer';
import {
  classifyModelLicense,
  laneForBaseModel,
  licenseGateReceipt,
  type ModelLicense,
  type RouteLane,
} from './music-license';
import { audioMetricsEnabled, audioMetricsGate } from './audio-metrics';

/** ProviderJob identity of every music-training receipt (worker + API). */
export const MUSIC_TRAINING_WORKSPACE_ID = 'training';
export const MUSIC_TRAINING_JOB_KIND = 'music-training';
/** Candidate lifecycle phases stamped into ProviderJob.outputJson.phase. */
export const MUSIC_TRAINING_CANDIDATE_READY_PHASE = 'candidate_ready';
export const MUSIC_TRAINING_PROMOTED_PHASE = 'promoted';
/** DEV-LANE promotion (trainlegal): a candidate whose BASE model license is
 *  non-commercial (or unknown) can only ever win the isolated dev pointer. */
export const MUSIC_TRAINING_PROMOTED_DEV_PHASE = 'promoted_dev';
export const MUSIC_TRAINING_REJECTED_PHASE = 'rejected';

/** SystemSetting keys — the durable route pointers and per-job receipts. */
export const ACTIVE_MUSIC_MODEL_SETTING_KEY = 'music.training.activeModel.v1';
/** The ISOLATED dev-lane pointer. NOTHING on a commercial render path may ever
 *  read this key — it exists so non-commercial-base experiments still have a
 *  measured, reversible route without touching production. */
export const MUSIC_DEV_MODEL_SETTING_KEY = 'music.training.devModel.v1';
/** Per-(genre|language) adapter route table (music-license.ts shapes). */
export const MUSIC_ADAPTER_ROUTE_SETTING_KEY = 'music.training.adapterRoutes.v1';
export const MUSIC_TRAINING_EVALUATION_PREFIX = 'music.training.evaluation.v1.';
/** Optional measured-audio receipt persisted by the audio-metrics harness. */
export const MUSIC_TRAINING_AUDIO_METRICS_PREFIX = 'music.training.audioMetrics.v1.';

export function musicTrainingEvaluationKey(providerJobId: string): string {
  return `${MUSIC_TRAINING_EVALUATION_PREFIX}${providerJobId}`;
}

export function musicTrainingAudioMetricsKey(providerJobId: string): string {
  return `${MUSIC_TRAINING_AUDIO_METRICS_PREFIX}${providerJobId}`;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export interface MusicTrainingEvaluationReceipt {
  candidateModelRef: string;
  datasetHash: string;
  candidateScore: number;
  evaluator: string;
  measuredAt: string;
  minGain?: number;
}

/** A finite 0-100 score or null — the only score shape the gate accepts. */
export function finiteEvaluationScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
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
    const candidateScore = finiteEvaluationScore(value.candidateScore);
    const minGain = value.minGain == null ? undefined : finiteEvaluationScore(value.minGain);
    if (
      typeof value.candidateModelRef !== 'string' || !value.candidateModelRef.trim() ||
      typeof value.datasetHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.datasetHash) ||
      candidateScore == null ||
      typeof value.evaluator !== 'string' || !value.evaluator.trim() ||
      typeof value.measuredAt !== 'string' || !Number.isFinite(Date.parse(value.measuredAt)) ||
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

/**
 * Build a valid receipt or THROW (statusCode 400/409 attached for API callers).
 * candidateModelRef/datasetHash come from the candidate's own durable receipt,
 * never from the operator — the binding is by construction, then re-verified by
 * the strict parser so builder and parser can never disagree.
 */
export function buildMusicTrainingEvaluationReceipt(input: {
  candidateModelRef: unknown;
  datasetHash: unknown;
  candidateScore: number;
  evaluator: string;
  measuredAt?: string;
  minGain?: number;
}): MusicTrainingEvaluationReceipt {
  const score = finiteEvaluationScore(input.candidateScore);
  const minGain = input.minGain == null ? undefined : finiteEvaluationScore(input.minGain);
  if (score == null) {
    throw Object.assign(new Error('music training score must be between 0 and 100'), { statusCode: 400 });
  }
  if (input.minGain != null && minGain == null) {
    throw Object.assign(new Error('music training minimum gain must be between 0 and 100'), { statusCode: 400 });
  }
  if (!input.evaluator.trim()) {
    throw Object.assign(new Error('music training evaluation requires an evaluator'), { statusCode: 400 });
  }
  if (typeof input.candidateModelRef !== 'string' || typeof input.datasetHash !== 'string') {
    throw Object.assign(new Error('music training candidate receipt is incomplete'), { statusCode: 409 });
  }
  const receipt: MusicTrainingEvaluationReceipt = {
    candidateModelRef: input.candidateModelRef,
    datasetHash: input.datasetHash,
    candidateScore: score,
    evaluator: input.evaluator.trim(),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
    ...(minGain == null ? {} : { minGain }),
  };
  if (!parseMusicTrainingEvaluation(JSON.stringify(receipt))) {
    throw Object.assign(new Error('music training evaluation receipt is invalid'), { statusCode: 409 });
  }
  return receipt;
}

/**
 * MEASURED-AUDIO RECEIPT (trainlegal, item 3) — what the audio-metrics harness
 * persists beside a candidate. Like the score receipt it is BOUND to the exact
 * candidate artifact + corpus hash; an unbound receipt parses to null and can
 * never influence a different candidate's promotion.
 */
export interface MusicAudioMetricsReceipt {
  candidateModelRef: string;
  datasetHash: string;
  /** FAD-CLAP vs the AfroRef reference set (lower = closer). Null = not run. */
  fadClap: number | null;
  /** Lyric WER on a rendered vocal clip (lower = better). Null = not run. */
  lyricWer: number | null;
  measuredAt: string;
  /** Cost/model receipt lines from the harness (auditable spend trail). */
  receipts: string[];
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Strict parser — fail-closed like every receipt in this file. */
export function parseMusicAudioMetricsReceipt(
  raw: string | null | undefined
): MusicAudioMetricsReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as JsonRecord;
    if (
      typeof value.candidateModelRef !== 'string' || !value.candidateModelRef.trim() ||
      typeof value.datasetHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.datasetHash) ||
      typeof value.measuredAt !== 'string' || !Number.isFinite(Date.parse(value.measuredAt)) ||
      (value.fadClap != null && finiteNonNegative(value.fadClap) == null) ||
      (value.lyricWer != null && finiteNonNegative(value.lyricWer) == null)
    ) return null;
    const receipts = Array.isArray(value.receipts)
      ? value.receipts.filter((line): line is string => typeof line === 'string').slice(0, 50)
      : [];
    return {
      candidateModelRef: value.candidateModelRef.trim(),
      datasetHash: value.datasetHash,
      fadClap: value.fadClap == null ? null : finiteNonNegative(value.fadClap),
      lyricWer: value.lyricWer == null ? null : finiteNonNegative(value.lyricWer),
      measuredAt: value.measuredAt,
      receipts,
    };
  } catch {
    return null;
  }
}

/** Receipt minGain wins; else MUSIC_TRAINER_PROMOTION_MIN_GAIN; else 1. */
export function resolveMusicPromotionMinGain(receiptMinGain?: number): number {
  const configuredGain = Number(process.env.MUSIC_TRAINER_PROMOTION_MIN_GAIN ?? '1');
  return receiptMinGain ?? (
    Number.isFinite(configuredGain) && configuredGain >= 0 ? configuredGain : 1
  );
}

/** The durable identity of one trained candidate, read from its ProviderJob. */
export interface MusicTrainingCandidate {
  providerJobId: string;
  candidateModelRef: string;
  datasetHash: string;
  trainingId: string;
  /** The trainer/base model that produced this adapter (license provenance);
   *  null on legacy receipts — the license gate then fails closed to dev. */
  trainerModel: string | null;
  phase: string | null;
  evaluationKey: string;
  evaluationError: string | null;
  output: JsonRecord;
}

/** Extract a candidate identity from a music-training ProviderJob row, or null
 * when the receipt is incomplete (missing model, dataset, or training id). */
export function musicTrainingCandidateFromJob(job: {
  id: string;
  externalId?: string | null;
  inputJson?: unknown;
  outputJson?: unknown;
}): MusicTrainingCandidate | null {
  const output = record(job.outputJson);
  const input = record(job.inputJson);
  const candidateModelRef =
    typeof output.candidateModelRef === 'string' && output.candidateModelRef.trim()
      ? output.candidateModelRef
      : null;
  const datasetHash = typeof input.datasetHash === 'string' ? input.datasetHash : null;
  const trainingId =
    typeof output.trainingId === 'string' && output.trainingId
      ? output.trainingId
      : typeof job.externalId === 'string' && job.externalId
        ? job.externalId
        : null;
  if (!candidateModelRef || !datasetHash || !trainingId) return null;
  return {
    providerJobId: job.id,
    candidateModelRef,
    datasetHash,
    trainingId,
    trainerModel:
      typeof input.trainerModel === 'string' && input.trainerModel.trim()
        ? input.trainerModel
        : null,
    phase: typeof output.phase === 'string' ? output.phase : null,
    evaluationKey: musicTrainingEvaluationKey(job.id),
    evaluationError: typeof output.evaluationError === 'string' ? output.evaluationError : null,
    output,
  };
}

/** What gets persisted beside the candidate receipt after a decision. */
export interface MusicCandidateEvaluationSummary extends MusicTrainingEvaluationReceipt {
  incumbentModelRef: string | null;
  incumbentScore: number | null;
  minGain: number;
  promote: boolean;
  reason: string;
  /** LICENSE LANE (trainlegal): where this candidate is ALLOWED to live. */
  lane: RouteLane;
  license: ModelLicense;
  /** Every receipt behind the decision — the license gate line always leads;
   *  measured-audio lines follow when the metrics gate ran. */
  receipts: string[];
}

export interface MusicCandidatePromotionDecision {
  verdict: 'mismatch' | 'rejected' | 'promoted' | 'promoted_dev';
  /** True ONLY for a PRODUCTION promotion. A dev-lane win is real but must
   *  never read as "the commercial route changed". */
  promoted: boolean;
  reason: string;
  minGain: number;
  lane: RouteLane;
  license: ModelLicense;
  /** The exact license-gate receipt string (also receipts[0]). */
  licenseReceipt: string;
  receipts: string[];
  evaluationSummary: MusicCandidateEvaluationSummary;
  /** The new PRODUCTION route — non-null ONLY when verdict is 'promoted'. */
  route: MusicModelRouteState | null;
  /** The new DEV-lane route — non-null ONLY when verdict is 'promoted_dev'. */
  devRoute: MusicModelRouteState | null;
}

/**
 * THE PROMOTION GATE, decided in one place. Fails closed on a receipt bound to
 * a different artifact or corpus; holds the incumbent on ties, regressions, and
 * re-scores of the already-active model; promotes only a measured win of at
 * least minGain (receipt override, else env, else 1). Pure — callers persist.
 *
 * LICENSE LAW (trainlegal, code-enforced): the candidate's BASE model license
 * decides its lane BEFORE any score is read. A cc-by-nc base (MusicGen) or an
 * unknown base can ONLY ever reach the isolated dev route ('promoted_dev',
 * devRoute) — `route` (the commercial production pointer) stays null for it on
 * every path, no override, no env, no operator flag.
 *
 * MEASURED AUDIO (item 3): when AUDIO_METRICS_ENABLED=1 and a bound audio
 * receipt is supplied, the WER/FAD thresholds referee the text score — a
 * candidate that fails them cannot promote in ANY lane. With the gate off the
 * text-only path is byte-for-byte the previous behavior.
 */
export function decideMusicCandidatePromotion(input: {
  candidate: {
    providerJobId: string;
    candidateModelRef: string;
    trainingId: string;
    datasetHash: string;
    /** Trainer/base model ref (license provenance). Absent → fail-closed dev. */
    trainerModel?: string | null;
  };
  evaluation: MusicTrainingEvaluationReceipt;
  currentRoute: MusicModelRouteState;
  /** The dev-lane pointer — incumbent for dev-lane candidates. */
  currentDevRoute?: MusicModelRouteState;
  /** Optional measured-audio receipt (strictly parsed, candidate-bound). */
  audioMetrics?: MusicAudioMetricsReceipt | null;
  at?: string;
}): MusicCandidatePromotionDecision {
  const { candidate, evaluation, currentRoute } = input;
  const minGain = resolveMusicPromotionMinGain(evaluation.minGain);

  // 1. LICENSE GATE FIRST — the lane is a legal fact, not a quality outcome.
  //    Classify the trainer base when recorded; otherwise the candidate ref
  //    itself. Anything not positively commercial lands in the dev lane.
  const licenseSource = candidate.trainerModel ?? candidate.candidateModelRef;
  const license = classifyModelLicense(licenseSource);
  const lane = laneForBaseModel(licenseSource);
  const licenseReceipt = licenseGateReceipt(licenseSource);
  const receipts: string[] = [licenseReceipt];

  // The incumbent this candidate competes against lives in ITS OWN lane.
  const laneRoute =
    lane === 'production' ? currentRoute : input.currentDevRoute ?? emptyMusicModelRoute();

  const summaryBase = {
    ...evaluation,
    incumbentModelRef: laneRoute.active?.modelRef ?? null,
    incumbentScore: laneRoute.active?.score ?? null,
    minGain,
    lane,
    license,
  };
  const decide = (
    verdict: MusicCandidatePromotionDecision['verdict'],
    reason: string,
    routes: { route?: MusicModelRouteState | null; devRoute?: MusicModelRouteState | null },
    promote: boolean
  ): MusicCandidatePromotionDecision => ({
    verdict,
    promoted: verdict === 'promoted',
    reason,
    minGain,
    lane,
    license,
    licenseReceipt,
    receipts,
    evaluationSummary: { ...summaryBase, promote, reason, receipts },
    route: routes.route ?? null,
    devRoute: routes.devRoute ?? null,
  });

  if (
    evaluation.candidateModelRef !== candidate.candidateModelRef ||
    evaluation.datasetHash !== candidate.datasetHash
  ) {
    return decide(
      'mismatch',
      'score receipt does not match candidate model and dataset hash',
      {},
      false
    );
  }

  // 2. MEASURED-AUDIO REFEREE (flag-gated; off => text-only path unchanged).
  if (audioMetricsEnabled() && input.audioMetrics) {
    const metrics = input.audioMetrics;
    if (
      metrics.candidateModelRef !== candidate.candidateModelRef ||
      metrics.datasetHash !== candidate.datasetHash
    ) {
      receipts.push(
        'audio metrics receipt ignored: bound to a different candidate/dataset (fail-soft — text judge decides alone)'
      );
    } else {
      const audioGate = audioMetricsGate({
        fadClap: metrics.fadClap,
        lyricWer: metrics.lyricWer,
      });
      receipts.push(...metrics.receipts, ...audioGate.notes);
      if (audioGate.block) {
        receipts.push(...audioGate.reasons);
        return decide('rejected', audioGate.reasons.join('; '), {}, false);
      }
    }
  }

  // 3. THE MEASURED WIN, judged against the lane's own incumbent.
  const gate = evaluateAndPromote({
    candidateScore: evaluation.candidateScore,
    incumbentScore: laneRoute.active?.score ?? null,
    minGain,
  });
  if (!gate.promote || laneRoute.active?.modelRef === candidate.candidateModelRef) {
    const reason = laneRoute.active?.modelRef === candidate.candidateModelRef
      ? 'candidate is already the active model'
      : gate.reason;
    return decide('rejected', reason, {}, gate.promote);
  }
  const promotedRoute = promoteMusicModelRoute({
    current: laneRoute,
    candidate: {
      modelRef: candidate.candidateModelRef,
      providerJobId: candidate.providerJobId,
      trainingId: candidate.trainingId,
      datasetHash: candidate.datasetHash,
      score: evaluation.candidateScore,
      evaluatedAt: evaluation.measuredAt,
      lane,
      license,
    },
    reason: gate.reason,
    at: input.at,
  });
  // 4. HARD LANE SPLIT: a dev-lane candidate NEVER touches `route` (the
  //    production pointer) — the block is this branch, not a comment.
  return lane === 'production'
    ? decide('promoted', gate.reason, { route: promotedRoute }, true)
    : decide(
        'promoted_dev',
        `${gate.reason} — dev lane only: ${licenseReceipt}`,
        { devRoute: promotedRoute },
        true
      );
}
