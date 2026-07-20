import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { canonicalJson } from "@afrohit/shared";

export const EAR_CORPUS_SCHEMA_VERSION = 2;
export const EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION = 1;
export const LOGDRUM_CALIBRATION_SCHEMA_VERSION = 5;
export const EAR_GENRES = ["amapiano", "afrobeats", "house"] as const;
export const EAR_STEMS = ["bass", "drums", "other", "vocals"] as const;
export const EAR_RECORDING_TYPES = [
  "human-produced-master",
  "licensed-reference-recording",
] as const;
export const EAR_HOLDOUT_PURPOSE = "logdrum-dsp-evaluation-v1";

export type EarGenre = (typeof EAR_GENRES)[number];
export type EarStem = (typeof EAR_STEMS)[number];
export type EarRightsBasis = "owned-master" | "licensed-evaluation";
export type EarRecordingType = (typeof EAR_RECORDING_TYPES)[number];

export interface EarCorpusFile {
  path: string;
  sha256: string;
}

export interface EarCorpusTrack extends EarCorpusFile {
  id: string;
  genre: EarGenre;
  sourceAssetIds: string[];
  sourceFamilyId: string;
  recordingType: EarRecordingType;
  expectTempoBpm: number;
  fourOnFloor: boolean;
  stems: Record<EarStem, EarCorpusFile>;
  rights: {
    basis: EarRightsBasis;
    reference: string;
    attestedBy: string;
    attestedAt: string;
  };
}

export interface EarCorpusManifest {
  schemaVersion: typeof EAR_CORPUS_SCHEMA_VERSION;
  freeze: {
    purpose: typeof EAR_HOLDOUT_PURPOSE;
    frozenAt: string;
    frozenBy: string;
    selectionMethod: "rights-cleared-stratified-holdout";
    trainingSnapshot: EarCorpusFile;
  };
  tracks: EarCorpusTrack[];
}

export interface EarTrainingSnapshotAsset {
  id: string;
  contentHash: string;
  sourceFamilyId: string;
}

export interface EarTrainingSnapshot {
  schemaVersion: typeof EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  datasetHash: string;
  assets: EarTrainingSnapshotAsset[];
}

export interface ValidatedEarCorpusTrack extends EarCorpusTrack {
  absolutePath: string;
  absoluteStems: Record<EarStem, string>;
}

export interface ValidatedEarCorpus {
  manifest: EarCorpusManifest;
  trainingSnapshot: EarTrainingSnapshot;
  tracks: ValidatedEarCorpusTrack[];
  corpusHash: string;
  trainingSnapshotHash: string;
  frozenAt: string;
  leakageVerified: true;
  genreCounts: Record<EarGenre, number>;
  rightsBasisCounts: Record<EarRightsBasis, number>;
}

export interface EarHoldoutExclusions {
  sourceAssetIds: Set<string>;
  sourceFamilyIds: Set<string>;
  contentHashes: Set<string>;
}

export class EarCorpusValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Ear corpus manifest is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "EarCorpusValidationError";
    this.issues = issues;
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function rejectUnknownKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label: string,
  issues: string[]
) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(`${label}.${key} is not supported`);
  }
}

function stringField(
  value: unknown,
  label: string,
  issues: string[],
  options: { min?: number; max?: number; pattern?: RegExp } = {}
): string {
  if (typeof value !== "string") {
    issues.push(`${label} must be a string`);
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) issues.push(`${label} is too short`);
  if (trimmed.length > (options.max ?? 500))
    issues.push(`${label} is too long`);
  if (options.pattern && !options.pattern.test(trimmed))
    issues.push(`${label} has an invalid format`);
  return trimmed;
}

function hashField(value: unknown, label: string, issues: string[]): string {
  return stringField(value, label, issues, {
    min: 64,
    max: 64,
    pattern: /^[a-f0-9]{64}$/,
  });
}

