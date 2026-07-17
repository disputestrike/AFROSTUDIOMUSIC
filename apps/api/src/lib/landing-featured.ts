import { prisma } from "@afrohit/db";

// ============================================================================
// LANDING FEATURED WALL (2026-07-16, owner ask: "let them play it right there").
//
// The landing song wall shows releaseReady records; the house can ALSO pin
// hand-picked REAL records (e.g. A.I Baddie) before the first formal release
// green-light. Honesty laws unchanged: a featured song must be a real record
// with playable, approved audio — the wall never fabricates a card, and the
// public copy claims only what is true ("measured and mastered", not
// "green-lit"). Curation is first-party/operator only.
// ============================================================================

const KEY = "landing.featured.v1";
export const MAX_FEATURED = 12;

export async function readFeaturedSongIds(): Promise<string[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export async function writeFeaturedSongIds(ids: string[]): Promise<string[]> {
  const value = [...new Set(ids)].slice(0, MAX_FEATURED);
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  return value;
}

/** PURE ordering law (unit-tested): curated songs first, in curated order,
 *  then the trending tail with duplicates dropped. Missing featured rows
 *  (deleted/quarantined since pinning) silently fall out — the wall never
 *  renders a ghost. */
export function orderFeaturedFirst<T extends { id: string }>(
  featuredIds: string[],
  featured: T[],
  trending: T[]
): T[] {
  const byId = new Map(featured.map(song => [song.id, song]));
  const head = featuredIds
    .map(id => byId.get(id))
    .filter((song): song is T => song !== undefined);
  const seen = new Set(head.map(song => song.id));
  return [...head, ...trending.filter(song => !seen.has(song.id))];
}
