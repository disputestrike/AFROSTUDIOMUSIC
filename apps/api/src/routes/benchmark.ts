import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

/**
 * LISTENING BENCHMARK — the ear-vs-machine ground truth loop (Feature 4).
 * The honest answer to "does lane 87 mean it actually sounds good?": rate real
 * renders 1–5, tag the machine's lane score, and compare per genre. Also captures
 * blind A/B picks (ours vs a reference). Without this the app can lie to itself.
 */
const rateSchema = z.object({
  genre: z.string().min(1),
  audioUrl: z.string().url(),
  humanRating: z.number().int().min(1).max(5),
  source: z.enum(['afrohit', 'reference', 'suno']).default('afrohit'),
  songId: z.string().optional(),
  engine: z.string().optional(),
  laneScore: z.number().int().min(0).max(100).optional(),
  blindLabel: z.string().max(4).optional(),
  notes: z.string().max(2000).optional(),
});

export default async function benchmark(app: FastifyInstance) {
  // Record one rating.
  app.post('/rate', { schema: { body: rateSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const b = rateSchema.parse(req.body);
    const row = await prisma.benchmarkRating.create({ data: { workspaceId, ...b } });
    reply.code(201);
    return { id: row.id };
  });

  // Songs rendered recently that still need a rating — the queue to listen through.
  app.get('/queue', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rated = new Set((await prisma.benchmarkRating.findMany({ where: { workspaceId }, select: { songId: true } })).map((r) => r.songId).filter(Boolean));
    const beats = await prisma.beatAsset.findMany({
      where: { project: { workspaceId }, approved: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, url: true, provider: true, songId: true, project: { select: { genre: true } }, meta: true },
    });
    return beats
      .filter((b) => !b.songId || !rated.has(b.songId))
      .map((b) => ({
        songId: b.songId, url: b.url, genre: b.project.genre, engine: b.provider,
        laneScore: ((b.meta ?? {}) as { bestOf?: { laneScore?: number } }).bestOf?.laneScore ?? null,
      }));
  });

  // Per-genre aggregate: human average vs machine lane average + the GAP (where
  // the score and the ear disagree). This is the number that tells the truth.
  app.get('/summary', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.benchmarkRating.findMany({ where: { workspaceId }, select: { genre: true, source: true, humanRating: true, laneScore: true } });
    const byGenre: Record<string, { n: number; humanSum: number; laneSum: number; laneN: number; ref: number[]; ours: number[] }> = {};
    for (const r of rows) {
      const g = (byGenre[r.genre] ??= { n: 0, humanSum: 0, laneSum: 0, laneN: 0, ref: [], ours: [] });
      g.n++; g.humanSum += r.humanRating;
      if (r.laneScore != null) { g.laneSum += r.laneScore; g.laneN++; }
      (r.source === 'afrohit' ? g.ours : g.ref).push(r.humanRating);
      void r.source;
    }
    const avg = (a: number[]) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null);
    return {
      genres: Object.entries(byGenre).map(([genre, g]) => ({
        genre, ratings: g.n,
        avgHuman: +(g.humanSum / g.n).toFixed(2),
        avgLaneScore: g.laneN ? Math.round(g.laneSum / g.laneN) : null,
        // Ear on a 0–100 scale for a like-for-like gap vs the lane score.
        earVsLaneGap: g.laneN ? Math.round((g.humanSum / g.n) * 20 - g.laneSum / g.laneN) : null,
        avgOurs: avg(g.ours), avgReference: avg(g.ref),
        beatsReference: avg(g.ours) != null && avg(g.ref) != null ? (avg(g.ours)! > avg(g.ref)!) : null,
      })),
      note: 'earVsLaneGap = (avgHuman×20) − avgLaneScore. Large negative = the machine scores it higher than your ear does — its confidence is inflated for that genre.',
    };
  });
}
