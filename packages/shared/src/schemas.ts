/**
 * Zod schemas — the single source of truth for API contracts.
 * Used by Fastify for validation and by the web app for typed clients.
 */
import { z } from 'zod';
import {
  GENRES,
  LANGUAGES,
  SONG_SECTIONS,
  APPROVAL_GATES,
  TASTE_DIMENSIONS,
  MIX_PRESETS,
  MASTER_PRESETS,
} from './constants';

export const genreSchema = z.enum(GENRES);
export const langSchema = z.enum(
  Object.keys(LANGUAGES) as [keyof typeof LANGUAGES, ...Array<keyof typeof LANGUAGES>]
);

// ---------- Artist DNA ------------------------------------------------------

export const artistDnaSchema = z.object({
  name: z.string().min(1).max(80),
  stageName: z.string().min(1).max(80),
  bio: z.string().max(2000).optional(),
  vocalRangeLow: z.string().optional(),
  vocalRangeHigh: z.string().optional(),
  vocalTone: z.array(z.string()).max(20).default([]),
  defaultBpmMin: z.number().int().min(40).max(220).optional(),
  defaultBpmMax: z.number().int().min(40).max(220).optional(),
  languages: z.array(langSchema).default([]),
  laneSummary: z.string().max(2000).optional(),
  references: z
    .array(
      z.object({
        name: z.string(),
        lane: z.string(),
        note: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
  forbiddenStyles: z.array(z.string()).max(20).default([]),
  slang: z
    .array(z.object({ phrase: z.string(), meaning: z.string(), language: z.string() }))
    .optional(),
  cornyBanned: z.array(z.string()).default([]),
  // Automation flags
  morningDrop: z.boolean().optional(),
  autoPilot: z.boolean().optional(),
});
export type ArtistDna = z.infer<typeof artistDnaSchema>;

// ---------- Brief -----------------------------------------------------------

export const briefSchema = z.object({
  mood: z.string().max(120).optional(),
  topic: z.string().max(2000).optional(),
  language: z.array(langSchema).default([]),
  audience: z.string().max(120).optional(),
  bpm: z.number().int().min(40).max(220).optional(),
  references: z.array(z.object({ name: z.string(), lane: z.string() })).optional(),
  notes: z.string().max(2000).optional(),
});
export type Brief = z.infer<typeof briefSchema>;

// ---------- Hooks -----------------------------------------------------------

export const hookSchema = z.object({
  text: z.string().min(2).max(500),
  language: z.array(langSchema).default([]),
  bpm: z.number().int().optional(),
  meta: z
    .object({
      syllablePattern: z.string().optional(),
      melodyNotes: z.string().optional(),
      callResponse: z.boolean().optional(),
    })
    .optional(),
});
export type Hook = z.infer<typeof hookSchema>;

export const generateHooksInputSchema = z.object({
  projectId: z.string().cuid(),
  count: z.number().int().min(1).max(100).default(20),
  brief: briefSchema.optional(),
  excludeIds: z.array(z.string().cuid()).optional(),
});

// ---------- Lyrics ----------------------------------------------------------

export const lyricStructureSchema = z.object({
  sections: z
    .array(
      z.object({
        name: z.enum(SONG_SECTIONS),
        lines: z.array(z.string()).min(1),
      })
    )
    .min(1),
});

export const generateLyricsInputSchema = z.object({
  projectId: z.string().cuid(),
  hookId: z.string().cuid(),
  cleanVersion: z.boolean().default(true),
  languageMix: z.record(langSchema, z.number().min(0).max(1)).optional(),
});

// ---------- Beats / Music ---------------------------------------------------

export const generateBeatInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid().optional(),
  genre: genreSchema,
  // FUSION: extra genres blended into the primary (primary = backbone).
  fusionGenres: z.array(genreSchema).max(2).optional(),
  // First-class mood + the just-listened reference to rebuild (see dropBatchSchema).
  mood: z.string().max(40).optional(),
  pinnedReferenceId: z.string().cuid().optional(),
  bpm: z.number().int().min(60).max(180),
  keySignature: z.string().optional(),
  durationS: z.number().int().min(15).max(240).default(60),
  vibePrompt: z.string().max(1000).optional(),
  withStems: z.boolean().default(true),
  // Full song WITH AI vocals: set withVocals + provide lyrics (or let the API
  // pull the latest lyric for the song). Routes to the vocals model.
  withVocals: z.boolean().default(false),
  lyrics: z.string().max(6000).optional(),
  // Arrange the vocal to sound alive — ad-libs, doubled/harmonized hook,
  // call-and-response — before generation. On by default for vocal songs.
  richVocals: z.boolean().default(true),
  // Which vocal/song model: 'ace_step' (default) or 'minimax' (higher realism).
  songEngine: z.enum(['suno', 'ace_step', 'minimax']).optional(),
});

// ---------- Voice -----------------------------------------------------------

export const voiceConsentInputSchema = z.object({
  legalName: z.string().min(2),
  email: z.string().email(),
  consentText: z.string().min(20),
  signatureUrl: z.string().url().optional(),
  consentAudioUrl: z.string().url().optional(),
});

export const voiceProfileInputSchema = z.object({
  artistId: z.string().cuid(),
  consentId: z.string().cuid(),
  name: z.string().min(1).max(80),
  sampleUrls: z.array(z.string().url()).min(1),
  language: langSchema.optional(),
});

export const renderVocalInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid().optional(),
  voiceProfileId: z.string().cuid(),
  lyricId: z.string().cuid(),
  role: z.enum(['lead', 'double', 'ad-lib', 'harmony']).default('lead'),
  pitchCorrection: z
    .object({ strength: z.number().min(0).max(1), retune: z.number().min(0).max(1) })
    .optional(),
  effects: z.record(z.any()).optional(),
});

