import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateCoverArtInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';

export default async function images(app: FastifyInstance) {
  app.post(
    '/cover-art',
    { schema: { body: generateCoverArtInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateCoverArtInputSchema.parse(req.body);
      await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });
      if (input.brandKitId) {
        await prisma.brandKit.findFirstOrThrow({ where: { id: input.brandKitId, workspaceId } });
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'cover-art');
      const charge = await app.chargeCredits({
        workspaceId,
        key: input.quality === 'high' ? 'cover_art_high' : 'cover_art_low',
        refTable: 'Project',
        refId: input.projectId,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.image,
        jobName: 'generate-image',
        workspaceId,
        projectId: input.projectId,
        kind: 'image',
        provider: process.env.IMAGE_PROVIDER ?? 'openai',
        inputJson: input,
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: input.projectId,
          brandKitId: input.brandKitId,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          kind: 'cover',
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}
