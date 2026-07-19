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
  const bm = (beat?.meta ?? {}) as { qc?: { verdict?: string; integratedLufs?: number | null } | null; measured?: { engineOk?: boolean }; compliance?: unknown; laneRepair?: string | null; bestOf?: { tried?: number; rendered?: number; rankedBy?: string; laneScore?: number | null }; assemblyLog?: Array<{ materialId?: string; role?: string }>; ownEngine?: { renderSpec?: unknown } };
  const mm = (master?.meta ?? {}) as { qc?: { integratedLufs?: number; verdict?: string } | null };

  // THE REQUEST THAT MADE IT — read back from the stored render job, never
  // re-derived. The routes stamp inputJson = {...input, trainingUsage}, and
  // inputJson.songId is the link (same lookup will-it-blow.ts uses to keep the
  // user's selections alive through the gate). A regenerate/transform job stores
  // a thinner inputJson — absent fields stay null/[], never reconstructed.
  const renderJob = await prisma.providerJob.findFirst({
    where: { workspaceId, kind: 'music', inputJson: { path: ['songId'], equals: songId } },
    orderBy: { createdAt: 'desc' },
    select: { inputJson: true, createdAt: true },
  });
  const rj = (renderJob?.inputJson ?? {}) as {
    genre?: string; fusionGenres?: string[]; mood?: string; languages?: string[]; voice?: string;
    songEngine?: string; dnaTags?: string[]; vibePrompt?: string;
    trainingUsage?: { referenceIds?: string[]; measured?: number; total?: number; pinnedReferenceId?: string | null };
  };

  // FAILED-PROVIDERS truth — every failed music job for this song, counted, with
  // the last reason (already wall-scrubbed at the worker's markFailed chokepoint;
  // one legacy path stored a bare string, so both shapes are read).
  const [failedCount, lastFailed] = await Promise.all([
    prisma.providerJob.count({ where: { workspaceId, kind: 'music', status: 'FAILED', inputJson: { path: ['songId'], equals: songId } } }),
    prisma.providerJob.findFirst({
      where: { workspaceId, kind: 'music', status: 'FAILED', inputJson: { path: ['songId'], equals: songId } },
      orderBy: { createdAt: 'desc' },
      select: { errorJson: true, finishedAt: true },
    }),
  ]);
  const lastErr = lastFailed?.errorJson as { message?: string } | string | null | undefined;
  const lastErrMsg = (typeof lastErr === 'string' ? lastErr : lastErr?.message ?? '').slice(0, 160) || null;

  // SHELF PROOF — which of the artist's own materials are IN this take. The
  // assembler writes the full transform log onto the beat (material.ts); a
  // provider render simply has none, and we say so rather than imply shelf use.
  const assembly = Array.isArray(bm.assemblyLog) ? bm.assemblyLog : [];
  type MaterialReceipt = {
    materialId: string;
    role: string;
    sourceBpm: number | null;
    targetBpm: number | null;
    stretchRatio: number | null;
    gain: number | null;
    pan: number | null;
    sections: unknown;
  };
  type ReferenceReceipt = {
    referenceId: string;
    position: number;
    pinned: boolean;
    influence: unknown;
    reference: { title: string | null; analysisState: string; rightsBasis: string };
  };
  const [materialReceipts, referenceReceipts]: [MaterialReceipt[], ReferenceReceipt[]] = beat
    ? await Promise.all([
        prisma.materialUsage.findMany({
          where: { workspaceId, beatId: beat.id },
          orderBy: { createdAt: 'asc' },
          select: {
            materialId: true,
            role: true,
            sourceBpm: true,
            targetBpm: true,
            stretchRatio: true,
            gain: true,
            pan: true,
            sections: true,
          },
        }),
        prisma.referenceUsage.findMany({
          where: { workspaceId, beatId: beat.id },
          orderBy: { position: 'asc' },
          select: {
            referenceId: true,
            position: true,
            pinned: true,
            influence: true,
            reference: { select: { title: true, analysisState: true, rightsBasis: true } },
          },
        }),
      ])
    : [[], []];

  // Lane grounding at proof time — WHO the profile that judged this song was.
  const refs = await prisma.soundReference.findMany({
    where: {
      workspaceId,
      active: true,
      analysisState: 'measured',
      rightsBasis: { not: 'unknown' },
      NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
    },
    take: 300,
    select: { genre: true, sourceUrl: true, recipe: true, rightsBasis: true },
  });
  type RefRow = { genre: string | null; sourceUrl: string; recipe: unknown; rightsBasis: string };
  const origins = refs
    .filter((r: RefRow) => norm(r.genre) === norm(song.project?.genre))
    .filter((r: RefRow) => ((r.recipe ?? {}) as { measured?: { engineOk?: boolean } }).measured?.engineOk)
    .map((r: RefRow) => ({ origin: referenceOrigin(r.sourceUrl, (r.recipe ?? {}) as { source?: string }, r.rightsBasis) }));
  const grounding = groundingOf(origins);

  // Credits actually ledgered against this song (renders charged to the project
  // are attributed there — stated, not hidden).
  const ledger = await prisma.creditLedger.aggregate({
    where: { workspaceId, refId: songId, delta: { lt: 0 } },
    _count: true,
  });

  const gaps = (song.laneGaps ?? {}) as Record<string, unknown>;
  return {
    proofPackVersion: 3,
    assembledAt: new Date().toISOString(),
    song: { id: song.id, title: song.lyric?.title || song.title, lane: song.project?.genre ?? null, bpm: song.project?.bpm ?? null },
    // What the artist ASKED for vs what actually judged it — selected genre from
    // the render job, effective genre from the project. A mismatch is a fact
    // worth showing, not a bug to hide. §1.11: songEngine is a vendor id in
    // storage, so it leaves here as a CLASS only ('own' maps to the own class).
    request: renderJob
      ? {
          selectedGenre: rj.genre ?? null,
          effectiveGenre: song.project?.genre ?? null,
          fusionGenres: rj.fusionGenres ?? [],
          mood: rj.mood ?? null,
          languages: rj.languages ?? [],
          voice: rj.voice ?? null,
          engineRequested: rj.songEngine ? engineClass(rj.songEngine === 'own' ? 'afrohit-own' : rj.songEngine) : null,
          promptStyleTags: rj.dnaTags ?? [],
          vibePrompt: rj.vibePrompt ? rj.vibePrompt.slice(0, 200) : null,
          at: renderJob.createdAt,
        }
      : { note: 'no render job stored — request facts unavailable, not reconstructed' },
    renderSpecification: bm.ownEngine?.renderSpec ?? null,
    // Which references shaped this render. New takes read the append-only usage
    // ledger; pre-ledger takes fall back to their stored job metadata.
    training: referenceReceipts.length
      ? {
          evidence: 'durable-ledger',
          usedReferenceIds: referenceReceipts.map((receipt) => receipt.referenceId),
          measuredCount: referenceReceipts.filter((receipt) => receipt.reference.analysisState === 'measured').length,
          totalCount: referenceReceipts.length,
          pinnedReferenceId: referenceReceipts.find((receipt) => receipt.pinned)?.referenceId ?? null,
          receipts: referenceReceipts.map((receipt) => ({
            referenceId: receipt.referenceId,
            title: receipt.reference.title,
            position: receipt.position,
            pinned: receipt.pinned,
            analysisState: receipt.reference.analysisState,
            rightsBasis: receipt.reference.rightsBasis,
            influence: receipt.influence,
          })),
        }
      : rj.trainingUsage
      ? {
          evidence: 'historical-job-metadata',
          usedReferenceIds: rj.trainingUsage.referenceIds ?? [],
          measuredCount: rj.trainingUsage.measured ?? 0,
          totalCount: rj.trainingUsage.total ?? 0,
          pinnedReferenceId: rj.trainingUsage.pinnedReferenceId ?? null,
          ...((rj.trainingUsage.measured ?? 0) < (rj.trainingUsage.total ?? 0)
            ? { note: 'measured < total — references not yet deep-measured contribute little (the honest backfill signal)' }
            : {}),
        }
      : { usedReferenceIds: [], note: renderJob ? 'render predates training-usage tracking' : 'no render job stored' },
    // THE SINGING BRAIN's receipt: sung-form transformation + the measurable
    // scorecard (hook recurrence, chorus reduction, melisma, clip ratio) the
    // render actually carried. Absent = the render predates the singing brain
    // or the lyrics were artist-authored (verbatim law — never transformed).
    singing: (rj as { sungForm?: { scorecard?: unknown; alignmentCount?: number; applied?: boolean; skipped?: string; retries?: number } }).sungForm
      ? (rj as { sungForm: Record<string, unknown> }).sungForm
      : { note: renderJob ? 'no sung-form record — render predates the Singing Brain, or artist-authored lyrics rode verbatim' : 'no render job stored' },
    // Shelf materials in this take. New assemblies read transactional receipts;
    // historical takes may only have the immutable-at-render assembly metadata.
    materials: beat
      ? materialReceipts.length
        ? {
            evidence: 'durable-ledger',
            usedMaterialIds: materialReceipts.map((receipt) => receipt.materialId),
            roles: materialReceipts.map((receipt) => receipt.role),
            receipts: materialReceipts,
          }
        : assembly.length
          ? {
              evidence: 'historical-beat-metadata',
              usedMaterialIds: assembly.map((x) => x.materialId ?? null),
              roles: assembly.map((x) => x.role ?? null),
            }
        : { usedMaterialIds: [], note: 'provider render — no shelf material in this take' }
      : { usedMaterialIds: [], note: 'no rendered take stored' },
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
    // The one prose field — and it only restates the stored bestOf numbers
    // (measured > inferred > unknown, same law as everything above).
    whyThisWon: beat
      ? bm.bestOf && (bm.bestOf.rendered ?? 1) > 1
        ? `ranked #1 of ${bm.bestOf.rendered} takes by ${bm.bestOf.rankedBy ?? 'lane score'}`
        : 'single take — no ranking ran'
      : 'no rendered take stored',
    // Failed attempts are part of the truth: counted, last reason shown (class
    // language only — scrubbed at the worker before it was ever stored).
    failures:
      failedCount > 0
        ? { count: failedCount, lastError: lastErrMsg ?? 'no reason recorded', lastAt: lastFailed?.finishedAt ?? null }
        : { count: 0, note: 'no failed render attempts on record for this song' },
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