// ---------- Mix / Master ----------------------------------------------------

export const createMixInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid(),
  preset: z.enum(MIX_PRESETS),
});

export const createMasterInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid(),
  mixId: z.string().cuid().optional(),
  preset: z.enum(MASTER_PRESETS),
});

// ---------- Images / Videos -------------------------------------------------

export const generateCoverArtInputSchema = z.object({
  projectId: z.string().cuid().optional(),
  brandKitId: z.string().cuid().optional(),
  prompt: z.string().min(5).max(2000),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
  size: z.enum(['1024x1024', '1024x1792', '1792x1024']).default('1024x1024'),
});

export const generateStoryboardInputSchema = z.object({
  projectId: z.string().cuid(),
  durationS: z.number().int().min(8).max(60).default(15),
  format: z.enum(['vertical', 'square', 'landscape']).default('vertical'),
  prompt: z.string().max(2000).optional(),
});

export const renderVideoInputSchema = z.object({
  projectId: z.string().cuid(),
  conceptId: z.string().cuid(),
  shotIndex: z.number().int().nonnegative().optional(),
});

// ---------- Taste / Rights / Approval --------------------------------------

export const tasteScoreSchema = z.object({
  dimensions: z.record(z.enum(TASTE_DIMENSIONS), z.number().min(0).max(10)),
  overall: z.number().min(0).max(10),
  notes: z.string().max(2000).optional(),
  similarityRisk: z.number().min(0).max(1).optional(),
  tooAiRisk: z.number().min(0).max(1).optional(),
});

export const approvalInputSchema = z.object({
  projectId: z.string().cuid(),
  gate: z.enum(APPROVAL_GATES),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  notes: z.string().max(2000).optional(),
});

export const rightsCheckInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid(),
});

// ---------- Sharing / PostGIS ----------------------------------------------

export const createShareLinkSchema = z.object({
  songId: z.string().cuid(),
  targetUrl: z.string().url(),
});

