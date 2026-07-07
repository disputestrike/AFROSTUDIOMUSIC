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
      // "MY sound" = heard/uploaded songs only — lyric-craft studies and trend
      // snapshots live in the same lake but are NOT the artist's sound.
      where: {
        workspaceId,
        NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
      },
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

  /**
   * THE DATA LAKE — everything the studio has learned, in one honest report:
   * what's in it, how much, and WHERE each kind feeds generation. This is the
   * "what do we have and are we orchestrating from it" answer, live.
   */
  app.get('/data-lake', async (req) => {
    const { workspaceId } = requireAuth(req);
    // Exact totals come from COUNT queries (a take-N page would silently freeze
    // the numbers as the lake grows); the page below only feeds the per-genre
    // breakdown + latest list.
    const [refTotal, lyricCraftN, trendN, generatedN, refs, materials, counts] = await Promise.all([
      prisma.soundReference.count({ where: { workspaceId } }),
      prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'lyric:' } } }),
      prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'trend:' } } }),
      prisma.soundReference.count({ where: { workspaceId, recipe: { path: ['source'], equals: 'generated' } } }),
      prisma.soundReference.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, genre: true, sourceUrl: true, title: true, summary: true, createdAt: true, recipe: true },
      }),
      prisma.materialAsset.groupBy({ by: ['genre', 'role'], where: { workspaceId }, _count: true }),
      Promise.all([
        prisma.song.count({ where: { workspaceId } }),
        prisma.lyricDraft.count({ where: { approved: true, project: { workspaceId } } }),
        prisma.hookCandidate.count({ where: { project: { workspaceId } } }),
        prisma.tasteScore.count(),
        prisma.analyticsEvent.count({ where: { workspaceId } }),
      ]),
    ]);
    const kind = (r: { sourceUrl: string; recipe: unknown }) =>
      r.sourceUrl.startsWith('lyric:') ? 'lyricCraft'
      : r.sourceUrl.startsWith('trend:') ? 'trendSnapshots'
      : ((r.recipe ?? {}) as { source?: string }).source === 'generated' ? 'selfTraining'
      : 'heardSongs';
    const byKind = {
      heardSongs: Math.max(0, refTotal - lyricCraftN - trendN - generatedN),
      lyricCraft: lyricCraftN,
      trendSnapshots: trendN,
      selfTraining: generatedN,
    };
    const genresByKind: Record<string, Record<string, number>> = {};
    for (const r of refs) {
      const k = kind(r);
      const g = r.genre ?? 'unknown';
      genresByKind[k] = genresByKind[k] ?? {};
      genresByKind[k]![g] = (genresByKind[k]![g] ?? 0) + 1;
    }
    return {
      soundReferences: {
        total: refTotal,
        byKind,
        genresByKind,
        latest: refs.slice(0, 40).map((r) => ({ id: r.id, title: r.title, genre: r.genre, kind: kind(r), summary: (r.summary ?? '').slice(0, 260), at: r.createdAt })),
      },
      materials: { total: materials.reduce((n, m) => n + m._count, 0), shelf: materials.map((m) => ({ genre: m.genre, role: m.role, count: m._count })) },
      songs: counts[0],
      approvedLyrics: counts[1],
      hooks: counts[2],
      tasteScores: counts[3],
      tasteEvents: counts[4],
      orchestration: {
        heardSongs: 'learnedReferenceBrief → hooks/lyrics/arranger prompts + learnedStyleTags → the MUSIC MODEL itself',
        lyricCraft: 'learnedLyricCraftBrief → hook writer + lyric writer (patterns only, never words)',
        trendSnapshots: 'researchTrends digest → hook writer + A&R director (snapshotted 1/genre/day)',
        selfTraining: 'QC-passed renders re-enter learnedReferenceBrief (max 1 per brief, uploads always outrank)',
        materials: 'pickMaterial + claudeArrangement → assemble-beat (the exact, deterministic beat)',
        staticLibraries: 'Sound DNA (23 genres + trends enrichment) + hit-craft (8 lyric modes) compiled into every prompt',
      },
    };
  });

  /**
   * Admin curation of the lake — a bad lesson or junk reference can be removed
   * (workspace-scoped; a delete STICKS, same doctrine as everywhere else).
   */
  app.delete<{ Params: { refId: string } }>('/references/:refId', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const gone = await prisma.soundReference.deleteMany({ where: { id: req.params.refId, workspaceId } });
    if (gone.count === 0) return reply.code(404).send({ error: 'reference_not_found' });
    return { deleted: true };
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