function utcTimestampField(
  value: unknown,
  label: string,
  issues: string[]
): string {
  const timestamp = stringField(value, label, issues, {
    min: 20,
    max: 35,
    pattern: /^\d{4}-\d{2}-\d{2}T.*Z$/,
  });
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs))
    issues.push(`${label} must be a valid UTC timestamp`);
  else if (timestampMs > Date.now() + 5 * 60_000)
    issues.push(`${label} cannot be in the future`);
  return timestamp;
}

function identifierList(
  value: unknown,
  label: string,
  issues: string[]
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${label} must contain at least one source identity`);
    return [];
  }
  const rows = value.map((entry, index) =>
    stringField(entry, `${label}[${index}]`, issues, {
      min: 3,
      max: 160,
      pattern: /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/,
    })
  );
  if (new Set(rows.map(row => row.toLowerCase())).size !== rows.length)
    issues.push(`${label} must not contain duplicate identities`);
  return rows;
}

function parseFile(
  value: unknown,
  label: string,
  issues: string[]
): EarCorpusFile {
  const row = record(value);
  if (!row) {
    issues.push(`${label} must be an object`);
    return { path: "", sha256: "" };
  }
  rejectUnknownKeys(row, ["path", "sha256"], label, issues);
  return {
    path: stringField(row.path, `${label}.path`, issues, { max: 500 }),
    sha256: hashField(row.sha256, `${label}.sha256`, issues),
  };
}

function parseTrack(
  value: unknown,
  index: number,
  issues: string[]
): EarCorpusTrack {
  const label = `tracks[${index}]`;
  const row = record(value);
  if (!row) {
    issues.push(`${label} must be an object`);
    return {
      id: "",
      path: "",
      sha256: "",
      genre: "afrobeats",
      sourceAssetIds: [],
      sourceFamilyId: "",
      recordingType: "human-produced-master",
      expectTempoBpm: 0,
      fourOnFloor: false,
      stems: Object.fromEntries(
        EAR_STEMS.map(stem => [stem, { path: "", sha256: "" }])
      ) as Record<EarStem, EarCorpusFile>,
      rights: {
        basis: "owned-master",
        reference: "",
        attestedBy: "",
        attestedAt: "",
      },
    };
  }
  rejectUnknownKeys(
    row,
    [
      "id",
      "path",
      "sha256",
      "genre",
      "sourceAssetIds",
      "sourceFamilyId",
      "recordingType",
      "expectTempoBpm",
      "fourOnFloor",
      "stems",
      "rights",
    ],
    label,
    issues
  );

  const id = stringField(row.id, `${label}.id`, issues, {
    min: 3,
    max: 64,
    pattern: /^[a-z0-9][a-z0-9._-]+$/,
  });
  const path = stringField(row.path, `${label}.path`, issues, { max: 500 });
  const sha256 = hashField(row.sha256, `${label}.sha256`, issues);
  const genre = EAR_GENRES.includes(row.genre as EarGenre)
    ? (row.genre as EarGenre)
    : "afrobeats";
  if (!EAR_GENRES.includes(row.genre as EarGenre))
    issues.push(`${label}.genre must be amapiano, afrobeats, or house`);
  const sourceAssetIds = identifierList(
    row.sourceAssetIds,
    `${label}.sourceAssetIds`,
    issues
  );
  const sourceFamilyId = stringField(
    row.sourceFamilyId,
    `${label}.sourceFamilyId`,
    issues,
    {
      min: 3,
      max: 160,
      pattern: /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/,
    }
  );
  const recordingType = EAR_RECORDING_TYPES.includes(
    row.recordingType as EarRecordingType
  )
    ? (row.recordingType as EarRecordingType)
    : "human-produced-master";
  if (!EAR_RECORDING_TYPES.includes(row.recordingType as EarRecordingType))
    issues.push(
      `${label}.recordingType must identify a human-produced master or licensed reference recording`
    );
  const expectTempoBpm =
    typeof row.expectTempoBpm === "number" &&
    Number.isFinite(row.expectTempoBpm) &&
    row.expectTempoBpm >= 60 &&
    row.expectTempoBpm <= 180
      ? row.expectTempoBpm
      : 0;
  if (!expectTempoBpm)
    issues.push(`${label}.expectTempoBpm must be between 60 and 180`);
  const fourOnFloor = row.fourOnFloor === true || row.fourOnFloor === false;
  if (!fourOnFloor) issues.push(`${label}.fourOnFloor must be a boolean`);

  const stemsRecord = record(row.stems);
  if (!stemsRecord) issues.push(`${label}.stems must be an object`);
  else rejectUnknownKeys(stemsRecord, EAR_STEMS, `${label}.stems`, issues);
  const stems = Object.fromEntries(
    EAR_STEMS.map(stem => [
      stem,
      parseFile(stemsRecord?.[stem], `${label}.stems.${stem}`, issues),
    ])
  ) as Record<EarStem, EarCorpusFile>;

  const rightsRecord = record(row.rights);
  if (!rightsRecord) issues.push(`${label}.rights must be an object`);
  else
    rejectUnknownKeys(
      rightsRecord,
      ["basis", "reference", "attestedBy", "attestedAt"],
      `${label}.rights`,
      issues
    );
  const basis = ["owned-master", "licensed-evaluation"].includes(
    String(rightsRecord?.basis)
  )
    ? (rightsRecord!.basis as EarRightsBasis)
    : "owned-master";
  if (
    !["owned-master", "licensed-evaluation"].includes(
      String(rightsRecord?.basis)
    )
  )
    issues.push(
      `${label}.rights.basis must be owned-master or licensed-evaluation`
    );
  const reference = stringField(
    rightsRecord?.reference,
    `${label}.rights.reference`,
    issues,
    { min: 8, max: 500 }
  );
  const attestedBy = stringField(
    rightsRecord?.attestedBy,
    `${label}.rights.attestedBy`,
    issues,
    { min: 2, max: 200 }
  );
  const attestedAt = utcTimestampField(
    rightsRecord?.attestedAt,
    `${label}.rights.attestedAt`,
    issues
  );

  return {
    id,
    path,
    sha256,
    genre,
    sourceAssetIds,
    sourceFamilyId,
    recordingType,
    expectTempoBpm,
    fourOnFloor: row.fourOnFloor === true,
    stems,
    rights: { basis, reference, attestedBy, attestedAt },
  };
}

export function parseEarCorpusManifest(value: unknown): EarCorpusManifest {
  const issues: string[] = [];
  const root = record(value);
  if (!root)
    throw new EarCorpusValidationError(["manifest must be a JSON object"]);
  rejectUnknownKeys(root, ["schemaVersion", "freeze", "tracks"], "manifest", issues);
  if (root.schemaVersion !== EAR_CORPUS_SCHEMA_VERSION)
    issues.push(`manifest.schemaVersion must be ${EAR_CORPUS_SCHEMA_VERSION}`);
  const freezeRecord = record(root.freeze);
  if (!freezeRecord) issues.push("manifest.freeze must be an object");
  else
    rejectUnknownKeys(
      freezeRecord,
      ["purpose", "frozenAt", "frozenBy", "selectionMethod", "trainingSnapshot"],
      "manifest.freeze",
      issues
    );
  const purpose = freezeRecord?.purpose;
  if (purpose !== EAR_HOLDOUT_PURPOSE)
    issues.push(`manifest.freeze.purpose must be ${EAR_HOLDOUT_PURPOSE}`);
  const frozenAt = utcTimestampField(
    freezeRecord?.frozenAt,
    "manifest.freeze.frozenAt",
    issues
  );
  const frozenBy = stringField(
    freezeRecord?.frozenBy,
    "manifest.freeze.frozenBy",
    issues,
    { min: 2, max: 200 }
  );
  const selectionMethod = freezeRecord?.selectionMethod;
  if (selectionMethod !== "rights-cleared-stratified-holdout")
    issues.push(
      "manifest.freeze.selectionMethod must be rights-cleared-stratified-holdout"
    );
  const trainingSnapshot = parseFile(
    freezeRecord?.trainingSnapshot,
    "manifest.freeze.trainingSnapshot",
    issues
  );
  if (!Array.isArray(root.tracks))
    issues.push("manifest.tracks must be an array");
  const rows = Array.isArray(root.tracks) ? root.tracks : [];
  if (rows.length !== 9)
    issues.push("manifest.tracks must contain exactly 9 tracks");
  const tracks = rows.map((row, index) => parseTrack(row, index, issues));

  const ids = new Set<string>();
  const sourceAssetIds = new Set<string>();
  const sourceFamilyIds = new Set<string>();
  const genreCounts: Record<EarGenre, number> = {
    amapiano: 0,
    afrobeats: 0,
    house: 0,
  };
  for (const track of tracks) {
    const key = track.id.toLowerCase();
    if (ids.has(key)) issues.push(`duplicate track id: ${track.id}`);
    ids.add(key);
    for (const sourceAssetId of track.sourceAssetIds) {
      const sourceKey = sourceAssetId.toLowerCase();
      if (sourceAssetIds.has(sourceKey))
        issues.push(`source asset is reused across holdout tracks: ${sourceAssetId}`);
      sourceAssetIds.add(sourceKey);
    }
    const familyKey = track.sourceFamilyId.toLowerCase();
    if (sourceFamilyIds.has(familyKey))
      issues.push(
        `source family is reused across holdout tracks: ${track.sourceFamilyId}`
      );
    sourceFamilyIds.add(familyKey);
    genreCounts[track.genre]++;
  }
  for (const genre of EAR_GENRES) {
    if (genreCounts[genre] !== 3)
      issues.push(`manifest must contain exactly 3 ${genre} tracks`);
  }
  if (issues.length) throw new EarCorpusValidationError(issues);
  return {
    schemaVersion: EAR_CORPUS_SCHEMA_VERSION,
    freeze: {
      purpose: EAR_HOLDOUT_PURPOSE,
      frozenAt,
      frozenBy,
      selectionMethod: "rights-cleared-stratified-holdout",
      trainingSnapshot,
    },
    tracks,
  };
}

export function parseEarTrainingSnapshot(value: unknown): EarTrainingSnapshot {
  const issues: string[] = [];
  const root = record(value);
  if (!root)
    throw new EarCorpusValidationError([
      "training snapshot must be a JSON object",
    ]);
  rejectUnknownKeys(
    root,
    ["schemaVersion", "generatedAt", "datasetHash", "assets"],
    "trainingSnapshot",
    issues
  );
  if (root.schemaVersion !== EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION)
    issues.push(
      `trainingSnapshot.schemaVersion must be ${EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION}`
    );
  const generatedAt = utcTimestampField(
    root.generatedAt,
    "trainingSnapshot.generatedAt",
    issues
  );
  const datasetHash = hashField(
    root.datasetHash,
    "trainingSnapshot.datasetHash",
    issues
  );
  if (!Array.isArray(root.assets) || root.assets.length === 0)
    issues.push("trainingSnapshot.assets must contain the active training corpus");
  const assets = (Array.isArray(root.assets) ? root.assets : []).map(
    (value, index): EarTrainingSnapshotAsset => {
      const label = `trainingSnapshot.assets[${index}]`;
      const row = record(value);
      if (!row) {
        issues.push(`${label} must be an object`);
        return { id: "", contentHash: "", sourceFamilyId: "" };
      }
      rejectUnknownKeys(row, ["id", "contentHash", "sourceFamilyId"], label, issues);
      return {
        id: stringField(row.id, `${label}.id`, issues, {
          min: 3,
          max: 160,
          pattern: /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/,
        }),
        contentHash: hashField(
          row.contentHash,
          `${label}.contentHash`,
          issues
        ),
        sourceFamilyId: stringField(
          row.sourceFamilyId,
          `${label}.sourceFamilyId`,
          issues,
          {
            min: 3,
            max: 160,
            pattern: /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/,
          }
        ),
      };
    }
  );
  for (const [field, values] of [
    ["id", assets.map(asset => asset.id.toLowerCase())],
    ["contentHash", assets.map(asset => asset.contentHash)],
  ] as const) {
    if (new Set(values).size !== values.length)
      issues.push(`trainingSnapshot.assets contains duplicate ${field} values`);
  }
  if (issues.length) throw new EarCorpusValidationError(issues);
  return {
    schemaVersion: EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    datasetHash,
    assets,
  };
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

type EarAudioFormat =
  | "wav"
  | "mp3"
  | "flac"
  | "aiff"
  | "m4a"
  | "ogg"
  | "webm";

async function sniffAudio(path: string): Promise<EarAudioFormat | null> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const text = (start: number, end: number) =>
      bytes.subarray(start, end).toString("ascii");
    if (
      ["RIFF", "RF64"].includes(text(0, 4)) &&
      text(8, 12) === "WAVE"
    )
      return "wav";
    if (
      text(0, 3) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    )
      return "mp3";
    if (text(0, 4) === "fLaC") return "flac";
    if (text(0, 4) === "OggS") return "ogg";
    if (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    )
      return "webm";
    if (text(4, 8) === "ftyp") return "m4a";
    if (text(0, 4) === "FORM" && ["AIFF", "AIFC"].includes(text(8, 12)))
      return "aiff";
    return null;
  } finally {
    await handle.close();
  }
}

function normalizedAudioExtension(path: string): EarAudioFormat | null {
  const extension = extname(path).toLowerCase();
  if (extension === ".aif") return "aiff";
  const format = extension.slice(1) as EarAudioFormat;
  return AUDIO_EXTENSIONS.has(extension) ? format : null;
}

const AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".flac",
  ".aiff",
  ".aif",
  ".m4a",
  ".ogg",
  ".webm",
]);

async function verifyCorpusFile(
  fixturesDir: string,
  file: EarCorpusFile,
  label: string,
  seenPaths: Set<string>,
  issues: string[]
): Promise<string> {
  if (!file.path || isAbsolute(file.path)) {
    issues.push(`${label}.path must be relative to the fixtures directory`);
    return "";
  }
  const absolute = resolve(fixturesDir, file.path);
  const relativePath = relative(fixturesDir, absolute);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..\\`) ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    issues.push(`${label}.path escapes the fixtures directory`);
    return "";
  }
  const extension = normalizedAudioExtension(absolute);
  if (!extension)
    issues.push(`${label}.path has an unsupported audio extension`);
  const pathKey = absolute.toLowerCase();
  if (seenPaths.has(pathKey))
    issues.push(`${label}.path is reused by another file`);
  seenPaths.add(pathKey);

  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      issues.push(`${label}.path must be a regular file, not a link`);
      return absolute;
    }
    if (info.size < 1_000 || info.size > 1024 * 1024 * 1024)
      issues.push(`${label}.path size is outside 1 KB to 1 GB`);
    const real = await realpath(absolute);
    const realRelative = relative(await realpath(fixturesDir), real);
    if (
      realRelative === ".." ||
      realRelative.startsWith(`..\\`) ||
      realRelative.startsWith("../") ||
      isAbsolute(realRelative)
    ) {
      issues.push(`${label}.path resolves outside the fixtures directory`);
      return absolute;
    }
    const actualHash = await hashFile(absolute);
    if (actualHash !== file.sha256)
      issues.push(`${label}.sha256 does not match ${file.path}`);
    const detected = await sniffAudio(absolute);
    if (!detected || detected !== extension)
      issues.push(
        `${label}.path bytes do not match its audio extension (detected ${String(detected)})`
      );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    issues.push(`${label}.path cannot be read (${code})`);
  }
  return absolute;
}

