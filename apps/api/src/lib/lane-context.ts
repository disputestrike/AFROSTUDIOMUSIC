import { prisma } from '@afrohit/db';
import { buildLaneProfile, describeLaneProfile, type MeasuredAnalysis, type LaneProfile } from '@afrohit/shared';

/**
 * PHASE 4 — the lane context injected into generation.
 *
 * Assembles the two measured signals the Lane pipeline produces, in ONE place that
 * every generation site pulls from:
 *  - laneTargets: the Phase-1 MEASURED lane fingerprint (what this genre actually is,
 *    from the artist's analyzed references) rendered as concrete targets.
 *  - repair: the Phase-3 steering addendum stored on the song's last measured take
 *    (what to fix on the next render to get back in-lane).
 *
 * Both are ADDITIVE and fail-open: empty until the ear has measured references / a
 * prior take, and any error yields empty strings — generation is never blocked. They
 * flow through fuseSoundDna (which places them first, so they never truncate out).
 */
const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
const genreMatches = (a?: string | null, b?: string | null) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** API-side lane profile from the workspace's measured references; null when the lane
 * can't be profiled yet (< minRefs). Mirrors the worker's loadLaneProfile. */
export async function loadLaneProfileForGenre(workspaceId: string, genre?: string | null): Promise<LaneProfile | null> {
  if (!genre) return null;
  try {
    const rows = await prisma.soundReference.findMany({
      where: {
        workspaceId,
        active: true,
        analysisState: { not: 'failed' },
        rightsBasis: { not: 'unknown' },
        NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
      },
      orderBy: { createdAt: 'desc' }, take: 300, select: { genre: true, recipe: true },
    });
    const measured: MeasuredAnalysis[] = [];
    for (const r of rows) {
      if (!genreMatches(r.genre, genre)) continue;
      const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis };
      if (rec.measured?.engineOk) measured.push(rec.measured);
    }
    const profile = buildLaneProfile(genre, 'genre', measured, { minRefs: 3 });
    return Object.keys(profile.features).length ? profile : null;
  } catch {
    return null;
  }
}

export async function laneContext(
  workspaceId: string,
  genre?: string | null,
  songId?: string | null,
): Promise<{ laneTargets: string; repair: string }> {
  let laneTargets = '';
  let repair = '';
  try {
    if (genre) {
      const rows = await prisma.soundReference.findMany({
        where: {
          workspaceId,
          active: true,
          analysisState: { not: 'failed' },
          rightsBasis: { not: 'unknown' },
          NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
        },
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
      if (Object.keys(profile.features).length) {
        // Does THIS song have a stored repair (a prior take measured off-lane)?
        // Only then does the FULL "match these" target set make sense.
        let storedRepair = '';
        if (songId) {
          const beat = await prisma.beatAsset.findFirst({ where: { songId }, orderBy: { createdAt: 'desc' }, select: { meta: true } });
          storedRepair = ((beat?.meta ?? {}) as { laneRepair?: string }).laneRepair ?? '';
        }
        const steerMode = (process.env.LANE_STEER ?? 'repair').toLowerCase();
        if (storedRepair || steerMode === 'full') {
          // REPAIR MODE (or explicit full-steer): pull the take back in-lane.
          laneTargets = `MEASURED LANE TARGET — the ${genre} lane, measured from your analyzed references. Build the beat to match these:\n${describeLaneProfile(profile)}`;
          repair = storedRepair;
        } else {
          // FRESH RENDER — LIGHT IDENTITY BAND ONLY. Feeding the full profile as
          // "match these" into every new song made everything converge on the
          // lane median ("only one direction, worse beats" — the owner heard the
          // homogenization before the numbers showed it: takes scoring 96/100
          // compliance are maximally SAME). Identity stays law; direction is free.
          const tempo = profile.features['tempoBpm']?.numeric;
          const band = tempo ? `keep the tempo between ${Math.round(tempo.p10)}–${Math.round(tempo.p90)} bpm` : '';
          laneTargets = `LANE IDENTITY (light) — this is ${genre}: ${band ? band + ' and ' : ''}honor the lane's core groove. EVERYTHING ELSE IS YOURS: take a fresh direction on melody, energy, texture and arrangement — do NOT converge on previous takes.`;
        }
      }
    }
  } catch {
    /* additive — never break generation */
  }
  return { laneTargets, repair };
}
