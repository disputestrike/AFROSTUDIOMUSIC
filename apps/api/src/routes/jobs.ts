import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

export default async function jobs(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { workspaceId, role } = requireAuth(req);
    return prisma.providerJob.findMany({
      where: {
        workspaceId,
        ...(['OWNER', 'ADMIN'].includes(role) ? {} : { kind: { notIn: ['voice', 'voice_profile', 'voice_dataset', 'voice_cleanup'] } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        status: true,
        outputJson: true,
        errorJson: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId, role } = requireAuth(req);
    const job = await prisma.providerJob.findFirst({
      where: { id: req.params.id, workspaceId },
      select: {
        id: true,
        kind: true,
        status: true,
        outputJson: true,
        errorJson: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
    if (!job) return reply.code(404).send({ error: 'not_found' });
    if (job.kind.startsWith('voice') && !['OWNER', 'ADMIN'].includes(role)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return job;
  });
}
