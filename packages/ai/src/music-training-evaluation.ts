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
  evaluateAndPromote,
  promoteMusicModelRoute,
  type MusicModelRouteState,
} from './music-trainer';

/** ProviderJob identity of every music-training receipt (worker + API). */
export const MUSIC_TRAINING_WORKSPACE_ID = 'training';
export const MUSIC_TRAINING_JOB_KIND = 'music-training';
/** Candidate lifecycle phases stamped into ProviderJob.outputJson.phase. */
export const MUSIC_TRAINING_CANDIDATE_READY_PHASE = 'candidate_ready';
export const MUSIC_TRAINING_PROMOTED_PHASE = 'promoted';
export const MUSIC_TRAINING_REJECTED_PHASE = 'rejected';

/** SystemSetting keys — the durable route pointer and per-job score receipts. */
export const ACTIVE_MUSIC_MODEL_SETTING_KEY = 'music.training.activeModel.v1';
export const MUSIC_TRAINING_EVALUATION_PREFIX = 'music.training.evaluation.v1.';

export function musicTrainingEvaluationKey(providerJobId: string): string {
  return `${MUSIC_TRAINING_EVALUATION_PREFIX}${providerJobId}`;
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
}

export interface MusicCandidatePromotionDecision {
  verdict: 'mismatch' | 'rejected' | 'promoted';
  promoted: boolean;
  reason: string;
  minGain: number;
  evaluationSummary: MusicCandidateEvaluationSummary;
  /** The new route state — non-null ONLY when verdict is 'promoted'. */
  route: MusicModelRouteState | null;
}

/**
 * THE PROMOTION GATE, decided in one place. Fails closed on a receipt bound to
 * a different artifact or corpus; holds the incumbent on ties, regressions, and
 * re-scores of the already-active model; promotes only a measured win of at
 * least minGain (receipt override, else env, else 1). Pure — callers persist.
 */
export function decideMusicCandidatePromotion(input: {
  candidate: {
    providerJobId: string;
    candidateModelRef: string;
    trainingId: string;
    datasetHash: string;
  };
  evaluation: MusicTrainingEvaluationReceipt;
  currentRoute: MusicModelRouteState;
  at?: string;
}): MusicCandidatePromotionDecision {
  const { candidate, evaluation, currentRoute } = input;
  const minGain = resolveMusicPromotionMinGain(evaluation.minGain);
  const summaryBase = {
    ...evaluation,
    incumbentModelRef: currentRoute.active?.modelRef ?? null,
    incumbentScore: currentRoute.active?.score ?? null,
    minGain,
  };
  if (
    evaluation.candidateModelRef !== candidate.candidateModelRef ||
    evaluation.datasetHash !== candidate.datasetHash
  ) {
    const reason = 'score receipt does not match candidate model and dataset hash';
    return {
      verdict: 'mismatch',
      promoted: false,
      reason,
      minGain,
      evaluationSummary: { ...summaryBase, promote: false, reason },
      route: null,
    };
  }
  const gate = evaluateAndPromote({
    candidateScore: evaluation.candidateScore,
    incumbentScore: currentRoute.active?.score ?? null,
    minGain,
  });
  const evaluationSummary: MusicCandidateEvaluationSummary = {
    ...summaryBase,
    promote: gate.promote,
    reason: gate.reason,
  };
  if (!gate.promote || currentRoute.active?.modelRef === candidate.candidateModelRef) {
    const reason = currentRoute.active?.modelRef === candidate.candidateModelRef
      ? 'candidate is already the active model'
      : gate.reason;
    return { verdict: 'rejected', promoted: false, reason, minGain, evaluationSummary, route: null };
  }
  const route = promoteMusicModelRoute({
    current: currentRoute,
    candidate: {
      modelRef: candidate.candidateModelRef,
      providerJobId: candidate.providerJobId,
      trainingId: candidate.trainingId,
      datasetHash: candidate.datasetHash,
      score: evaluation.candidateScore,
      evaluatedAt: evaluation.measuredAt,
    },
    reason: gate.reason,
    at: input.at,
  });
  return {
    verdict: 'promoted',
    promoted: true,
    reason: gate.reason,
    minGain,
    evaluationSummary,
    route,
  };
}
