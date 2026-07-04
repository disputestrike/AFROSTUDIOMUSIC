import { getOpenAI, MODELS } from './openai-client';

const STUB_DIM = 1536;
function isStub(): boolean { return process.env.STUB_AI === '1'; }

/** Compute an embedding for a single string (1536-dim with text-embedding-3-small). */
export async function embed(text: string): Promise<number[]> {
  if (isStub()) return stubEmbedding(text);
  const client = getOpenAI();
  const res = await client.embeddings.create({
    model: MODELS.embedding,
    input: text,
  });
  return res.data[0]!.embedding;
}

export async function embedMany(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  if (isStub()) return inputs.map(stubEmbedding);
  const client = getOpenAI();
  const res = await client.embeddings.create({ model: MODELS.embedding, input: inputs });
  return res.data.map((d) => d.embedding);
}

/** Format an embedding for the pgvector text input form: '[0.1,0.2,...]'. */
export function vectorLiteral(vec: number[]): string {
  return '[' + vec.map((n) => Number(n.toFixed(7))).join(',') + ']';
}

/**
 * Deterministic 1536-dim pseudo-embedding for tests. Uses a simple hash so
 * the same text reliably yields the same vector — which is what nearest-
 * neighbor lookups in pgvector need, even if the values are nonsense.
 */
function stubEmbedding(text: string): number[] {
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  const out = new Array<number>(STUB_DIM);
  let x = seed || 1;
  for (let i = 0; i < STUB_DIM; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x / 0xffffffff) * 2 - 1;
  }
  return out;
}
