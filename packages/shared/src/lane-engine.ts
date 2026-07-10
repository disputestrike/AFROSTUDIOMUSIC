/**
 * PHASE 7 — engine ceilings.
 *
 * Codifies the honest quality ceiling of each music engine per lane, and picks the
 * best AVAILABLE one, so the studio always renders on the strongest engine it can and
 * tells the operator how to lift the ceiling. No overclaiming: Suno V5 is the ceiling
 * for full vocal songs; MiniMax is the best available without a Suno key; ACE-Step is
 * the last-resort fallback.
 */
export type Engine = 'suno' | 'minimax' | 'ace_step';

export interface EngineRecommendation {
  engine: Engine;
  ceiling: 'best' | 'good' | 'fallback';
  reason: string;
  lift?: string; // how to raise the ceiling, when not already at 'best'
}

/**
 * Best full-song engine for a lane given what's configured. `sunoAvailable` = a Suno
 * key is set (the worker uses its own SUNO_API_KEY, never the workspace Replicate key).
 */
export function recommendEngine(genre: string, opts: { sunoAvailable: boolean; firstParty?: boolean }): EngineRecommendation {
  // W-2 THE WALL: the bridge is never recommended to a non-first-party caller —
  // its output cannot be resold. Default firstParty=true preserves the internal
  // single-owner behavior; multi-tenant callers MUST pass their real status.
  // Reasons speak in ENGINE CLASSES (§1.11): these strings reach user surfaces.
  if (opts.sunoAvailable && (opts.firstParty ?? true)) {
    return {
      engine: 'suno',
      ceiling: 'best',
      reason: 'The flagship engine is the strongest full-song path for every lane — top vocals + arrangement (first-party releases only).',
    };
  }
  return {
    engine: 'minimax',
    ceiling: 'good',
    reason: `The standard full-song engine is the best available for ${genre.replace(/_/g, ' ')} on this route (a fast draft engine is the last-resort fallback if it fails).`,
    lift: (opts.firstParty ?? true) ? 'Set SUNO_API_KEY on the worker to route first-party songs to the flagship engine — the biggest single quality lever.' : undefined,
  };
}

// DRAFT engines can't reliably perform signature-heavy lanes (no prompt teaches
// MusicGen/ACE-Step the amapiano log drum). When one of these rendered a low-scoring
// take, the ceiling is the BAND, not the brief — say so, never blame the user.
const DRAFT_ENGINES = new Set(['ace_step', 'musicgen']);

export function engineAdequacy(engine: string | undefined | null, genre: string): { adequate: boolean; note?: string } {
  const e = (engine ?? '').toLowerCase();
  if (DRAFT_ENGINES.has(e)) {
    // §1.11 THE WALL: this note reaches user surfaces — class language only.
    return {
      adequate: false,
      note: `This take was rendered on a fast DRAFT engine, which cannot reliably perform ${genre.replace(/_/g, ' ')} (especially its signature rhythm). A low lane score here reflects the ENGINE's limit, not your brief — re-render on a standard or flagship engine.`,
    };
  }
  return { adequate: true };
}
