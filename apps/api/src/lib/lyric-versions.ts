/**
 * LYRIC VERSION HISTORY — never lose the original.
 *
 * Benjamin's problem: when the AI rewrites a lyric (make-it-bigger / the will-it-
 * blow gate), it overwrites the body in place — so if the rewrite is WORSE than
 * what he had, the original is gone. Sometimes the original IS the better take.
 *
 * snapshotLyricVersion() saves the CURRENT lyric into LyricDraft.versions BEFORE
 * any overwrite, newest-first, capped so the JSON stays bounded. Then the artist
 * can revert to the original (or any prior take) from the catalog. Best-effort:
 * a snapshot failure never blocks the rewrite.
 */
import { prisma } from '@afrohit/db';

export interface LyricVersion {
  body: string;
  title: string | null;
  cleanVersion: string | null;
  at: string; // ISO timestamp
  label?: string; // e.g. "original", "before make-it-bigger", "before revert"
}

const MAX_VERSIONS = 15;

export function readVersions(raw: unknown): LyricVersion[] {
  return Array.isArray(raw) ? (raw as LyricVersion[]).filter((v) => v && typeof v.body === 'string') : [];
}

/**
 * Push the lyric's CURRENT body/title into its version history before it's about
 * to change. The very first snapshot is auto-labelled "original" so the artist can
 * always find their starting point.
 */
export async function snapshotLyricVersion(lyricId: string, label?: string): Promise<void> {
  try {
    const cur = await prisma.lyricDraft.findUnique({
      where: { id: lyricId },
      select: { body: true, title: true, cleanVersion: true, versions: true },
    });
    if (!cur?.body?.trim()) return;
    const prior = readVersions(cur.versions);
    // Don't snapshot an identical body twice in a row (idempotent re-saves).
    if (prior[0]?.body === cur.body) return;
    const entry: LyricVersion = {
      body: cur.body,
      title: cur.title ?? null,
      cleanVersion: cur.cleanVersion ?? null,
      at: new Date().toISOString(),
      label: label ?? (prior.length === 0 ? 'original' : undefined),
    };
    const next = [entry, ...prior].slice(0, MAX_VERSIONS);
    await prisma.lyricDraft.update({ where: { id: lyricId }, data: { versions: next as never } });
  } catch {
    /* best-effort — never block a rewrite on history bookkeeping */
  }
}
