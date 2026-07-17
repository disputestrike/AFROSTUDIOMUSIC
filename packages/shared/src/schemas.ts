/**
 * Zod schemas — the single source of truth for API contracts.
 * Used by Fastify for validation and by the web app for typed clients.
 */
import { z } from "zod";
import { VOICE_CONSENT_TEXT, VOICE_CONSENT_VERSION } from "./voice-consent";
import {
  LIKENESS_CONSENT_TEXT,
  LIKENESS_CONSENT_VERSION,
  VIDEO_ENGINE_CLASSES,
} from "./likeness";
import { isMaterialRole, type MaterialRole } from "./material-roles";
import {
  GENRES,
  LANGUAGES,
  SONG_SECTIONS,
  APPROVAL_GATES,
  TASTE_DIMENSIONS,
  MIX_PRESETS,
  MASTER_PRESETS,
} from "./constants";

export const genreSchema = z.enum(GENRES);
export const langSchema = z.enum(
  Object.keys(LANGUAGES) as [
    keyof typeof LANGUAGES,
    ...Array<keyof typeof LANGUAGES>,
  ]
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
    .array(
      z.object({
        phrase: z.string(),
        meaning: z.string(),
        language: z.string(),
      })
    )
    .optional(),
  cornyBanned: z.array(z.string()).default([]),
  // Automation flags
  morningDrop: z.boolean().optional(),
});
export type ArtistDna = z.infer<typeof artistDnaSchema>;

// ---------- Brief -----------------------------------------------------------

