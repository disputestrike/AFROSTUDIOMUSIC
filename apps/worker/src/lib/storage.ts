/**
 * Worker-side storage: download URL → bytes, upload bytes → URL.
 * Mirrors apps/api/src/lib/storage.ts so the worker doesn't depend on it.
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

// Storage config accepts BOTH naming schemes: the app's canonical S3_* vars and
// Cloudflare R2's natural R2_* names (R2_S3_API_URL / R2_ACCESS_KEY_ID / ...),
// so pasting R2 credentials under their own names Just Works. S3_* wins if both set.
const endpoint =
  process.env.S3_ENDPOINT ??
  process.env.R2_S3_API_URL ??
  (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
const region = process.env.S3_REGION ?? 'auto';
const bucket = process.env.S3_BUCKET ?? process.env.R2_BUCKET ?? 'afrohit-studio';
const publicBase = process.env.S3_PUBLIC_BASE_URL ?? process.env.R2_PUBLIC_URL;

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  return _client;
}

export function publicUrlFor(key: string): string {
  if (publicBase) return `${publicBase.replace(/\/+$/, '')}/${key}`;
  if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
  return `s3://${bucket}/${key}`;
}

export async function uploadBytes(opts: {
  workspaceId: string;
  kind: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
  ext: string;
}): Promise<string> {
  const key = `${opts.workspaceId}/${opts.kind}/${nanoid()}.${opts.ext}`;
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: opts.bytes,
      ContentType: opts.contentType,
    })
  );
  return publicUrlFor(key);
}

export async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function ingestRemoteFile(opts: {
  workspaceId: string;
  url: string;
  kind: string;
  ext: string;
  contentType: string;
}): Promise<string> {
  const bytes = await downloadToBuffer(opts.url);
  return uploadBytes({ workspaceId: opts.workspaceId, kind: opts.kind, bytes, contentType: opts.contentType, ext: opts.ext });
}

/**
 * Delete an object we host, by its public URL. Used to PURGE transient
 * training-session audio after its recipe is extracted — the studio keeps
 * what it LEARNED, never a copy of someone else's recording.
 */
export async function deleteObjectByUrl(url: string): Promise<void> {
  if (!publicBase || !url.startsWith(publicBase)) return; // only our own objects
  const key = url.slice(publicBase.length).replace(/^\//, '');
  if (!key) return;
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
