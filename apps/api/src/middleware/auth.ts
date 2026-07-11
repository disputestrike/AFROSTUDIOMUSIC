import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@afrohit/db';

/**
 * Verify a compact HS256 JWT signed with JWT_SECRET. Returns the claims when the
 * signature + expiry are valid, else null. No external dependency — enough for
 * the jwt AUTH_MODE (issue tokens from your own login/session service with the
 * same secret + { sub, workspaceId }).
 */
function verifyJwt(token: string): Record<string, unknown> | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const h = parts[0]!, p = parts[1]!, sig = parts[2]!;
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null; // expired
    return claims;
  } catch {
    return null;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      workspaceId: string;
      role: string;
      isService: boolean;
    };
  }
}

/**
 * Auth modes (env AUTH_MODE):
 *   - "internal" (default) — NO external auth. Every request resolves a single
 *     default workspace + owner (lazily created on first request). This is for
 *     internal / single-tenant use right now. NOT safe to expose publicly.
 *   - future: "google" — build your own Google OAuth here (the seam is this hook).
 *
 * Service-to-service calls (worker → API) always authenticate via
 * x-internal-secret regardless of mode.
 */
const AUTH_MODE = (): string => (process.env.AUTH_MODE ?? 'internal').toLowerCase();

export function isInternalMode(): boolean {
  return AUTH_MODE() === 'internal';
}

// Cache the default identity so we don't re-resolve it on every request.
let cachedIdentity: { userId: string; workspaceId: string } | null = null;

async function getOrCreateDefaultIdentity(): Promise<{ userId: string; workspaceId: string }> {
  if (cachedIdentity) return cachedIdentity;
  const slug = process.env.INTERNAL_WORKSPACE_SLUG ?? 'studio';
  const email = process.env.INTERNAL_OWNER_EMAIL ?? 'owner@afrohit.local';

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { clerkId: `internal_${email}`, email, fullName: 'Studio Owner' },
    });
  }
  let ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    ws = await prisma.workspace.create({
      data: { name: 'Studio', slug, plan: 'PRO', creditsCents: 10_000_00 /* $100 to start */ },
    });
  }
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: ws.id, userId: user.id },
  });
  if (!membership) {
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
    });
  }
  cachedIdentity = { userId: user.id, workspaceId: ws.id };
  return cachedIdentity;
}

export const authPlugin = fp(async function (app: FastifyInstance) {
  app.decorateRequest('auth', undefined);

  // Internal mode NEVER rejects a request, so if this instance is reachable from
  // the public internet, anyone gets the owner's workspace + spends the owner's
  // provider budget. Benjamin runs single-owner internal mode in production ON
  // PURPOSE, so this WARNS by default (never crashes his own deploy). Only when
  // he opts INTO multi-tenant hardening (REQUIRE_AUTH=1) do we refuse to boot in
  // the unsafe internal+prod combination.
  if (isInternalMode() && process.env.NODE_ENV === 'production') {
    if (process.env.REQUIRE_AUTH === '1') {
      throw new Error(
        'REFUSING TO BOOT: REQUIRE_AUTH=1 but AUTH_MODE=internal authenticates no one. Set AUTH_MODE to a real auth provider or unset REQUIRE_AUTH for single-owner mode.'
      );
    }
    app.log.warn(
      '⚠️  AUTH_MODE=internal in production — the API does NOT authenticate. Safe only behind a network gate/allowlist. Before public multi-tenant use: implement real auth + set ENFORCE_GENERATION_CAP=1.'
    );
  }

  app.addHook('preValidation', async (req, reply) => {
    const url = req.routeOptions?.url ?? req.url ?? '';
    if (url.startsWith('/health')) return;
    if (url.startsWith('/docs')) return;
    if (url.startsWith('/webhooks')) return;
    // Public anon endpoints (share ingest + public redirect)
    if (url.startsWith('/api/v1/share/events')) return;
    if (url.startsWith('/api/v1/share/redirect')) return;
    // Account creation/login are definitionally unauthenticated (/auth/me is NOT
    // exempt — it requires the resolved identity).
    if (url.startsWith('/api/v1/auth/signup') || url.startsWith('/api/v1/auth/login')) return;

    // Service-to-service (worker → API)
    const svc = req.headers['x-internal-secret'];
    if (svc && svc === process.env.INTERNAL_API_SECRET) {
      const workspaceId = String(req.headers['x-workspace-id'] ?? '');
      const userId = String(req.headers['x-user-id'] ?? '');
      if (workspaceId && userId) {
        req.auth = { userId, workspaceId, role: 'OWNER', isService: true };
        return;
      }
    }

    // Internal mode (default) — resolve the single default workspace, no token.
    if (isInternalMode()) {
      try {
        const id = await getOrCreateDefaultIdentity();
        const ws = await prisma.workspace.findUnique({
          where: { id: id.workspaceId },
          select: { suspendedAt: true },
        });
        if (ws?.suspendedAt) return reply.forbidden('workspace suspended');
        req.auth = { userId: id.userId, workspaceId: id.workspaceId, role: 'OWNER', isService: false };
        return;
      } catch (err) {
        req.log.error({ err }, 'internal auth bootstrap failed');
        return reply.internalServerError('auth bootstrap failed');
      }
    }

    // JWT mode — real multi-tenant auth. A Bearer HS256 token signed with
    // JWT_SECRET, carrying { sub|userId, workspaceId, role }. Unauthenticated or
    // invalid → 401. Membership is verified against the DB so a token can't claim
    // a workspace the user isn't a member of.
    if (AUTH_MODE() === 'jwt') {
      const auth = String(req.headers['authorization'] ?? '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const claims = verifyJwt(token);
      if (!claims) return reply.unauthorized('invalid or missing token');
      const userId = String(claims.sub ?? claims.userId ?? '');
      const workspaceId = String(claims.workspaceId ?? '');
      if (!userId || !workspaceId) return reply.unauthorized('token missing userId/workspaceId');
      // Verify the user actually belongs to the workspace (membership table).
      const [ws, member] = await Promise.all([
        prisma.workspace.findUnique({ where: { id: workspaceId }, select: { suspendedAt: true } }),
        prisma.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { role: true } }),
      ]);
      if (!ws) return reply.unauthorized('unknown workspace');
      if (ws.suspendedAt) return reply.forbidden('workspace suspended');
      if (!member) return reply.forbidden('not a member of this workspace');
      req.auth = { userId, workspaceId, role: member.role as never, isService: false };
      return;
    }

    // No other auth mode is implemented. Fail explicitly rather than silently
    // letting requests through.
    return reply.unauthorized(`auth mode "${AUTH_MODE()}" not implemented — set AUTH_MODE=internal or jwt`);
  });
});

export function requireAuth(req: import('fastify').FastifyRequest) {
  if (!req.auth) throw new Error('auth missing — did the preValidation hook run?');
  return req.auth;
}
