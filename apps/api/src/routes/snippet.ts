import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { snippetInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

/**
 * Make a vertical 9:16 shareable clip (TikTok/Reels/Shorts) from a finished
 * song — the artifact that actually spreads. Reuses the music queue
 * (name=snippet). Poll /jobs/:id → outputJson.url = the mp4.
 */
export default async function snippet(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: snippetInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = snippetInputSchema.parse(req.body ?? {});
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      const song = input.songId
        ? await prisma.song.findFirstOrThrow({ where: { id: input.songId, projectId: project.id } })
        : await prisma.song.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
      if (!song) return reply.code(400).send({ error: 'no_song — make a song first' });

      const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s', refTable: 'Song', refId: song.id });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'video',
          provider: 'snippet',
          status: 'QUEUED',
          inputJson: { songId: song.id, startS: input.startS } as never,
        },
      });
      await enqueue({
        queue: app.queues.music,
        name: 'snippet',
        payload: { jobId: job.id, workspaceId, projectId: project.id, songId: song.id, startS: input.startS },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued', songId: song.id };
    }
  );
}
