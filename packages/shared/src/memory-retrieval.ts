export interface MemoryRetrievalCandidate {
  content: string;
  embedding?: unknown;
  createdAt: Date | string;
}

export interface RankedMemoryCandidate extends MemoryRetrievalCandidate {
  lexicalScore: number;
  recencyScore: number;
  semanticScore: number | null;
  score: number;
}

function finiteVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : null;
}

function normalizedTokens(value: string): Set<string> {
  const words =
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu) ?? [];
  return new Set(words.filter(word => word.length > 1));
}

function lexicalSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.sqrt(left.size * right.size);
}

function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length === 0) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function normalizedContent(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Hybrid retrieval over JSON embeddings. Semantic relevance leads when a query
 * vector is available; lexical relevance and recency keep unembedded memories
 * useful and provide a deterministic provider-failure fallback.
 */
export function rankMemoryCandidates(opts: {
  candidates: MemoryRetrievalCandidate[];
  query: string;
  queryEmbedding?: unknown;
  limit: number;
  now?: Date;
}): RankedMemoryCandidate[] {
  const limit = Math.max(0, Math.floor(opts.limit));
  if (limit === 0) return [];

  const queryTokens = normalizedTokens(opts.query);
  const queryVector = finiteVector(opts.queryEmbedding);
  const nowMs = (opts.now ?? new Date()).getTime();
  const halfLifeMs = 180 * 24 * 60 * 60 * 1_000;

  const ranked = opts.candidates.map(candidate => {
    const lexicalScore = lexicalSimilarity(
      queryTokens,
      normalizedTokens(candidate.content)
    );
    const createdAtMs = new Date(candidate.createdAt).getTime();
    const ageMs = Number.isFinite(createdAtMs)
      ? Math.max(0, nowMs - createdAtMs)
      : halfLifeMs;
    const recencyScore = Math.exp(-ageMs / halfLifeMs);
    const candidateVector = finiteVector(candidate.embedding);
    const cosine =
      queryVector && candidateVector
        ? cosineSimilarity(queryVector, candidateVector)
        : null;
    const semanticScore = cosine === null ? null : (cosine + 1) / 2;
    const score = queryVector
      ? 0.7 * (semanticScore ?? 0.5) + 0.2 * lexicalScore + 0.1 * recencyScore
      : 0.75 * lexicalScore + 0.25 * recencyScore;
    return {
      ...candidate,
      lexicalScore,
      recencyScore,
      semanticScore,
      score,
    };
  });

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  });

  const unique: RankedMemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    const key = normalizedContent(candidate.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length === limit) break;
  }
  return unique;
}
