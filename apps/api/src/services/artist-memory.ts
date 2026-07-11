/**
 * Production memory — the taste feedback loop.
 *
 * Every approve/reject writes an ArtistMemoryChunk (with a pgvector embedding
 * when available). Hook generation reads recent approved/rejected chunks and
 * feeds them back into the prompt, so the system converges on the artist's
 * taste instead of resetting every session.
 */
import { prisma } from '@afrohit/db';
import { embed } from '@afrohit/ai';

export async function recordFeedback(opts: {
  workspaceId: string;
  artistId: string;
  kind: 'approved' | 'rejected';
  content: string;
  sourceKind: 'hook' | 'lyric';
  sourceId: string;
}): Promise<void> {
  // Semantic memory: compute the embedding NOW so the taste graph supports
  // similarity retrieval, not just recency. Best-effort — feedback must never
  // be lost because the embedding provider blinked (embedding stays null).
  const embedding = await embed(opts.content.slice(0, 2_000)).catch(() => null);
  await prisma.artistMemoryChunk.create({
    data: {
      workspaceId: opts.workspaceId,
      artistId: opts.artistId,
      kind: opts.kind,
      content: opts.content.slice(0, 2_000),
      embedding: (embedding ?? undefined) as never,
      meta: { sourceKind: opts.sourceKind, sourceId: opts.sourceId } as never,
    },
  });
}

export interface MemoryContext {
  approvedExamples: string[];
  rejectedExamples: string[];
}

/** Latest feedback examples for prompt injection. Recency beats similarity for MVP. */
export async function memoryContext(artistId: string, limit = 15): Promise<MemoryContext> {
  const [approved, rejected] = await Promise.all([
    prisma.artistMemoryChunk.findMany({
      where: { artistId, kind: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { content: true },
    }),
    prisma.artistMemoryChunk.findMany({
      where: { artistId, kind: 'rejected' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { content: true },
    }),
  ]);
  return {
    approvedExamples: approved.map((c: { content: string }) => c.content),
    rejectedExamples: rejected.map((c: { content: string }) => c.content),
  };
}
