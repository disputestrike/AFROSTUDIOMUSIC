/**
 * Cross-cutting domain constants. Keep this file dependency-free
 * so it can be imported by web, API, worker, and AI packages alike.
 */

export const GENRES = [
  // Afro / diaspora core
  'afrobeats',
  'afro_fusion',
  'amapiano',
  'afro_dancehall',
  'street_pop',
  'afro_rnb',
  'gospel',
  'afro_pop',
  'hip_hop',
  'highlife',
  'reggae',
  // Global — all-genre, each with full Sound DNA (packages/ai/src/sound-dna/global-genres.ts)
  'pop',
  'rnb',
  'dancehall',
  'drill',
  'trap',
  'house',
  'edm',
  'reggaeton',
  'latin_pop',
  'country',
  'rock',
  'soul',
] as const;
export type Genre = (typeof GENRES)[number];

export const LANGUAGES = {
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  pcm: 'Nigerian Pidgin',
  en: 'English',
  fr: 'French',
  pt: 'Portuguese',
  sw: 'Swahili',
  zu: 'Zulu',
  xh: 'Xhosa',
  twi: 'Twi',
  st: 'Sesotho',
  tn: 'Setswana',
  tsotsitaal: 'Tsotsitaal (SA street)',
  ln: 'Lingala',
  wo: 'Wolof',
  bm: 'Bambara',
  nouchi: 'Nouchi (Ivorian street)',
  es: 'Spanish',
  ar: 'Arabic (Egyptian/Maghreb)',
  ht: 'Haitian Creole (Kreyòl)',
  kriolu: 'Cape Verdean Kriolu',
  am: 'Amharic',
  patois: 'Jamaican Patois',
} as const;
export type LanguageCode = keyof typeof LANGUAGES;

export const SONG_SECTIONS = [
  'intro',
  'verse',
  'pre_hook',
  'hook',
  'bridge',
  'breakdown',
  'outro',
  'adlib',
] as const;
export type SongSection = (typeof SONG_SECTIONS)[number];

export const APPROVAL_GATES = [
  'brief',
  'hook',
  'lyrics',
  'beat',
  'voice',
  'mix',
  'rights',
  'release',
] as const;
export type ApprovalGate = (typeof APPROVAL_GATES)[number];

/** Order matters — a song can't progress past a gate without all earlier ones cleared. */
export const APPROVAL_GATE_ORDER: ApprovalGate[] = [
  'brief',
  'hook',
  'lyrics',
  'beat',
  'voice',
  'mix',
  'rights',
  'release',
];

export const TASTE_DIMENSIONS = [
  'hookMemorability',
  'firstEightSeconds',
  'chorusSimplicity',
  'languageAuthenticity',
  'danceability',
  'replayValue',
  'uniqueness',
  'emotionalClarity',
  'tikTokLoopQuality',
  'platformFit',
] as const;
export type TasteDimension = (typeof TASTE_DIMENSIONS)[number];

// Instrumental-beat providers. 'replicate' (MusicGen) is the VALIDATED default
// for a Replicate-only operator; eleven/stable_audio/mubert are UNVERIFIED
// scaffolds. 'beatoven' was removed (advertised with no adapter → silent stub).
// Every string here MUST have a case in musicAdapter().
export const MUSIC_PROVIDERS = ['replicate', 'eleven', 'stable_audio', 'mubert', 'stub'] as const;
export const VOICE_PROVIDERS = ['eleven', 'openai', 'stub'] as const;
export const VIDEO_PROVIDERS = ['veo', 'sora', 'stub'] as const;
export const IMAGE_PROVIDERS = ['openai', 'stub'] as const;

export type MusicProvider = (typeof MUSIC_PROVIDERS)[number];
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export const MIX_PRESETS = ['radio', 'club', 'tiktok', 'youtube', 'acapella', 'instrumental'] as const;
export const MASTER_PRESETS = [
  'streaming_lufs_-14',
  'breathe_-16.5', // HEADROOM LAW: finished records breathe (Suno's own measured range) — default for finished/uploaded masters
  'afro_stream_-9', // retired from default paths (the "-9 crusher") — still selectable for club-loud intent
  'club_-9',
  'reels_-16',
  'cd_-9',
] as const;

export const PLAN_TIERS = ['STARTER', 'CREATOR', 'PRO', 'STUDIO'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Soft monthly limits per plan. Hard limits = these * 1.2. */
export const PLAN_LIMITS: Record<
  PlanTier,
  {
    seats: number;
    monthlyDemoSongs: number;
    monthlyVoiceRenders: number;
    monthlyVideoSeconds: number;
    coverArt: number;
  }
> = {
  STARTER: { seats: 1, monthlyDemoSongs: 0, monthlyVoiceRenders: 0, monthlyVideoSeconds: 0, coverArt: 5 },
  CREATOR: { seats: 1, monthlyDemoSongs: 20, monthlyVoiceRenders: 0, monthlyVideoSeconds: 30, coverArt: 30 },
  PRO: { seats: 3, monthlyDemoSongs: 60, monthlyVoiceRenders: 100, monthlyVideoSeconds: 90, coverArt: 100 },
  STUDIO: { seats: 10, monthlyDemoSongs: 300, monthlyVoiceRenders: 500, monthlyVideoSeconds: 600, coverArt: 1000 },
};

/**
 * Monthly credit allowance (in 1/100-cent micro-cents) granted when a
 * subscription activates AND on each recurring PAYMENT.SALE.COMPLETED. Sized to
 * the tier's promised demo-song volume at the full_song_demo price (75_000) plus
 * a cover-art base, so a paying customer actually RECEIVES the capability their
 * plan advertises (audit DANGEROUS: activation used to grant delta:0 = nothing).
 */
export const PLAN_CREDIT_GRANT_CENTS: Record<PlanTier, number> = {
  STARTER: 30_000, // ~5 cover arts, no demo songs
  CREATOR: 20 * 75_000 + 30_000, // ~20 full songs + art
  PRO: 60 * 75_000 + 100_000, // ~60 full songs + art
  STUDIO: 300 * 75_000 + 1_000_000, // ~300 full songs + art
};
