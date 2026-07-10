import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { buildLaneProfile, describeLaneProfile, scoreLaneCompliance, describeCompliance, planRepairs, describeRepairPlan, type MeasuredAnalysis } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { loadProfileFor, unseededForLane } from '../lib/lane-report';
import { GENRES } from '@afrohit/shared';

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

import { requireAdmin } from './admin';

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

  // THE INVENTORY — per lane, what the lake already holds and what's still needed.
  // This is the answer to "we have 94 songs and 1,394 hooks, why aren't we using
  // them": measured vs unmeasured vs authentic, plus one honest next step per lane.
  app.get('/inventory', async (req) => {
    await requireAdmin(req); // owner dashboard — never public
    const { workspaceId } = requireAuth(req);
    const lanes = await Promise.all(
      (GENRES as readonly string[]).map(async (g) => {
        const { profile, refs, authenticRefs } = await loadProfileFor(workspaceId, g);
        const unseeded = await unseededForLane(g);
        const next = !refs
          ? 'no references yet'
          : authenticRefs >= 3
            ? 'READY — authentic profile live'
            : profile
              ? `self-trained profile only — add ${3 - authenticRefs} more real track(s) to certify`
              : `${refs} ref(s), needs ${Math.max(0, 3 - refs)} more measured to profile`;
        return { lane: g, refs, measuredProfiled: !!profile, authenticRefs, lexiconUnseeded: unseeded, next };
      })
    );
    const [songs, beatsTotal, beatsApproved, hooks, tasteEvents, lexByLang, materials] = await Promise.all([
      prisma.song.count({ where: { workspaceId } }),
      prisma.beatAsset.count({ where: { project: { workspaceId } } }),
      prisma.beatAsset.count({ where: { project: { workspaceId }, approved: true } }),
      prisma.hookCandidate.count({ where: { project: { workspaceId } } }).catch(() => 0),
      prisma.analyticsEvent.count({ where: { workspaceId, name: { startsWith: 'taste.' } } }).catch(() => 0),
      prisma.lexiconEntry.groupBy({ by: ['language'], where: { workspaceId: null }, _count: true }).catch(() => []),
      prisma.materialAsset.groupBy({ by: ['role'], where: { workspaceId }, _count: true }).catch(() => []),
    ]);
    const recentBeats = await prisma.beatAsset.findMany({ where: { project: { workspaceId } }, orderBy: { createdAt: 'desc' }, take: 200, select: { meta: true } });
    const beatsMeasured = recentBeats.filter((b) => ((b.meta ?? {}) as { measured?: { engineOk?: boolean } }).measured?.engineOk).length;
    return {
      totals: { songs, beats: beatsTotal, beatsApproved, beatsMeasuredOfRecent200: beatsMeasured, hooks, tasteEvents },
      lexicon: Object.fromEntries((lexByLang as Array<{ language: string; _count: number }>).map((l) => [l.language, l._count])),
      materials: Object.fromEntries((materials as Array<{ role: string; _count: number }>).map((m) => [m.role, m._count])),
      lanes: lanes.sort((a, b) => b.authenticRefs - a.authenticRefs || b.refs - a.refs),
      backfill: 'POST /api/v1/admin/run {"task":"measure-backfill"} measures what history is missing; {"task":"mine-lexicon"} harvests transcripts into the word bank; nightly-compound runs both every night at 02:45 UTC.',
    };
  });

  // WO-4(d) — THE GAP DASHBOARD: every song the studio has made, its target
  // lane, measured score + coverage, top failing dimensions and drift — the map
  // of what to fix, built from songs already paid for. Unmeasured songs are
  // listed honestly with their reason (never silently missing).
  app.get('/gap-map', async (req) => {
    const { workspaceId } = requireAuth(req);
    const songs = await prisma.song.findMany({
      where: { workspaceId, OR: [{ masters: { some: {} } }, { mixes: { some: {} } }, { beats: { some: {} } }] },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, title: true, laneScore: true, laneGaps: true, hitScore: true, createdAt: true, project: { select: { genre: true } } },
    });
    const rows = songs.map((s) => {
      const gaps = (s.laneGaps ?? {}) as { coverage?: number; failedCritical?: string[]; topGaps?: unknown[]; drift?: { severity?: string }; unmeasured?: boolean; reason?: string; measuredAt?: string };
      return {
        songId: s.id,
        title: s.title,
        lane: s.project?.genre ?? null,
        laneScore: s.laneScore, // measured compliance (§1.6: distinct from hitScore, the taste read)
        hitScore: s.hitScore,
        coverage: gaps.coverage ?? null,
        failedCritical: gaps.failedCritical ?? [],
        topGaps: gaps.topGaps ?? [],
        drift: gaps.drift?.severity ?? null,
        measured: !gaps.unmeasured && s.laneScore != null,
        reason: gaps.unmeasured ? (gaps.reason ?? 'not yet listened') : undefined,
        measuredAt: gaps.measuredAt ?? null,
        createdAt: s.createdAt,
      };
    });
    const measured = rows.filter((r) => r.measured);
    const byLane = new Map<string, { lane: string; n: number; avg: number; failing: number }>();
    for (const r of measured) {
      const k = r.lane ?? 'unknown';
      const cur = byLane.get(k) ?? { lane: k, n: 0, avg: 0, failing: 0 };
      cur.avg = (cur.avg * cur.n + (r.laneScore ?? 0)) / (cur.n + 1);
      cur.n++;
      if ((r.laneScore ?? 0) < 60 || r.failedCritical.length) cur.failing++;
      byLane.set(k, cur);
    }
    return {
      totals: { songs: rows.length, measured: measured.length, unmeasured: rows.length - measured.length },
      byLane: [...byLane.values()].map((l) => ({ ...l, avg: Math.round(l.avg) })).sort((a, b) => b.n - a.n),
      songs: rows,
      note: 'listen-back walks the back catalog nightly (8/run) — unmeasured shrinks on its own; POST /admin/run {"task":"listen-back"} forces a batch now.',
    };
  });
}
