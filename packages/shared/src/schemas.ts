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
  bpm: z.number().int().min(60).max(180),
  keySignature: z.string().optional(),
  durationS: z.number().int().min(15).max(240).default(60),
  vibePrompt: z.string().max(1000).optional(),
  withStems: z.boolean().default(true),
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

// ---------- Chat (Studio Chat) ---------------------------------------------

export const chatMessageInputSchema = z.object({
  threadId: z.string().cuid().optional(), // create new if absent
  projectId: z.string().cuid().optional(),
  content: z.string().min(1).max(8000),
});

export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;
