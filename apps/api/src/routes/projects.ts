import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { genreSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

const createProjectSchema = z.object({
  artistId: z.string().cuid(),
  title: z.string().min(1).max(160),
  genre: genreSchema,
  bpm: z.number().int().min(40).max(220).optional(),
  keySignature: z.string().optional(),
});

export default async function projects(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.project.findMany({
      where: { workspaceId },
      include: { artist: { select: { id: true, stageName: true } }, _count: { select: { songs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  });

  app.post('/', { schema: { body: createProjectSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const data = createProjectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: { workspaceId, ...data },
    });
    reply.code(201);
    return project;
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.project.findFirstOrThrow({
      where: { id: req.params.id, workspaceId },
      include: {
        artist: true,
        briefs: { orderBy: { createdAt: 'desc' }, take: 1 },
        hooks: { orderBy: { score: 'desc' }, take: 25 },
        lyrics: { orderBy: { createdAt: 'desc' }, take: 5 },
        songs: { orderBy: { createdAt: 'desc' } },
        beats: { take: 5, orderBy: { createdAt: 'desc' } },
        vocalRenders: { take: 5, orderBy: { createdAt: 'desc' } },
        mixes: { take: 5, orderBy: { createdAt: 'desc' } },
        masters: { take: 5, orderBy: { createdAt: 'desc' } },
        imageAssets: { take: 10, orderBy: { createdAt: 'desc' } },
        videoConcepts: { take: 5, orderBy: { createdAt: 'desc' } },
        approvals: { take: 50, orderBy: { createdAt: 'desc' } },
      },
    });
  });

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { schema: { body: createProjectSchema.partial() } },
    async (req) => {
      const { workspaceId } = requireAuth(req);
      return prisma.project.update({
        where: { id: req.params.id, workspaceId },
        data: createProjectSchema.partial().parse(req.body),
      });
    }
  );

  app.post<{ Params: { id: string }; Body: { gate: string; decision: string; notes?: string } }>(
    '/:id/approve',
    async (req) => {
      const { userId, workspaceId } = requireAuth(req);
      const { gate, decision, notes } = req.body;
      return prisma.approval.create({
        data: {
          workspaceId,
          projectId: req.params.id,
          userId,
          gate,
          decision,
          notes,
        },
      });
    }
  );

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    // Relations cascade on delete (hooks, songs, lyrics, assets, jobs, etc.).
    await prisma.project.deleteMany({ where: { id: req.params.id, workspaceId } });
    reply.code(204);
    return null;
  });
}
