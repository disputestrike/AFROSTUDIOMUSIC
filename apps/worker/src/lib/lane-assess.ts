import { prisma } from '@afrohit/db';
import { priorAnalyses, buildLaneProfile, scoreLaneCompliance, planRepairs, referenceOrigin, groundingOf, type MeasuredAnalysis, type LaneProfile, type LaneGrounding } from '@afrohit/shared';
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
/** C-2 — grounding census for a lane: who the measured refs actually ARE. */
export async function laneGrounding(workspaceId: string, genre?: string | null): Promise<LaneGrounding> {
  if (!genre) return { external: 0, factsOnly: 0, self: 0, grounded: false };
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { genre: true, sourceUrl: true, recipe: true },
  });
  const origins: Array<{ origin: ReturnType<typeof referenceOrigin> }> = [];
  for (const r of rows) {
    if (!genreMatches(r.genre, genre)) continue;
    const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis; source?: string };
    if (rec.measured?.engineOk) origins.push({ origin: referenceOrigin(r.sourceUrl, rec) });
  }
  return groundingOf(origins);
}

export async function loadLaneProfile(workspaceId: string, genre?: string | null): Promise<LaneProfile | null> {
  if (!genre) return null;
  const rows = await prisma.soundReference.findMany({
    where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { genre: true, sourceUrl: true, recipe: true },
  });
  // C-2 — GROUNDING RULE: a lane's profile counts NON-SELF refs as grounding.
  // Self-generated measurements join only once the lane is grounded (≥3 non-self)
  // — scoring our own renders against a guess and folding the matches back in
  // would teach the lane to sound like ourselves (feedback loop, not learning).
  const nonSelf: MeasuredAnalysis[] = [];
  const self: MeasuredAnalysis[] = [];
  for (const r of rows) {
    if (!genreMatches(r.genre, genre)) continue;
    const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis; source?: string };
    if (!rec.measured?.engineOk) continue;
    (referenceOrigin(r.sourceUrl, rec) === 'self-generated' ? self : nonSelf).push(rec.measured);
  }
  if (nonSelf.length >= 3) {
    const profile = buildLaneProfile(genre, 'genre', [...nonSelf, ...self], { minRefs: 3 });
    if (Object.keys(profile.features).length) return profile;
  }
  // COLD-START WORKAROUND: expert priors — published knowledge as numbers, every
  // field method-tagged 'expert-prior'. Correct scoring/ranking/repair from day
  // one; certification still demands 3 AUTHENTIC refs, and C-2 locks self-
  // promotion until the lane is grounded in non-self references.
  const priors = priorAnalyses(genre);
  if (priors.length) {
    const pp = buildLaneProfile(genre, 'genre', priors, { minRefs: 1 });
    if (Object.keys(pp.features).length) {
      console.log(`[lane] ${genre}: expert-prior profile in use (${nonSelf.length} external refs; ${self.length} self excluded — self-promotion locked)`);
      return pp;
    }
  }
  return null;
}

export async function assessLaneCompliance(opts: {
  workspaceId: string;
  genre?: string | null;
  beatId: string;
  audioUrl: string;
  /** WO-4(c): when the take belongs to a song, the read writes through to the
   *  Song row too — no new song is "done" until the studio has listened to it. */
  songId?: string | null;
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

    const beat = await prisma.beatAsset.findUnique({ where: { id: opts.beatId }, select: { meta: true, songId: true } });
    const meta = (beat?.meta ?? {}) as Record<string, unknown>;
    // Persist the RAW MeasuredAnalysis too (anti-pattern #9: a library that grows
    // without storing its DSP teaches nothing — and Adjust-Song classifies against
    // ALL lanes from this exact object, no re-measure needed).
    const laneRead = {
      measured: analysis,
      compliance: { overall: score.overall, coverage: score.coverage, drift: score.drift, scored: score.scored, failedCritical: score.failedCritical },
      laneRepair: plan.clean ? null : plan.laneSteeringAddendum,
      assessedGenre: opts.genre,
      assessedAt: new Date().toISOString(),
    };
    await prisma.beatAsset.update({
      where: { id: opts.beatId },
      data: { meta: { ...meta, ...laneRead } as never },
    });
    // WO-4(c): write the listen-back through to the song (measured lane read
    // beside the LLM hitScore — §1.6, two questions, two systems, never merged).
    const songId = opts.songId ?? beat?.songId;
    if (songId) {
      await prisma.song.update({
        where: { id: songId },
        data: {
          laneScore: score.overall,
          measuredAnalysis: analysis as never,
          laneGaps: {
            coverage: score.coverage,
            failedCritical: score.failedCritical,
            topGaps: (plan.repairs ?? []).slice(0, 5),
            drift: score.drift,
            assessedGenre: opts.genre,
            measuredAt: new Date().toISOString(),
          } as never,
        },
      }).catch((e) => console.warn('[lane-assess] song write-through failed:', (e as Error)?.message));
    }
    console.log(`[lane-assess] ${opts.genre}: compliance=${score.overall}/100 drift=${score.drift.severity} repairs=${plan.repairs.length}`);
  } catch (err) {
    console.warn('[lane-assess] failed (non-fatal):', (err as Error)?.message);
  }
}
