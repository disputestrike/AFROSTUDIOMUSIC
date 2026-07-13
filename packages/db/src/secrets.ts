import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const AAD = Buffer.from('afrohit.workspace-secret.v1', 'utf8');

function decodeKey(raw: string): Buffer {
  const value = raw.trim().replace(/^base64:/, '');
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error('ENCRYPTION_KEY must be exactly 32 bytes encoded as base64 or 64 hexadecimal characters');
}

function encryptionKey(required: boolean): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (required) throw new Error('ENCRYPTION_KEY is required to protect workspace provider credentials');
    return null;
  }
  return decodeKey(raw);
}

export function assertSecretConfiguration(): void {
  encryptionKey(process.env.NODE_ENV === 'production');
}

export function isSealedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function sealSecret(plaintext: string): string {
  if (!plaintext) throw new Error('cannot encrypt an empty secret');
  const key = encryptionKey(true)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function openSecret(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!isSealedSecret(value)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('refusing to use an unencrypted workspace credential in production');
    }
    return value;
  }

  const encoded = value.slice(PREFIX.length).split('.');
  if (encoded.length !== 3 || encoded.some((part) => !part)) {
    throw new Error('workspace secret envelope is malformed');
  }
  const [ivPart, tagPart, ciphertextPart] = encoded as [string, string, string];
  const key = encryptionKey(true)!;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function secretHint(value: string | null | undefined): string | null {
  const plaintext = openSecret(value);
  return plaintext ? `****${plaintext.slice(-4)}` : null;
}

export const secretEnvelopePrefix = PREFIX;
