import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { rightsCheckInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';

export default async function rights(app: FastifyInstance) {
  app.post(
    '/check',
    { schema: { body: rightsCheckInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = rightsCheckInputSchema.parse(req.body);
      const song = await prisma.song.findFirst({
        where: {
          id: input.songId,
          projectId: input.projectId,
          workspaceId,
        },
        select: { id: true, projectId: true },
      });
      if (!song) return reply.code(404).send({ error: 'song_not_found' });

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'rights-check');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'analyze_audio',
        refTable: 'Song',
        refId: song.id,
        idempotencyKey,
      });
      if (!charge.ok) {
        return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      }

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.rights,
        jobName: 'check-rights',
        workspaceId,
        projectId: song.projectId,
        kind: 'rights',
        provider: 'internal+audd',
        inputJson: input,
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: song.projectId,
          songId: song.id,
          audioRightsAttestation: input.audioRightsAttestation,
        }),
      });
      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    },
  );
}