export const logShareEventSchema = z.object({
  shareLinkCode: z.string().min(4).max(32),
  eventType: z.enum(['click', 'play', 'download', 'share', 'conversion']),
  sourcePlatform: z.string().max(40).optional(),
  // Optional lat/lng — typically derived server-side from IP geolocation.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().length(2).optional(),
});

// ---------- Uploads (bring-your-own beat / instrumental / vocal) ------------
// The artist uploads their OWN authentic audio. We never invent or replace it.

export const UPLOAD_KINDS = ['beat', 'instrumental', 'vocal', 'reference', 'stem'] as const;

export const presignUploadSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.string().min(3).max(120),
  ext: z.string().min(1).max(8),
});

const AUDIO_FORMATS = ['wav', 'mp3', 'flac', 'aiff', 'm4a', 'ogg', 'webm'] as const;

export const attachBeatUploadSchema = z.object({
  key: z.string().min(4), // R2 object key returned by /uploads/presign
  songId: z.string().cuid().optional(),
  bpm: z.number().int().min(40).max(220).optional(),
  keySignature: z.string().max(12).optional(),
  durationS: z.number().min(1).max(1200).optional(),
  format: z.enum(AUDIO_FORMATS).default('wav'),
  title: z.string().max(120).optional(),
  instrumental: z.boolean().optional(), // full instrumental vs a loop/beat
});

export const attachVocalUploadSchema = z.object({
  key: z.string().min(4),
  songId: z.string().cuid().optional(),
  role: z.enum(['lead', 'double', 'ad-lib', 'harmony']).default('lead'),
  durationS: z.number().min(1).max(1200).optional(),
  language: langSchema.optional(),
});

// Upload a FINISHED song / full mix — stored as a mix and (by default) sent
// straight to the mastering chain. This is the "master my track" path.
export const attachSongUploadSchema = z.object({
  key: z.string().min(4),
  songId: z.string().cuid().optional(),
  title: z.string().max(120).optional(),
  masterPreset: z.enum(MASTER_PRESETS).default('streaming_lufs_-14'),
  autoMaster: z.boolean().default(true),
});

// Import audio from a URL the artist has the RIGHTS to (own files, direct audio
// links, royalty-free / Creative-Commons sources). Not a streaming-platform
// ripper — the API refuses YouTube/Spotify/etc. hosts.
export const importUrlSchema = z.object({
  projectId: z.string().cuid(),
  url: z.string().url(),
  kind: z.enum(['beat', 'instrumental', 'vocal', 'song', 'reference']),
  songId: z.string().cuid().optional(),
  bpm: z.number().int().min(40).max(220).optional(),
  keySignature: z.string().max(12).optional(),
  role: z.enum(['lead', 'double', 'ad-lib', 'harmony']).optional(),
  title: z.string().max(120).optional(),
});

// ---------- Mixer console (hands-on, DAW-style) ----------------------------
// Every track gets a channel strip: fader + pan + mute/solo + EQ + comp + verb.
// The AI can propose a full settings set ("AI mix it"), or you drive it by hand.

export const mixerEqSchema = z.object({
  low: z.number().min(-12).max(12).default(0), // ~110 Hz shelf
  mid: z.number().min(-12).max(12).default(0), // ~1.5 kHz bell
  high: z.number().min(-12).max(12).default(0), // ~8 kHz shelf
});

export const mixerCompSchema = z.object({
  on: z.boolean().default(false),
  threshold: z.number().min(-40).max(0).default(-18),
  ratio: z.number().min(1).max(20).default(3),
});

export const mixerTrackSchema = z.object({
  id: z.string(),
  kind: z.enum(['beat', 'vocal']),
  label: z.string().max(60).optional(),
  gainDb: z.number().min(-24).max(12).default(0),
  pan: z.number().min(-1).max(1).default(0),
  mute: z.boolean().default(false),
  solo: z.boolean().default(false),
  eq: mixerEqSchema.default({ low: 0, mid: 0, high: 0 }),
  comp: mixerCompSchema.default({ on: false, threshold: -18, ratio: 3 }),
  reverb: z.number().min(0).max(1).default(0),
});
export type MixerTrack = z.infer<typeof mixerTrackSchema>;

