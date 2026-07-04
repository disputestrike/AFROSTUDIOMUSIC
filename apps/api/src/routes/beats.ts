import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateBeatInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue, QUEUES } from '../lib/queue';

export default async function beats(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>(
    '/',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      return prisma.beatAsset.findMany({
        where: { projectId: req.params.projectId },
        include: { stems: true },
        orderBy: { createdAt: 'desc' },
      });
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/generate',
    { schema: { body: generateBeatInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateBeatInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: input.withStems ? 'full_song_demo' : 'beat_idea_short_30s',
        refTable: 'Project',
        refId: project.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'music',
          provider: process.env.MUSIC_PROVIDER ?? 'stub',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.music,
        name: 'generate-music',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          input: { ...input, artistTone: project.artist.vocalTone, languages: project.artist.languages },
        },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued' };
    }
  );
}
