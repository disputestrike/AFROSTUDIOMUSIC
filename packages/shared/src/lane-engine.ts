/**
 * Engine route availability.
 *
 * Picks a connected, legally permitted route and describes its class. Comparative
 * quality is established by benchmark results, never by this helper.
 */
export type Engine = 'suno' | 'eleven' | 'minimax' | 'ace_step' | 'unavailable';

export interface EngineRecommendation {
  engine: Engine;
  ceiling: 'evaluation' | 'standard' | 'draft' | 'unavailable';
  reason: string;
  lift?: string;
}

/**
 * Available full-song route for a lane given the current workspace capabilities.
 */
export function recommendEngine(
  genre: string,
  opts: { sunoAvailable: boolean; elevenAvailable?: boolean; replicateAvailable: boolean; firstParty: boolean }
): EngineRecommendation {
  // W-2 THE WALL: the bridge is never recommended to a non-first-party caller —
  // its output cannot be resold. Callers must pass real workspace status.
  // Reasons speak in ENGINE CLASSES (§1.11): these strings reach user surfaces.
  if (opts.sunoAvailable && opts.firstParty) {
    return {
      engine: 'suno',
      ceiling: 'evaluation',
      reason: 'The flagship evaluation route is connected for this first-party workspace.',
    };
  }
  if (opts.elevenAvailable) {
    return {
      engine: 'eleven',
      ceiling: 'standard',
      reason: `The advanced full-song engine provides section-controlled rendering for ${genre.replace(/_/g, ' ')} on an approved route.`,
    };
  }
  if (!opts.replicateAvailable) {
    return {
      engine: 'unavailable',
      ceiling: 'unavailable',
      reason: 'No full-song engine is connected. Connect an approved advanced or standard engine before rendering.',
    };
  }
  return {
    engine: 'minimax',
    ceiling: 'standard',
    reason: `The standard full-song route is connected for ${genre.replace(/_/g, ' ')}; a draft route remains an explicit fallback.`,
    lift: opts.firstParty ? 'Connect the authorized flagship route to include it in first-party benchmark runs.' : undefined,
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
