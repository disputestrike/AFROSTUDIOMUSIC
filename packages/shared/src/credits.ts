/**
 * Credit price table. Values are in 1/100 cent units:
 * 100 = USD 0.01 and 10_000 = USD 1.00.
 *
 * These are product prices, not provider-cost or margin evidence. Reprice only
 * from reconciled ProviderJob, AnalyticsEvent, invoice, and infrastructure data.
 */
export const CREDIT_COSTS = {
  // Text
  hooks_batch_20: 1_500, // $0.15
  lyrics_full: 3_000, // $0.30
  taste_score_batch_50: 2_000, // $0.20
  brief_polish: 500, // $0.05

  // Image
  cover_art_low: 3_000, // $0.30
  cover_art_high: 25_000, // $2.50

  // Music and analysis
  beat_idea_short_30s: 25_000, // $2.50
  full_song_demo: 75_000, // $7.50
  stems_export: 50_000, // $5.00
  analyze_audio: 5_000, // $0.50
  hit_predict: 3_000, // $0.30

  // Voice
  voice_render_30s: 30_000, // $3.00
  voice_render_full: 80_000, // $8.00
  voice_profile_setup: 200_000, // $20.00
  voice_clone_training: 50_000, // $5.00
  voice_sing_render: 15_000, // $1.50

  // Mix and master
  mix_preset: 10_000, // $1.00
  master_preset: 15_000, // $1.50

  // Video
  video_8s: 100_000, // $10.00
  video_20s: 250_000, // $25.00

  // Certified release bundle
  release_export: 5_000, // $0.50
} as const;

export type CreditKey = keyof typeof CREDIT_COSTS;

export function costOf(key: CreditKey): number {
  return CREDIT_COSTS[key];
}

/** Convert a 1/100 cent integer to a USD display string. */
export function formatCredits(microCents: number): string {
  const dollars = microCents / 10_000;
  return `$${dollars.toFixed(2)}`;
}
