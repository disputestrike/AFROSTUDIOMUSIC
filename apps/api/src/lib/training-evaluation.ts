/**
 * TRAINING EVALUATION SEAM (API side) — closes the loop the owner ordered shut
 * on 2026-07-19 night: a finished candidate sat at "awaiting evaluation"
 * forever because submitMusicTrainingEvaluation lived only in the worker with
 * no route, no UI, no caller.
 *
 * apps/api cannot import from apps/worker, so EVERYTHING validation-critical —
 * the receipt shape + strict parser, the receipt builder, the promotion
 * decision, and the SystemSetting keys — is single-sourced in @afrohit/ai
 * (music-training-evaluation.ts) and shared with the worker's flywheel. This
 * file is only the thin prisma plumbing around that shared seam: find the
 * candidate receipt, persist the score, apply the decided route/phase writes.
 * It re-implements NO validation and NO gate math.
 */
import { prisma } from '@afrohit/db';
import {
  ACTIVE_MUSIC_MODEL_SETTING_KEY,
  MUSIC_TRAINING_CANDIDATE_READY_PHASE,
  MUSIC_TRAINING_JOB_KIND,
  MUSIC_TRAINING_PROMOTED_PHASE,
  MUSIC_TRAINING_REJECTED_PHASE,
  MUSIC_TRAINING_WORKSPACE_ID,
  buildMusicTrainingEvaluationReceipt,
  decideMusicCandidatePromotion,
  musicTrainingCandidateFromJob,
  musicTrainingEvaluationKey,
  parseMusicModelRoute,
  parseMusicTrainingEvaluation,
  rollbackMusicModelRoute,
  type MusicModelRouteState,
  type MusicTrainingEvaluationReceipt,
} from '@afrohit/ai';

function seamError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** The same durable route pointer the worker reads/writes — same key, same parser. */
export async function readActiveMusicModelRoute(): Promise<MusicModelRouteState> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
  });
  return parseMusicModelRoute(row?.value);
}

export interface TrainingCandidateRow {
  providerJobId: string;
  candidateModelRef: string;
  datasetHash: string;
  trainingId: string;
  createdAt: string;
  finishedAt: string | null;
  phase: string | null;
  active: boolean;
  evaluation: MusicTrainingEvaluationReceipt | null;
  evaluationError: string | null;
}

export interface TrainingCandidatesReport {
  candidates: TrainingCandidateRow[];
  activeModelRef: string | null;
  active: MusicModelRouteState['active'];
  previous: MusicModelRouteState['previous'];
  events: MusicModelRouteState['events'];
  updatedAt: string;
}

/** Every trained candidate (workspace 'training', kind 'music-training',
 * SUCCEEDED) with its bound score receipt (or null) and active/previous state. */
