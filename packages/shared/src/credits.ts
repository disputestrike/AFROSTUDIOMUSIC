/**
 * Credit cost table. All values are in 1/100 cents (i.e. 100 = 1 cent, 10_000 = $1).
 * The integer precision avoids float math on money.
 *
 * Rule of thumb: charge the user 2-3× our actual provider cost so we cover the
 * PayPal fee, infra, support, and margin. Tune as real cost data lands.
 */
export const CREDIT_COSTS = {
  // Text — cheap, generated up-front; we *do* charge but trivially
  hooks_batch_20: 1_500, // $0.15
  lyrics_full: 3_000, // $0.30
  taste_score_batch_50: 2_000, // $0.20
  brief_polish: 500, // $0.05
  // Image
  cover_art_low: 3_000, // $0.30
  cover_art_high: 25_000, // $2.50
  // Music
  beat_idea_short_30s: 25_000, // $2.50
  full_song_demo: 75_000, // $7.50
  stems_export: 50_000, // $5.00
  // Listen / Shazam — audio understanding on Replicate (paid inference)
  analyze_audio: 5_000, // $0.50
  // Voice
  voice_render_30s: 30_000, // $3.00
  voice_render_full: 80_000, // $8.00
  voice_profile_setup: 200_000, // $20.00 one-time per voice
  // Mix / master
  mix_preset: 10_000, // $1.00
  master_preset: 15_000, // $1.50
  // Video
  video_8s: 100_000, // $10.00
  video_20s: 250_000, // $25.00
  // Bundle export with rights receipt
  release_export: 5_000, // $0.50
} as const;

export type CreditKey = keyof typeof CREDIT_COSTS;

export function costOf(key: CreditKey): number {
  return CREDIT_COSTS[key];
}

/** Convert 1/100-cent integer to display USD string. */
export function formatCredits(microCents: number): string {
  const dollars = microCents / 10_000;
  return `$${dollars.toFixed(2)}`;
}
