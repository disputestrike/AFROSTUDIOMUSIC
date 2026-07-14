import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { prisma } from "@afrohit/db";
import { runWithLlmUsageContext, setLlmUsageContext } from "@afrohit/ai";
import {
  assertSessionConfiguration,
  constantTimeSecretEqual,
  originAllowed,
  requestSession,
  verifySession,
} from "../lib/session";

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      userId: string;
      workspaceId: string;
      role: string;
      isService: boolean;
    };
  }
}

const AUTH_MODE = (): string =>
  (process.env.AUTH_MODE ?? "internal").toLowerCase();

export function isInternalMode(): boolean {
  return AUTH_MODE() === "internal";
}

type DefaultIdentity = { userId: string; workspaceId: string };

let cachedIdentity: DefaultIdentity | null = null;
let identityPromise: Promise<DefaultIdentity> | null = null;

async function createDefaultIdentity(): Promise<DefaultIdentity> {
  const slug = process.env.INTERNAL_WORKSPACE_SLUG ?? "studio";
  const email = process.env.INTERNAL_OWNER_EMAIL ?? "owner@afrohit.local";
  const [user, workspace] = await Promise.all([
    prisma.user.upsert({
      where: { email },
      create: {
        clerkId: "internal_" + email,
        email,
        fullName: "Studio Owner",
      },
      update: {},
    }),
    prisma.workspace.upsert({
      where: { slug },
      create: {
        name: "Studio",
        slug,
        plan: "PRO",
        creditsCents: 1_000_000,
      },
      update: {},
    }),
  ]);
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
    },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    update: {},
  });
  return { userId: user.id, workspaceId: workspace.id };
}

async function getOrCreateDefaultIdentity(): Promise<DefaultIdentity> {
  if (cachedIdentity) return cachedIdentity;
  if (!identityPromise) {
    identityPromise = createDefaultIdentity()
      .then(identity => {
        cachedIdentity = identity;
        return identity;
      })
      .finally(() => {
        identityPromise = null;
      });
  }
  return identityPromise;
}
function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  const atOrBelow = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);
  return (
    atOrBelow("/health") ||
    atOrBelow("/docs") ||
    atOrBelow("/webhooks") ||
    path === "/api/v1/share/events" ||
    atOrBelow("/api/v1/share/redirect") ||
    atOrBelow("/api/v1/public") ||
    atOrBelow("/api/v1/billing/return") ||
    path === "/api/v1/auth/signup" ||
    path === "/api/v1/auth/login"
  );
}

async function resolveMembership(userId: string, workspaceId: string) {
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { suspendedAt: true },
    }),
    prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      select: { role: true },
    }),
  ]);
  return { workspace, membership };
}

export const authPlugin = fp(async function auth(app: FastifyInstance) {
  app.decorateRequest("auth", undefined);

  app.addHook("onRequest", (req, _reply, done) => {
    runWithLlmUsageContext({ requestId: String(req.id) }, done);
  });

  if (isInternalMode() && process.env.NODE_ENV === "production") {
    throw new Error("REFUSING TO BOOT: production requires AUTH_MODE=jwt");
  } else if (AUTH_MODE() === "jwt") {
    assertSessionConfiguration();
  } else if (!isInternalMode()) {
    throw new Error(`unsupported AUTH_MODE=${AUTH_MODE()}`);
  }

  if (
    process.env.NODE_ENV === "production" &&
    Buffer.byteLength(process.env.INTERNAL_API_SECRET ?? "") < 32
  ) {
    throw new Error(
      "INTERNAL_API_SECRET must contain at least 32 bytes in production"
    );
  }

  app.addHook("preValidation", async (req, reply) => {
    const url = req.routeOptions?.url ?? req.url ?? "";
    if (req.method === "OPTIONS") return;
    const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const publicPath = isPublicPath(url);
    if (publicPath) {
      if (
        unsafe &&
        (url.startsWith("/api/v1/auth/signup") ||
          url.startsWith("/api/v1/auth/login"))
      ) {
        if (
          !originAllowed(
            typeof req.headers.origin === "string"
              ? req.headers.origin
              : undefined
          ) ||
          req.headers["x-afrohit-request"] !== "1"
        ) {
          return reply.forbidden("browser request verification failed");
        }
      }
      return;
    }

    const serviceSecret = req.headers["x-internal-secret"];
    if (
      constantTimeSecretEqual(serviceSecret, process.env.INTERNAL_API_SECRET)
    ) {
      const workspaceId = String(req.headers["x-workspace-id"] ?? "");
      const userId = String(req.headers["x-user-id"] ?? "");
      if (!workspaceId || !userId)
        return reply.unauthorized("service identity missing");
      const { workspace, membership } = await resolveMembership(
        userId,
        workspaceId
      );
      if (!workspace || !membership)
        return reply.unauthorized("invalid service identity");
      if (workspace.suspendedAt) return reply.forbidden("workspace suspended");
      if (unsafe && membership.role === "VIEWER")
        return reply.forbidden("viewer role is read-only");
      req.auth = {
        userId,
        workspaceId,
        role: membership.role,
        isService: true,
      };
      setLlmUsageContext({ userId, workspaceId });
      return;
    }

    if (isInternalMode()) {
      try {
        const identity = await getOrCreateDefaultIdentity();
        const workspace = await prisma.workspace.findUnique({
          where: { id: identity.workspaceId },
          select: { suspendedAt: true },
        });
        if (workspace?.suspendedAt)
          return reply.forbidden("workspace suspended");
        req.auth = { ...identity, role: "OWNER", isService: false };
        setLlmUsageContext(identity);
        return;
      } catch (error) {
        req.log.error({ error }, "internal auth bootstrap failed");
        return reply.internalServerError("auth bootstrap failed");
      }
    }

    const session = requestSession(req);
    if (!session) return reply.unauthorized("missing session");
    const claims = verifySession(session.token);
    if (!claims) return reply.unauthorized("invalid or expired session");
    if (session.source === "cookie" && unsafe) {
      if (
        !originAllowed(
          typeof req.headers.origin === "string"
            ? req.headers.origin
            : undefined
        ) ||
        req.headers["x-afrohit-request"] !== "1"
      ) {
        return reply.forbidden("browser request verification failed");
      }
    }
    const { workspace, membership } = await resolveMembership(
      claims.sub,
      claims.workspaceId
    );
    if (!workspace) return reply.unauthorized("unknown workspace");
    if (workspace.suspendedAt) return reply.forbidden("workspace suspended");
    if (!membership) return reply.forbidden("not a workspace member");
    if (unsafe && membership.role === "VIEWER")
      return reply.forbidden("viewer role is read-only");
    req.auth = {
      userId: claims.sub,
      workspaceId: claims.workspaceId,
      role: membership.role,
      isService: false,
    };
    setLlmUsageContext({ userId: claims.sub, workspaceId: claims.workspaceId });
  });
});

export function requireAuth(req: FastifyRequest) {
  if (!req.auth) throw new Error("auth missing");
  return req.auth;
}

export function requireRole(req: FastifyRequest, allowed: readonly string[]) {
  const auth = requireAuth(req);
  if (!allowed.includes(auth.role)) {
    throw Object.assign(new Error("insufficient workspace role"), {
      statusCode: 403,
    });
  }
  return auth;
}
