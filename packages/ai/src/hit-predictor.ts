/**
 * predictHit — run the A&R hit scout over a song and return calibrated hit +
 * viral scores with honest, actionable feedback. Claude-first (the taste brain);
 * graceful null if no model is configured so callers never hard-fail.
 */
import { generateJson } from './generate';
import { anthropicEnabled } from './anthropic-client';
import { HIT_PREDICTOR_SYSTEM, hitPredictorUserPrompt } from './prompts/hit-predictor';

export interface HitPrediction {
  hitScore: number; // 0-100
  viralScore: number; // 0-100
  dimensions: Record<string, number>;
  verdict: string;
  strengths: string[];
  risks: string[];
  toMakeItBigger: string[];
  comparableLane: string;
  tiktokMoment: string | null;
}

export async function predictHit(opts: {
  title?: string;
  genre?: string;
  bpm?: number;
  hook?: string;
  lyrics?: string;
  soundDna?: string;
  trends?: string;
  hasMaster?: boolean;
  languages?: string[];
}): Promise<HitPrediction | null> {
  // Needs a real judgment model — no stub scores (a fake hit score is worse than
  // none). STUB_AI still returns the deterministic shape via generateJson.
  if (!anthropicEnabled() && process.env.STUB_AI !== '1' && !process.env.OPENAI_API_KEY) return null;
  try {
    const out = await generateJson<HitPrediction>({
      system: HIT_PREDICTOR_SYSTEM,
      user: hitPredictorUserPrompt(opts),
      maxTokens: 1_500,
      temperature: 0.4,
    });
    if (typeof out?.hitScore !== 'number') return null;
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    return {
      hitScore: clamp(out.hitScore),
      viralScore: clamp(out.viralScore ?? 0),
      dimensions: out.dimensions ?? {},
      verdict: out.verdict ?? '',
      strengths: out.strengths ?? [],
      risks: out.risks ?? [],
      toMakeItBigger: out.toMakeItBigger ?? [],
      comparableLane: out.comparableLane ?? '',
      tiktokMoment: out.tiktokMoment ?? null,
    };
  } catch {
    return null;
  }
}
