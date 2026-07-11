/**
 * DATA LAKE — the chat's window into everything the studio has LEARNED.
 *
 * The lake (SoundReference rows + materials + word bank) already feeds every
 * generation (learnedReferenceBrief / learnedStyleTags / learnedLyricCraftBrief).
 * The one thing missing was that the CHAT never saw any of it — its per-turn
 * context only carried the current project, so it would deny that any training
 * had happened ("no learning yet"). These helpers put the lake IN the chat's
 * context and behind a tool, so it can speak to what the artist actually taught
 * it and how that translates into songs.
 */
import { prisma } from '@afrohit/db';

/** Merge the genre-label variants that slipped past normalization on write
 * (e.g. "Afro Fusion" / "afro_fusion" / "Afrobeats" / "afrobeats") so the
 * artist sees ONE clean count per genre, not four. */
function normGenre(g: string | null | undefined): string {
  if (!g) return 'unknown';
  return g.toLowerCase().trim().replace(/[\s/-]+/g, '_');
}

/** WHERE each learned kind actually feeds generation — the honest orchestration
 * map, in plain language for the chat to relay to the artist. */
export const LAKE_ORCHESTRATION = {
  heardSongs:
    'Songs you TRAINED on / listened to → learnedReferenceBrief (into the hook, lyric & vocal-arranger prompts) AND learnedStyleTags (the heard drums / groove / bass go into the MUSIC MODEL itself). So the next song in that genre rebuilds the sound you trained on — not just the words, the actual production.',
  lyricCraft:
    'Lyric-craft studies → learnedLyricCraftBrief into the hook + lyric writers (hook mechanics, flow, imagery — patterns only, NEVER the words).',
  trendSnapshots:
    'Trend snapshots → the hook writer + A&R director, so what you make stays current.',
  selfTraining:
    'Your own QC-passed songs re-enter the lake (max 1 per brief; your real trained references always outrank them).',
  zapped:
    'Songs you Zapped (Shazam layer) → the uncopyrightable CRAFT of that lane/era (production, groove, hook mechanics) feeds the writers as a REFERENCE LANE — never a copy of the song or its lyrics.',
} as const;

export interface DataLakeSummary {
  totalReferences: number;
  byKind: { heardSongs: number; lyricCraft: number; trendSnapshots: number; selfTraining: number; zapped: number; referenceFacts: number };
  /** Top genres among the artist's HEARD/trained sound (not lyric/trend rows). */
  topGenres: Array<{ genre: string; count: number }>;
  /** A few real trait lines so the chat can quote what it actually learned. */
  sampleTraits: string[];
  lastLearnedAt: Date | null;
}

/**
 * Compact lake snapshot for the chat's per-turn WORKSPACE_CONTEXT. Deliberately
 * cheap (4 counts + one small read) so it doesn't slow the chat down.
 */
export async function dataLakeSummary(workspaceId: string): Promise<DataLakeSummary> {
  const [total, lyricCraftN, trendN, zapN, factsN, generatedN, recent] = await Promise.all([
    prisma.soundReference.count({ where: { workspaceId } }),
    prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'lyric:' } } }),
    prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'trend:' } } }),
    prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'zap:' } } }),
    prisma.soundReference.count({ where: { workspaceId, sourceUrl: { startsWith: 'facts:' } } }),
    prisma.soundReference.count({ where: { workspaceId, recipe: { path: ['source'], equals: 'generated' } } }),
    prisma.soundReference.findMany({
      // "MY sound" = heard/trained rows only. Lyric-craft, trends, and Zap'd
      // reference-lanes live in the same table but aren't the artist's own sound.
      where: { workspaceId, NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }, { sourceUrl: { startsWith: 'zap:' } }, { sourceUrl: { startsWith: 'facts:' } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { genre: true, summary: true, recipe: true, createdAt: true },
    }),
  ]);
  const byGenre = new Map<string, number>();
  for (const r of recent) {
    const g = normGenre(r.genre);
    byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
  }
  const topGenres = [...byGenre.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const sampleTraits: string[] = [];
  const seen = new Set<string>();
  for (const r of recent) {
    const g = normGenre(r.genre);
    if (seen.has(g)) continue;
    seen.add(g);
    const rec = (r.recipe ?? {}) as { drums?: string; groove?: string; vocalStyle?: string; vibe?: string };
    const t = [rec.drums, rec.groove, rec.vocalStyle].filter(Boolean).join(' · ') || r.summary || rec.vibe || '';
    if (t) sampleTraits.push(`${g}: ${String(t).slice(0, 140)}`);
    if (sampleTraits.length >= 4) break;
  }
  return {
    totalReferences: total,
    byKind: {
      heardSongs: Math.max(0, total - lyricCraftN - trendN - zapN - factsN - generatedN),
      lyricCraft: lyricCraftN,
      trendSnapshots: trendN,
      selfTraining: generatedN,
      zapped: zapN,
      // facts-only reference records (numbers for lane profiles; no expression)
      referenceFacts: factsN,
    },
    topGenres,
    sampleTraits,
    lastLearnedAt: recent[0]?.createdAt ?? null,
  };
}

/**
 * Fuller report for the show_data_lake chat tool: the summary + the most recent
 * learnings + the orchestration map, so the chat can answer "what have I taught
 * you and how does it make my songs better?" concretely.
 */
export async function dataLakeReport(workspaceId: string) {
  const [summary, recent] = await Promise.all([
    dataLakeSummary(workspaceId),
    prisma.soundReference.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { genre: true, sourceUrl: true, title: true, summary: true, createdAt: true, recipe: true },
    }),
  ]);
  const kindOf = (r: { sourceUrl: string; recipe: unknown }) =>
    r.sourceUrl.startsWith('lyric:')
      ? 'lyricCraft'
      : r.sourceUrl.startsWith('trend:')
        ? 'trendSnapshots'
        : r.sourceUrl.startsWith('zap:')
          ? 'zapped'
          : r.sourceUrl.startsWith('facts:')
            ? 'referenceFacts'
          : ((r.recipe ?? {}) as { source?: string }).source === 'generated'
            ? 'selfTraining'
            : 'heardSongs';
  return {
    ...summary,
    recentLearnings: recent.map((r: { genre: string | null; sourceUrl: string; title: string | null; summary: string | null; createdAt: Date; recipe: unknown }) => ({
      kind: kindOf(r),
      genre: normGenre(r.genre),
      what: String(r.title || r.summary || '').slice(0, 120),
      at: r.createdAt,
    })),
    howItsUsed: LAKE_ORCHESTRATION,
    note: 'This lake feeds EVERY generation automatically — the artist does NOT need to do anything to "apply" it. The next song in a learned genre already pulls these references into both the writers and the music model.',
  };
}
