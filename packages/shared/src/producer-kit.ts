import { z } from "zod";
import { GENRES } from "./constants";
import {
  ALL_MATERIAL_ROLES,
  COARSE_MATERIAL_ROLES,
  familyOf,
  isMaterialRole,
  type MaterialRole,
} from "./material-roles";
import { getGenreKit } from "./genre-kits";
import { ownedAudioRightsConfirmationSchema } from "./schemas";

export const PRODUCER_KIT_MAX_FILES = 24;
export const PRODUCER_KIT_ROLES = [
  ...ALL_MATERIAL_ROLES,
  ...COARSE_MATERIAL_ROLES,
  "fill",
] as const;

const PRODUCER_KIT_ROLE_SET = new Set<string>(PRODUCER_KIT_ROLES);

export function isProducerKitRole(role: string): boolean {
  return PRODUCER_KIT_ROLE_SET.has(role);
}

export const producerKitAudioMetricsSchema = z
  .object({
    durationS: z.number().positive().max(600),
    sampleRate: z.number().int().min(8_000).max(384_000),
    channels: z.number().int().min(1).max(16),
    peakDbfs: z.number().min(-160).max(6),
    rmsDbfs: z.number().min(-160).max(6),
    clippedSampleRatio: z.number().min(0).max(1),
  })
  .strict();

export type ProducerKitAudioMetrics = z.infer<
  typeof producerKitAudioMetricsSchema
>;

const producerKitFileSchema = z
  .object({
    clientId: z.string().uuid(),
    key: z.string().min(4).max(1000),
    fileName: z.string().trim().min(1).max(240),
    sizeBytes: z.number().int().min(1_000).max(80 * 1024 * 1024),
    kind: z.enum(["loop", "stem"]).default("loop"),
    metrics: producerKitAudioMetricsSchema.nullable(),
    proposedRole: z
      .string()
      .refine(isProducerKitRole, "unknown material role")
      .optional(),
    proposedBpm: z.number().int().min(40).max(220).optional(),
    proposedKeySignature: z.string().trim().max(24).optional(),
  })
  .strict();

export const producerKitManifestSchema = z
  .object({
    kitId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    genre: z.enum(GENRES),
    defaultBpm: z.number().int().min(40).max(220).optional(),
    defaultKeySignature: z.string().trim().max(24).optional(),
    files: z
      .array(producerKitFileSchema)
      .min(1)
      .max(PRODUCER_KIT_MAX_FILES),
    rightsConfirmation: ownedAudioRightsConfirmationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const clientIds = new Set<string>();
    const keys = new Set<string>();
    value.files.forEach((file, index) => {
      if (clientIds.has(file.clientId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "clientId"],
          message: "duplicate clientId",
        });
      }
      if (keys.has(file.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "key"],
          message: "duplicate upload key",
        });
      }
      clientIds.add(file.clientId);
      keys.add(file.key);
    });
  });

const acceptedProducerKitFileSchema = z
  .object({
    materialId: z.string().cuid(),
    decision: z.literal("accept"),
    role: z.string().refine(isProducerKitRole, "unknown material role"),
    bpm: z.number().int().min(40).max(220).nullable(),
    keySignature: z.string().trim().max(24).nullable(),
    qualityConfirmed: z.literal(true),
  })
  .strict();

const rejectedProducerKitFileSchema = z
  .object({
    materialId: z.string().cuid(),
    decision: z.literal("reject"),
  })
  .strict();

export const confirmProducerKitSchema = z
  .object({
    files: z
      .array(
        z.discriminatedUnion("decision", [
          acceptedProducerKitFileSchema,
          rejectedProducerKitFileSchema,
        ])
      )
      .min(1)
      .max(PRODUCER_KIT_MAX_FILES),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.files.forEach((file, index) => {
      if (ids.has(file.materialId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "materialId"],
          message: "duplicate materialId",
        });
      }
      ids.add(file.materialId);
    });
  });

export type ProducerKitManifestInput = z.infer<
  typeof producerKitManifestSchema
>;
export type ConfirmProducerKitInput = z.infer<
  typeof confirmProducerKitSchema
>;

export type ProducerKitQuality = {
  status: "passed" | "review" | "rejected";
  reasons: string[];
};

export function inferProducerKitQuality(
  metrics: ProducerKitAudioMetrics | null
): ProducerKitQuality {
  if (!metrics) {
    return {
      status: "review",
      reasons: ["browser could not decode this file for audio measurements"],
    };
  }

  const rejected: string[] = [];
  const review: string[] = [];
  if (metrics.durationS < 0.25) rejected.push("audio is shorter than 0.25 seconds");
  if (metrics.durationS > 300) rejected.push("audio is longer than 5 minutes");
  else if (metrics.durationS > 180)
    review.push("longer than a normal loop or production stem");
  if (metrics.sampleRate < 22_050)
    rejected.push("sample rate is below 22.05 kHz");
  if (metrics.channels > 2)
    review.push("multichannel audio will be treated as a stereo material");
  if (metrics.peakDbfs < -55 || metrics.rmsDbfs < -70)
    rejected.push("audio is effectively silent");
  if (metrics.clippedSampleRatio > 0.05)
    rejected.push("more than 5% of sampled audio is clipped");
  else if (metrics.clippedSampleRatio > 0.005)
    review.push("audio contains repeated full-scale peaks");
  if (metrics.peakDbfs > 0.1) rejected.push("audio exceeds digital full scale");

  if (rejected.length) return { status: "rejected", reasons: rejected };
  if (review.length) return { status: "review", reasons: review };
  return { status: "passed", reasons: [] };
}

