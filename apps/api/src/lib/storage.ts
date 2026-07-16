import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseStorageUri, storageUri } from "@afrohit/shared";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

const endpoint =
  process.env.S3_ENDPOINT ??
  process.env.R2_S3_API_URL ??
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined);
const region = process.env.S3_REGION ?? "auto";
const bucket =
  process.env.S3_BUCKET ?? process.env.R2_BUCKET ?? "afrohit-studio";
const legacyPublicBase = (
  process.env.S3_PUBLIC_BASE_URL ?? process.env.R2_PUBLIC_URL
)?.replace(/\/+$/, "");

function legacyObjectKey(value: string): string | null {
  if (!legacyPublicBase) return null;
  try {
    const base = new URL(`${legacyPublicBase}/`);
    const candidate = new URL(value);
    if (
      candidate.origin !== base.origin ||
      !candidate.pathname.startsWith(base.pathname)
    )
      return null;
    const key = candidate.pathname
      .slice(base.pathname.length)
      .replace(/^\/+/, "");
    return parseStorageUri(storageUri(bucket, key))?.key ?? null;
  } catch {
    return null;
  }
}

export function canonicalAssetRef(value: string): string | null {
  const location = parseStorageUri(value);
  if (location)
    return location.bucket === bucket ? storageUri(bucket, location.key) : null;
  const legacyKey = legacyObjectKey(value);
  return legacyKey ? storageUri(bucket, legacyKey) : null;
}

let storageClient: S3Client | null = null;
export function assertStorageConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!(process.env.S3_BUCKET || process.env.R2_BUCKET))
    throw new Error("S3_BUCKET or R2_BUCKET is required in production");
  if (process.env.STORAGE_PRIVATE_CONFIRMED !== "1") {
    throw new Error(
      "STORAGE_PRIVATE_CONFIRMED=1 is required after public bucket access has been disabled"
    );
  }
  const accessKey = process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID;
  const secretKey =
    process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY;
  if ((accessKey && !secretKey) || (!accessKey && secretKey))
    throw new Error("storage access-key configuration is incomplete");
  if (endpoint && (!accessKey || !secretKey))
    throw new Error(
      "S3-compatible endpoint credentials are required in production"
    );
}

function client(): S3Client {
  if (storageClient) return storageClient;
  const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY;
  storageClient = new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
  return storageClient;
}

export async function presignUpload(opts: {
  workspaceId: string;
  kind: string;
  contentType: string;
  ext?: string;
  sizeBytes: number;
}) {
  const key = `${opts.workspaceId}/${opts.kind}/${nanoid()}.${opts.ext ?? "bin"}`;
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentLength: opts.sizeBytes,
      ContentType: opts.contentType,
      CacheControl: "private, max-age=0, no-store",
      Metadata: { workspace: opts.workspaceId },
    }),
    { expiresIn: 300 }
  );
  const assetRef = storageUri(bucket, key);
  return {
    url,
    key,
    assetRef,
    publicUrl: assetRef,
    playbackUrl: await presignDownload(key, 900),
  };
}

export async function presignDownload(key: string, expiresInSec = 3600) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    {
      expiresIn: Math.max(60, Math.min(expiresInSec, 3600)),
    }
  );
}

export async function presignAssetRef(
  value: string,
  expiresInSec = 3600
): Promise<string> {
  const canonical = canonicalAssetRef(value);
  if (!canonical) {
    if (value.startsWith("s3://")) throw new Error("invalid_asset_reference");
    return value;
  }
  const location = parseStorageUri(canonical)!;
  return presignDownload(location.key, expiresInSec);
}

/** Validate a canonical private reference and return true when one was supplied. */
export function assertWorkspaceAsset(
  workspaceId: string,
  value: string
): boolean {
  const canonical = canonicalAssetRef(value);
  if (!canonical) {
    if (value.startsWith("s3://")) {
      throw Object.assign(new Error("invalid_asset_reference"), {
        statusCode: 400,
      });
    }
    return false;
  }
  const location = parseStorageUri(canonical)!;
  if (!location.key.startsWith(`${workspaceId}/`)) {
    throw Object.assign(new Error("cross_workspace_asset"), {
      statusCode: 403,
    });
  }
  return true;
}

export function assertOwnedKey(workspaceId: string, key: string): string {
  if (
    typeof key !== "string" ||
    !key.startsWith(`${workspaceId}/`) ||
    key.includes("..") ||
    key.includes("//") ||
    key.includes("\\")
  ) {
    throw Object.assign(new Error("forbidden_key"), { statusCode: 403 });
  }
  return key;
}

export type AudioFormat =
  | "wav"
  | "mp3"
  | "flac"
  | "ogg"
  | "webm"
  | "m4a"
  | "aiff";

/**
 * Is this stored ContentType an acceptable CLAIM for an audio upload?
 *
 * The claim is only a screen — the magic-byte sniff below is the real content
 * check (the presign schema says exactly this). Browsers tag MPEG AUDIO
 * (.mpeg/.mpg) as "video/mpeg" — a technicality of MIME registration, not a
 * video file — and some upload paths/proxies store "application/octet-stream".
 * Rejecting on those claims BEFORE sniffing broke legitimate audio the presign
 * had already accepted (the .mpeg/.mpg attach failure, 2026-07-16). Anything
 * else (image/*, text/*, other video/*) is still rejected on the claim so the
 * ingest stays an audio ingest.
 */
