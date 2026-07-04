import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

const resolveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().max(2000).optional(),
});

/**
 * Native-language / quality review queue.
 * Tasks are auto-created by the lyric generator when it flags uncertain
 * Yoruba/Igbo/Hausa/Pidgin lines. A native speaker (workspace member)
 * resolves them here; rejected tasks flip the lyric back to unapproved.
 */
export default async function reviews(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.reviewTask.findMany({
      where: { workspaceId, status: req.query.status ?? 'open' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/:id/resolve',
    { schema: { body: resolveSchema } },
    async (req) => {
      const { workspaceId, userId } = requireAuth(req);
      const { decision, notes } = resolveSchema.parse(req.body);
      const task = await prisma.reviewTask.findFirstOrThrow({
        where: { id: req.params.id, workspaceId, status: 'open' },
      });
      const updated = await prisma.reviewTask.update({
        where: { id: task.id },
        data: { status: decision, notes, resolvedBy: userId, resolvedAt: new Date() },
      });
      // A rejected native-language review un-approves the lyric so it can't
      // flow to vocals/export until rewritten.
      if (decision === 'rejected' && task.lyricId) {
        await prisma.lyricDraft.update({
          where: { id: task.lyricId },
          data: { approved: false, approvalNotes: `native review rejected: ${notes ?? ''}` },
        });
      }
      return updated;
    }
  );
}
