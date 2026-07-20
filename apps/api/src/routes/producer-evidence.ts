import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import {
  AFROONE_DIRECTIONS,
  PRODUCER_EVIDENCE_CURRENT_VERSION,
  PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
  PRODUCER_PANEL_SIZE,
  UNPROMPTED_RETURN_MIN_DELAY_MS,
  buildProducerReadinessReport,
  evaluateProducerEvidence,
  isAfroOneRenderSpecification,
  isLegacyProducerEvidencePack,
  isProducerEvidenceFollowupEvent,
  isProducerEvidencePackV2,
  type ProducerEvidenceAnyPack,
  type ProducerEvidenceFollowupEvent,
  type ProducerEvidencePackV2,
  type ProducerEvidenceRecord,
} from '@afrohit/shared';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const score = z.number().min(1).max(5);
const reviewerId = z.string().trim().min(1).max(120);
const comparatorLabel = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'comparator labels must be opaque identifiers');

const producerScoreSchema = z
  .object({
    reviewerId,
    independent: z.boolean(),
    aiSkeptical: z.boolean(),
    percussionRoleCorrectness: score,
    logDrumPlacement: score,
    arrangementSpace: score,
    hookLift: score,
    lagosFeel: score,
    feelsWestern: z.boolean(),
    choseOverManualRebuild: z.boolean(),
    wouldPay: z.boolean(),
    preferredComparatorLabel: comparatorLabel,
  })
  .strict();

const technicalCorrectionSchema = z
  .object({
    category: z.enum([
      'phase',
      'timing',
      'swing',
      'gain_staging',
      'tail_cleanup',
      'frequency_overlap',
      'missing_stem',
      'other',
    ]),
    durationMs: z.number().int().nonnegative().max(24 * 60 * 60_000),
  })
  .strict();

const producerSessionSchema = z
  .object({
    briefStartedAt: z.string().datetime({ offset: true }),
    firstUsableDirectionAt: z.string().datetime({ offset: true }),
    allDirectionsReadyAt: z.string().datetime({ offset: true }),
    dawImportedAt: z.string().datetime({ offset: true }),
    manualBaselineMs: z.number().int().positive().max(24 * 60 * 60_000),
    shelfMode: z.enum(['ready', 'cold']),
    onboardingDurationMs: z.number().int().nonnegative().max(24 * 60 * 60_000),
    technicalCorrections: z.array(technicalCorrectionSchema).max(50),
    blindedComparatorLabels: z.array(comparatorLabel).min(2).max(10),
  })
  .strict()
  .superRefine((session, ctx) => {
    const brief = Date.parse(session.briefStartedAt);
    const first = Date.parse(session.firstUsableDirectionAt);
    const ready = Date.parse(session.allDirectionsReadyAt);
    const imported = Date.parse(session.dawImportedAt);
    if (!(brief <= first && first <= ready && ready <= imported)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'session timestamps must follow brief, first usable, all ready, DAW import',
      });
    }
    if (imported > Date.now() + 5 * 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'session timestamps cannot be in the future',
      });
    }
    const labels = session.blindedComparatorLabels.map(label => label.toUpperCase());
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'blinded comparator labels must be unique',
      });
    }
  });

export const createProducerEvidenceSchema = z
  .object({
    songId: z.string().cuid(),
    directions: z
      .array(
        z
          .object({
            jobId: z.string().cuid(),
            replayJobId: z.string().cuid(),
          })
          .strict()
      )
      .length(3),
    producerScores: z.array(producerScoreSchema).length(PRODUCER_PANEL_SIZE),
    session: producerSessionSchema,
    daw: z.enum(['fl_studio', 'ableton', 'other']),
  })
  .strict()
  .superRefine((input, ctx) => {
    const reviewerIds = input.producerScores.map(row => row.reviewerId.toLocaleLowerCase('en-US'));
    if (new Set(reviewerIds).size !== PRODUCER_PANEL_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['producerScores'],
        message: 'a final panel requires five unique reviewers',
      });
    }
    if (input.producerScores.filter(row => row.independent).length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['producerScores'],
        message: 'a final panel requires at least two independent reviewers',
      });
    }
    if (!input.producerScores.some(row => row.aiSkeptical)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['producerScores'],
        message: 'a final panel requires at least one AI-skeptical reviewer',
      });
    }
    const labels = new Set(
      input.session.blindedComparatorLabels.map(label => label.toLocaleUpperCase('en-US'))
    );
    for (const [index, row] of input.producerScores.entries()) {
      if (!labels.has(row.preferredComparatorLabel.toLocaleUpperCase('en-US'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['producerScores', index, 'preferredComparatorLabel'],
          message: 'preferred comparator must be one of the blinded labels',
        });
      }
    }
  });

const followupSchema = z
  .object({
    reviewerId,
    type: z.enum(['paid_session_use', 'unprompted_return']),
  })
  .strict();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hashShelf(rows: Array<{ materialId: string; material: { contentHash: string | null } }>) {
  const receipt = rows
    .map(row => `${row.materialId}:${row.material.contentHash ?? 'unverified'}`)
    .sort()
    .join('|');
  return createHash('sha256').update(receipt).digest('hex');
}

