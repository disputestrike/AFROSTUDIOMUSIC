import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { artistDnaSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

export default async function artists(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.artist.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/', { schema: { body: artistDnaSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const data = artistDnaSchema.parse(req.body);
    const artist = await prisma.artist.create({
      data: { workspaceId, ...data, references: data.references ?? [], slang: data.slang ?? [] },
    });
    reply.code(201);
    return artist;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.artist.findFirstOrThrow({
      where: { id: req.params.id, workspaceId },
    });
  });

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { schema: { body: artistDnaSchema.partial() } },
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const data = artistDnaSchema.partial().parse(req.body);
      return prisma.artist.update({
        where: { id: req.params.id, workspaceId },
        data: data as never,
      });
    }
  );
}
