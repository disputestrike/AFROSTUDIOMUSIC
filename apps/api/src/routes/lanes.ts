import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { buildLaneProfile, describeLaneProfile, type MeasuredAnalysis } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';

/**
 * PHASE 1 surface — LaneProfile.
 *
 * Builds the measured fingerprint of a genre lane from the workspace's reference
 * library: the ear (Phase 0) attaches a MeasuredAnalysis to every analyzed
 * reference (SoundReference.recipe.measured), and this aggregates those into the
 * per-feature target the Phase-2 compliance scorer will compare against.
 *
 * Only 'measured' values feed the profile (honesty law) — a lane with too few
 * measured references is honestly reported as under-profiled, never faked. Zap /
 * trend / lyric references carry no audio measurement, so they naturally don't
 * contribute (they lack recipe.measured with engineOk).
 */
const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
const genreMatches = (a?: string | null, b?: string | null) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

export default async function lanes(app: FastifyInstance) {
  app.get('/:genre/profile', async (req) => {
    const { workspaceId } = requireAuth(req);
    const { genre } = req.params as { genre: string };

    const rows = await prisma.soundReference.findMany({
      where: {
        workspaceId,
        NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { genre: true, recipe: true },
    });

    const measuredList: MeasuredAnalysis[] = [];
    let refsInGenre = 0;
    for (const r of rows) {
      if (!genreMatches(r.genre, genre)) continue;
      refsInGenre++;
      const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis };
      if (rec.measured && rec.measured.engineOk) measuredList.push(rec.measured);
    }

    const profile = buildLaneProfile(genre, 'genre', measuredList, { minRefs: 3 });
    profile.builtAt = new Date().toISOString();

    return {
      profile,
      summary: describeLaneProfile(profile),
      refsInGenre,
      refsMeasured: measuredList.length,
      note:
        measuredList.length < profile.minRefs
          ? `Only ${measuredList.length} measured reference(s) in "${genre}". Analyze at least ${profile.minRefs} rights-cleared ${genre} tracks (the ear measures each) to build a real lane profile.`
          : undefined,
    };
  });
}