export const briefSchema = z.object({
  mood: z.string().max(120).optional(),
  topic: z.string().max(2000).optional(),
  language: z.array(langSchema).default([]),
  audience: z.string().max(120).optional(),
  bpm: z.number().int().min(40).max(220).optional(),
  references: z
    .array(z.object({ name: z.string(), lane: z.string() }))
    .optional(),
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
  // Owner law (2026-07-12): 3 deep hooks, not 20 shallow drafts — concentrate
  // the craft in few fully-committed candidates the A&R can really compare.
  count: z.number().int().min(1).max(12).default(3),
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

export const REQUESTED_MATERIAL_ROLES_VERSION = 1 as const;

const INSTRUMENT_ROLE_ALIASES: Readonly<Record<string, MaterialRole>> = {
  "log drum": "log_drum",
  "amapiano log bass": "log_drum",
  "talking drum": "talking_drum",
  congas: "conga",
  saxophone: "sax",
  "brass section": "brass_section",
  "highlife guitar": "highlife_guitar",
  "palm wine guitar": "palmwine_guitar",
  guitar: "guitar_chords",
  "guitar chords": "guitar_chords",
  "lead guitar": "lead_guitar",
  strings: "strings_line",
  "warm sub bass": "sub_bass",
  "synth pads": "synth_pad",
};

function normalizedInstrumentSelection(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export interface RequestedMaterialRoleProvenance {
  version: typeof REQUESTED_MATERIAL_ROLES_VERSION;
  source: "user-instrument-selection";
  instruments: string[];
  mappings: Array<{ instrument: string; role: MaterialRole }>;
}

export interface RequestedMaterialRoleContract {
  requestedRoles: MaterialRole[];
  unsupportedInstruments: string[];
  provenance: RequestedMaterialRoleProvenance;
}

/** Derive worker roles from the public instrument labels. Callers must never
 * accept a client-supplied requestedRoles/provenance object in their place. */
export function requestedMaterialRoleContract(
  instruments: readonly string[] | null | undefined
): RequestedMaterialRoleContract {
  const requestedInstruments: string[] = [];
  const mappings: Array<{ instrument: string; role: MaterialRole }> = [];
  const unsupportedInstruments: string[] = [];
  const seenInstruments = new Set<string>();
  const seenRoles = new Set<MaterialRole>();

  for (const raw of instruments ?? []) {
    const instrument = raw.trim();
    const normalized = normalizedInstrumentSelection(instrument);
    if (!normalized || seenInstruments.has(normalized)) continue;
    seenInstruments.add(normalized);
    requestedInstruments.push(instrument);

    const directRole = normalized.replace(/\s+/g, "_");
    const role =
      INSTRUMENT_ROLE_ALIASES[normalized] ??
      (isMaterialRole(directRole) ? directRole : null);
    if (!role) {
      unsupportedInstruments.push(instrument);
      continue;
    }
    mappings.push({ instrument, role });
    seenRoles.add(role);
  }

  return {
    requestedRoles: [...seenRoles],
    unsupportedInstruments,
    provenance: {
      version: REQUESTED_MATERIAL_ROLES_VERSION,
      source: "user-instrument-selection",
      instruments: requestedInstruments,
      mappings,
    },
  };
}

export const EXACT_MATERIAL_ROLE_EVIDENCE = [
  "synth-code",
  "stem-separated",
  "human-confirmed",
] as const;

export function hasExactMaterialRoleEvidence(pick: {
  roleEvidence?: string | null;
}): boolean {
  return (EXACT_MATERIAL_ROLE_EVIDENCE as readonly string[]).includes(
    pick.roleEvidence?.trim() ?? ""
  );
}

export function missingExactRequestedMaterialRoles(
  picks: ReadonlyArray<{ role: string; roleEvidence?: string | null }>,
  requestedRoles: readonly MaterialRole[]
): MaterialRole[] {
  return requestedRoles.filter(
    role =>
      !picks.some(
        pick => pick.role === role && hasExactMaterialRoleEvidence(pick)
      )
  );
}

export const instrumentSelectionsSchema = z
  .array(z.string().trim().min(2).max(32))
  .max(8);

export const generateBeatInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid().optional(),
  /** CATALOG TYPE stamp for door 2/3 creations (instrumental | film_sound).
   *  Absent → 'song' for vocal renders, 'instrumental' for beds. */
  creationKind: z.enum(['instrumental', 'film_sound']).optional(),
  genre: genreSchema,
  // FUSION: extra genres blended into the primary (primary = backbone).
  fusionGenres: z.array(genreSchema).max(2).optional(),
  // First-class mood + the just-listened reference to rebuild (see dropBatchSchema).
  mood: z.string().max(40).optional(),
  pinnedReferenceId: z.string().cuid().optional(),
  bpm: z.number().int().min(60).max(180),
  keySignature: z.string().optional(),
  /** Omit for a sensible default: full-length (genre standard) for vocal songs,
   *  60s for instrumental sketches. The old default(60) made every caller that
   *  omitted duration render a 60-second "full song". */
  durationS: z.number().int().min(15).max(240).optional(),
  vibePrompt: z.string().max(1000).optional(),
  /** HARD language constraint — outranks the artist profile's defaults. */
  languages: z.array(z.string().min(2).max(12)).max(5).optional(),
  voice: z.enum(["auto", "female", "male", "duet", "group"]).optional(),
  /** WO-5: takes rendered for THIS request (draft default 1; Hit-Maker flows pass 2). */
  candidates: z.number().int().min(1).max(4).optional(),
  withStems: z.boolean().default(true),
  // Full song WITH AI vocals: set withVocals + provide lyrics (or let the API
  // pull the latest lyric for the song). Routes to the vocals model.
  withVocals: z.boolean().default(false),
  lyrics: z.string().max(6000).optional(),
  // Arrange the vocal to sound alive — ad-libs, doubled/harmonized hook,
  // call-and-response — before generation. On by default for vocal songs.
  richVocals: z.boolean().default(true),
  // Which vocal/song model: 'ace_step' (default) or 'minimax' (higher realism).
  songEngine: z
    .enum(["suno", "eleven", "ace_step", "minimax", "own"])
    .optional(),
  /** Artist LANE to vibe toward (energy/tempo/production feel) — never a copy,
   *  never named in the song. Same semantics as dropBatchSchema.influence. */
  influence: z.string().max(120).optional(),
  /** Explicit instrument picks — emitted as a high-priority `instrumentation:`
   *  line in the engine's style prompt (steering; exact on the own engine). */
  instruments: instrumentSelectionsSchema.optional(),
});

// ---------- Voice -----------------------------------------------------------

export const voiceConsentInputSchema = z
  .object({
    artistId: z.string().cuid(),
    legalName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    consentText: z.literal(VOICE_CONSENT_TEXT),
    consentVersion: z.literal(VOICE_CONSENT_VERSION),
    accepted: z.literal(true),
    signatureUrl: z.string().url().optional(),
    consentAudioUrl: z.string().url().optional(),
  })
  .strict();

export const voiceProfileInputSchema = z
  .object({
    artistId: z.string().cuid(),
    consentId: z.string().cuid(),
    name: z.string().min(1).max(80),
    sampleUrls: z.array(z.string().url()).min(1).max(20),
    language: langSchema.optional(),
  })
  .strict();

/** OWN-VOICE TRAINING kickoff: consent-gated, dataset is ONE zip of the
 *  artist's own recordings, destination is a "user/model" path in the ARTIST's
 *  Replicate account (falls back to VOICE_TRAINER_DESTINATION when omitted). */
export const voiceTrainInputSchema = z
  .object({
    artistId: z.string().cuid(),
    consentId: z.string().cuid(),
    name: z.string().min(1).max(80),
    datasetZipUrl: z.string().url(),
    destination: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
        'destination must be "user/model"'
      )
      .optional(),
  })
  .strict();

