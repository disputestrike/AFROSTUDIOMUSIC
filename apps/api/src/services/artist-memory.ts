/**
 * Production memory: approvals and rejections influence later generations.
 * Stored embeddings are queried when available, with lexical and recency
 * ranking as a deterministic fallback when the embedding provider is down.
 */
import { embed } from "@afrohit/ai";
import { prisma } from "@afrohit/db";
import { rankMemoryCandidates } from "@afrohit/shared";

export async function recordFeedback(opts: {
  workspaceId: string;
  artistId: string;
  kind: "approved" | "rejected";
  content: string;
  sourceKind: "hook" | "lyric";
  sourceId: string;
}): Promise<void> {
  const content = opts.content.trim().slice(0, 2_000);
  if (!content) return;

  // Repeated clicks and identical drafts should update one memory, not buy and
  // store the same embedding forever. The latest decision wins.
  const existing = await prisma.artistMemoryChunk.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      artistId: opts.artistId,
      content,
      kind: { in: ["approved", "rejected"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    await prisma.artistMemoryChunk.update({
      where: { id: existing.id },
      data: {
        kind: opts.kind,
        meta: { sourceKind: opts.sourceKind, sourceId: opts.sourceId } as never,
      },
    });
    return;
  }

  const startedAt = Date.now();
  const embedding = await embed(content).catch(() => null);
  await prisma.$transaction([
    prisma.artistMemoryChunk.create({
      data: {
        workspaceId: opts.workspaceId,
        artistId: opts.artistId,
        kind: opts.kind,
        content,
        embedding: (embedding ?? undefined) as never,
        meta: { sourceKind: opts.sourceKind, sourceId: opts.sourceId } as never,
      },
    }),
    prisma.analyticsEvent.create({
      data: {
        workspaceId: opts.workspaceId,
        name: "artist_memory.embedding",
        properties: {
          purpose: "feedback_write",
          inputCharacters: content.length,
          durationMs: Date.now() - startedAt,
          stored: Boolean(embedding),
        } as never,
      },
    }),
  ]);
}

export interface MemoryContext {
  approvedExamples: string[];
  rejectedExamples: string[];
}

export async function memoryContext(opts: {
  workspaceId: string;
  artistId: string;
  query: string;
  limit?: number;
}): Promise<MemoryContext> {
  const limit = Math.min(25, Math.max(1, opts.limit ?? 15));
  const poolSize = Math.max(60, limit * 6);
  const [approved, rejected] = await Promise.all([
    prisma.artistMemoryChunk.findMany({
      where: {
        workspaceId: opts.workspaceId,
        artistId: opts.artistId,
        kind: "approved",
      },
      orderBy: { createdAt: "desc" },
      take: poolSize,
      select: { content: true, embedding: true, createdAt: true },
    }),
    prisma.artistMemoryChunk.findMany({
      where: {
        workspaceId: opts.workspaceId,
        artistId: opts.artistId,
        kind: "rejected",
      },
      orderBy: { createdAt: "desc" },
      take: poolSize,
      select: { content: true, embedding: true, createdAt: true },
    }),
  ]);

  const candidates = [...approved, ...rejected];
  const canUseSemantic =
    opts.query.trim().length > 0 &&
    candidates.some(candidate => Array.isArray(candidate.embedding));
  const startedAt = Date.now();
  const queryEmbedding = canUseSemantic
    ? await embed(opts.query.slice(0, 4_000)).catch(() => null)
    : null;
  const rank = (rows: typeof approved) =>
    rankMemoryCandidates({
      candidates: rows,
      query: opts.query,
      queryEmbedding,
      limit,
    }).map(candidate => candidate.content);

  const context = {
    approvedExamples: rank(approved),
    rejectedExamples: rank(rejected),
  };
  await prisma.analyticsEvent
    .create({
      data: {
        workspaceId: opts.workspaceId,
        name: "artist_memory.recall",
        properties: {
          artistId: opts.artistId,
          mode: queryEmbedding ? "hybrid_semantic" : "lexical_recency",
          queryCharacters: opts.query.length,
          candidateCount: candidates.length,
          approvedReturned: context.approvedExamples.length,
          rejectedReturned: context.rejectedExamples.length,
          durationMs: Date.now() - startedAt,
        } as never,
      },
    })
    .catch(() => undefined);
  return context;
}
