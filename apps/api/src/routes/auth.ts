import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { isInternalMode, requireAuth } from '../middleware/auth';
import {
  adminGrantCookie,
  assertSessionConfiguration,
  clearAdminGrantCookie,
  clearSessionCookie,
  constantTimeSecretEqual,
  revokeSessionFamily,
  sessionCookie,
  signAdminGrant,
  signSession,
} from '../lib/session';

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(12).max(128),
  name: z.string().min(1).max(80).optional(),
  stageName: z.string().min(1).max(80).optional(),
});
const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(128),
});
const adminUnlockSchema = z.object({ secret: z.string().min(1).max(512) });

type PasswordVersion = 'v1' | 'v2';

const PASSWORD_PARAMS: Record<PasswordVersion, { N: number; maxmem: number }> = {
  v1: { N: 16_384, maxmem: 64 * 1024 * 1024 },
  v2: { N: 65_536, maxmem: 96 * 1024 * 1024 },
};
let activePasswordDerivations = 0;
const MAX_PASSWORD_DERIVATIONS = 4;

async function derivePassword(password: string, salt: string, version: PasswordVersion): Promise<Buffer> {
  if (activePasswordDerivations >= MAX_PASSWORD_DERIVATIONS) {
    throw Object.assign(new Error('authentication capacity is busy'), { statusCode: 503 });
  }
  activePasswordDerivations += 1;
  const params = PASSWORD_PARAMS[version];
  try {
    return await new Promise((resolve, reject) => {
      scrypt(password, salt, 64, { N: params.N, r: 8, p: 1, maxmem: params.maxmem }, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  } finally {
    activePasswordDerivations -= 1;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const hash = await derivePassword(password, salt, 'v2');
  return `scrypt:v2:${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string | null): Promise<{ valid: boolean; needsRehash: boolean }> {
  let salt = 'afrohit-invalid-account';
  let expectedHex = '';
  let version: PasswordVersion = 'v2';
  if (stored?.startsWith('scrypt:v1:') || stored?.startsWith('scrypt:v2:')) {
    const parts = stored.split(':');
    version = parts[1] === 'v1' ? 'v1' : 'v2';
    salt = parts[2] ?? salt;
    expectedHex = parts[3] ?? '';
  } else if (stored?.includes(':')) {
    version = 'v1';
    [salt, expectedHex] = stored.split(':', 2) as [string, string];
  }
  const actual = await derivePassword(password, salt, version);
  const expected = Buffer.from(expectedHex, 'hex');
  const valid = expected.length === actual.length && timingSafeEqual(actual, expected);
  return { valid, needsRehash: valid && version !== 'v2' };
}

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'studio';

function sessionsAvailable(): boolean {
  try {
    assertSessionConfiguration();
    return true;
  } catch {
    return false;
  }
}

const limited = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };

export default async function auth(app: FastifyInstance) {
  app.post('/signup', { ...limited, schema: { body: signupSchema } }, async (req, reply) => {
    if (!sessionsAvailable()) return reply.code(503).send({ error: 'signup_disabled' });
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PUBLIC_SIGNUP !== '1') {
      return reply.code(403).send({ error: 'signup_closed' });
    }
    const input = signupSchema.parse(req.body);
    const email = input.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return reply.code(409).send({ error: 'email_in_use' });

    const base = slugify(input.stageName || input.name || email.split('@')[0]!);
    let slug = base;
    for (let suffix = 2; await prisma.workspace.findUnique({ where: { slug }, select: { id: true } }); suffix++) {
      slug = `${base}-${suffix}`;
    }
    const stage = input.stageName || input.name || email.split('@')[0]!;
    const passwordHash = await hashPassword(input.password);
    type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
    const result = await prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.create({
        data: {
          clerkId: `local_${randomBytes(10).toString('hex')}`,
          email,
          fullName: input.name ?? null,
          passwordHash,
        },
      });
      const workspace = await tx.workspace.create({ data: { name: `${stage}'s Studio`, slug } });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' } });
      await tx.artist.create({
        data: { workspaceId: workspace.id, stageName: stage, languages: ['pcm', 'en'], vocalTone: ['smooth'] } as never,
      });
      return { user, workspace };
    });

    const token = signSession({ sub: result.user.id, workspaceId: result.workspace.id, role: 'OWNER' });
    reply.header('set-cookie', sessionCookie(token)).code(201);
    return { userId: result.user.id, workspaceId: result.workspace.id, plan: 'STARTER' };
  });

  app.post('/login', { ...limited, schema: { body: loginSchema } }, async (req, reply) => {
    if (!sessionsAvailable()) return reply.code(503).send({ error: 'login_disabled' });
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase().trim() } });
    const password = await verifyPassword(input.password, user?.passwordHash ?? null);
    if (!user || !password.valid) return reply.code(401).send({ error: 'invalid_credentials' });
    if (password.needsRehash) {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
    }
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) return reply.code(403).send({ error: 'no_workspace' });
    const token = signSession({ sub: user.id, workspaceId: membership.workspaceId, role: membership.role });
    reply.header('set-cookie', sessionCookie(token));
    return { userId: user.id, workspaceId: membership.workspaceId };
  });

  app.post('/admin-unlock', { ...limited, schema: { body: adminUnlockSchema } }, async (req, reply) => {
    if (!isInternalMode()) return reply.code(400).send({ error: 'admin_unlock_not_required' });
    if (Buffer.byteLength(process.env.ADMIN_SECRET ?? '') < 32) {
      return reply.code(503).send({ error: 'admin_unlock_not_configured' });
    }
    const { userId, workspaceId } = requireAuth(req);
    const input = adminUnlockSchema.parse(req.body);
    if (!constantTimeSecretEqual(input.secret, process.env.ADMIN_SECRET)) {
      return reply.code(401).send({ error: 'invalid_admin_secret' });
    }
    const token = signAdminGrant(userId, workspaceId);
    reply.header('set-cookie', adminGrantCookie(token));
    return { ok: true, expiresInSeconds: 2 * 60 * 60 };
  });

  app.post('/logout', async (req, reply) => {
    const session = requireAuth(req).session;
    if (session) {
      try {
        await revokeSessionFamily(app.redis, session);
      } catch (error) {
        req.log.error({ err: error }, 'session family revocation failed during logout');
        return reply.code(503).send({ error: 'logout_unavailable' });
      }
    }
    reply.header('set-cookie', [clearSessionCookie(), clearAdminGrantCookie()]).code(204).send();
  });

  app.get('/me', async (req) => {
    const { userId, workspaceId } = requireAuth(req);
    const [user, workspace] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } }),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, plan: true, creditsCents: true } }),
    ]);
    return { userId, workspaceId, email: user?.email ?? null, name: user?.fullName ?? null, workspace };
  });
}