export async function listMusicTrainingCandidates(): Promise<TrainingCandidatesReport> {
  const [route, jobs] = await Promise.all([
    readActiveMusicModelRoute(),
    prisma.providerJob.findMany({
      where: {
        workspaceId: MUSIC_TRAINING_WORKSPACE_ID,
        kind: MUSIC_TRAINING_JOB_KIND,
        status: 'SUCCEEDED',
      },
      select: {
        id: true,
        externalId: true,
        inputJson: true,
        outputJson: true,
        createdAt: true,
        finishedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  const candidates = jobs
    .map(job => musicTrainingCandidateFromJob(job))
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
  const receiptRows = candidates.length
    ? await prisma.systemSetting.findMany({
        where: { key: { in: candidates.map(candidate => candidate.evaluationKey) } },
        select: { key: true, value: true },
      })
    : [];
  const receiptsByKey = new Map(receiptRows.map(row => [row.key, row.value]));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  return {
    candidates: candidates.map(candidate => {
      const job = jobsById.get(candidate.providerJobId);
      return {
        providerJobId: candidate.providerJobId,
        candidateModelRef: candidate.candidateModelRef,
        datasetHash: candidate.datasetHash,
        trainingId: candidate.trainingId,
        createdAt: job?.createdAt.toISOString() ?? '',
        finishedAt: job?.finishedAt?.toISOString() ?? null,
        phase: candidate.phase,
        active: route.active?.providerJobId === candidate.providerJobId ||
          route.active?.modelRef === candidate.candidateModelRef,
        evaluation: parseMusicTrainingEvaluation(receiptsByKey.get(candidate.evaluationKey)),
        evaluationError: candidate.evaluationError,
      };
    }),
    activeModelRef: route.active?.modelRef ?? null,
    active: route.active,
    previous: route.previous,
    events: route.events.slice(-10),
    updatedAt: route.updatedAt,
  };
}

export interface EvaluationSubmissionResult {
  receipt: MusicTrainingEvaluationReceipt;
  evaluationKey: string;
  promoted: boolean;
  reason: string;
  activeModelRef: string | null;
  previousModelRef: string | null;
}

/** Persist a strict, candidate-bound score receipt and run the promotion gate
 * NOW — the operator sees promote/hold immediately instead of waiting for the
 * nightly pass. Same receipt key, same gate, same phase writes as the worker. */
export async function submitMusicTrainingEvaluation(input: {
  providerJobId: string;
  candidateScore: number;
  evaluator: string;
  measuredAt?: string;
  minGain?: number;
}): Promise<EvaluationSubmissionResult> {
  const job = await prisma.providerJob.findFirst({
    where: {
      id: input.providerJobId,
      workspaceId: MUSIC_TRAINING_WORKSPACE_ID,
      kind: MUSIC_TRAINING_JOB_KIND,
      status: 'SUCCEEDED',
    },
    select: { id: true, externalId: true, inputJson: true, outputJson: true },
  });
  if (!job) {
    throw seamError('music training candidate not found (workspace training, kind music-training, SUCCEEDED)', 404);
  }
  const candidate = musicTrainingCandidateFromJob(job);
  if (!candidate) throw seamError('music training candidate receipt is incomplete', 409);
  if (candidate.phase !== MUSIC_TRAINING_CANDIDATE_READY_PHASE) {
    throw seamError(
      `music training candidate is not ready for evaluation (phase: ${candidate.phase ?? 'unknown'})`,
      409
    );
  }
  // Binding by construction: model ref + dataset hash come from the candidate's
  // own durable receipt; the shared builder validates score/evaluator/minGain.
  const receipt = buildMusicTrainingEvaluationReceipt({
    candidateModelRef: candidate.candidateModelRef,
    datasetHash: candidate.datasetHash,
    candidateScore: input.candidateScore,
    evaluator: input.evaluator,
    measuredAt: input.measuredAt,
    minGain: input.minGain,
  });
  const key = musicTrainingEvaluationKey(job.id);
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(receipt) },
    update: { value: JSON.stringify(receipt) },
  });

  const current = await readActiveMusicModelRoute();
  const decision = decideMusicCandidatePromotion({
    candidate: {
      providerJobId: candidate.providerJobId,
      candidateModelRef: candidate.candidateModelRef,
      trainingId: candidate.trainingId,
      datasetHash: candidate.datasetHash,
    },
    evaluation: receipt,
    currentRoute: current,
  });
  const evaluatedOutput = { ...candidate.output, evaluation: decision.evaluationSummary };

  if (decision.verdict !== 'promoted' || !decision.route) {
    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        outputJson: {
          ...evaluatedOutput,
          phase: MUSIC_TRAINING_REJECTED_PHASE,
          decision: decision.reason,
        } as never,
        finishedAt: new Date(),
      },
    });
    return {
      receipt,
      evaluationKey: key,
      promoted: false,
      reason: decision.reason,
      activeModelRef: current.active?.modelRef ?? null,
      previousModelRef: current.previous?.modelRef ?? null,
    };
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
          phase: MUSIC_TRAINING_PROMOTED_PHASE,
          activeModelRef: route.active?.modelRef,
          previousModelRef: route.previous?.modelRef ?? null,
          promotedAt: route.updatedAt,
        } as never,
        finishedAt: new Date(),
      },
    }),
  ]);
  return {
    receipt,
    evaluationKey: key,
    promoted: true,
    reason: decision.reason,
    activeModelRef: route.active?.modelRef ?? null,
    previousModelRef: route.previous?.modelRef ?? null,
  };
}

export interface RollbackResult {
  rolledBack: boolean;
  reason: string;
  activeModelRef: string | null;
  previousModelRef: string | null;
}

/** Operator-safe rollback — the shared rollbackMusicModelRoute does the state
 * math (former active preserved as `previous`, reason retained in history);
 * this only persists the result under the same key the worker uses. */
export async function rollbackActiveMusicModel(reason: string): Promise<RollbackResult> {
  const trimmed = reason.trim();
  if (!trimmed) throw seamError('music model rollback requires a reason', 400);
  const current = await readActiveMusicModelRoute();
  const result = rollbackMusicModelRoute({ current, reason: trimmed });
  if (result.rolledBack) {
    await prisma.systemSetting.upsert({
      where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
      create: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY, value: JSON.stringify(result.route) },
      update: { value: JSON.stringify(result.route) },
    });
  }
  return {
    rolledBack: result.rolledBack,
    reason: result.reason,
    activeModelRef: result.route.active?.modelRef ?? null,
    previousModelRef: result.route.previous?.modelRef ?? null,
  };
}
