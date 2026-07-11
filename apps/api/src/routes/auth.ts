import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';

/**
 * AUTH — signup/login for multi-tenant mode (T1).
 *
 * Email+password (scrypt, no external deps) issuing an HS256 JWT with
 * { sub, workspaceId, exp } — the exact claims the auth middleware's verifyJwt
 * checks in AUTH_MODE=jwt. Signup provisions the full tenant: User + Workspace
 * (STARTER) + OWNER membership + a starter Artist, so a new user can create
 * immediately. These routes are PUBLIC (skipped by the auth hook) but rate-
 * limited like everything else. In internal mode they still work — useful for
 * preparing accounts before flipping AUTH_MODE=jwt.
 */

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
  stageName: z.string().min(1).max(80).optional(),
});
const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':') as [string, string];
  const a = scryptSync(pw, salt, 64);
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Issue a compact HS256 JWT the middleware's verifyJwt accepts. */
export function signJwt(claims: { sub: string; workspaceId: string }, ttlSeconds = 30 * 24 * 3600): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set — required for signup/login tokens');
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' });
  const p = enc({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds });
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'studio';

export default async function auth(app: FastifyInstance) {
  app.post('/signup', { schema: { body: signupSchema } }, async (req, reply) => {
    if (!process.env.JWT_SECRET) return reply.code(503).send({ error: 'signup_disabled', hint: 'set JWT_SECRET to enable accounts' });
    const input = signupSchema.parse(req.body);
    const email = input.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'email_in_use' });

    // Provision the whole tenant atomically: user, workspace, membership, artist.
    const base = slugify(input.stageName || input.name || email.split('@')[0]!);
    let slug = base;
    for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const stage = input.stageName || input.name || email.split('@')[0]!;
    type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
    const result = await prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.create({
        data: { clerkId: `local_${randomBytes(10).toString('hex')}`, email, fullName: input.name ?? null, passwordHash: hashPassword(input.password) },
      });
      const ws = await tx.workspace.create({ data: { name: `${stage}'s Studio`, slug } });
      await tx.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } });
      await tx.artist.create({
        data: { workspaceId: ws.id, stageName: stage, languages: ['pcm', 'en'], vocalTone: ['smooth'] } as never,
      });
      return { user, ws };
    });

    const token = signJwt({ sub: result.user.id, workspaceId: result.ws.id });
    reply.code(201);
    return { token, userId: result.user.id, workspaceId: result.ws.id, plan: 'STARTER' };
  });

  app.post('/login', { schema: { body: loginSchema } }, async (req, reply) => {
    if (!process.env.JWT_SECRET) return reply.code(503).send({ error: 'login_disabled', hint: 'set JWT_SECRET to enable accounts' });
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase().trim() } });
    // Uniform error for wrong email OR password — never reveal which.
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const member = await prisma.workspaceMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    if (!member) return reply.code(403).send({ error: 'no_workspace' });
    const token = signJwt({ sub: user.id, workspaceId: member.workspaceId });
    return { token, userId: user.id, workspaceId: member.workspaceId };
  });

  // Who am I (works in both modes — internal resolves the owner identity).
  app.get('/me', async (req) => {
    const { userId, workspaceId } = requireAuth(req);
    const [user, ws] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } }),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, plan: true, creditsCents: true } }),
    ]);
    return { userId, workspaceId, email: user?.email ?? null, name: user?.fullName ?? null, workspace: ws };
  });
}