// ---------- Artist likeness (consent-gated, own-face-only) ------------------

/** Mirrors voiceConsentInputSchema: the signer types the versioned consent
 *  back verbatim (literal match) so a stale client can never record consent
 *  to text the user did not see. */
export const likenessConsentInputSchema = z
  .object({
    artistId: z.string().cuid(),
    legalName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    consentText: z.literal(LIKENESS_CONSENT_TEXT),
    consentVersion: z.literal(LIKENESS_CONSENT_VERSION),
    accepted: z.literal(true),
  })
  .strict();

export const LIKENESS_IMAGE_FORMATS = ["png", "jpg", "jpeg", "webp"] as const;
export const MAX_LIKENESS_PHOTO_BYTES = 15 * 1024 * 1024;

/** Presign a browser→storage PUT for ONE likeness photo. Image claims only —
 *  the attach step's magic-byte sniff is the real content check. */
export const likenessPhotoPresignSchema = z
  .object({
    contentType: z
      .string()
      .regex(/^image\/(png|jpe?g|webp)$/i)
      .max(60),
    ext: z.enum(LIKENESS_IMAGE_FORMATS),
    sizeBytes: z.number().int().min(1_000).max(MAX_LIKENESS_PHOTO_BYTES),
  })
  .strict();

/** Attach an uploaded photo to the artist under a recorded consent. */
export const likenessPhotoAttachSchema = z
  .object({
    key: z.string().min(4).max(512),
    artistId: z.string().cuid(),
    consentId: z.string().cuid(),
  })
  .strict();

/** Kick off likeness training (Flux LoRA on the artist's OWN photos). */
export const likenessTrainInputSchema = z
  .object({
    artistId: z.string().cuid(),
    consentId: z.string().cuid(),
    /** Optional "user/model" destination in the operator's Replicate account. */
    destination: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
        'destination must be "user/model"'
      )
      .optional(),
  })
  .strict();

/** DATASET BUILDER: raw recordings → a trainer-ready zip (layout
 *  `dataset/<name>/split_<i>.wav`, 48k mono, ~10s segments) — exactly what the
 *  default trainer (replicate/train-rvc-model) expects. Two minutes is the
 *  measured minimum; 10–20 minutes of clean solo vocals is the quality target. */
