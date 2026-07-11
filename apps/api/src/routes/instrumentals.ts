import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

/**
 * THE INSTRUMENTAL LIBRARY — a findable home for instrumentals.
 *
 * Benjamin: "I strip the vocal off a song and I want that instrumental stored
 * somewhere I can find it and reuse it — I keep saying instrumental and I don't
 * get it." Stripping a song's vocal (separate_stems) now files the full
 * instrumental as a MaterialAsset with role='instrumental'; this route lists them
 * all in one place and lets him load one into a NEW song to work over.
 */
export default async function instrumentals(app: FastifyInstance) {
  /** Every instrumental the artist owns (stripped from a song or uploaded). */
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.materialAsset.findMany({
      where: { workspaceId, role: 'instrumental' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      total: rows.length,
      instrumentals: rows.map((m: { id: string; url: string; genre: string | null; bpm: number | null; keySignature: string | null; durationS: number | null; source: string; meta: unknown; createdAt: Date }) => {
        const meta = (m.meta ?? {}) as { fromSongId?: string; fromSongTitle?: string };
        return {
          id: m.id,
          url: m.url,
          genre: m.genre,
          bpm: m.bpm,
          keySignature: m.keySignature,
          durationS: m.durationS,
          source: m.source, // 'artist_stem' (stripped) | 'upload'
          fromSongId: meta.fromSongId ?? null,
          createdAt: m.createdAt,
        };
      }),
    };
  });

  /**
   * Load an instrumental into a NEW song (new id) to work over — record/upload a
   * vocal or mix on top. (The AI sung-engines generate their own beat and can't
   * sing over an existing track, so reuse = a fresh song carrying this instrumental
   * as its audio, for the studio/mixer.)
   */
  app.post<{ Params: { id: string }; Body: { title?: string } }>('/:id/reuse', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const inst = await prisma.materialAsset.findFirst({ where: { id: req.params.id, workspaceId, role: 'instrumental' } });
    if (!inst) return reply.code(404).send({ error: 'instrumental_not_found' });
    const artist = await prisma.artist.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    if (!artist) return reply.code(400).send({ error: 'no_artist', message: 'No artist profile yet — create a song first.' });

    const title = (req.body?.title as string)?.slice(0, 100) || 'New over instrumental';
    const project = await prisma.project.create({
      data: { workspaceId, artistId: artist.id, title, genre: inst.genre ?? 'afrobeats', bpm: inst.bpm ?? 103 },
    });
    const song = await prisma.song.create({
      data: { workspaceId, projectId: project.id, title, status: 'SKETCH' },
    });
    const beat = await prisma.beatAsset.create({
      data: {
        projectId: project.id, songId: song.id, url: inst.url, format: 'mp3',
        bpm: inst.bpm, keySignature: inst.keySignature, duration: inst.durationS ?? undefined,
        provider: 'upload', approved: true,
        meta: { reusedInstrumental: inst.id, instrumental: true } as never,
      },
    });
    reply.code(201);
    return { songId: song.id, projectId: project.id, beatId: beat.id, message: 'Instrumental loaded into a new song — open the studio to record/upload a vocal or mix over it.' };
  });
}
