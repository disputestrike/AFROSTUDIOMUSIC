#!/usr/bin/env node
/**
 * Validate and upload a rights-clean competitor corpus for the blind benchmark.
 *
 * Validation is offline by default. Uploading requires an authenticated API and
 * an explicit --confirm-upload flag. Signed upload URLs and bearer tokens are
 * never written to the evidence report.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const FORMATS = new Set(["wav", "mp3", "flac", "aiff", "m4a", "ogg", "webm"]);
const MIME = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  aiff: "audio/aiff",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
};
const HASH = /^[a-f0-9]{64}$/i;
const NORMALIZATION_LIMITS = {
  maxIntegratedLufsDelta: 1,
  maxDurationDeltaSeconds: 1,
};
const args = process.argv.slice(2);

function argumentValue(name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

function help() {
  console.log(
    [
      "AfroHit blind benchmark corpus",
      "",
      "Validate only:",
      "  node scripts/benchmark-corpus.mjs --manifest ./benchmark.json --validate-only",
      "",
      "Validate and upload:",
      "  API_URL=https://... AUTH_TOKEN=... node scripts/benchmark-corpus.mjs \\",
      "    --manifest ./benchmark.json --confirm-upload",
      "",
      "Manifest requirements:",
      "  schemaVersion 1, competitor suno, protocol attestation,",
      "  measured normalization evidence for both sides of every pair,",
      "  at least 10 unique files and songs across at least 5 genres.",
    ].join("\n")
  );
}

if (hasFlag("--help") || hasFlag("-h")) {
  help();
  process.exit(0);
}

const manifestArgument = argumentValue("--manifest");
if (!manifestArgument) {
  help();
  throw new Error("--manifest is required");
}
const validateOnly = hasFlag("--validate-only");
if (!validateOnly && !hasFlag("--confirm-upload")) {
  throw new Error("--confirm-upload is required before any object upload");
}

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return null;
}

function hashJson(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function identityHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStrictKeys(value, allowed, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    label + " must be an object"
  );
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  assert(
    unexpected.length === 0,
    label + " has unexpected keys: " + unexpected.join(", ")
  );
}

function isUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}

function assertNormalizationSide(side, label) {
  assertStrictKeys(
    side,
    ["contentHash", "integratedLufs", "durationSeconds", "metadata"],
    label
  );
  assert(
    typeof side.contentHash === "string" && HASH.test(side.contentHash),
    label + ".contentHash must be a full SHA-256 hash"
  );
  assert(
    Number.isFinite(side.integratedLufs) &&
      side.integratedLufs >= -70 &&
      side.integratedLufs <= 5,
    label + ".integratedLufs must be a measured value from -70 to 5"
  );
  assert(
    Number.isFinite(side.durationSeconds) &&
      side.durationSeconds >= 1 &&
      side.durationSeconds <= 21_600,
    label + ".durationSeconds must be a measured value from 1 to 21600"
  );
  assertStrictKeys(
    side.metadata,
    ["formatTagKeys", "streamTagKeys"],
    label + ".metadata"
  );
  assert(
    Array.isArray(side.metadata.formatTagKeys) &&
      side.metadata.formatTagKeys.length === 0 &&
      Array.isArray(side.metadata.streamTagKeys) &&
      side.metadata.streamTagKeys.length === 0,
    label + ".metadata must contain empty post-normalization tag inventories"
  );
}

function assertNormalizationEvidence(evidence, label, referenceHash) {
  assertStrictKeys(
    evidence,
    [
      "schemaVersion",
      "measuredAt",
      "analyzer",
      "tolerances",
      "afrohit",
      "reference",
    ],
    label
  );
  assert(evidence.schemaVersion === 1, label + ".schemaVersion must be 1");
  assert(
    isUtcTimestamp(evidence.measuredAt),
    label + ".measuredAt must be a UTC timestamp"
  );
  assertStrictKeys(
    evidence.analyzer,
    ["name", "version", "loudnessMethod"],
    label + ".analyzer"
  );
  assert(
    typeof evidence.analyzer.name === "string" &&
      evidence.analyzer.name.trim().length >= 2 &&
      typeof evidence.analyzer.version === "string" &&
      evidence.analyzer.version.trim().length >= 1 &&
      evidence.analyzer.loudnessMethod === "ebu_r128",
    label + ".analyzer must identify an EBU R128 measurement tool"
  );
  assertStrictKeys(
    evidence.tolerances,
    ["maxIntegratedLufsDelta", "maxDurationDeltaSeconds"],
    label + ".tolerances"
  );
  for (const [key, maximum] of Object.entries(NORMALIZATION_LIMITS)) {
    assert(
      Number.isFinite(evidence.tolerances[key]) &&
        evidence.tolerances[key] >= 0 &&
        evidence.tolerances[key] <= maximum,
      label + ".tolerances." + key + " exceeds the claim limit"
    );
  }
  assertNormalizationSide(evidence.afrohit, label + ".afrohit");
  assertNormalizationSide(evidence.reference, label + ".reference");
  assert(
    evidence.reference.contentHash.toLowerCase() === referenceHash,
    label + ".reference.contentHash does not match the reference file"
  );
  assert(
    evidence.afrohit.contentHash.toLowerCase() !== referenceHash,
    label + " must bind two distinct audio assets"
  );
  assert(
    Math.abs(
      evidence.afrohit.integratedLufs - evidence.reference.integratedLufs
    ) <=
      evidence.tolerances.maxIntegratedLufsDelta + 1e-9,
    label + " measured loudness exceeds its persisted tolerance"
  );
  assert(
    Math.abs(
      evidence.afrohit.durationSeconds - evidence.reference.durationSeconds
    ) <=
      evidence.tolerances.maxDurationDeltaSeconds + 1e-9,
    label + " measured duration exceeds its persisted tolerance"
  );
}

function inside(base, candidate) {
  const rel = relative(base, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
  );
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function sniffAudio(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const text = (start, end) => bytes.subarray(start, end).toString("ascii");
    if (
      (text(0, 4) === "RIFF" || text(0, 4) === "RF64") &&
      text(8, 12) === "WAVE"
    ) {
      return "wav";
    }
    if (
      text(0, 3) === "ID3" ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    ) {
      return "mp3";
    }
    if (text(0, 4) === "fLaC") return "flac";
    if (text(0, 4) === "OggS") return "ogg";
    if (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    ) {
      return "webm";
    }
    if (text(4, 8) === "ftyp") return "m4a";
    if (text(0, 4) === "FORM" && ["AIFF", "AIFC"].includes(text(8, 12))) {
      return "aiff";
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function parseManifest(path) {
  const manifestPath = resolve(path);
  const manifestDir = dirname(manifestPath);
  const manifestDirReal = await realpath(manifestDir);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error("manifest is unreadable JSON: " + error.message);
  }
  assertStrictKeys(
    manifest,
    ["schemaVersion", "competitor", "protocol", "entries"],
    "manifest"
  );
  assert(manifest.schemaVersion === 1, "schemaVersion must be 1");
  assert(manifest.competitor === "suno", "competitor must be suno");
  assertStrictKeys(
    manifest.protocol,
    [
      "version",
      "blind",
      "identityMetadataRemoved",
      "loudnessMatched",
      "durationMatched",
      "independentJudgesMin",
      "note",
    ],
    "protocol"
  );
  assert(manifest.protocol.version === 1, "protocol.version must be 1");
  assert(manifest.protocol.blind === true, "protocol.blind must be true");
  assert(
    manifest.protocol.identityMetadataRemoved === true,
    "protocol.identityMetadataRemoved must be true"
  );
  assert(
    manifest.protocol.loudnessMatched === true,
    "protocol.loudnessMatched must be true"
  );
  assert(
    manifest.protocol.durationMatched === true,
    "protocol.durationMatched must be true"
  );
  assert(
    Number.isInteger(manifest.protocol.independentJudgesMin) &&
      manifest.protocol.independentJudgesMin >= 3,
    "protocol.independentJudgesMin must be at least 3"
  );
  assert(
    typeof manifest.protocol.note === "string" &&
      manifest.protocol.note.trim().length >= 10,
    "protocol.note must describe the controlled listening protocol"
  );
  assert(
    Array.isArray(manifest.entries) && manifest.entries.length >= 10,
    "at least 10 corpus entries are required"
  );

  const ids = new Set();
  const songIds = new Set();
  const paths = new Set();
  const hashes = new Set();
  const afrohitHashes = new Set();
  const genres = new Set();
  const entries = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const label = "entries[" + index + "]";
    assertStrictKeys(
      entry,
      [
        "id",
        "songId",
        "genre",
        "file",
        "format",
        "sha256",
        "rights",
        "normalizationEvidence",
      ],
      label
    );
    assert(
      typeof entry.id === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(entry.id),
      label + ".id is invalid"
    );
    assert(!ids.has(entry.id), "duplicate entry id: " + entry.id);
    ids.add(entry.id);
    assert(
      typeof entry.songId === "string" &&
        /^[A-Za-z0-9_-]{10,80}$/.test(entry.songId),
      label + ".songId is invalid"
    );
    assert(
      !songIds.has(entry.songId),
      "each AfroHit song may appear only once: " + entry.songId
    );
    songIds.add(entry.songId);
    assert(
      typeof entry.genre === "string" && /^[a-z0-9_]{2,40}$/.test(entry.genre),
      label + ".genre is invalid"
    );
    genres.add(entry.genre);
    assert(
      typeof entry.file === "string" &&
        entry.file.length > 0 &&
        !isAbsolute(entry.file),
      label + ".file must be a relative path"
    );
    const fullPath = resolve(manifestDir, entry.file);
    assert(
      inside(manifestDir, fullPath),
      label + ".file escapes the manifest directory"
    );
    const fileInfo = await lstat(fullPath);
    assert(!fileInfo.isSymbolicLink(), label + ".file may not be a symlink");
    assert(fileInfo.isFile(), label + ".file must be a regular file");
    const fullReal = await realpath(fullPath);
    assert(
      inside(manifestDirReal, fullReal),
      label + ".file resolves outside the manifest directory"
    );
    assert(
      fileInfo.size >= 1_000 && fileInfo.size <= 250 * 1024 * 1024,
      label + ".file must be between 1 KB and 250 MB"
    );
    assert(
      typeof entry.format === "string" && FORMATS.has(entry.format),
      label + ".format is unsupported"
    );
    const rawExtension = extname(entry.file).slice(1).toLowerCase();
    const extension = rawExtension === "aif" ? "aiff" : rawExtension;
    assert(
      extension === entry.format,
      label + ".file extension does not match format"
    );
    const detected = await sniffAudio(fullPath);
    assert(
      detected === entry.format,
      label +
        ".file bytes do not match format (detected " +
        String(detected) +
        ")"
    );
    assert(
      typeof entry.sha256 === "string" && HASH.test(entry.sha256),
      label + ".sha256 must be a full SHA-256 hash"
    );
    const actualHash = await sha256File(fullPath);
    assert(
      actualHash === entry.sha256.toLowerCase(),
      label + ".sha256 does not match the file"
    );
    assert(
      !hashes.has(actualHash),
      "competitor audio bytes are duplicated: " + actualHash
    );
    hashes.add(actualHash);
    const normalizedPath = fullReal.toLowerCase();
    assert(
      !paths.has(normalizedPath),
      "the same file path appears more than once"
    );
    paths.add(normalizedPath);

    assertStrictKeys(
      entry.rights,
      ["confirmed", "basis", "note", "attestedBy", "attestedAt"],
      label + ".rights"
    );
    assert(
      entry.rights.confirmed === true,
      label + ".rights.confirmed must be true"
    );
    assert(
      ["owner", "licensed_evaluation"].includes(entry.rights.basis),
      label + ".rights.basis is invalid"
    );
    assert(
      typeof entry.rights.note === "string" &&
        entry.rights.note.trim().length >= 3 &&
        entry.rights.note.length <= 400,
      label + ".rights.note must be 3-400 characters"
    );
    assert(
      typeof entry.rights.attestedBy === "string" &&
        entry.rights.attestedBy.trim().length >= 2,
      label + ".rights.attestedBy is required"
    );
    assert(
      isUtcTimestamp(entry.rights.attestedAt),
      label + ".rights.attestedAt must be a UTC timestamp"
    );
    assertNormalizationEvidence(
      entry.normalizationEvidence,
      label + ".normalizationEvidence",
      actualHash
    );
    const afrohitHash =
      entry.normalizationEvidence.afrohit.contentHash.toLowerCase();
    assert(
      !afrohitHashes.has(afrohitHash),
      "AfroHit audio bytes are duplicated: " + afrohitHash
    );
    afrohitHashes.add(afrohitHash);
    entries.push({
      ...entry,
      sha256: actualHash,
      fullPath,
      sizeBytes: fileInfo.size,
      contentType: MIME[entry.format],
    });
  }
  for (const referenceHash of hashes) {
    assert(
      !afrohitHashes.has(referenceHash),
      "audio bytes appear on both benchmark sides: " + referenceHash
    );
  }
  assert(genres.size >= 5, "at least 5 genres are required");
  const publicManifest = {
    schemaVersion: manifest.schemaVersion,
    competitor: manifest.competitor,
    protocol: manifest.protocol,
    entries: entries.map(entry => ({
      id: entry.id,
      songId: entry.songId,
      genre: entry.genre,
      file: entry.file,
      format: entry.format,
      sha256: entry.sha256,
      rights: entry.rights,
      normalizationEvidence: entry.normalizationEvidence,
    })),
  };
  return {
    manifestPath,
    manifest: publicManifest,
    entries,
    genres: [...genres].sort(),
    manifestHash: hashJson(publicManifest),
  };
}

function ensureApiConfiguration() {
  const apiUrl = String(process.env.API_URL ?? process.env.API_BASE ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(process.env.AUTH_TOKEN ?? "").trim();
  assert(apiUrl && token, "API_URL and AUTH_TOKEN are required for upload");
  const parsed = new URL(apiUrl);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  assert(
    parsed.protocol === "https:" || local,
    "API_URL must use HTTPS outside localhost"
  );
  return { apiUrl, token, origin: parsed.origin };
}

async function apiCall(config, path, options = {}) {
  const method = options.method ?? "GET";
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const response = await fetch(config.apiUrl + path, {
    method,
    headers: {
      accept: "application/json",
      authorization: "Bearer " + config.token,
      ...(unsafe ? { "x-afrohit-request": "1" } : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object"
        ? String(body.error ?? body.message ?? "")
        : "";
    throw new Error(
      method +
        " " +
        path +
        " returned " +
        response.status +
        (code ? " (" + code.slice(0, 160) + ")" : "")
    );
  }
  return { status: response.status, body };
}

async function loadState(path, manifestHash) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state.manifestHash !== manifestHash) {
      throw new Error("benchmark state belongs to another manifest");
    }
    return state;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { schemaVersion: 1, manifestHash, entries: {} };
    }
    throw error;
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

const parsed = await parseManifest(manifestArgument);
console.log(
  "Validated " +
    parsed.entries.length +
    " unique files across " +
    parsed.genres.length +
    " genres"
);
console.log("Manifest SHA-256: " + parsed.manifestHash);

const artifactRoot = resolve(
  process.env.ACCEPTANCE_ARTIFACT_DIR ?? "artifacts/acceptance"
);
const reportPath = resolve(
  argumentValue("--output") ??
    artifactRoot +
      sep +
      "benchmark-" +
      parsed.manifestHash.slice(0, 16) +
      ".json"
);
const statePath = resolve(
  artifactRoot +
    sep +
    "benchmark-state-" +
    parsed.manifestHash.slice(0, 16) +
    ".json"
);

let server = null;
const uploaded = [];
if (!validateOnly) {
  const config = ensureApiConfiguration();
  const state = await loadState(statePath, parsed.manifestHash);
  const existingPairs = await apiCall(
    config,
    "/api/v1/benchmark/competitor/pairs"
  );
  const activePairIds = new Set(
    Array.isArray(existingPairs.body)
      ? existingPairs.body.map(pair => pair.id).filter(Boolean)
      : []
  );
  for (const [index, entry] of parsed.entries.entries()) {
    const previous = state.entries[entry.id];
    if (
      previous &&
      previous.sha256 === entry.sha256 &&
      previous.key &&
      previous.pairId &&
      activePairIds.has(previous.pairId)
    ) {
      uploaded.push({
        id: entry.id,
        songIdHash: identityHash(entry.songId),
        sha256: entry.sha256,
        pairId: previous.pairId,
        reused: true,
      });
      console.log(
        "REUSE " +
          String(index + 1).padStart(2, "0") +
          "/" +
          parsed.entries.length +
          " " +
          entry.id
      );
      continue;
    }
    const presigned = await apiCall(config, "/api/v1/uploads/presign", {
      method: "POST",
      body: {
        kind: "reference",
        contentType: entry.contentType,
        ext: entry.format,
        sizeBytes: entry.sizeBytes,
      },
      idempotencyKey:
        "benchmark." + parsed.manifestHash.slice(0, 20) + "." + entry.id,
    });
    assert(
      presigned.body?.url && presigned.body?.key,
      "presign response is incomplete for " + entry.id
    );
    const uploadResponse = await fetch(presigned.body.url, {
      method: "PUT",
      headers: {
        "content-type": entry.contentType,
        "content-length": String(entry.sizeBytes),
      },
      body: createReadStream(entry.fullPath),
      duplex: "half",
      signal: AbortSignal.timeout(15 * 60_000),
    });
    assert(
      uploadResponse.ok,
      "object upload failed for " +
        entry.id +
        " with HTTP " +
        uploadResponse.status
    );
    const protocolTag =
      " Protocol evidence " + parsed.manifestHash.slice(0, 20) + ".";
    const pair = await apiCall(config, "/api/v1/benchmark/competitor/pairs", {
      method: "POST",
      body: {
        songId: entry.songId,
        referenceKey: presigned.body.key,
        referenceFormat: entry.format,
        competitor: parsed.manifest.competitor,
        rightsAttestation: {
          confirmed: true,
          basis: entry.rights.basis,
          note: (entry.rights.note + protocolTag).slice(0, 500),
        },
        comparisonProtocol: {
          ...parsed.manifest.protocol,
          normalizationEvidence: entry.normalizationEvidence,
        },
      },
      idempotencyKey:
        "benchmark-pair." + parsed.manifestHash.slice(0, 20) + "." + entry.id,
    });
    assert(pair.body?.id, "pair id is missing for " + entry.id);
    state.entries[entry.id] = {
      sha256: entry.sha256,
      key: presigned.body.key,
      pairId: pair.body.id,
      uploadedAt: new Date().toISOString(),
    };
    await saveState(statePath, state);
    uploaded.push({
      id: entry.id,
      songIdHash: identityHash(entry.songId),
      sha256: entry.sha256,
      pairId: pair.body.id,
      reused: pair.body.existing === true,
    });
    console.log(
      "UPLOAD " +
        String(index + 1).padStart(2, "0") +
        "/" +
        parsed.entries.length +
        " " +
        entry.id
    );
  }
  const evidence = await apiCall(
    config,
    "/api/v1/benchmark/competitor/evidence"
  );
  server = evidence.body;
  assert(
    server?.gates?.corpusPassed === true,
    "server corpus gate remains closed after upload"
  );
  assert(
    server?.corpus?.sample?.eligiblePairs >= 10,
    "server has fewer than 10 eligible independent pairs"
  );
  assert(
    server?.corpus?.sample?.genres >= 5,
    "server has fewer than 5 eligible genres"
  );
}

const reportBase = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: validateOnly ? "validate-only" : "uploaded",
  manifestFile: basename(parsed.manifestPath),
  manifestPathHash: identityHash(parsed.manifestPath),
  manifestHash: parsed.manifestHash,
  competitor: parsed.manifest.competitor,
  protocol: parsed.manifest.protocol,
  corpus: {
    entries: parsed.entries.length,
    genres: parsed.genres,
    uniqueCompetitorHashes: parsed.entries.length,
    rightsAttested: parsed.entries.length,
    normalizationMeasured: parsed.entries.length,
  },
  uploads: uploaded,
  serverEvidence: server,
};
const report = { ...reportBase, evidenceHash: hashJson(reportBase) };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log("Evidence: " + reportPath);
console.log("Evidence SHA-256: " + report.evidenceHash);
