import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ISSUER = 'afrohit-api';
const AUDIENCE = 'afrohit-web';
const COOKIE_NAME = 'afrohit_session';
const ADMIN_COOKIE_NAME = 'afrohit_admin';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_FAMILY_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAMILY_TTL_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_REVOCATION_TIMEOUT_MS = 500;
const REVOCATION_KEY_PREFIX = 'auth:session-revoked:v1';

export type SessionClaims = {
  sub: string;
  workspaceId: string;
  role?: string;
  iss: string;
  aud: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  sid: string;
  fexp: number;
};

export type SessionFamily = {
  id: string;
  expiresAt: number;
};

export class SessionRevocationUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('session revocation store unavailable', cause === undefined ? undefined : { cause });
    this.name = 'SessionRevocationUnavailableError';
  }
}

function sessionSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return secret;
}

export function assertSessionConfiguration(): void {
  sessionSecret();
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signSession(
  claims: { sub: string; workspaceId: string; role?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
  family?: SessionFamily,
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(300, Math.min(ttlSeconds, 24 * 60 * 60));
  const sid = family?.id ?? randomBytes(16).toString('base64url');
  const fexp = family?.expiresAt ?? now + DEFAULT_FAMILY_TTL_SECONDS;
  if (!validSessionIdentifier(sid) ||
      !Number.isSafeInteger(fexp) ||
      fexp <= now ||
      fexp - now > MAX_FAMILY_TTL_SECONDS) {
    throw new Error('invalid session family');
  }
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    ...claims,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    nbf: now - 5,
    exp: Math.min(now + ttl, fexp),
    jti: randomBytes(16).toString('base64url'),
    sid,
    fexp,
  });
  const signature = createHmac('sha256', sessionSecret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function sessionFamilyFromClaims(claims: SessionClaims): SessionFamily {
  return { id: claims.sid, expiresAt: claims.fexp };
}

function validSessionIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function verifySession(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  let header: { alg?: string; typ?: string };
  let claims: Partial<SessionClaims>;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as typeof header;
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SessionClaims>;
  } catch {
    return null;
  }
  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  const expected = createHmac('sha256', sessionSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
  if (typeof claims.iat !== 'number' ||
      typeof claims.nbf !== 'number' ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.nbf) ||
      !Number.isSafeInteger(claims.exp)) return null;
  if (claims.nbf > now + 30 || claims.iat > now + 30 || claims.exp <= now) return null;
  if (claims.exp - claims.iat > 24 * 60 * 60 + 30) return null;
  if (typeof claims.sub !== 'string' || typeof claims.workspaceId !== 'string' || !claims.sub || !claims.workspaceId) return null;
  if (!validSessionIdentifier(claims.jti)) return null;

  // Tokens issued before family revocation was introduced remain valid, but
  // their JTI acts as a one-token family so they can still be revoked safely.
  const sid = claims.sid === undefined ? claims.jti : claims.sid;
  const fexp = claims.fexp === undefined ? claims.exp : claims.fexp;
  if (!validSessionIdentifier(sid) || typeof fexp !== 'number' || !Number.isSafeInteger(fexp)) return null;
  if (fexp < claims.exp || fexp <= now || fexp - claims.iat > MAX_FAMILY_TTL_SECONDS + 30) return null;
  return { ...claims, sid, fexp } as SessionClaims;
}

function revocationKey(kind: 'jti' | 'sid', value: string): string {
  const digest = createHash('sha256').update(value).digest('base64url');
  return `${REVOCATION_KEY_PREFIX}:${kind}:${digest}`;
}

function revocationTimeoutMs(): number {
  const configured = Number(process.env.SESSION_REVOCATION_TIMEOUT_MS ?? DEFAULT_REVOCATION_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_REVOCATION_TIMEOUT_MS;
  return Math.max(50, Math.min(Math.trunc(configured), 5_000));
}

async function runRevocationCommand<T>(redis: Redis, command: () => Promise<T>): Promise<T> {
  if (redis.status !== 'ready') throw new SessionRevocationUnavailableError();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SessionRevocationUnavailableError()), revocationTimeoutMs());
  });
  try {
    return await Promise.race([Promise.resolve().then(command), timeout]);
  } catch (error) {
    if (error instanceof SessionRevocationUnavailableError) throw error;
    throw new SessionRevocationUnavailableError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function isSessionRevoked(redis: Redis, claims: SessionClaims): Promise<boolean> {
  const keys = [revocationKey('jti', claims.jti), revocationKey('sid', claims.sid)];
  const values = await runRevocationCommand(redis, () => redis.mget(...keys));
  if (values.length !== keys.length) throw new SessionRevocationUnavailableError();
  return values.some(value => value !== null);
}

async function writeRevocations(
  redis: Redis,
  entries: Array<{ key: string; expiresAt: number }>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const transaction = redis.multi();
  for (const entry of entries) {
    transaction.set(entry.key, '1', 'EX', Math.max(1, entry.expiresAt - now));
  }
  const result = await runRevocationCommand(redis, () => transaction.exec());
  if (!result || result.some(([error]) => error !== null)) {
    throw new SessionRevocationUnavailableError();
  }
}

export async function revokeSessionToken(redis: Redis, claims: SessionClaims): Promise<void> {
  await writeRevocations(redis, [
    { key: revocationKey('jti', claims.jti), expiresAt: claims.exp },
  ]);
}

export async function revokeSessionFamily(redis: Redis, claims: SessionClaims): Promise<void> {
  await writeRevocations(redis, [
    { key: revocationKey('jti', claims.jti), expiresAt: claims.exp },
    { key: revocationKey('sid', claims.sid), expiresAt: claims.fexp },
  ]);
}

function parseCookies(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (raw ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

export function requestSession(req: FastifyRequest): { token: string; source: 'bearer' | 'cookie' } | null {
  const authorization = String(req.headers.authorization ?? '');
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return { token, source: 'bearer' };
  }
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return token ? { token, source: 'cookie' } : null;
}

function cookieAttributes(maxAge: number): string {
  const production = process.env.NODE_ENV === 'production';
  const configured = (process.env.SESSION_COOKIE_SAMESITE ?? 'lax').toLowerCase();
  const sameSite = configured === 'none' ? 'None' : configured === 'strict' ? 'Strict' : 'Lax';
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  return [
    'Path=/',
    'HttpOnly',
    production || sameSite === 'None' ? 'Secure' : '',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`,
    domain ? `Domain=${domain}` : '',
  ].filter(Boolean).join('; ');
}

export function sessionCookie(token: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  return `${COOKIE_NAME}=${token}; ${cookieAttributes(ttlSeconds)}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

export function signAdminGrant(userId: string, workspaceId: string): string {
  const secret = process.env.ADMIN_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) throw new Error('ADMIN_SECRET must contain at least 32 bytes');
  const payload = encodeJson({
    userId,
    workspaceId,
    exp: Math.floor(Date.now() / 1000) + ADMIN_TTL_SECONDS,
    jti: randomBytes(16).toString('base64url'),
  });
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function adminGrantCookie(token: string): string {
  return `${ADMIN_COOKIE_NAME}=${token}; ${cookieAttributes(ADMIN_TTL_SECONDS)}`;
}

export function clearAdminGrantCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

export function validAdminGrant(req: FastifyRequest, userId: string, workspaceId: string): boolean {
  const secret = process.env.ADMIN_SECRET ?? '';
  if (Buffer.byteLength(secret) < 32) return false;
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE_NAME];
  if (!token) return false;
  const split = token.lastIndexOf('.');
  if (split <= 0) return false;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: string;
      workspaceId?: string;
      exp?: number;
      jti?: string;
    };
    return claims.userId === userId &&
      claims.workspaceId === workspaceId &&
      typeof claims.jti === 'string' &&
      !!claims.jti &&
      typeof claims.exp === 'number' &&
      claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function constantTimeSecretEqual(actual: unknown, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = (process.env.WEB_URL ?? 'http://localhost:3000')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try { return new URL(entry).origin; } catch { return ''; }
    });
  try {
    return allowed.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}