async function verifyTrainingSnapshotFile(
  fixturesDir: string,
  file: EarCorpusFile,
  issues: string[]
): Promise<{ absolutePath: string; actualHash: string | null }> {
  if (!file.path || isAbsolute(file.path) || extname(file.path).toLowerCase() !== ".json") {
    issues.push(
      "manifest.freeze.trainingSnapshot.path must be a relative JSON path"
    );
    return { absolutePath: "", actualHash: null };
  }
  const absolutePath = resolve(fixturesDir, file.path);
  const relativePath = relative(fixturesDir, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..\\`) ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    issues.push("manifest.freeze.trainingSnapshot.path escapes the fixtures directory");
    return { absolutePath, actualHash: null };
  }
  try {
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      issues.push(
        "manifest.freeze.trainingSnapshot.path must be a regular file, not a link"
      );
      return { absolutePath, actualHash: null };
    }
    if (info.size < 100 || info.size > 50 * 1024 * 1024)
      issues.push(
        "manifest.freeze.trainingSnapshot.path size is outside 100 B to 50 MB"
      );
    const real = await realpath(absolutePath);
    const realRelative = relative(await realpath(fixturesDir), real);
    if (
      realRelative === ".." ||
      realRelative.startsWith(`..\\`) ||
      realRelative.startsWith("../") ||
      isAbsolute(realRelative)
    ) {
      issues.push(
        "manifest.freeze.trainingSnapshot.path resolves outside the fixtures directory"
      );
      return { absolutePath, actualHash: null };
    }
    const actualHash = await hashFile(absolutePath);
    if (actualHash !== file.sha256)
      issues.push(
        "manifest.freeze.trainingSnapshot.sha256 does not match the snapshot bytes"
      );
    return { absolutePath, actualHash };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    issues.push(
      `manifest.freeze.trainingSnapshot.path cannot be read (${code})`
    );
    return { absolutePath, actualHash: null };
  }
}

export async function validateEarCorpusManifest(
  value: unknown,
  fixturesDir: string
): Promise<ValidatedEarCorpus> {
  const manifest = parseEarCorpusManifest(value);
  const issues: string[] = [];
  const snapshotFile = await verifyTrainingSnapshotFile(
    fixturesDir,
    manifest.freeze.trainingSnapshot,
    issues
  );
  let trainingSnapshot: EarTrainingSnapshot | null = null;
  if (snapshotFile.actualHash) {
    try {
      trainingSnapshot = parseEarTrainingSnapshot(
        JSON.parse(await readFile(snapshotFile.absolutePath, "utf8"))
      );
    } catch (error) {
      if (error instanceof EarCorpusValidationError) issues.push(...error.issues);
      else
        issues.push(
          `training snapshot is unreadable JSON (${error instanceof Error ? error.message : "unknown error"})`
        );
    }
  }
  const seenPaths = new Set<string>();
  const tracks: ValidatedEarCorpusTrack[] = [];
  for (const [index, track] of manifest.tracks.entries()) {
    const absolutePath = await verifyCorpusFile(
      fixturesDir,
      track,
      `tracks[${index}]`,
      seenPaths,
      issues
    );
    const stemEntries: Array<[EarStem, string]> = [];
    for (const stem of EAR_STEMS) {
      stemEntries.push([
        stem,
        await verifyCorpusFile(
          fixturesDir,
          track.stems[stem],
          `tracks[${index}].stems.${stem}`,
          seenPaths,
          issues
        ),
      ]);
    }
    tracks.push({
      ...track,
      absolutePath,
      absoluteStems: Object.fromEntries(stemEntries) as Record<EarStem, string>,
    });
  }
  if (trainingSnapshot) {
    const frozenMs = Date.parse(manifest.freeze.frozenAt);
    const snapshotMs = Date.parse(trainingSnapshot.generatedAt);
    if (Number.isFinite(frozenMs) && Number.isFinite(snapshotMs) && frozenMs < snapshotMs)
      issues.push(
        "manifest.freeze.frozenAt must be at or after the training snapshot timestamp"
      );

    const trainingIds = new Set(
      trainingSnapshot.assets.map(asset => asset.id.toLowerCase())
    );
    const trainingFamilies = new Set(
      trainingSnapshot.assets.map(asset => asset.sourceFamilyId.toLowerCase())
    );
    const trainingHashes = new Set(
      trainingSnapshot.assets.map(asset => asset.contentHash.toLowerCase())
    );
    for (const [index, track] of manifest.tracks.entries()) {
      const sharedIds = track.sourceAssetIds.filter(id =>
        trainingIds.has(id.toLowerCase())
      );
      if (sharedIds.length)
        issues.push(
          `tracks[${index}] leaks source asset(s) from training: ${sharedIds.join(", ")}`
        );
      if (trainingFamilies.has(track.sourceFamilyId.toLowerCase()))
        issues.push(
          `tracks[${index}].sourceFamilyId is present in the training snapshot`
        );
      const audioHashes = [
        track.sha256,
        ...EAR_STEMS.map(stem => track.stems[stem].sha256),
      ];
      if (audioHashes.some(hash => trainingHashes.has(hash.toLowerCase())))
        issues.push(
          `tracks[${index}] contains audio bytes present in the training snapshot`
        );
    }
  }
  if (issues.length) throw new EarCorpusValidationError(issues);

  if (!trainingSnapshot || !snapshotFile.actualHash)
    throw new EarCorpusValidationError([
      "training snapshot validation did not complete",
    ]);

  const genreCounts: Record<EarGenre, number> = {
    amapiano: 0,
    afrobeats: 0,
    house: 0,
  };
  const rightsBasisCounts: Record<EarRightsBasis, number> = {
    "owned-master": 0,
    "licensed-evaluation": 0,
  };
  for (const track of manifest.tracks) {
    genreCounts[track.genre]++;
    rightsBasisCounts[track.rights.basis]++;
  }
  const canonicalManifest: EarCorpusManifest = {
    schemaVersion: manifest.schemaVersion,
    freeze: manifest.freeze,
    tracks: [...manifest.tracks].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const corpusHash = createHash("sha256")
    .update(canonicalJson(canonicalManifest))
    .digest("hex");
  return {
    manifest,
    trainingSnapshot,
    tracks,
    corpusHash,
    trainingSnapshotHash: snapshotFile.actualHash,
    frozenAt: manifest.freeze.frozenAt,
    leakageVerified: true,
    genreCounts,
    rightsBasisCounts,
  };
}

/**
 * Extract the frozen identities that every future trainer pass must exclude.
 * This parses the complete manifest contract, so a malformed or partial
 * holdout can never silently become a weak exclusion list.
 */
export function earHoldoutExclusions(value: unknown): EarHoldoutExclusions {
  const manifest = parseEarCorpusManifest(value);
  return {
    sourceAssetIds: new Set(
      manifest.tracks.flatMap(track =>
        track.sourceAssetIds.map(id => id.toLowerCase())
      )
    ),
    sourceFamilyIds: new Set(
      manifest.tracks.map(track => track.sourceFamilyId.toLowerCase())
    ),
    contentHashes: new Set(
      manifest.tracks.flatMap(track => [
        track.sha256.toLowerCase(),
        ...EAR_STEMS.map(stem => track.stems[stem].sha256.toLowerCase()),
      ])
    ),
  };
}

export function calibrationSigningKey(value: string | undefined): string {
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error(
      "LOGDRUM_CALIBRATION_SIGNING_KEY must contain at least 32 bytes"
    );
  }
  return value;
}

function unsignedCalibrationArtifact(value: JsonRecord): JsonRecord {
  const copy = { ...value };
  delete copy.signature;
  return copy;
}

export function calibrationKeyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function signCalibrationArtifact<T extends JsonRecord>(
  artifact: T,
  key: string
): T & {
  signatureAlgorithm: "hmac-sha256";
  signatureKeyId: string;
  signature: string;
} {
  calibrationSigningKey(key);
  const unsigned = {
    ...unsignedCalibrationArtifact(artifact),
    signatureAlgorithm: "hmac-sha256" as const,
    signatureKeyId: calibrationKeyId(key),
  };
  return {
    ...unsigned,
    signature: createHmac("sha256", key)
      .update(canonicalJson(unsigned))
      .digest("hex"),
  } as T & {
    signatureAlgorithm: "hmac-sha256";
    signatureKeyId: string;
    signature: string;
  };
}

export function verifyCalibrationArtifactSignature(
  value: unknown,
  key: string | undefined
): boolean {
  const artifact = record(value);
  if (!artifact || !key || Buffer.byteLength(key) < 32) return false;
  if (
    artifact.signatureAlgorithm !== "hmac-sha256" ||
    artifact.signatureKeyId !== calibrationKeyId(key) ||
    typeof artifact.signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.signature)
  )
    return false;
  const expected = createHmac("sha256", key)
    .update(canonicalJson(unsignedCalibrationArtifact(artifact)))
    .digest();
  const actual = Buffer.from(artifact.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validCalibrationParams(value: unknown): boolean {
  const params = record(value);
  if (!params) return false;
  return ["r0", "s", "w1", "w2", "glideFloor"].every(key => {
    const candidate = params[key];
    return typeof candidate === "number" && Number.isFinite(candidate);
  });
}

export function calibrationGateStatus(
  value: unknown,
  signingKey: string | undefined
): { open: boolean; reason: string | null } {
  const artifact = record(value);
  if (!artifact) return { open: false, reason: "invalid-artifact" };
  if (artifact.gatesPassed !== true)
    return { open: false, reason: "gates-not-passed" };
  if (artifact.schemaVersion !== LOGDRUM_CALIBRATION_SCHEMA_VERSION)
    return { open: false, reason: "stale-schema" };
  if (artifact.provenance !== "real-9track")
    return { open: false, reason: "synthetic-calibration" };
  if (artifact.rightsVerified !== true)
    return { open: false, reason: "rights-not-verified" };
  if (artifact.leakageVerified !== true)
    return { open: false, reason: "training-leakage-unverified" };
  if (artifact.manifestSchemaVersion !== EAR_CORPUS_SCHEMA_VERSION)
    return { open: false, reason: "invalid-manifest-schema" };
  if (artifact.trackCount !== 9)
    return { open: false, reason: "invalid-track-count" };
  const genreCounts = record(artifact.genreCounts);
  if (!genreCounts || EAR_GENRES.some(genre => genreCounts[genre] !== 3))
    return { open: false, reason: "invalid-genre-balance" };
  const rightsBasisCounts = record(artifact.rightsBasisCounts);
  if (
    !rightsBasisCounts ||
    Number(rightsBasisCounts["owned-master"] ?? 0) +
      Number(rightsBasisCounts["licensed-evaluation"] ?? 0) !==
      9
  )
    return { open: false, reason: "invalid-rights-summary" };
  if (
    typeof artifact.corpusHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.corpusHash)
  )
    return { open: false, reason: "missing-corpus-hash" };
  if (
    typeof artifact.trainingSnapshotHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.trainingSnapshotHash)
  )
    return { open: false, reason: "missing-training-snapshot-hash" };
  if (
    typeof artifact.holdoutFrozenAt !== "string" ||
    !Number.isFinite(Date.parse(artifact.holdoutFrozenAt))
  )
    return { open: false, reason: "missing-holdout-freeze" };
  const gates = record(artifact.gates);
  if (
    !gates ||
    gates.tempo !== true ||
    gates.fourOnFloor !== true ||
    gates.logDrumSeparation !== true
  )
    return { open: false, reason: "incomplete-gates" };
  if (
    typeof artifact.separationMargin !== "number" ||
    !Number.isFinite(artifact.separationMargin) ||
    artifact.separationMargin <= 0 ||
    !validCalibrationParams(artifact.params)
  )
    return { open: false, reason: "invalid-calibration-values" };
  if (!signingKey || Buffer.byteLength(signingKey) < 32)
    return { open: false, reason: "missing-signing-key" };
  if (!verifyCalibrationArtifactSignature(artifact, signingKey))
    return { open: false, reason: "invalid-signature" };
  return { open: true, reason: null };
}