export const mixerRenderSchema = z.object({
  songId: z.string().cuid(),
  tracks: z.array(mixerTrackSchema).min(1),
});

export const mixerAiSchema = z.object({
  songId: z.string().cuid(),
  goal: z.string().max(300).optional(), // e.g. "radio-ready, vocal forward"
});

// ---------- Listen / analyze a reference track -----------------------------

export const analyzeAudioSchema = z.object({
  url: z.string().url(), // an uploaded/imported track url the artist has rights to
});

// ---------- Rights spine (split-sheet + ISRC/UPC + green-light) -------------

export const splitEntrySchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(['writer', 'composer', 'producer', 'performer', 'featured', 'other']).default('writer'),
  share: z.number().min(0).max(100),
});

export const rightsInputSchema = z.object({
  splitSheet: z.array(splitEntrySchema).max(20).optional(),
  isrc: z.string().max(20).optional(),
  upc: z.string().max(20).optional(),
  nativeReviewOk: z.boolean().optional(), // a native speaker signed off on YO/IG/HA delivery
});

// ---------- Drop Machine (batch generate → rank → shortlist) ---------------

export const dropBatchSchema = z.object({
  // Roomy: album next-tracks prepend the anchor's styleBrief to the theme.
  theme: z.string().min(3).max(2000),
  count: z.number().int().min(1).max(6).default(3),
  genre: z.string().max(40).default('afrobeats'),
  // FUSION: extra genres blended into the primary (e.g. amapiano × drill) —
  // the primary is the backbone; these inject their signature sounds.
  fusionGenres: z.array(genreSchema).max(2).optional(),
  // MOOD is a first-class production input (colors the music-model tags, the
  // hooks and the lyrics) — not just a word buried in the theme sentence.
  mood: z.string().max(40).optional(),
  // Pin the SoundReference the artist JUST listened to — the remake must
  // rebuild THAT record's sound, not whatever reference happens to be recent.
  pinnedReferenceId: z.string().cuid().optional(),
  bpm: z.number().int().min(60).max(180).default(103),
  withVocals: z.boolean().default(true),
  songEngine: z.enum(['suno', 'ace_step', 'minimax']).optional(),
  // Artist LANE to steer the vibe toward (e.g. "Davido, Wizkid"). Captures the
  // energy/production feel — never copies songs, never named in the output.
  influence: z.string().max(200).optional(),
});

// ---------- Proxied audio upload (browser → API → R2, no R2 CORS) ----------

export const audioUploadSchema = z.object({
  kind: z.string().max(20).default('reference'),
  contentType: z.string().max(60).default('audio/webm'),
  ext: z.string().max(8).default('webm'),
  dataBase64: z.string().min(16), // raw base64 or a data: URL
});

// ---------- Snippet (vertical shareable clip) ------------------------------

export const snippetInputSchema = z.object({
  songId: z.string().cuid().optional(), // defaults to the project's latest song
  startS: z.number().int().min(0).max(600).optional(), // clip start; default ~8s
});

// ---------- Integrations (in-app music engine key) -------------------------

export const integrationsInputSchema = z.object({
  musicProvider: z.enum(['replicate', 'suno', 'stub']).nullable().optional(),
  musicApiKey: z.string().max(400).nullable().optional(), // '' = keep existing
});

// ---------- Chat (Studio Chat) ---------------------------------------------

export const chatMessageInputSchema = z.object({
  threadId: z.string().cuid().optional(), // create new if absent
  projectId: z.string().cuid().optional(),
  content: z.string().min(1).max(8000),
  // Autopilot: loop the whole pipeline autonomously instead of one step/turn.
  autopilot: z.boolean().optional().default(false),
});

export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;
