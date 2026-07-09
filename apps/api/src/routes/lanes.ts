import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { buildLaneProfile, describeLaneProfile, scoreLaneCompliance, describeCompliance, planRepairs, describeRepairPlan, type MeasuredAnalysis } from '@afrohit/shared';
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

/** Every measured reference in a genre lane (with the source ref id, for exclusion). */
async function fetchGenreMeasured(workspaceId: string, genre: string) {
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, genre: true, recipe: true },
  });
  let refsInGenre = 0;
  const measured: Array<{ id: string; analysis: MeasuredAnalysis }> = [];
  for (const r of rows) {
    if (!genreMatches(r.genre, genre)) continue;
    refsInGenre++;
    const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis };
    if (rec.measured && rec.measured.engineOk) measured.push({ id: r.id, analysis: rec.measured });
  }
  return { refsInGenre, measured };
}

export default async function lanes(app: FastifyInstance) {
  app.get('/:genre/profile', async (req) => {
    const { workspaceId } = requireAuth(req);
    const { genre } = req.params as { genre: string };
    const { refsInGenre, measured } = await fetchGenreMeasured(workspaceId, genre);
    const profile = buildLaneProfile(genre, 'genre', measured.map((m) => m.analysis), { minRefs: 3 });
    profile.builtAt = new Date().toISOString();
    return {
      profile,
      summary: describeLaneProfile(profile),
      refsInGenre,
      refsMeasured: measured.length,
      note:
        measured.length < profile.minRefs
          ? `Only ${measured.length} measured reference(s) in "${genre}". Analyze at least ${profile.minRefs} rights-cleared ${genre} tracks (the ear measures each) to build a real lane profile.`
          : undefined,
    };
  });

  // ---- PHASE 2: score a track's compliance against its lane + flag genre drift ----
  // Body: { referenceId } to score a stored analyzed reference (built against the
  // OTHER refs in its lane), or { analysis } to score an external MeasuredAnalysis.
  app.post('/:genre/score', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const { genre } = req.params as { genre: string };
    const body = (req.body ?? {}) as { referenceId?: string; analysis?: MeasuredAnalysis };
    const { measured } = await fetchGenreMeasured(workspaceId, genre);

    let subject: MeasuredAnalysis | undefined = body.analysis;
    let laneRefs = measured;
    if (body.referenceId) {
      const found = measured.find((m) => m.id === body.referenceId);
      if (!found) return reply.code(404).send({ error: 'reference_not_measured', hint: 'That reference has no measured analysis (was it analyzed after the ear went live?).' });
      subject = found.analysis;
      laneRefs = measured.filter((m) => m.id !== body.referenceId); // score against the REST of the lane
    }
    if (!subject) return reply.code(400).send({ error: 'need_referenceId_or_analysis' });

    const profile = buildLaneProfile(genre, 'genre', laneRefs.map((m) => m.analysis), { minRefs: 3 });
    if (!Object.keys(profile.features).length) {
      return reply.code(422).send({ error: 'lane_not_profiled', refsMeasured: laneRefs.length, hint: `Need at least ${profile.minRefs} measured ${genre} references to score against.` });
    }
    const score = scoreLaneCompliance(subject, profile);
    const repair = planRepairs(score); // Phase 3: concrete fixes + the Phase-4 steering addendum
    return { score, repair, summary: describeCompliance(score), repairSummary: describeRepairPlan(repair), profileRefs: laneRefs.length };
  });
}
