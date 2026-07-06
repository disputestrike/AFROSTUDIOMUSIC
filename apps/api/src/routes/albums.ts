import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { dropBatchSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { runDropPipeline } from './drop';

/**
 * ALBUMS — anchored to ONE song's sound.
 *
 * "I got a song I really like → build an album of that song, that style, that
 * flow." The anchor song's engine, genre, bpm, hook style and vocal direction
 * are distilled into a styleBrief; every "next track" generates INSIDE that
 * lane so the album holds one voice and one flow.
 */
export default async function albums(app: FastifyInstance) {
  /** List albums with their songs (newest first). */
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.album.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        songs: {
          orderBy: { createdAt: 'asc' },
          include: {
            masters: { orderBy: { createdAt: 'desc' }, take: 1 },
            mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
            beats: { orderBy: { createdAt: 'desc' }, take: 1 },
            lyric: { select: { title: true } },
          },
        },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      anchorSongId: a.anchorSongId,
      styleBrief: a.styleBrief,
      createdAt: a.createdAt,
      songs: a.songs.map((s) => ({
        id: s.id,
        title: s.lyric?.title || s.title,
        status: s.status,
        projectId: s.projectId,
        audioUrl: s.masters[0]?.url ?? s.mixes[0]?.url ?? s.beats[0]?.url ?? null,
        isAnchor: s.id === a.anchorSongId,
      })),
    }));
  });

  /** Start an album FROM a song — the anchor defines the sound. */
  const createSchema = z.object({ anchorSongId: z.string().cuid(), title: z.string().max(120).optional() });
  app.post('/', { schema: { body: createSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { anchorSongId, title } = createSchema.parse(req.body);
    const anchor = await prisma.song.findFirst({
      where: { id: anchorSongId, workspaceId },
      include: {
        project: { include: { artist: true } },
        lyric: true,
        beats: { orderBy: { createdAt: 'desc' }, take: 1 },
        hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!anchor) return reply.code(404).send({ error: 'song_not_found' });

    // Distill the anchor's sound into a directive every album track will follow.
    const beat = anchor.beats[0];
    const meta = (beat?.meta ?? {}) as { qc?: { integratedLufs?: number } };
    const styleBrief = [
      `ALBUM STYLE ANCHOR — every track must hold this ONE sound (same voice, same flow, fresh songs):`,
      `Genre: ${anchor.project.genre}${anchor.project.bpm ? ` at ~${anchor.project.bpm} bpm` : ''}. Engine: ${beat?.provider ?? 'auto'}.`,
      anchor.project.artist.vocalTone?.length ? `Vocal tone: ${anchor.project.artist.vocalTone.join(', ')} — ONE consistent lead voice across the album.` : '',
      anchor.hooks[0] ? `Hook style reference (the FEEL, never reuse the words): "${anchor.hooks[0].text.split('\n')[0]!.slice(0, 90)}"` : '',
      anchor.lyric?.languageMix ? `Language mix: ${JSON.stringify(anchor.lyric.languageMix)}.` : '',
      meta.qc?.integratedLufs != null ? `Production target: ~${meta.qc.integratedLufs} LUFS, keep the anchor's dynamic feel.` : '',
    ].filter(Boolean).join('\n');

    const album = await prisma.album.create({
      data: {
        workspaceId,
        title: title || `${anchor.lyric?.title || anchor.title} — the album`,
        anchorSongId: anchor.id,
        styleBrief,
      },
    });
    await prisma.song.update({ where: { id: anchor.id }, data: { albumId: album.id } });
    reply.code(201);
    return { id: album.id, title: album.title };
  });

  /** Add an existing song to an album. */
  const addSchema = z.object({ songId: z.string().cuid() });
  app.post<{ Params: { albumId: string } }>('/:albumId/add', { schema: { body: addSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { songId } = addSchema.parse(req.body);
    const album = await prisma.album.findFirst({ where: { id: req.params.albumId, workspaceId }, select: { id: true } });
    if (!album) return reply.code(404).send({ error: 'album_not_found' });
    const updated = await prisma.song.updateMany({ where: { id: songId, workspaceId }, data: { albumId: album.id } });
    if (updated.count === 0) return reply.code(404).send({ error: 'song_not_found' });
    return { ok: true };
  });

  /** Generate the NEXT track in this album's style. Async: 202 + jobId, poll /jobs/:id. */
  const nextSchema = z.object({ theme: z.string().max(300).optional() });
  app.post<{ Params: { albumId: string } }>('/:albumId/next', { schema: { body: nextSchema } }, async (req, reply) => {
    const { workspaceId, userId } = requireAuth(req);
    const { theme } = nextSchema.parse(req.body);
    const album = await prisma.album.findFirst({ where: { id: req.params.albumId, workspaceId } });
    if (!album) return reply.code(404).send({ error: 'album_not_found' });
    const anchor = album.anchorSongId
      ? await prisma.song.findFirst({ where: { id: album.anchorSongId, workspaceId }, include: { project: true, beats: { orderBy: { createdAt: 'desc' }, take: 1 } } })
      : null;
    if (!anchor) return reply.code(400).send({ error: 'no_anchor', message: 'This album has no anchor song to take its style from.' });

    const engine = (['suno', 'ace_step', 'minimax'] as const).find((e) => e === anchor.beats[0]?.provider);
    const input = dropBatchSchema.parse({
      theme: `${album.styleBrief ?? ''}\n\nNEXT ALBUM TRACK: ${theme?.trim() || 'a fresh song in exactly this sound — same voice, same flow, new story.'}`,
      count: 1,
      genre: anchor.project.genre,
      bpm: anchor.project.bpm ?? 103,
      withVocals: true,
      ...(engine ? { songEngine: engine } : {}),
    });

    const dropJob = await prisma.providerJob.create({
      data: { workspaceId, projectId: anchor.projectId, kind: 'drop', provider: 'internal', status: 'RUNNING', startedAt: new Date(), inputJson: { ...input, albumId: album.id } as never },
    });
    const ctx = { app, workspaceId, userId, projectId: anchor.projectId };
    void runDropPipeline(app, ctx, input, dropJob.id)
      .then(async () => {
        // Stamp the new song into the album once the pipeline lands it.
        const done = await prisma.providerJob.findUnique({ where: { id: dropJob.id }, select: { outputJson: true } });
        const songId = (done?.outputJson as { drop?: Array<{ songId?: string }> } | null)?.drop?.[0]?.songId;
        if (songId) await prisma.song.update({ where: { id: songId }, data: { albumId: album.id } }).catch(() => {});
      })
      .catch(async (err) => {
        app.log.error({ err, dropJobId: dropJob.id }, 'album next-track pipeline crashed');
        await prisma.providerJob.update({ where: { id: dropJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: 'album track failed — try again' as never } }).catch(() => {});
      });

    reply.code(202);
    return { jobId: dropJob.id, status: 'queued', albumId: album.id };
  });

  /** Delete an album (songs keep existing — only the grouping dies). */
  app.delete<{ Params: { albumId: string } }>('/:albumId', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    await prisma.album.deleteMany({ where: { id: req.params.albumId, workspaceId } });
    reply.code(204);
    return null;
  });
}
