import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@afrohit/db';

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
 * Resolves auth from either:
 *  - Clerk-issued JWT (production browser sessions)
 *  - Internal API secret (worker -> API calls)
 *  - Demo bypass when DEV_AUTH_BYPASS=1 (local dev only)
 *
 * The `auth` decorator hangs off the request and is required by every
 * authenticated route.
 */
export const authPlugin = fp(async function (app: FastifyInstance) {
  app.decorateRequest('auth', undefined);

  // preValidation runs before body schema validation, so unauthenticated
  // requests get a 401 instead of leaking schema errors as 400s.
  app.addHook('preValidation', async (req, reply) => {
    const url = req.routeOptions?.url ?? req.url ?? '';
    if (url.startsWith('/health')) return;
    if (url.startsWith('/docs')) return;
    if (url.startsWith('/webhooks')) return;
    // Public anon endpoints (share/events ingest + public redirect)
    if (url.startsWith('/api/v1/share/events')) return;
    if (url.startsWith('/api/v1/share/redirect')) return;

    // Service-to-service
    const svc = req.headers['x-internal-secret'];
    if (svc && svc === process.env.INTERNAL_API_SECRET) {
      const workspaceId = String(req.headers['x-workspace-id'] ?? '');
      const userId = String(req.headers['x-user-id'] ?? '');
      if (workspaceId && userId) {
        req.auth = { userId, workspaceId, role: 'OWNER', isService: true };
        return;
      }
    }

    const authz = req.headers.authorization;

    // Dev bypass — opt in via env, never enable in prod.
    // Only kicks in when a bearer token is present (any value), so anonymous
    // requests still receive a clean 401 even when bypass is on.
    if (process.env.DEV_AUTH_BYPASS === '1' && authz?.startsWith('Bearer ')) {
      try {
        const ws = await prisma.workspace.findUnique({ where: { slug: 'demo' } });
        const user = await prisma.user.findUnique({ where: { email: 'owner@demo.afrohit' } });
        if (ws && user) {
          if (ws.suspendedAt) return reply.forbidden('workspace suspended');
          req.auth = { userId: user.id, workspaceId: ws.id, role: 'OWNER', isService: false };
          return;
        }
      } catch (err) {
        req.log.warn({ err }, 'dev bypass DB lookup failed — falling through to JWT');
      }
    }

    if (!authz || !authz.startsWith('Bearer ')) {
      return reply.unauthorized('missing bearer token');
    }
    const token = authz.slice('Bearer '.length);

    try {
      // Clerk's verifyToken returns the session claims. We resolve the user/workspace
      // from our DB (Clerk userId -> our User -> active workspace).
      const { verifyToken } = await import('@clerk/backend');
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      const clerkUserId = payload.sub!;
      const user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });
      if (!user) return reply.unauthorized('unknown user');

      // For MVP, the user's *first* workspace is the active one.
      // Multi-workspace switching can be added with a header (x-workspace-slug).
      const slug = (req.headers['x-workspace-slug'] as string | undefined)?.trim();
      const membership = slug
        ? await prisma.workspaceMember.findFirst({
            where: { userId: user.id, workspace: { slug } },
            include: { workspace: { select: { suspendedAt: true } } },
          })
        : await prisma.workspaceMember.findFirst({
            where: { userId: user.id },
            include: { workspace: { select: { suspendedAt: true } } },
          });
      if (!membership) return reply.unauthorized('no workspace membership');
      if (membership.workspace.suspendedAt) return reply.forbidden('workspace suspended');

      req.auth = {
        userId: user.id,
        workspaceId: membership.workspaceId,
        role: membership.role,
        isService: false,
      };
    } catch (err) {
      req.log.warn({ err }, 'jwt verification failed');
      return reply.unauthorized('invalid token');
    }
  });
});

export function requireAuth(req: import('fastify').FastifyRequest) {
  if (!req.auth) throw new Error('auth missing — did the preHandler run?');
  return req.auth;
}
