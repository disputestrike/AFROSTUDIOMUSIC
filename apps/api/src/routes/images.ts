import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateCoverArtInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

export default async function images(app: FastifyInstance) {
  app.post(
    '/cover-art',
    { schema: { body: generateCoverArtInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateCoverArtInputSchema.parse(req.body);

      const charge = await app.chargeCredits({
        workspaceId,
        key: input.quality === 'high' ? 'cover_art_high' : 'cover_art_low',
        refTable: 'Project',
        refId: input.projectId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: input.projectId,
          kind: 'image',
          provider: process.env.IMAGE_PROVIDER ?? 'openai',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.image,
        name: 'generate-image',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: input.projectId,
          brandKitId: input.brandKitId,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          kind: 'cover',
        },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );
}
