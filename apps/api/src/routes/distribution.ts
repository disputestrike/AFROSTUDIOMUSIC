/**
 * DISTRIBUTION SEAM (Phase 5, Part B) — workspace-level connected accounts +
 * configuration status for the ONE aggregator (Ayrshare).
 *
 * HONESTY LAW: this route never publishes anything and never claims to be
 * configured when it isn't. `GET /status` reports the true configuration
 * (DISTRIBUTION_ENABLED + AYRSHARE_API_KEY) so the UI can show "connect your
 * accounts to distribute" instead of a fake success. Connecting an account
 * records the artist's platform link (the aggregator holds the real OAuth link;
 * we store its reference), but nothing here fires an HTTP publish — that only
 * ever happens in the worker's flag-gated + key-gated publish job.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@afrohit/db";
import { SOCIAL_PLATFORMS, socialDistributionConfig } from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";

const connectSchema = z
  .object({
    platform: z.enum(SOCIAL_PLATFORMS),
    // The aggregator's reference for the linked profile (Ayrshare profileKey /
    // handle). Optional — a connection can be recorded as pending before the
    // artist finishes the aggregator's linking flow.
    externalRef: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export default async function distribution(app: FastifyInstance) {
  /** Configuration + connected accounts — drives the "connect your accounts /
   *  distribution not configured" UI. Read-only, any workspace member. */
  app.get("/status", async req => {
    const { workspaceId } = requireAuth(req);
    const config = socialDistributionConfig();
    const accounts = await prisma.connectedAccount.findMany({
      where: { workspaceId },
      orderBy: { platform: "asc" },
      select: {
        id: true,
        platform: true,
        status: true,
        displayName: true,
        updatedAt: true,
      },
    });
    return {
      provider: config.provider,
      enabled: config.enabled,
      configured: config.ready,
      missing: config.missing,
      platforms: SOCIAL_PLATFORMS,
      accounts,
      connectedCount: accounts.filter(a => a.status === "connected").length,
    };
  });

  /** Connect (or update) one platform account. OWNER/ADMIN. A ref means the
   *  aggregator link is live → "connected"; without one it stays "pending". */
  app.post(
    "/accounts",
    { schema: { body: connectSchema } },
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ["OWNER", "ADMIN"]);
      const input = connectSchema.parse(req.body);
      const status = input.externalRef ? "connected" : "pending";
      const account = await prisma.connectedAccount.upsert({
        where: {
          workspaceId_platform: { workspaceId, platform: input.platform },
        },
        create: {
          workspaceId,
          platform: input.platform,
          externalRef: input.externalRef ?? null,
          displayName: input.displayName ?? null,
          status,
        },
        update: {
          externalRef: input.externalRef ?? null,
          displayName: input.displayName ?? null,
          status,
        },
        select: {
          id: true,
          platform: true,
          status: true,
          displayName: true,
        },
      });
      return reply.code(201).send(account);
    }
  );

  /** Disconnect a platform account. OWNER/ADMIN. */
  app.delete<{ Params: { id: string } }>(
    "/accounts/:id",
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ["OWNER", "ADMIN"]);
      const result = await prisma.connectedAccount.deleteMany({
        where: { id: req.params.id, workspaceId },
      });
      if (result.count === 0) {
        return reply.code(404).send({ error: "account_not_found" });
      }
      return { disconnected: true };
    }
  );
}
