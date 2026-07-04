/**
 * Production memory — the taste feedback loop.
 *
 * Every approve/reject writes an ArtistMemoryChunk (with a pgvector embedding
 * when available). Hook generation reads recent approved/rejected chunks and
 * feeds them back into the prompt, so the system converges on the artist's
 * taste instead of resetting every session.
 */
import { prisma } from '@afrohit/db';
import { embed, vectorLiteral } from '@afrohit/ai';

export async function recordFeedback(opts: {
  workspaceId: string;
  artistId: string;
  kind: 'approved' | 'rejected';
  content: string;
  sourceKind: 'hook' | 'lyric';
  sourceId: string;
}): Promise<void> {
  const chunk = await prisma.artistMemoryChunk.create({
    data: {
      workspaceId: opts.workspaceId,
      artistId: opts.artistId,
      kind: opts.kind,
      content: opts.content.slice(0, 2_000),
      meta: { sourceKind: opts.sourceKind, sourceId: opts.sourceId } as never,
    },
  });
  // Embedding is best-effort — memory rows are useful even without vectors.
  try {
    const vec = await embed(opts.content.slice(0, 2_000));
    await prisma.$executeRawUnsafe(
      `UPDATE "ArtistMemoryChunk" SET embedding = $1::vector WHERE id = $2`,
      vectorLiteral(vec),
      chunk.id
    );
  } catch {
    /* no embedding available (no key / no pgvector) — fine */
  }
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
    approvedExamples: approved.map((c) => c.content),
    rejectedExamples: rejected.map((c) => c.content),
  };
}
