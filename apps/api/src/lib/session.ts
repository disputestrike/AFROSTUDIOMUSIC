import type { FastifyRequest } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ISSUER = 'afrohit-api';
const AUDIENCE = 'afrohit-web';
const COOKIE_NAME = 'afrohit_session';
const ADMIN_COOKIE_NAME = 'afrohit_admin';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_TTL_SECONDS = 2 * 60 * 60;

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
};

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
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(300, Math.min(ttlSeconds, 24 * 60 * 60));
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    ...claims,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    nbf: now - 5,
    exp: now + ttl,
    jti: randomBytes(16).toString('base64url'),
  });
  const signature = createHmac('sha256', sessionSecret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
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
  if (typeof claims.iat !== 'number' || typeof claims.nbf !== 'number' || typeof claims.exp !== 'number') return null;
  if (claims.nbf > now + 30 || claims.iat > now + 30 || claims.exp <= now) return null;
  if (claims.exp - claims.iat > 24 * 60 * 60 + 30) return null;
  if (typeof claims.sub !== 'string' || typeof claims.workspaceId !== 'string' || !claims.sub || !claims.workspaceId) return null;
  if (typeof claims.jti !== 'string' || !claims.jti) return null;
  return claims as SessionClaims;
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
