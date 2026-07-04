import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

/**
 * Catalog — the artist's finished/in-progress songs with their latest playable
 * assets and cover art. This is the human-facing view (vs the raw job log).
 */
export default async function songs(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.song.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        project: { select: { id: true, title: true, genre: true, bpm: true, artist: { select: { stageName: true } } } },
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
        beats: { orderBy: { createdAt: 'desc' }, take: 1 },
        lyric: { select: { title: true } },
      },
    });

    // Cover art is attached at the project level.
    const projectIds = [...new Set(rows.map((s) => s.projectId))];
    const covers = await prisma.imageAsset.findMany({
      where: { projectId: { in: projectIds }, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true, url: true },
    });
    const coverByProject = new Map<string, string>();
    for (const c of covers) if (c.projectId && !coverByProject.has(c.projectId)) coverByProject.set(c.projectId, c.url);

    return rows.map((s) => ({
      id: s.id,
      title: s.lyric?.title || s.title,
      status: s.status,
      artist: s.project.artist.stageName,
      projectId: s.projectId,
      projectTitle: s.project.title,
      genre: s.project.genre,
      bpm: s.project.bpm,
      audioUrl: s.masters[0]?.url ?? s.mixes[0]?.url ?? s.beats[0]?.url ?? null,
      coverUrl: coverByProject.get(s.projectId) ?? null,
      createdAt: s.createdAt,
    }));
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.song.deleteMany({ where: { id: req.params.id, workspaceId } });
    reply.code(204);
    return null;
  });
}