export function isAcceptableAudioContentTypeClaim(contentType: string): boolean {
  const claim = contentType.trim().toLowerCase().split(";")[0] ?? "";
  return (
    claim.startsWith("audio/") ||
    /^video\/(x-)?mpe?g$/.test(claim) ||
    claim === "application/octet-stream" ||
    claim === "" // no claim stored at all — let the sniff decide
  );
}

export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.byteLength < 12) return null;
  const text = (start: number, end: number) =>
    Buffer.from(bytes.subarray(start, end)).toString("ascii");
  if (
    (text(0, 4) === "RIFF" || text(0, 4) === "RF64") &&
    text(8, 12) === "WAVE"
  )
    return "wav";
  if (
    text(0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
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
}

export async function verifyUploadedAudio(
  workspaceId: string,
  key: string,
  expectedFormat?: string
): Promise<{ key: string; sizeBytes: number; format: AudioFormat }> {
  const ownedKey = assertOwnedKey(workspaceId, key);
  let head;
  try {
    head = await client().send(
      new HeadObjectCommand({ Bucket: bucket, Key: ownedKey })
    );
  } catch {
    throw Object.assign(new Error("uploaded_audio_not_found"), {
      statusCode: 404,
    });
  }
  const sizeBytes = Number(head.ContentLength ?? 0);
  if (sizeBytes < 1_000 || sizeBytes > 250 * 1024 * 1024) {
    throw Object.assign(new Error("uploaded_audio_size_invalid"), {
      statusCode: 413,
    });
  }
  // CLAIM SCREEN ONLY — the sniff below is the real content check. A strict
  // audio/*-only test here rejected .mpeg/.mpg uploads (browsers claim
  // "video/mpeg" for MPEG *audio*) AFTER the presign schema had deliberately
  // accepted them — the file made it to storage and then died at attach.
  if (!isAcceptableAudioContentTypeClaim(String(head.ContentType ?? ""))) {
    throw Object.assign(new Error("uploaded_object_is_not_audio"), {
      statusCode: 415,
    });
  }
  const object = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: ownedKey, Range: "bytes=0-63" })
  );
  if (!object.Body)
    throw Object.assign(new Error("uploaded_audio_unreadable"), {
      statusCode: 422,
    });
  const prefix =
    "transformToByteArray" in object.Body
      ? await object.Body.transformToByteArray()
      : Buffer.concat(
          await (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of object.Body as AsyncIterable<Uint8Array>)
              chunks.push(Buffer.from(chunk));
            return chunks;
          })()
        );
  const format = sniffAudioFormat(prefix);
  if (!format)
    throw Object.assign(new Error("unsupported_or_invalid_audio"), {
      statusCode: 415,
    });
  // .mpeg/.mpg ARE the MP3 family (see the presign schema): the sniff reports
  // MPEG audio frames as "mp3", so an "mpeg"/"mpg" expectation must compare as
  // mp3 or a legitimate file fails on naming alone.
  const normalizedExpected =
    expectedFormat === "mp4"
      ? "m4a"
      : expectedFormat === "mpeg" || expectedFormat === "mpg"
        ? "mp3"
        : expectedFormat;
  if (normalizedExpected && normalizedExpected !== format) {
    throw Object.assign(
      new Error(`audio_format_mismatch_${normalizedExpected}_${format}`),
      { statusCode: 415 }
    );
  }
  return { key: ownedKey, sizeBytes, format };
}

/** Freeze uploaded benchmark evidence by hashing every byte after format and
 * ownership validation. This is intentionally separate from ordinary upload
 * verification because full-file hashing is only needed at evidence boundaries. */
export async function fingerprintUploadedAudio(
  workspaceId: string,
  key: string,
  expectedFormat?: string
): Promise<{
  assetRef: string;
  key: string;
  sizeBytes: number;
  format: AudioFormat;
  contentHash: string;
}> {
  const verified = await verifyUploadedAudio(workspaceId, key, expectedFormat);
  const object = await client().send(
    new GetObjectCommand({ Bucket: bucket, Key: verified.key })
  );
  if (!object.Body || !(Symbol.asyncIterator in object.Body)) {
    throw Object.assign(new Error("uploaded_audio_unreadable"), {
      statusCode: 422,
    });
  }
  const hash = createHash("sha256");
  let total = 0;
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > 250 * 1024 * 1024) {
      throw Object.assign(new Error("uploaded_audio_size_invalid"), {
        statusCode: 413,
      });
    }
    hash.update(bytes);
  }
  if (total !== verified.sizeBytes) {
    throw Object.assign(
      new Error("uploaded_audio_changed_during_verification"),
      { statusCode: 409 }
    );
  }
  return {
    ...verified,
    assetRef: storageUri(bucket, verified.key),
    contentHash: hash.digest("hex"),
  };
}

/** Compatibility name retained while callers migrate from public URLs. */
export function publicUrlFor(key: string): string {
  return storageUri(bucket, key);
}

export async function putBytes(
  key: string,
  bytes: Buffer | Uint8Array,
  contentType: string
) {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      CacheControl: "private, max-age=0, no-store",
    })
  );
  return storageUri(bucket, key);
}

export async function deleteAssetRef(value: string): Promise<void> {
  const canonical = canonicalAssetRef(value);
  const location = canonical ? parseStorageUri(canonical) : null;
  if (!location) return;
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: location.key })
  );
}
