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
export function recommendEngine(genre: string, opts: { sunoAvailable: boolean }): EngineRecommendation {
  if (opts.sunoAvailable) {
    return {
      engine: 'suno',
      ceiling: 'best',
      reason: 'Suno V5 is the strongest full-song engine for every lane — top vocals + arrangement.',
    };
  }
  return {
    engine: 'minimax',
    ceiling: 'good',
    reason: `MiniMax music-2.6 is the best available full-song engine for ${genre.replace(/_/g, ' ')} without a Suno key (ACE-Step is the last-resort fallback if it fails).`,
    lift: 'Set SUNO_API_KEY on the worker to render every song on Suno V5 — the biggest single quality lever.',
  };
}

// DRAFT engines can't reliably perform signature-heavy lanes (no prompt teaches
// MusicGen/ACE-Step the amapiano log drum). When one of these rendered a low-scoring
// take, the ceiling is the BAND, not the brief — say so, never blame the user.
const DRAFT_ENGINES = new Set(['ace_step', 'musicgen']);

export function engineAdequacy(engine: string | undefined | null, genre: string): { adequate: boolean; note?: string } {
  const e = (engine ?? '').toLowerCase();
  if (DRAFT_ENGINES.has(e)) {
    return {
      adequate: false,
      note: `Engine "${e}" is a DRAFT engine and cannot reliably perform ${genre.replace(/_/g, ' ')} (especially its signature rhythm). A low lane score here reflects the ENGINE's limit, not your brief — set SUNO_API_KEY (Suno V5) or use MiniMax.`,
    };
  }
  return { adequate: true };
}
