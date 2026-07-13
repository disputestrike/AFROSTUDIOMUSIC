export type StorageLocation = { bucket: string; key: string };

export function storageUri(bucket: string, key: string): string {
  const cleanBucket = bucket.trim();
  const cleanKey = key.replace(/^\/+/, '');
  const value = `s3://${cleanBucket}/${cleanKey}`;
  if (!parseStorageUri(value)) {
    throw new Error('invalid storage location');
  }
  return value;
}

export function parseStorageUri(value: string): StorageLocation | null {
  if (typeof value !== 'string' || !value.startsWith('s3://')) return null;
  const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,62})\/([A-Za-z0-9][A-Za-z0-9/_-]*(?:\.[A-Za-z0-9_-]+)?)$/.exec(value);
  if (!match) return null;
  const bucket = match[1]!;
  const key = match[2]!;
  if (key.length > 1024 || key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return { bucket, key };
}

export function isStorageUri(value: unknown): value is string {
  return typeof value === 'string' && parseStorageUri(value) !== null;
}
