/**
 * Taste engine — scores hooks/lyrics on the 10 dimensions defined in
 * @afrohit/shared, plus similarity and "too AI" risks.
 *
 * Implementation: prompt the text model in JSON mode for batch scoring.
 * Future: add a learned regression model fed by your past streaming data,
 * once the catalog grows.
 */
import { generateJson } from './generate';
import { TASTE_SYSTEM, tasteUserPrompt } from './prompts/taste';
import type { ArtistDna } from '@afrohit/shared';

export interface TasteInputItem {
  id: string;
  text: string;
  kind: 'hook' | 'lyric' | 'snippet';
}

export interface TasteScore {
  id: string;
  dimensions: Record<string, number>;
  overall: number;
  similarityRisk: number;
  tooAiRisk: number;
  notes?: string;
}

export async function scoreItems(opts: {
  artist: ArtistDna;
  items: TasteInputItem[];
  model?: string;
}): Promise<TasteScore[]> {
  if (opts.items.length === 0) return [];
  // generateJson = Claude-first (resilient) instead of OpenAI-only — the taste
  // scorer must not hard-fail when the OpenAI account is quota-exhausted.
  const result = await generateJson<{ scores: TasteScore[] }>({
    system: TASTE_SYSTEM,
    user: tasteUserPrompt({ artist: opts.artist, items: opts.items }),
    temperature: 0.2,
    maxTokens: 3_000,
  });
  return result.scores ?? [];
}

/**
 * Sort scored items in descending overall, applying small tie-breakers:
 *   - lower similarityRisk wins
 *   - lower tooAiRisk wins
 */
export function rankByOverall<T extends { score: TasteScore }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.score.overall !== a.score.overall) return b.score.overall - a.score.overall;
    if (a.score.similarityRisk !== b.score.similarityRisk)
      return a.score.similarityRisk - b.score.similarityRisk;
    return a.score.tooAiRisk - b.score.tooAiRisk;
  });
}
