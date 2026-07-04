import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';

/**
 * Public release page data (the pre-save / smart-link catch-page). No workspace
 * scoping — a fan clicking a shared link isn't logged in. Returns only
 * public-safe fields. This is what catches the traffic a snippet drives so the
 * attention doesn't leak.
 */
export default async function publicRoutes(app: FastifyInstance) {
  app.get<{ Params: { songId: string } }>('/song/:songId', async (req, reply) => {
    const song = await prisma.song.findUnique({
      where: { id: req.params.songId },
      include: { project: { include: { artist: true } }, lyric: true },
    });
    if (!song) return reply.code(404).send({ error: 'not_found' });

    const [master, mix, cover, snippet] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.mix.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover' }, orderBy: { createdAt: 'desc' } }),
      prisma.videoRender.findFirst({ where: { projectId: song.projectId, provider: 'snippet' }, orderBy: { createdAt: 'desc' } }),
    ]);

    reply.header('cache-control', 'public, max-age=60');
    return {
      id: song.id,
      title: song.title,
      artist: song.project.artist.stageName,
      genre: song.project.genre,
      coverUrl: cover?.url ?? null,
      streamUrl: master?.url ?? mix?.url ?? null,
      snippetUrl: snippet?.url ?? null,
      isrc: song.isrc ?? null,
      releaseReady: song.releaseReady,
    };
  });
}