function packFromProperties(value: unknown): ProducerEvidenceAnyPack | null {
  const pack = record(value).pack;
  if (isProducerEvidencePackV2(pack) || isLegacyProducerEvidencePack(pack)) return pack;
  return null;
}

function followupFromProperties(value: unknown): ProducerEvidenceFollowupEvent | null {
  const event = record(value).event;
  return isProducerEvidenceFollowupEvent(event) ? event : null;
}

function normalizedReviewerId(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export default async function producerEvidence(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    const input = createProducerEvidenceSchema.parse(req.body);
    const song = await prisma.song.findFirst({
      where: { id: input.songId, workspaceId },
      select: { id: true, projectId: true },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });

    const jobIds = input.directions.flatMap(row => [row.jobId, row.replayJobId]);
    const jobs = await prisma.providerJob.findMany({
      where: {
        id: { in: jobIds },
        workspaceId,
        projectId: song.projectId,
        provider: 'afrohit-own',
        status: 'SUCCEEDED',
      },
      select: {
        id: true,
        inputJson: true,
        outputJson: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    const byJob = new Map(jobs.map(job => [job.id, job]));
    if (byJob.size !== new Set(jobIds).size) {
      return reply.code(409).send({ error: 'evidence_jobs_incomplete' });
    }

    const originals = input.directions.map(row => byJob.get(row.jobId)!);
    const beatIds = originals.map(job => String(record(job.outputJson).beatId ?? ''));
    const replayBeatIds = input.directions.map(row =>
      String(record(byJob.get(row.replayJobId)!.outputJson).beatId ?? '')
    );
    if ([...beatIds, ...replayBeatIds].some(id => !id)) {
      return reply.code(409).send({ error: 'evidence_beat_receipts_incomplete' });
    }
    const beats = await prisma.beatAsset.findMany({
      where: {
        id: { in: [...beatIds, ...replayBeatIds] },
        projectId: song.projectId,
        songId: song.id,
        project: { workspaceId },
      },
      include: { stems: true },
    });
    const byBeat = new Map(beats.map(beat => [beat.id, beat]));
    if (byBeat.size !== new Set([...beatIds, ...replayBeatIds]).size) {
      return reply.code(409).send({ error: 'evidence_beats_incomplete' });
    }

    const renderSpecs = originals.map(job => record(job.inputJson).renderSpec);
    if (renderSpecs.some(spec => !isAfroOneRenderSpecification(spec))) {
      return reply.code(409).send({ error: 'render_spec_unavailable' });
    }
    const typedSpecs = renderSpecs.filter(isAfroOneRenderSpecification);
    const directions = typedSpecs.map(spec => spec.direction);
    if (
      new Set(directions).size !== 3 ||
      AFROONE_DIRECTIONS.some(direction => !directions.includes(direction)) ||
      new Set(typedSpecs.map(spec => `${spec.genre}:${spec.ontologyVersion}`)).size !== 1
    ) {
      return reply.code(409).send({ error: 'controlled_direction_set_invalid' });
    }

    const usage = await prisma.materialUsage.findMany({
      where: { workspaceId, beatId: { in: beatIds } },
      select: { materialId: true, material: { select: { contentHash: true } } },
    });
    if (!usage.length || usage.some(row => !row.material.contentHash)) {
      return reply.code(409).send({ error: 'shelf_snapshot_unverified' });
    }

    const finishes = originals.map(job => job.finishedAt?.getTime() ?? 0);
    if (finishes.some(value => value === 0)) {
      return reply.code(409).send({ error: 'workflow_timing_incomplete' });
    }
    const firstUsableAt = Date.parse(input.session.firstUsableDirectionAt);
    const allDirectionsReadyAt = Date.parse(input.session.allDirectionsReadyAt);
    if (firstUsableAt < Math.min(...finishes) || allDirectionsReadyAt < Math.max(...finishes)) {
      return reply.code(409).send({ error: 'session_timing_precedes_render_receipt' });
    }
    const batchSeed = Number(record(originals[0]!.inputJson).batchSeed);
    if (!Number.isInteger(batchSeed) || batchSeed < 0) {
      return reply.code(409).send({ error: 'batch_seed_unavailable' });
    }

    const evidenceDirections = input.directions.map((pair, index) => {
      const source = byBeat.get(beatIds[index]!)!;
      const replay = byBeat.get(replayBeatIds[index]!)!;
      const replayInput = record(byJob.get(pair.replayJobId)!.inputJson);
      const stemsClean =
        source.stems.length > 0 &&
        source.stems.every(
          stem =>
            stem.qualityState === 'passed' &&
            Boolean(stem.contentHash) &&
            Boolean(stem.verifiedAt)
        );
      return {
        direction: typedSpecs[index]!.direction,
        jobId: pair.jobId,
        beatId: source.id,
        audioUrl: source.url,
        contentHash: source.contentHash ?? undefined,
        stemCount: source.stems.length,
        stemsClean,
        replayVerified:
          replayInput.replayOfBeatId === source.id &&
          Boolean(source.contentHash) &&
          source.contentHash === replay.contentHash,
      };
    });

    const createdAt = new Date().toISOString();
    const pack: ProducerEvidencePackV2 = {
      version: PRODUCER_EVIDENCE_CURRENT_VERSION,
      workspaceId,
      songId: song.id,
      shelfSnapshotHash: hashShelf(usage),
      lane: typedSpecs[0]!.genre,
      ontologyVersion: typedSpecs[0]!.ontologyVersion,
      seed: batchSeed,
      directions: evidenceDirections,
      producerScores: input.producerScores,
      session: input.session,
      totalWorkflowMs:
        Date.parse(input.session.allDirectionsReadyAt) - Date.parse(input.session.briefStartedAt),
      daw: input.daw,
      createdAt,
    };
    const verdict = evaluateProducerEvidence(pack);
    const event = await prisma.analyticsEvent.create({
      data: {
        workspaceId,
        userId,
        name: 'producer.evidence_pack',
        properties: { pack, initialVerdict: verdict } as never,
      },
      select: { id: true, createdAt: true },
    });
    reply.code(201);
    return { id: event.id, createdAt: event.createdAt, pack, verdict };
  });

  app.post('/:packId/events', async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    const { packId } = z.object({ packId: z.string().cuid() }).parse(req.params);
    const input = followupSchema.parse(req.body);
    const packRow = await prisma.analyticsEvent.findFirst({
      where: { id: packId, workspaceId, name: 'producer.evidence_pack' },
      select: { id: true, createdAt: true, properties: true },
    });
    if (!packRow) return reply.code(404).send({ error: 'evidence_pack_not_found' });
    const pack = packFromProperties(packRow.properties);
    if (!pack || !isProducerEvidencePackV2(pack)) {
      return reply.code(409).send({ error: 'legacy_evidence_is_non_certifying' });
    }
    const reviewerKey = normalizedReviewerId(input.reviewerId);
    if (
      !pack.producerScores.some(
        row => normalizedReviewerId(row.reviewerId) === reviewerKey
      )
    ) {
      return reply.code(409).send({ error: 'reviewer_not_in_panel' });
    }

    const recordedAt = new Date();
    if (recordedAt.getTime() <= packRow.createdAt.getTime()) {
      return reply.code(409).send({ error: 'followup_must_be_recorded_later' });
    }
    if (
      input.type === 'unprompted_return' &&
      recordedAt.getTime() - packRow.createdAt.getTime() < UNPROMPTED_RETURN_MIN_DELAY_MS
    ) {
      return reply.code(409).send({ error: 'unprompted_return_window_not_reached' });
    }

    const existingRows = await prisma.analyticsEvent.findMany({
      where: {
        workspaceId,
        name: 'producer.evidence_followup',
        createdAt: { gt: packRow.createdAt },
      },
      orderBy: { createdAt: 'asc' },
      take: 5_000,
      select: { properties: true },
    });
    const existing = existingRows
      .map(row => followupFromProperties(row.properties))
      .filter((event): event is ProducerEvidenceFollowupEvent => Boolean(event))
      .filter(event => event.packId === packId);
    if (
      existing.some(
        event =>
          event.type === input.type && normalizedReviewerId(event.reviewerId) === reviewerKey
      )
    ) {
      return reply.code(409).send({ error: 'followup_already_recorded' });
    }

    const followup: ProducerEvidenceFollowupEvent = {
      version: PRODUCER_EVIDENCE_FOLLOWUP_VERSION,
      packId,
      reviewerId: input.reviewerId,
      type: input.type,
      recordedAt: recordedAt.toISOString(),
    };
    const event = await prisma.analyticsEvent.create({
      data: {
        workspaceId,
        userId,
        name: 'producer.evidence_followup',
        properties: { event: followup } as never,
      },
      select: { id: true, createdAt: true },
    });
    const verdict = evaluateProducerEvidence(pack, [...existing, followup]);
    reply.code(201);
    return {
      id: event.id,
      createdAt: event.createdAt,
      type: followup.type,
      verdict,
    };
  });

  app.get('/', async req => {
    const { workspaceId } = requireAuth(req);
    const [packRows, followupRows] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { workspaceId, name: 'producer.evidence_pack' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 52,
        select: { id: true, createdAt: true, properties: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { workspaceId, name: 'producer.evidence_followup' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5_000,
        select: { properties: true },
      }),
    ]);

    const packs: ProducerEvidenceRecord[] = packRows.flatMap(row => {
      const pack = packFromProperties(row.properties);
      return pack
        ? [{ id: row.id, createdAt: row.createdAt.toISOString(), pack }]
        : [];
    });
    const followups = followupRows
      .map(row => followupFromProperties(row.properties))
      .filter((event): event is ProducerEvidenceFollowupEvent => Boolean(event));
    return buildProducerReadinessReport({ packs, followups });
  });
}
