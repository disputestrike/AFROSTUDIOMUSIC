import { prisma } from '@afrohit/db';
import { buildLaneProfile, scoreLaneCompliance, planRepairs, type MeasuredAnalysis, type LaneProfile } from '@afrohit/shared';
import { measureAudio, dspAvailable } from './dsp';

/**
 * PHASE 4 — close the loop. Measure a freshly rendered take with the ear, score it
 * against its genre lane (Phase 1/2), plan the repairs (Phase 3), and STORE the
 * compliance + repair steering on the beat so the next regeneration is pushed back
 * in-lane (via laneContext → fuseSoundDna → the music style).
 *
 * Cost-aware + fail-open: gated behind LANE_ASSESS=1 (measuring every render costs
 * DSP time), and a no-op when the ear is unavailable or the lane has too few measured
 * references to profile. Never throws into the render pipeline.
 */
const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
const genreMatches = (a?: string | null, b?: string | null) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * Load the lane profile for a genre from this workspace's MEASURED references.
 * Returns null when the lane can't be profiled yet (< minRefs measured refs) — the
 * caller then falls open. Shared by the post-render assessment AND best-of-N ranking.
 */
export async function loadLaneProfile(workspaceId: string, genre?: string | null): Promise<LaneProfile | null> {
  if (!genre) return null;
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { genre: true, recipe: true },
  });
  const measured: MeasuredAnalysis[] = [];
  for (const r of rows) {
    if (!genreMatches(r.genre, genre)) continue;
    const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis };
    if (rec.measured?.engineOk) measured.push(rec.measured);
  }
  const profile = buildLaneProfile(genre, 'genre', measured, { minRefs: 3 });
  return Object.keys(profile.features).length ? profile : null;
}

export async function assessLaneCompliance(opts: {
  workspaceId: string;
  genre?: string | null;
  beatId: string;
  audioUrl: string;
}): Promise<void> {
  try {
    // LANE_ASSESS default-ON (only off when explicitly '0') per the FINAL INSTRUCTION.
    if (process.env.LANE_ASSESS === '0' || !opts.genre) return;
    if (!(await dspAvailable())) return;

    const profile = await loadLaneProfile(opts.workspaceId, opts.genre);
    if (!profile) return; // no lane to compare against yet

    // Measure the rendered take (full-mix — cheap; log-drum stays 'inferred' and is
    // excluded from the score, so no Demucs cost here).
    const analysis = await measureAudio(opts.audioUrl);
    if (!analysis.engineOk) return;

    const score = scoreLaneCompliance(analysis, profile);
    const plan = planRepairs(score);

    const beat = await prisma.beatAsset.findUnique({ where: { id: opts.beatId }, select: { meta: true } });
    const meta = (beat?.meta ?? {}) as Record<string, unknown>;
    await prisma.beatAsset.update({
      where: { id: opts.beatId },
      data: {
        meta: {
          ...meta,
          compliance: { overall: score.overall, coverage: score.coverage, drift: score.drift, scored: score.scored },
          laneRepair: plan.clean ? null : plan.soundBriefAddendum,
        } as never,
      },
    });
    console.log(`[lane-assess] ${opts.genre}: compliance=${score.overall}/100 drift=${score.drift.severity} repairs=${plan.repairs.length}`);
  } catch (err) {
    console.warn('[lane-assess] failed (non-fatal):', (err as Error)?.message);
  }
}
