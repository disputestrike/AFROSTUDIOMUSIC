import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { createMasterInputSchema, createMixInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

export default async function mixes(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: createMixInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMixInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'mix_preset',
        refTable: 'Song',
        refId: input.songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'mix',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.mix,
        name: 'create-mix',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          preset: input.preset,
        },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { songId: string; preset: string; mixId?: string } }>(
    '/master',
    { schema: { body: createMasterInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMasterInputSchema.omit({ projectId: true }).parse(req.body);

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'master_preset',
        refTable: 'Song',
        refId: input.songId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: req.params.projectId,
          kind: 'master',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.master,
        name: 'create-master',
        payload: { jobId: job.id, workspaceId, projectId: req.params.projectId, ...input },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );
}
