import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { presignAssetRef } from '../lib/storage';

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
    // Only expose songs the artist has green-lit (audit: an unauthenticated,
    // un-scoped endpoint was leaking title/artist/cover/ISRC for ANY song id in
    // ANY workspace). An unreleased song is 404 to the public.
    if (!song || !song.releaseReady || song.status !== 'RELEASED' || song.quarantined) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const [master, mix, cover, snippet] = await Promise.all([
      prisma.master.findFirst({ where: { songId: song.id, approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.mix.findFirst({ where: { songId: song.id, approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.imageAsset.findFirst({ where: { projectId: song.projectId, kind: 'cover', approved: true }, orderBy: { createdAt: 'desc' } }),
      prisma.videoRender.findFirst({ where: { projectId: song.projectId, provider: 'snippet', approved: true }, orderBy: { createdAt: 'desc' } }),
    ]);

    const [coverUrl, streamUrl, snippetUrl] = await Promise.all([
      cover?.url ? presignAssetRef(cover.url, 900) : null,
      song.releaseReady && (master?.url || mix?.url) ? presignAssetRef(master?.url ?? mix!.url, 900) : null,
      snippet?.url ? presignAssetRef(snippet.url, 900) : null,
    ]);

    // Only released rows receive short-lived streaming capabilities. The
    // stable private object references never leave the API.
    reply.header('cache-control', 'public, max-age=60');
    return {
      id: song.id,
      title: song.title,
      artist: song.project.artist.stageName,
      genre: song.project.genre,
      coverUrl,
      streamUrl,
      snippetUrl,
      isrc: song.isrc ?? null,
      releaseReady: song.releaseReady,
    };
  });
}
