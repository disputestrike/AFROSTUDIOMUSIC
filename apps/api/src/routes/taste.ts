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
