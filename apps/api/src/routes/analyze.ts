import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { analyzeAudioSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { assertSafeUrl } from '../lib/url-guard';

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
      const { url, purgeAfter } = analyzeAudioSchema.parse(req.body);

      // Same bright-line + SSRF guard as /import: no streaming-catalog hosts,
      // no private/metadata targets. The AI listens to rights-cleared audio only.
      const chk = await assertSafeUrl(url);
      if (!chk.ok) return reply.code(chk.code).send({ error: chk.error, message: chk.message });

      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      // Paid Replicate inference → subject to the daily cap like every other
      // generation path (was previously the one uncapped entry point).
      const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio', refTable: 'Project', refId: project.id });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

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
        payload: { jobId: job.id, workspaceId, projectId: project.id, url , purgeAfter },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued' };
    }
  );
}