const ROLE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["log drum lead", "log_drum_lead"],
  ["logdrum lead", "log_drum_lead"],
  ["log drum", "log_drum"],
  ["logdrum", "log_drum"],
  ["808 bass", "bass_808"],
  ["808 kick", "kick_808"],
  ["808", "bass_808"],
  ["perc break", "percussion_break"],
  ["drum break", "percussion_break"],
  ["percs", "percussion"],
  ["perc", "percussion"],
  ["drums", "drums"],
  ["drum loop", "drums"],
  ["keys", "piano"],
  ["key loop", "piano"],
  ["guitar", "guitar_chords"],
  ["vox chop", "vocal_chop"],
  ["vox", "vocal_chop"],
  ["fx", "transition_fx"],
] as const;

function searchableName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9#b ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rolePhrase(role: string): string {
  return role.replace(/_/g, " ");
}

export function inferProducerKitRole(
  fileName: string,
  genre?: string | null
): { role: string | null; confidence: "high" | "medium" | "low"; reason: string } {
  const name = searchableName(fileName);
  const bounded = (phrase: string) =>
    new RegExp(`(?:^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`).test(name);

  const exact = [...PRODUCER_KIT_ROLES]
    .sort((a, b) => b.length - a.length)
    .find(role => bounded(rolePhrase(role)));
  if (exact) {
    return { role: exact, confidence: "high", reason: "role named in file" };
  }

  const alias = ROLE_ALIASES.find(([phrase]) => bounded(phrase));
  if (alias) {
    return {
      role: alias[1],
      confidence: "high",
      reason: `recognized “${alias[0]}” in file name`,
    };
  }

  const kit = getGenreKit(genre);
  if (kit) {
    const candidates = [...kit.signatureRoles, ...kit.requiredRoles];
    const familyWord = ([
      ["bass", "bass"],
      ["kick", "drumkit"],
      ["snare", "drumkit"],
      ["hat", "drumkit"],
      ["shaker", "african_perc"],
      ["piano", "harmony"],
      ["pad", "harmony"],
      ["melody", "melody"],
      ["lead", "melody"],
    ] as const).find(([word]) => bounded(word));
    if (familyWord) {
      const match = candidates.find(
        role => isMaterialRole(role) && familyOf(role) === familyWord[1]
      );
      if (match) {
        return {
          role: match,
          confidence: "medium",
          reason: `matched ${familyWord[0]} to the ${genre} kit`,
        };
      }
    }
  }

  return {
    role: null,
    confidence: "low",
    reason: "role needs producer confirmation",
  };
}

export function inferProducerKitBpm(fileName: string): number | null {
  const name = searchableName(fileName);
  const explicit = name.match(/(?:^|\s)(\d{2,3})\s*bpm(?:$|\s)/i);
  const loose = name.match(/(?:^|\s)([6-9]\d|1\d{2}|2[01]\d|220)(?:$|\s)/);
  const value = Number(explicit?.[1] ?? loose?.[1]);
  return Number.isInteger(value) && value >= 40 && value <= 220 ? value : null;
}

function normalizedKey(note: string, accidental: string, mode: string): string {
  const normalizedMode = /^(m|min|minor)$/i.test(mode) ? "minor" : "major";
  return `${note.toUpperCase()}${accidental || ""} ${normalizedMode}`;
}

export function inferProducerKitKey(fileName: string): string | null {
  const name = searchableName(fileName);
  const wordMode = name.match(
    /(?:^|\s)([a-g])([#b]?)[ ]*(major|minor|maj|min)(?:$|\s)/i
  );
  if (wordMode)
    return normalizedKey(wordMode[1]!, wordMode[2]!, wordMode[3]!);
  const shortMode = name.match(/(?:^|\s)([a-g])([#b]?)(m)(?:$|\s)/i);
  if (shortMode)
    return normalizedKey(shortMode[1]!, shortMode[2]!, shortMode[3]!);
  return null;
}

export function inferProducerKitFile(
  fileName: string,
  metrics: ProducerKitAudioMetrics | null,
  defaults?: { genre?: string | null; bpm?: number | null; keySignature?: string | null }
) {
  const role = inferProducerKitRole(fileName, defaults?.genre);
  return {
    role,
    bpm: inferProducerKitBpm(fileName) ?? defaults?.bpm ?? null,
    keySignature:
      inferProducerKitKey(fileName) ?? defaults?.keySignature?.trim() ?? null,
    quality: inferProducerKitQuality(metrics),
  };
}
