import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseStorageUri, storageUri } from '@afrohit/shared';
import { assertSafeUrl, safeFetch } from '@afrohit/shared/server-url-safety';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

const endpoint =
  process.env.S3_ENDPOINT ??
  process.env.R2_S3_API_URL ??
  (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const region = process.env.S3_REGION ?? 'auto';
const bucket = process.env.S3_BUCKET ?? process.env.R2_BUCKET ?? 'afrohit-studio';
const publicBase = process.env.S3_PUBLIC_BASE_URL ?? process.env.R2_PUBLIC_URL;
const DEFAULT_BUFFER_LIMIT = 128 * 1024 * 1024;
const DEFAULT_INGEST_LIMIT = 640 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 90_000;
const DEFAULT_INGEST_TIMEOUT_MS = 10 * 60_000;

let storageClient: S3Client | null = null;
export function assertStorageConfiguration(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!(process.env.S3_BUCKET || process.env.R2_BUCKET)) throw new Error('S3_BUCKET or R2_BUCKET is required in production');
  if (process.env.STORAGE_PRIVATE_CONFIRMED !== '1') {
    throw new Error('STORAGE_PRIVATE_CONFIRMED=1 is required after public bucket access has been disabled');
  }
  const accessKey = process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY;
  if ((accessKey && !secretKey) || (!accessKey && secretKey)) throw new Error('storage access-key configuration is incomplete');
  if (endpoint && (!accessKey || !secretKey)) throw new Error('S3-compatible endpoint credentials are required in production');
}

function client(): S3Client {
  if (storageClient) return storageClient;
  const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY;
  storageClient = new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
  return storageClient;
}

function safeSegment(value: string, fallback: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

function objectKey(workspaceId: string, kind: string, ext: string): string {
  return `${safeSegment(workspaceId, 'workspace')}/${safeSegment(kind, 'asset')}/${nanoid()}.${safeSegment(ext, 'bin')}`;
}

function ownedLocation(value: string): { key: string } | null {
  const location = parseStorageUri(value);
  if (location) return location.bucket === bucket ? { key: location.key } : null;
  if (!publicBase) return null;
  try {
    const base = new URL(`${publicBase.replace(/\/+$/, '')}/`);
    const candidate = new URL(value);
    if (candidate.origin !== base.origin || !candidate.pathname.startsWith(base.pathname)) return null;
    const key = candidate.pathname.slice(base.pathname.length).replace(/^\/+/, '');
    return parseStorageUri(storageUri(bucket, key)) ? { key } : null;
  } catch {
    return null;
  }
}

/** Canonical private reference. It is deliberately not an HTTP URL. */
export function publicUrlFor(key: string): string {
  return storageUri(bucket, key);
}

export async function uploadBytes(opts: {
  workspaceId: string;
  kind: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
  ext: string;
}): Promise<string> {
  const key = objectKey(opts.workspaceId, opts.kind, opts.ext);
  await client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: opts.bytes,
    ContentLength: opts.bytes.byteLength,
    ContentType: opts.contentType,
    CacheControl: 'private, max-age=0, no-store',
  }));
  return storageUri(bucket, key);
}

async function collectChunks(
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const output: Buffer[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('download_too_large');
    output.push(bytes);
  }
  return Buffer.concat(output, total);
}

export async function downloadToBuffer(
  value: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_BUFFER_LIMIT;
  const local = ownedLocation(value);
  if (local) {
    const object = await client().send(new GetObjectCommand({ Bucket: bucket, Key: local.key }));
    if ((object.ContentLength ?? 0) > maxBytes) throw new Error('download_too_large');
    if (!object.Body || !(Symbol.asyncIterator in object.Body)) throw new Error('storage_body_unavailable');
    return collectChunks(object.Body as AsyncIterable<Uint8Array>, maxBytes);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await safeFetch(value, { signal: controller.signal, maxHops: 5 });
    if (!response.ok) throw new Error(`download_failed_${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('download_too_large');
    if (!response.body) throw new Error('download_body_unavailable');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel('download_too_large');
        throw new Error('download_too_large');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a private asset immediately before handing it to an external provider. */
export async function resolveAssetForProvider(value: string, expiresInSec = 3600): Promise<string> {
  const local = ownedLocation(value);
  if (!local) {
    const check = await assertSafeUrl(value);
    if (!check.ok) throw new Error(`provider_asset_${check.error}`);
    return value;
  }
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: local.key }), {
    expiresIn: Math.max(300, Math.min(expiresInSec, 3600)),
  });
}

export async function ingestRemoteFile(opts: {
  workspaceId: string;
  url: string;
  kind: string;
  ext: string;
  contentType: string;
  maxBytes?: number;
}): Promise<string> {
  const destinationKey = objectKey(opts.workspaceId, opts.kind, opts.ext);
  const local = ownedLocation(opts.url);
  if (local) {
    await client().send(new CopyObjectCommand({
      Bucket: bucket,
      Key: destinationKey,
      CopySource: `${bucket}/${encodeURIComponent(local.key).replace(/%2F/g, '/')}`,
      ContentType: opts.contentType,
      MetadataDirective: 'REPLACE',
      CacheControl: 'private, max-age=0, no-store',
    }));
    return storageUri(bucket, destinationKey);
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_INGEST_LIMIT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_INGEST_TIMEOUT_MS);
  const directory = await mkdtemp(join(tmpdir(), 'afrohit-ingest-'));
  const file = join(directory, 'payload');
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const response = await safeFetch(opts.url, { signal: controller.signal, maxHops: 5 });
    if (!response.ok) throw new Error(`ingest_failed_${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('ingest_too_large');
    if (!response.body) throw new Error('ingest_body_unavailable');

    handle = await open(file, 'w');
    const reader = response.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel('ingest_too_large');
        throw new Error('ingest_too_large');
      }
      await handle.write(chunk);
    }
    await handle.close();
    handle = null;

    await client().send(new PutObjectCommand({
      Bucket: bucket,
      Key: destinationKey,
      Body: createReadStream(file),
      ContentLength: total,
      ContentType: opts.contentType,
      CacheControl: 'private, max-age=0, no-store',
    }));
    return storageUri(bucket, destinationKey);
  } finally {
    clearTimeout(timer);
    await handle?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteObjectByUrl(value: string): Promise<void> {
  let location = ownedLocation(value);
  if (!location && publicBase && value.startsWith(`${publicBase.replace(/\/+$/, '')}/`)) {
    location = { key: value.slice(publicBase.replace(/\/+$/, '').length + 1) };
  }
  if (!location?.key) return;
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: location.key }));
}
