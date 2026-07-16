import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from './admin';

const reuseInstrumentalSchema = z.object({ title: z.string().trim().min(1).max(100).optional() });

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
  // TENANT SURFACE ISOLATION (Wave 8a): operator-only surface (Suno-shaped
  // consumer app has no instrumental library). Server-enforced for every
  // route in this plugin, not just an unrendered nav item.
  app.addHook('preValidation', async (req) => {
    await requireAdmin(req);
  });

  /** Every instrumental the artist owns (stripped from a song or uploaded). */
  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.materialAsset.findMany({
      where: {
        workspaceId,
        role: 'instrumental',
        readiness: 'ready',
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
        rightsBasis: { not: 'unknown' },
      },
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
  app.post<{ Params: { id: string } }>('/:id/reuse', { schema: { body: reuseInstrumentalSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = reuseInstrumentalSchema.parse(req.body ?? {});
    const inst = await prisma.materialAsset.findFirst({
      where: {
        id: req.params.id,
        workspaceId,
        role: 'instrumental',
        readiness: 'ready',
        qualityState: 'passed',
        rightsBasis: { not: 'unknown' },
      },
    });
    if (!inst) return reply.code(404).send({ error: 'instrumental_not_found' });
    const artist = await prisma.artist.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    if (!artist) return reply.code(400).send({ error: 'no_artist', message: 'No artist profile yet — create a song first.' });

    const title = input.title || 'New over instrumental';
    const instMeta = (inst.meta ?? {}) as { format?: string };
    const reused = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { workspaceId, artistId: artist.id, title, genre: inst.genre ?? 'afrobeats', bpm: inst.bpm ?? 103 },
      });
      const song = await tx.song.create({
        data: { workspaceId, projectId: project.id, title, status: 'SKETCH' },
      });
      const job = await tx.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'music',
          provider: 'instrumental-reuse',
          status: 'RUNNING',
          startedAt: new Date(),
          inputJson: { materialId: inst.id, songId: song.id, operation: 'instrumental-reuse' } as never,
        },
      });
      const created = await tx.beatAsset.create({
        data: {
          projectId: project.id,
          songId: song.id,
          url: inst.url,
          format: instMeta.format ?? (inst.url.toLowerCase().includes('.wav') ? 'wav' : 'mp3'),
          bpm: inst.bpm,
          keySignature: inst.keySignature,
          duration: inst.durationS ?? undefined,
          provider: 'instrumental-reuse',
          assetKind: 'instrumental',
          qualityState: 'passed',
          contentHash: inst.contentHash,
          verifiedAt: inst.verifiedAt,
          approved: true,
          meta: { reusedInstrumental: inst.id, instrumental: true } as never,
        },
      });
      await tx.materialUsage.create({
        data: {
          workspaceId,
          materialId: inst.id,
          providerJobId: job.id,
          beatId: created.id,
          songId: song.id,
          role: 'instrumental',
          sourceBpm: inst.bpm,
          targetBpm: inst.bpm,
          stretchRatio: 1,
          gain: 1,
          pan: 0,
          sections: ['full-song'] as never,
        },
      });
      await tx.providerJob.update({
        where: { id: job.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), outputJson: { beatId: created.id, songId: song.id } as never },
      });
      return { project, song, beat: created };
    });
    reply.code(201);
    return {
      songId: reused.song.id,
      projectId: reused.project.id,
      beatId: reused.beat.id,
      message: 'Instrumental loaded into a new song — open the studio to record/upload a vocal or mix over it.',
    };
  });
}
