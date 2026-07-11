import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { scoreItems } from '@afrohit/ai';
import { referenceOrigin } from '@afrohit/shared';
import { lexiconStats } from '../lib/lexicon';
import { requireAuth } from '../middleware/auth';

const scoreInputSchema = z.object({
  hookIds: z.array(z.string().cuid()).optional(),
  songIds: z.array(z.string().cuid()).optional(),
  lyricIds: z.array(z.string().cuid()).optional(),
});

export default async function taste(app: FastifyInstance) {
  /**
   * Learn-My-Sound profile — what the studio has LEARNED from the artist's own
   * uploads. Aggregates the SoundReference library (per-genre counts + the
   * freshest learned traits) so the artist can SEE their sound taking shape.
   * Free + fast (no AI call — reads the already-learned recipes).
   */
  app.get('/sound-profile', async (req) => {
    const { workspaceId } = requireAuth(req);
    const refs = await prisma.soundReference.findMany({
      // "MY sound" = heard/uploaded songs only — lyric-craft, trend snapshots, and
      // Zap'd reference-lanes live in the same lake but are NOT the artist's sound.
      where: {
        workspaceId,
        // facts: rows are lane-profile numbers from records the artist didn't make — not "my sound"
        NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }, { sourceUrl: { startsWith: 'zap:' } }, { sourceUrl: { startsWith: 'facts:' } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, genre: true, title: true, summary: true, createdAt: true, recipe: true },
    });
    const byGenre = new Map<string, number>();
    for (const r of refs) {
      const g = r.genre ?? 'unknown';
      byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
    }
    // Freshest trait lines per genre — the visible "what it knows about MY sound".
    const traits: Array<{ genre: string; trait: string; learnedAt: Date }> = [];
    const seen = new Set<string>();
    for (const r of refs) {
      const g = r.genre ?? 'unknown';
      if (seen.has(g)) continue;
      seen.add(g);
      const rec = (r.recipe ?? {}) as { drums?: string; groove?: string; vocalStyle?: string; vibe?: string };
      const trait = [rec.drums, rec.groove, rec.vocalStyle].filter(Boolean).join(' · ') || r.summary || rec.vibe || '';
      if (trait) traits.push({ genre: g, trait: trait.slice(0, 220), learnedAt: r.createdAt });
    }
    return {
      totalReferences: refs.length,
      genres: [...byGenre.entries()].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count),
      traits,
      lastLearnedAt: refs[0]?.createdAt ?? null,
    };
  });

  /**
   * THE DATA LAKE — everything the studio has learned, in one honest report:
   * what's in it, how much, and WHERE each kind feeds generation. This is the
   * "what do we have and are we orchestrating from it" answer, live.
   */
  app.get('/data-lake', async (req) => {
    const { workspaceId } = requireAuth(req);
    // Exact totals come from COUNT queries (a take-N page would silently freeze
    // the numbers as the lake grows); the page below only feeds the per-genre
    // breakdown + latest list.
    const [refTotal, lyricCraftN, trendN, zapN, generatedN, refs, materials, counts] = await Promise.all([
      prisma.soundReference.count({ where: { workspaceId } }),
      prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'lyric:' } } }),
      prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'trend:' } } }),
      prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'zap:' } } }),
      prisma.soundReference.count({ where: { workspaceId, recipe: { path: ['source'], equals: 'generated' } } }),
      prisma.soundReference.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, genre: true, sourceUrl: true, title: true, summary: true, createdAt: true, recipe: true },
      }),
      prisma.materialAsset.groupBy({ by: ['genre', 'role'], where: { workspaceId }, _count: true }),
      Promise.all([
        prisma.song.count({ where: { workspaceId } }),
        prisma.lyricDraft.count({ where: { approved: true, project: { workspaceId } } }),
        prisma.hookCandidate.count({ where: { project: { workspaceId } } }),
        prisma.tasteScore.count(),
        prisma.analyticsEvent.count({ where: { workspaceId } }),
      ]),
    ]);
    const kind = (r: { sourceUrl: string; recipe: unknown }) =>
      r.sourceUrl.startsWith('lyric:') ? 'lyricCraft'
      : r.sourceUrl.startsWith('trend:') ? 'trendSnapshots'
      : r.sourceUrl.startsWith('zap:') ? 'zapped'
      : ((r.recipe ?? {}) as { source?: string }).source === 'generated' ? 'selfTraining'
      : 'heardSongs';
    const byKind = {
      heardSongs: Math.max(0, refTotal - lyricCraftN - trendN - zapN - generatedN),
      lyricCraft: lyricCraftN,
      trendSnapshots: trendN,
      selfTraining: generatedN,
      zapped: zapN,
    };
    const genresByKind: Record<string, Record<string, number>> = {};
    for (const r of refs) {
      const k = kind(r);
      const g = r.genre ?? 'unknown';
      genresByKind[k] = genresByKind[k] ?? {};
      genresByKind[k]![g] = (genresByKind[k]![g] ?? 0) + 1;
    }
    return {
      soundReferences: {
        total: refTotal,
        byKind,
        genresByKind,
        latest: refs.slice(0, 40).map((r: { id: string; title: string | null; genre: string | null; sourceUrl: string; recipe: unknown; summary: string | null; createdAt: Date }) => ({ id: r.id, title: r.title, genre: r.genre, kind: kind(r), summary: (r.summary ?? '').slice(0, 260), at: r.createdAt })),
      },
      materials: { total: materials.reduce((n: number, m: { _count: number }) => n + m._count, 0), shelf: materials.map((m: { genre: string | null; role: string; _count: number }) => ({ genre: m.genre, role: m.role, count: m._count })) },
      wordBank: await lexiconStats(workspaceId).catch(() => ({ total: 0, byLanguage: [], byCategory: [] })),
      songs: counts[0],
      approvedLyrics: counts[1],
      hooks: counts[2],
      tasteScores: counts[3],
      tasteEvents: counts[4],
      orchestration: {
        heardSongs: 'learnedReferenceBrief → hooks/lyrics/arranger prompts + learnedStyleTags → the MUSIC MODEL itself',
        lyricCraft: 'learnedLyricCraftBrief → hook writer + lyric writer (patterns only, never words)',
        trendSnapshots: 'researchTrends digest → hook writer + A&R director (snapshotted 1/genre/day)',
        selfTraining: 'QC-passed renders re-enter learnedReferenceBrief (max 1 per brief, uploads always outrank)',
        materials: 'pickMaterial + claudeArrangement → assemble-beat (the exact, deterministic beat)',
        staticLibraries: 'Sound DNA (23 genres + trends enrichment) + hit-craft (8 lyric modes) compiled into every prompt',
        wordBank: 'lexiconPalette → a rotating slice of authentic terms (per language + mood) injected into every hook + lyric so vocabulary stays wide',
      },
    };
  });

  /**
   * TRAINING UTILIZATION — the owner's question answered per reference: is it
   * measured (the DSP ear actually ran), deep-measured, where it came from, how
   * many renders it actually shaped, was material harvested from it, and does it
   * still need a backfill. Usage comes from ONE scan of the last 300 music
   * renders' trainingUsage (counted in memory — never a query per reference).
   */
  app.get('/utilization', async (req) => {
    const { workspaceId } = requireAuth(req);
    const [refs, renders, materials] = await Promise.all([
      prisma.soundReference.findMany({
        // lyric-craft + trend snapshots are non-audio lessons — utilization is
        // about SOUND references (heard/facts/self-trained/zapped lanes).
        where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }] },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, title: true, genre: true, sourceUrl: true, recipe: true, createdAt: true },
      }),
      prisma.providerJob.findMany({
        where: { workspaceId, kind: 'music' },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: { inputJson: true, createdAt: true },
      }),
      // Harvest linkage: SOME material writers stamp meta.sourceUrl with the audio
      // they were split from — the only honest reference↔material key we have.
      prisma.materialAsset.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: { meta: true },
      }),
    ]);

    // One pass over render history → Map<refId, {count, lastAt}>.
    const usage = new Map<string, { count: number; lastAt: Date }>();
    for (const j of renders) {
      const tu = ((j.inputJson ?? {}) as { trainingUsage?: { referenceIds?: string[] } }).trainingUsage;
      for (const id of tu?.referenceIds ?? []) {
        const cur = usage.get(id);
        if (cur) { cur.count++; if (j.createdAt > cur.lastAt) cur.lastAt = j.createdAt; }
        else usage.set(id, { count: 1, lastAt: j.createdAt });
      }
    }
    const harvestedUrls = new Set<string>();
    for (const m of materials) {
      const u = ((m.meta ?? {}) as { sourceUrl?: string }).sourceUrl;
      if (u) harvestedUrls.add(u);
    }

    // Same normalizer family as the learn path ('Afro Fusion' → 'afro_fusion') so
    // a label VARIANT never reads as a lane mismatch.
    const norm = (g: string) => g.toLowerCase().trim().replace(/[\s/-]+/g, '_').replace(/[^a-z_]/g, '');

    type RecipeView = {
      source?: string;
      genre?: string;
      audioMissing?: boolean;
      deepMeasured?: boolean;
      measured?: { engineOk?: boolean };
      refile?: { status?: string; proposedLane?: string };
    };
    return {
      rows: refs.map((r: { id: string; title: string | null; genre: string | null; sourceUrl: string; recipe: unknown; createdAt: Date }) => {
        const rec = (r.recipe ?? {}) as RecipeView;
        // 'zap' is decided HERE (metadata-learned lane, no owned audio); the
        // shared referenceOrigin() covers the other three origins.
        const origin = r.sourceUrl.startsWith('zap:') || rec.source === 'zap' ? ('zap' as const) : referenceOrigin(r.sourceUrl, rec);
        // REAL measurement = the DSP ear ran (same predicate as learnedUsage) —
        // never the presence of LLM-guessed prose.
        const measured = rec.measured?.engineOk === true;
        const u = usage.get(r.id);
        const audioUrl = r.sourceUrl.replace(/^facts:/, '');
        // harvested: true = a material row is stamped with this exact source URL;
        // null = UNKNOWN (most harvest writers don't stamp it — absence proves
        // nothing); false only for zap rows (no audio was ever held, nothing to
        // harvest). Honest three states, per the grounding doctrine.
        const harvested = harvestedUrls.has(audioUrl) ? true : origin === 'zap' ? false : null;
        // Mirrors measure-backfill's own targeting: plain-URL audio refs only
        // ('zap:' has no audio behind the marker; 'facts:' audio is purged after
        // its at-creation pass; audioMissing rows are tombstoned — never retried).
        const backfillable = !r.sourceUrl.startsWith('zap:') && !r.sourceUrl.startsWith('facts:') && !rec.audioMissing;
        // Lane mismatch: a PENDING refile proposal outranks; a decided one
        // (approved/rejected — the user's ear spoke) silences the recipe's stale
        // label; else compare the recipe's own detected genre to the filed lane.
        const refileStatus = rec.refile?.status;
        const detected =
          refileStatus === 'proposed' && rec.refile?.proposedLane ? rec.refile.proposedLane
          : refileStatus === 'approved' || refileStatus === 'rejected' ? null
          : rec.genre && r.genre && norm(rec.genre) !== norm(r.genre) ? rec.genre
          : null;
        return {
          id: r.id,
          title: r.title,
          genre: r.genre,
          origin,
          measured,
          // deep pass really landed (tombstoned give-ups also stamp deepMeasured).
          deepMeasured: rec.deepMeasured === true && !rec.audioMissing,
          usedInRenders: u?.count ?? 0,
          lastUsedAt: u?.lastAt ?? null,
          harvested,
          needsBackfill: backfillable && !measured,
          genreMismatch: detected ? { detected, filed: r.genre } : null,
          learnedAt: r.createdAt,
        };
      }),
      window: { renders: renders.length, materialRows: materials.length },
      note: 'usedInRenders counts the last 300 music renders (trainingUsage). harvested "?" = unknown — harvest rows don’t carry a reference id, so only material stamped with the same source URL can be matched honestly.',
    };
  });

  /**
   * Admin curation of the lake — a bad lesson or junk reference can be removed
   * (workspace-scoped; a delete STICKS, same doctrine as everywhere else).
   */
  app.delete<{ Params: { refId: string } }>('/references/:refId', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const gone = await prisma.soundReference.deleteMany({ where: { id: req.params.refId, workspaceId } });
    if (gone.count === 0) return reply.code(404).send({ error: 'reference_not_found' });
    return { deleted: true };
  });

  app.post(
    '/score',
    { schema: { body: scoreInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { hookIds = [], lyricIds = [] } = scoreInputSchema.parse(req.body);

      const hooks = hookIds.length
        ? await prisma.hookCandidate.findMany({
            where: { id: { in: hookIds }, project: { workspaceId } },
            include: { project: { include: { artist: true } } },
          })
        : [];
      const lyricRows = lyricIds.length
        ? await prisma.lyricDraft.findMany({
            where: { id: { in: lyricIds }, project: { workspaceId } },
            include: { project: { include: { artist: true } } },
          })
        : [];

      if (hooks.length + lyricRows.length === 0) {
        return reply.code(400).send({ error: 'no items' });
      }

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'taste_score_batch_50',
        multiplier: Math.ceil((hooks.length + lyricRows.length) / 50),
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const artist = (hooks[0]?.project.artist ?? lyricRows[0]?.project.artist)!;
      const items = [
        ...hooks.map((h: { id: string; text: string }) => ({ id: h.id, text: h.text, kind: 'hook' as const })),
        ...lyricRows.map((l: { id: string; body: string }) => ({ id: l.id, text: l.body.slice(0, 4_000), kind: 'lyric' as const })),
      ];

      const scores = await scoreItems({ artist: artist as never, items });

      // Persist taste scores + update best-known hook scores for ranking.
      await prisma.$transaction(
        scores.map((s) =>
          prisma.tasteScore.create({
            data: {
              hookId: hooks.find((h: { id: string }) => h.id === s.id) ? s.id : undefined,
              songId: undefined,
              dimensions: s.dimensions as never,
              overall: s.overall,
              similarityRisk: s.similarityRisk,
              tooAiRisk: s.tooAiRisk,
              notes: s.notes,
            },
          })
        )
      );
      await Promise.all(
        scores
          .filter((s) => hooks.find((h: { id: string }) => h.id === s.id))
          .map((s) =>
            prisma.hookCandidate.update({
              where: { id: s.id },
              data: { score: s.overall },
            })
          )
      );

      return { scores };
    }
  );
}
