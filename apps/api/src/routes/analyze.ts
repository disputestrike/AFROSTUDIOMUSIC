import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { analyzeAudioSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

/**
 * "Play a song and it listens." Queues an audio-understanding job (reuses the
 * music queue, name=analyze-audio). Poll /jobs/:id → outputJson.profile holds
 * BPM/key/genre/mood/energy/instruments + a suggested prompt to create a FRESH
 * original in that vibe (never a copy).
 */
export default async function analyze(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: analyzeAudioSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { url } = analyzeAudioSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'analyze',
          provider: 'replicate',
          status: 'QUEUED',
          inputJson: { url } as never,
        },
      });
      await enqueue({
        queue: app.queues.music,
        name: 'analyze-audio',
        payload: { jobId: job.id, workspaceId, projectId: project.id, url },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued' };
    }
  );
}
