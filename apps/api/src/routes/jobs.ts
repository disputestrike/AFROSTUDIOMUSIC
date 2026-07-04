import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

export default async function jobs(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.providerJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const job = await prisma.providerJob.findFirst({
      where: { id: req.params.id, workspaceId },
    });
    if (!job) return reply.code(404).send({ error: 'not_found' });
    return job;
  });
}
