import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import {
  AFROONE_DIRECTIONS,
  PRODUCER_EVIDENCE_VERSION,
  evaluateProducerEvidence,
  isAfroOneRenderSpecification,
  type ProducerEvidencePack,
} from '@afrohit/shared';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const score = z.number().min(1).max(5);
const producerScoreSchema = z.object({
  reviewerId: z.string().trim().min(1).max(120),
  independent: z.boolean(),
  aiSkeptical: z.boolean(),
  percussionRoleCorrectness: score,
  logDrumPlacement: score,
  arrangementSpace: score,
  hookLift: score,
  lagosFeel: score,
  feelsWestern: z.boolean(),
  usedInPaidSession: z.boolean(),
  choseOverManualRebuild: z.boolean(),
  wouldPay: z.boolean(),
  returnedUnprompted: z.boolean(),
});

const createEvidenceSchema = z.object({
  songId: z.string().cuid(),
  directions: z
    .array(
      z.object({
        jobId: z.string().cuid(),
        replayJobId: z.string().cuid(),
      })
    )
    .length(3),
  producerScores: z.array(producerScoreSchema).max(20),
  manualWorkflowMs: z.number().int().positive().max(24 * 60 * 60_000).optional(),
  daw: z.enum(['fl_studio', 'ableton', 'other']),
});

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

export default async function producerEvidence(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    const input = createEvidenceSchema.parse(req.body);
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

    const starts = originals.map(job => (job.startedAt ?? job.createdAt).getTime());
    const finishes = originals.map(job => job.finishedAt?.getTime() ?? 0);
    if (finishes.some(value => value === 0)) {
      return reply.code(409).send({ error: 'workflow_timing_incomplete' });
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

    const pack: ProducerEvidencePack = {
      version: PRODUCER_EVIDENCE_VERSION,
      workspaceId,
      songId: song.id,
      shelfSnapshotHash: hashShelf(usage),
      lane: typedSpecs[0]!.genre,
      ontologyVersion: typedSpecs[0]!.ontologyVersion,
      seed: batchSeed,
      directions: evidenceDirections,
      producerScores: input.producerScores,
      totalWorkflowMs: Math.max(...finishes) - Math.min(...starts),
      manualWorkflowMs: input.manualWorkflowMs,
      daw: input.daw,
      createdAt: new Date().toISOString(),
    };
    const verdict = evaluateProducerEvidence(pack);
    const event = await prisma.analyticsEvent.create({
      data: {
        workspaceId,
        userId,
        name: 'producer.evidence_pack',
        properties: { pack, verdict } as never,
      },
      select: { id: true, createdAt: true },
    });
    reply.code(201);
    return { id: event.id, createdAt: event.createdAt, pack, verdict };
  });

  app.get('/', async req => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.analyticsEvent.findMany({
      where: { workspaceId, name: 'producer.evidence_pack' },
      orderBy: { createdAt: 'desc' },
      take: 52,
      select: { id: true, createdAt: true, properties: true },
    });
    return { items: rows };
  });
}
