/**
 * PER-SONG PROOF PACK (adopted from CrucibAI's evidence-bundle discipline).
 *
 * One JSON artifact per song answering "why did this song pass?" from STORED
 * measurements only — never recomputed prose, never invented numbers. Fields
 * the ear didn't measure say so explicitly (measured > inferred > unknown).
 * Persisted onto Song.proofPack when a song goes green-lit; readable any time
 * via GET /songs/:id/proof. §1.11 wall: engines appear as CLASSES only.
 */
import { prisma } from '@afrohit/db';
import { engineClass, referenceOrigin, groundingOf, describeGrounding } from '@afrohit/shared';

const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');

export async function assembleProofPack(workspaceId: string, songId: string): Promise<Record<string, unknown> | null> {
  const song = await prisma.song.findFirst({
    where: { id: songId, workspaceId },
    include: {
      project: { select: { genre: true, bpm: true } },
      beats: { orderBy: { createdAt: 'desc' }, take: 1 },
      masters: { orderBy: { createdAt: 'desc' }, take: 1 },
      lyric: { select: { title: true } },
    },
  });
  if (!song) return null;
  const beat = song.beats[0];
  const master = song.masters[0];
  const bm = (beat?.meta ?? {}) as { qc?: unknown; measured?: { engineOk?: boolean }; compliance?: unknown; laneRepair?: string | null; bestOf?: { tried?: number; rendered?: number; rankedBy?: string; laneScore?: number | null } };
  const mm = (master?.meta ?? {}) as { qc?: { integratedLufs?: number; verdict?: string } | null };

  // Lane grounding at proof time — WHO the profile that judged this song was.
  const refs = await prisma.soundReference.findMany({
    where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
    take: 300,
    select: { genre: true, sourceUrl: true, recipe: true },
  });
  const origins = refs
    .filter((r) => norm(r.genre) === norm(song.project?.genre))
    .filter((r) => ((r.recipe ?? {}) as { measured?: { engineOk?: boolean } }).measured?.engineOk)
    .map((r) => ({ origin: referenceOrigin(r.sourceUrl, (r.recipe ?? {}) as { source?: string }) }));
  const grounding = groundingOf(origins);

  // Credits actually ledgered against this song (renders charged to the project
  // are attributed there — stated, not hidden).
  const ledger = await prisma.creditLedger.aggregate({
    where: { workspaceId, refId: songId, delta: { lt: 0 } },
    _count: true,
  });

  const gaps = (song.laneGaps ?? {}) as Record<string, unknown>;
  return {
    proofPackVersion: 1,
    assembledAt: new Date().toISOString(),
    song: { id: song.id, title: song.lyric?.title || song.title, lane: song.project?.genre ?? null, bpm: song.project?.bpm ?? null },
    lane: {
      score: song.laneScore ?? null,
      coverage: (gaps.coverage as number | undefined) ?? null,
      drift: (gaps.drift as { severity?: string } | undefined)?.severity ?? null,
      failedCritical: (gaps.failedCritical as string[] | undefined) ?? [],
      judgedAgainst: describeGrounding(grounding),
      measuredAt: (gaps.measuredAt as string | undefined) ?? null,
      note: song.laneScore == null ? 'not yet listened-back — unknown, not assumed' : undefined,
    },
    ar: {
      hitScore: song.hitScore ?? null,
      viralScore: song.viralScore ?? null,
      willBlow: ((song.hitRead ?? {}) as { willBlow?: boolean }).willBlow ?? null,
      note: song.hitScore == null ? 'no A&R read stored — advisory score absent, never invented' : 'advisory — the artist’s ear decides',
    },
    render: beat
      ? {
          engineClass: engineClass(beat.provider ?? 'stub'),
          takesTried: bm.bestOf?.tried ?? 1,
          takesRendered: bm.bestOf?.rendered ?? 1,
          rankedBy: bm.bestOf?.rankedBy ?? 'single take',
          earRead: bm.measured?.engineOk ? 'measured' : 'ear unavailable at render time',
          repairApplied: bm.laneRepair ? 'steering stored for next regen' : 'none needed',
          qc: bm.qc ?? null,
        }
      : { note: 'no rendered take stored' },
    master: master
      ? { preset: master.preset, measuredLufs: mm.qc?.integratedLufs ?? null, qcVerdict: mm.qc?.verdict ?? 'not measured', at: master.createdAt }
      : { note: 'not mastered' },
    cost: { ledgeredActionsForThisSong: ledger._count, note: 'render charges attributed to the project appear in /admin/economics, not here' },
    audio: {
      current: master?.url ?? beat?.url ?? null,
      note: 'artifact referenced by URL; bytes live in storage — this pack certifies the measurements, storage certifies the file',
    },
  };
}
