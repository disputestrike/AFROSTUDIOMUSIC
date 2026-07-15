import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import { engineClass } from "@afrohit/shared";
import { requireAuth } from "../middleware/auth";

const jobSelect = {
  id: true,
  kind: true,
  provider: true,
  status: true,
  outputJson: true,
  errorJson: true,
  cost: true,
  creditsCents: true,
  chargeLedger: {
    select: {
      delta: true,
      units: true,
      planUnits: true,
      reversal: { select: { delta: true, createdAt: true } },
    },
  },
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const;

type PublicJobInput = {
  id: string;
  kind: string;
  provider: string;
  status: string;
  outputJson: unknown;
  errorJson: unknown;
  cost: unknown;
  creditsCents: number;
  chargeLedger: {
    delta: number;
    units: number;
    planUnits: number;
    reversal: { delta: number; createdAt: Date } | null;
  } | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

function providerClass(kind: string, provider: string): string {
  if (provider === "internal") return "internal";
  if (kind === "music") return engineClass(provider);
  if (["", "stub", "unknown", "unavailable"].includes(provider.toLowerCase()))
    return "unavailable";
  return "external";
}

function publicJob(job: PublicJobInput) {
  const routeClass = providerClass(job.kind, job.provider);
  const charged = Math.abs(job.chargeLedger?.delta ?? job.creditsCents ?? 0);
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    outputJson: job.outputJson,
    errorJson: job.errorJson,
    executionEvidence: {
      providerClass: routeClass,
      realProvider: !["unavailable", "unknown"].includes(routeClass),
      estimatedCostUsd:
        job.cost === null || job.cost === undefined ? null : Number(job.cost),
      chargedCreditsCents: charged,
      chargedUnits: job.chargeLedger?.units ?? null,
      planUnits: job.chargeLedger?.planUnits ?? null,
      refunded: !!job.chargeLedger?.reversal,
      refundedCreditsCents: Math.max(0, job.chargeLedger?.reversal?.delta ?? 0),
      refundedAt: job.chargeLedger?.reversal?.createdAt ?? null,
    },
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
  };
}

export default async function jobs(app: FastifyInstance) {
  app.get("/", async req => {
    const { workspaceId, role } = requireAuth(req);
    const rows = await prisma.providerJob.findMany({
      where: {
        workspaceId,
        ...(["OWNER", "ADMIN"].includes(role)
          ? {}
          : {
              kind: {
                notIn: [
                  "voice",
                  "voice_profile",
                  "voice_dataset",
                  "voice_cleanup",
                ],
              },
            }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: jobSelect,
    });
    return rows.map((row: unknown) => publicJob(row as PublicJobInput));
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { workspaceId, role } = requireAuth(req);
    const job = await prisma.providerJob.findFirst({
      where: { id: req.params.id, workspaceId },
      select: jobSelect,
    });
    if (!job) return reply.code(404).send({ error: "not_found" });
    if (job.kind.startsWith("voice") && !["OWNER", "ADMIN"].includes(role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return publicJob(job as PublicJobInput);
  });
}
