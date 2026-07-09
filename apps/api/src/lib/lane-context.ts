import { prisma } from '@afrohit/db';
import { buildLaneProfile, describeLaneProfile, type MeasuredAnalysis } from '@afrohit/shared';

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
      if (Object.keys(profile.features).length) {
        laneTargets = `MEASURED LANE TARGET — the ${genre} lane, measured from your analyzed references. Build the beat to match these:\n${describeLaneProfile(profile)}`;
      }
    }
    if (songId) {
      const beat = await prisma.beatAsset.findFirst({ where: { songId }, orderBy: { createdAt: 'desc' }, select: { meta: true } });
      const meta = (beat?.meta ?? {}) as { laneRepair?: string };
      if (meta.laneRepair) repair = meta.laneRepair;
    }
  } catch {
    /* additive — never break generation */
  }
  return { laneTargets, repair };
}
