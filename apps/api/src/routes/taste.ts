import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { scoreItems } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';

const scoreInputSchema = z.object({
  hookIds: z.array(z.string().cuid()).optional(),
  songIds: z.array(z.string().cuid()).optional(),
  lyricIds: z.array(z.string().cuid()).optional(),
});

export default async function taste(app: FastifyInstance) {
  /**
   * Learn-My-Sound profile — what the studio has LEARNED from the artist's own
   * uploads. Aggregates the SoundReference library (per-genre counts + the
   * freshest learned traits) so the artist can SEE their sound taking shape.
   * Free + fast (no AI call — reads the already-learned recipes).
   */
  app.get('/sound-profile', async (req) => {
    const { workspaceId } = requireAuth(req);
    const refs = await prisma.soundReference.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, genre: true, title: true, summary: true, createdAt: true, recipe: true },
    });
    const byGenre = new Map<string, number>();
    for (const r of refs) {
      const g = r.genre ?? 'unknown';
      byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
    }
    // Freshest trait lines per genre — the visible "what it knows about MY sound".
    const traits: Array<{ genre: string; trait: string; learnedAt: Date }> = [];
    const seen = new Set<string>();
    for (const r of refs) {
      const g = r.genre ?? 'unknown';
      if (seen.has(g)) continue;
      seen.add(g);
      const rec = (r.recipe ?? {}) as { drums?: string; groove?: string; vocalStyle?: string; vibe?: string };
      const trait = [rec.drums, rec.groove, rec.vocalStyle].filter(Boolean).join(' · ') || r.summary || rec.vibe || '';
      if (trait) traits.push({ genre: g, trait: trait.slice(0, 220), learnedAt: r.createdAt });
    }
    return {
      totalReferences: refs.length,
      genres: [...byGenre.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
      traits,
      lastLearnedAt: refs[0]?.createdAt ?? null,
    };
  });

  app.post(
    '/score',
    { schema: { body: scoreInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { hookIds = [], lyricIds = [] } = scoreInputSchema.parse(req.body);

      const hooks = hookIds.length
        ? await prisma.hookCandidate.findMany({
            where: { id: { in: hookIds }, project: { workspaceId } },
            include: { project: { include: { artist: true } } },
          })
        : [];
      const lyricRows = lyricIds.length
        ? await prisma.lyricDraft.findMany({
            where: { id: { in: lyricIds }, project: { workspaceId } },
            include: { project: { include: { artist: true } } },
          })
        : [];

      if (hooks.length + lyricRows.length === 0) {
        return reply.code(400).send({ error: 'no items' });
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'taste_score_batch_50',
        multiplier: Math.ceil((hooks.length + lyricRows.length) / 50),
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const artist = (hooks[0]?.project.artist ?? lyricRows[0]?.project.artist)!;
      const items = [
        ...hooks.map((h) => ({ id: h.id, text: h.text, kind: 'hook' as const })),
        ...lyricRows.map((l) => ({ id: l.id, text: l.body.slice(0, 4_000), kind: 'lyric' as const })),
      ];

      const scores = await scoreItems({ artist: artist as never, items });

      // Persist taste scores + update best-known hook scores for ranking.
      await prisma.$transaction(
        scores.map((s) =>
          prisma.tasteScore.create({
            data: {
              hookId: hooks.find((h) => h.id === s.id) ? s.id : undefined,
              songId: undefined,
              dimensions: s.dimensions as never,
              overall: s.overall,
              similarityRisk: s.similarityRisk,
              tooAiRisk: s.tooAiRisk,
              notes: s.notes,
            },
          })
        )
      );
      await Promise.all(
        scores
          .filter((s) => hooks.find((h) => h.id === s.id))
          .map((s) =>
            prisma.hookCandidate.update({
              where: { id: s.id },
              data: { score: s.overall },
            })
          )
      );

      return { scores };
    }
  );
}