export const voiceDatasetInputSchema = z
  .object({
    name: z.string().min(1).max(60),
    sampleUrls: z.array(z.string().url()).min(1).max(20),
    isolationConfirmed: z.literal(true),
    purgeSourceSamples: z.boolean().default(false),
  })
  .strict();

/** SING WITH MY VOICE: the trained voice performs an existing track. HONEST:
 *  RVC converts the performance in the input (full song or bare vocal) — the
 *  melody and timing come from the input vocal; it does not invent one.
 *  songId/songUrl "at least one" is enforced in the route handler (a .refine
 *  here would break the swagger jsonSchemaTransform). */
export const voiceSingInputSchema = z.object({
  songId: z.string().cuid().optional(),
  songUrl: z.string().url().optional(),
  rightsConfirmed: z.boolean().optional(),
  pitchChange: z
    .enum(["no-change", "male-to-female", "female-to-male"])
    .default("no-change"),
  // Realism knobs (all optional — studio realism defaults apply when omitted).
  tuning: z
    .object({
      indexRate: z.number().min(0).max(1).optional(),
      rmsMixRate: z.number().min(0).max(1).optional(),
      protect: z.number().min(0).max(0.5).optional(),
      pitchAlgo: z.enum(["rmvpe", "mangio-crepe"]).optional(),
      reverbWetness: z.number().min(0).max(1).optional(),
      reverbSize: z.number().min(0).max(1).optional(),
      reverbDryness: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const renderVocalInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid().optional(),
  voiceProfileId: z.string().cuid(),
  lyricId: z.string().cuid(),
  role: z.enum(["lead", "double", "ad-lib", "harmony"]).default("lead"),
  pitchCorrection: z
    .object({
      strength: z.number().min(0).max(1),
      retune: z.number().min(0).max(1),
    })
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
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).default("1024x1024"),
});

export const generateStoryboardInputSchema = z.object({
  projectId: z.string().cuid(),
  // Name the SONG this video is for. Optional so project-level concepts still
  // work, but when present the recommendation is built from that song's own
  // words and lane rather than the project brief alone — and it is stored
  // against the song so it can sit beside its lyrics.
  songId: z.string().cuid().optional(),
  // 'full_song' (default) = the creative-director treatment covering the whole
  // song, sequenced against its measured section boundaries, with a social
  // teaser cut derived from it. 'short' = the legacy 8-60s shot list.
  mode: z.enum(["full_song", "short"]).default("full_song"),
  // Optional now: in full_song mode the length is derived from the song's
  // measured audio; this field is the fallback when nothing is measured (and
  // the target length in 'short' mode, default 15).
  durationS: z.number().int().min(8).max(60).optional(),
  format: z.enum(["vertical", "square", "landscape"]).default("vertical"),
  prompt: z.string().max(2000).optional(),
  // THE ARTIST'S VISION (owner, 2026-07-17: "people have their own ideas for
  // their music videos — they can bring that, stick with it, or enhance it").
  // Pasted vision text + how faithfully the director must serve it.
  vision: z.string().max(6000).optional(),
  visionMode: z.enum(["strict", "enhance"]).default("enhance"),
});

export const renderVideoInputSchema = z.object({
  projectId: z.string().cuid(),
  conceptId: z.string().cuid(),
  shotIndex: z.number().int().nonnegative().optional(),
  /**
   * ENGINE CLASS — the public/internal wall applied to video. Users pick
   * 'draft' | 'standard' | 'flagship'; which model backs each class is
   * internal operator config. Optional so every existing caller keeps its
   * exact contract (absent → 'standard'). Billing is untouched: the same
   * per-shot videoRenderUsage applies to every class.
   */
  engineClass: z.enum(VIDEO_ENGINE_CLASSES).optional(),
  /**
   * Ask for the artist's TRAINED LIKENESS in this render: a keyframe is
   * generated from the trained model first, then image-to-video. Requires a
   * trained likeness under an unrevoked consent — the route 409s honestly
   * when there is none rather than quietly rendering without the face.
   */
  useLikeness: z.boolean().optional(),
});

/**
 * ONE-CLICK FULL VIDEO — render every UNRENDERED scene of a concept in one
 * request. Workspace scope comes from the concept's own project (no projectId
 * needed); one upfront charge = per-scene class price × unrendered scenes
 * (already-rendered scenes are never re-billed); the concept is stamped
 * meta.autoAssemble so the worker assembles the full cut when coverage lands.
 */
export const renderAllVideoInputSchema = z.object({
  conceptId: z.string().cuid(),
  engineClass: z.enum(VIDEO_ENGINE_CLASSES).default('standard'),
  useLikeness: z.boolean().optional(),
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
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  notes: z.string().max(2000).optional(),
});

export const rightsCheckInputSchema = z.object({
  projectId: z.string().cuid(),
  songId: z.string().cuid(),
  audioRightsAttestation: z
    .object({
      confirmed: z.literal(true),
      basis: z.enum(["owner", "licensed", "public_domain"]),
      note: z.string().trim().min(3).max(500).optional(),
    })
    .optional(),
});

// ---------- Sharing / PostGIS ----------------------------------------------

export const createShareLinkSchema = z.object({
  songId: z.string().cuid(),
  targetUrl: z
    .string()
    .url()
    .max(2048)
    .refine(value => {
      try {
        const parsed = new URL(value);
        return (
          ["http:", "https:"].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password
        );
      } catch {
        return false;
      }
    }, "targetUrl must be an http(s) URL without embedded credentials"),
});

export const logShareEventSchema = z.object({
  shareLinkCode: z.string().min(4).max(32),
  eventType: z.enum(["click", "play", "download", "share", "conversion"]),
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

export const OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION = 1 as const;
export const ownedAudioRightsConfirmationSchema = z
  .object({
    version: z.literal(OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION),
    confirmed: z.literal(true),
  })
  .strict();
export type OwnedAudioRightsConfirmation = z.infer<
  typeof ownedAudioRightsConfirmationSchema
>;

export const UPLOAD_KINDS = [
  "beat",
  "instrumental",
  "vocal",
  "reference",
  "stem",
] as const;
const AUDIO_FORMATS = [
  "wav",
  "mp3",
  "flac",
  "aiff",
  "m4a",
  "ogg",
  "webm",
  // .mpeg/.mpg ARE MPEG audio — the same family as .mp3 — and ffmpeg decodes
  // them like any other input. Widening the browser file picker's accept=
  // attribute (as an earlier change did) only got the file as far as this
  // schema, which then rejected it: `ext` failed the enum, and `contentType`
  // failed the audio-only regex below because browsers tag .mpeg as
  // "video/mpeg". The upload reached the server and 400'd. Both halves had to
  // move for the picker change to mean anything.
  "mpeg",
  "mpg",
] as const;

export const MAX_PRESIGNED_UPLOAD_BYTES = 80 * 1024 * 1024;

export const presignUploadSchema = z
  .object({
    kind: z.enum(UPLOAD_KINDS),
    // audio/* — plus the narrow video/mpeg family ONLY. Browsers report MPEG
    // AUDIO (.mpeg/.mpg) with a video/* MIME type, so an audio-only regex
    // rejects a legitimate audio upload on a technicality of MIME registration.
    // Enumerated rather than allowing video/* wholesale, so this stays an audio
    // ingest and doesn't quietly become a video one. The real content check is
    // the magic-byte sniff at upload time — this only screens the claim.
    contentType: z
      .string()
      .regex(/^(audio\/[a-z0-9.+-]+|video\/(x-)?mpe?g)$/i)
      .max(120),
    ext: z.enum(AUDIO_FORMATS),
    sizeBytes: z.number().int().min(1_000).max(MAX_PRESIGNED_UPLOAD_BYTES),
  })
  .strict();

export const attachBeatUploadSchema = z
  .object({
    key: z.string().min(4), // R2 object key returned by /uploads/presign
    songId: z.string().cuid().optional(),
    bpm: z.number().int().min(40).max(220).optional(),
    keySignature: z.string().max(12).optional(),
    durationS: z.number().min(1).max(1200).optional(),
    format: z.enum(AUDIO_FORMATS).default("wav"),
    title: z.string().max(120).optional(),
    instrumental: z.boolean().optional(), // full instrumental vs a loop/beat
    rightsConfirmation: ownedAudioRightsConfirmationSchema,
  })
  .strict();

export const attachVocalUploadSchema = z.object({
  key: z.string().min(4),
  songId: z.string().cuid().optional(),
  role: z.enum(["lead", "double", "ad-lib", "harmony"]).default("lead"),
  durationS: z.number().min(1).max(1200).optional(),
  language: langSchema.optional(),
  isolationConfirmed: z.literal(true),
});

// Upload a FINISHED song / full mix — stored as a mix and (by default) sent
// straight to the mastering chain. This is the "master my track" path.
export const attachSongUploadSchema = z
  .object({
    key: z.string().min(4),
    songId: z.string().cuid().optional(),
    title: z.string().max(120).optional(),
    // An uploaded finished song (Suno, or bring-your-own) → light-touch conform to
    // the commercial default (-9 LUFS / -1.0 dBTP). Safe now: the two-pass chain
    // drives with a MEASURED gain and lands linearly on target — the old "-9
    // crusher" was the one-pass dynamic loudnorm, not the number. Artists who
    // want the record to breathe opt in to 'breathe_-16.5'.
    masterPreset: z.enum(MASTER_PRESETS).default("afro_stream_-9"),
    autoMaster: z.boolean().default(true),
    rightsConfirmation: ownedAudioRightsConfirmationSchema,
  })
  .strict();

// Import audio from a URL the artist has the RIGHTS to (own files, direct audio
// links, royalty-free / Creative-Commons sources). Not a streaming-platform
// ripper — the API refuses YouTube/Spotify/etc. hosts.
export const importUrlSchema = z
  .object({
    projectId: z.string().cuid(),
    url: z.string().url(),
    kind: z.enum(["beat", "instrumental", "vocal", "song", "reference"]),
    songId: z.string().cuid().optional(),
    bpm: z.number().int().min(40).max(220).optional(),
    keySignature: z.string().max(12).optional(),
    role: z.enum(["lead", "double", "ad-lib", "harmony"]).optional(),
    isolationConfirmed: z.boolean().optional(),
    title: z.string().max(120).optional(),
    /** kind 'song' only: learn + harvest WITHOUT filing a catalog Song — training
     *  uploads must never appear in the artist's working catalog. */
    trainingOnly: z.boolean().optional(),
    /** Finished-song imports use the same durable certification/mastering path
     * as direct workspace uploads. Other import kinds ignore these fields. */
    masterPreset: z.enum(MASTER_PRESETS).default("afro_stream_-9"),
    autoMaster: z.boolean().default(true),
    rightsConfirmation: ownedAudioRightsConfirmationSchema,
  })
  .strict();

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
  kind: z.enum(["beat", "vocal"]),
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

// factsOnly: measure a lawfully accessed reference into uncopyrightable NUMBERS
// (tempo/key/groove/log-drum/arrangement); no transcription, prose recipe, or
// retained audio. Expression-level learning is a separate, rights-attested path.
const analyzeAudioBaseShape = {
  /** Training session: delete the uploaded audio after learning from it. */
  purgeAfter: z.boolean().optional(),
  url: z.string().url(),
};

export const analyzeAudioSchema = z.union([
  z
    .object({
      ...analyzeAudioBaseShape,
      factsOnly: z.literal(true),
      rightsConfirmation: ownedAudioRightsConfirmationSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...analyzeAudioBaseShape,
      factsOnly: z.literal(false).optional(),
      rightsConfirmation: ownedAudioRightsConfirmationSchema,
    })
    .strict(),
]);

// ---------- Rights spine (split-sheet + ISRC/UPC + green-light) -------------

export const splitEntrySchema = z.object({
  name: z.string().min(1).max(120),
  role: z
    .enum(["writer", "composer", "producer", "performer", "featured", "other"])
    .default("writer"),
  share: z.number().min(0).max(100),
});

export const rightsInputSchema = z.object({
  splitSheet: z.array(splitEntrySchema).min(1).max(20).optional(),
  acceptSplits: z.boolean().optional(),
  isrc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}-?[A-Z0-9]{3}-?[0-9]{2}-?[0-9]{5}$/)
    .optional(),
  upc: z
    .string()
    .trim()
    .regex(/^[0-9]{12,14}$/)
    .optional(),
  nativeReview: z
    .object({
      reviewerName: z.string().trim().min(2).max(120),
      languages: z.array(z.string().trim().min(2).max(12)).min(1).max(8),
      attested: z.literal(true),
      notes: z.string().trim().max(1000).optional(),
    })
    .optional(),
  revokeNativeReview: z.literal(true).optional(),
});

// ---------- Drop Machine (batch generate → rank → shortlist) ---------------

export const dropBatchSchema = z.object({
  /** HARD language constraint — the writers must use ONLY these. */
  languages: z.array(z.string().min(2).max(12)).max(5).optional(),
  // Roomy: album next-tracks prepend the anchor's styleBrief to the theme.
  theme: z.string().min(3).max(2000),
  /** The RAW musical description alone (no title-anchor boilerplate) — this is
   *  what reaches the music engine's style prompt. theme = the writers' brief. */
  vibe: z.string().max(500).optional(),
  songTitle: z.string().max(80).optional(),
  voice: z.enum(["auto", "female", "male", "duet", "group"]).optional(),
  /** WO-5: takes rendered per song (draft default 1; Hit-Maker flows pass 2). */
  candidates: z.number().int().min(1).max(4).optional(),
  count: z.number().int().min(1).max(6).default(3),
  genre: z.string().max(40).default("afrobeats"),
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
  songEngine: z
    .enum(["suno", "eleven", "ace_step", "minimax", "own"])
    .optional(),
  // Artist LANE to steer the vibe toward (e.g. "Davido, Wizkid"). Captures the
  // energy/production feel — never copies songs, never named in the output.
  influence: z.string().max(200).optional(),
  /** Explicit instrument picks threaded to the render's style prompt. */
  instruments: instrumentSelectionsSchema.optional(),
});

// ---------- Proxied audio upload (browser → API → R2, no R2 CORS) ----------

export const audioUploadSchema = z.object({
  kind: z.enum(UPLOAD_KINDS).default("reference"),
  contentType: z
    .string()
    .regex(/^audio\/[a-z0-9.+-]+$/i)
    .max(60)
    .default("audio/webm"),
  ext: z.enum(AUDIO_FORMATS).default("webm"),
  dataBase64: z
    .string()
    .min(16)
    .max(42 * 1024 * 1024), // ~30 MB decoded
});

// ---------- Snippet (vertical shareable clip) ------------------------------

export const snippetInputSchema = z.object({
  songId: z.string().cuid().optional(), // defaults to the project's latest song
  startS: z.number().int().min(0).max(600).optional(), // clip start; default ~8s
});

// ---------- Integrations (in-app music engine key) -------------------------

export const integrationsInputSchema = z.object({
  musicProvider: z.enum(["replicate", "eleven", "suno"]).nullable().optional(),
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
