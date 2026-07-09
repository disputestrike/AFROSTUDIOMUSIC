import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
    forcePathStyle: !!endpoint, // MinIO + R2 need this
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  return _client;
}

export async function presignUpload(opts: {
  workspaceId: string;
  kind: string;
  contentType: string;
  ext?: string;
}) {
  const key = `${opts.workspaceId}/${opts.kind}/${nanoid()}.${opts.ext ?? 'bin'}`;
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: opts.contentType }),
    { expiresIn: 300 }
  );
  return { url, key, publicUrl: publicUrlFor(key) };
}

export async function presignDownload(key: string, expiresInSec = 3600) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSec,
  });
}

/**
 * Guard a caller-supplied storage key: it MUST live under the caller's
 * workspace prefix and contain no traversal. Presign writes keys as
 * `${workspaceId}/...`, so an attach/import that accepts a client key must
 * reject anything outside that namespace (cross-tenant read/exfil otherwise).
 * Throws on violation. Returns the key when safe.
 */
export function assertOwnedKey(workspaceId: string, key: string): string {
  if (typeof key !== 'string' || !key.startsWith(`${workspaceId}/`) || key.includes('..') || key.includes('//')) {
    throw Object.assign(new Error('forbidden_key'), { statusCode: 403 });
  }
  return key;
}

export function publicUrlFor(key: string): string {
  if (publicBase) return `${publicBase.replace(/\/+$/, '')}/${key}`;
  if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
  return `s3://${bucket}/${key}`;
}

export async function putBytes(key: string, bytes: Buffer | Uint8Array, contentType: string) {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
  return publicUrlFor(key);
}
