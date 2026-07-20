import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import {
  SINGING_EXTERNAL_SCORE_EVENT,
  SINGING_EXTERNAL_SCORE_VERSION,
  isSingingExternalScoreReceipt,
  singingExternalScoreAverage,
  type SingingExternalScoreReceipt,
} from "@afrohit/shared";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "./admin";

const score = z.number().min(1).max(5);

export const singingEvidenceSchema = z.object({
  providerJobId: z.string().cuid(),
  vocalRenderId: z.string().cuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  evaluatorId: z.string().trim().min(1).max(120),
  measuredAt: z.string().datetime({ offset: true }).optional(),
  releaseUsable: z.boolean(),
  scores: z.object({
    pitchAccuracy: score,
    lyricClarity: score,
    naturalness: score,
    culturalFit: score,
    releaseReadiness: score,
  }).strict(),
}).strict();

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function receiptFromProperties(value: unknown): SingingExternalScoreReceipt | null {
  const receipt = record(value).receipt;
  return isSingingExternalScoreReceipt(receipt) ? receipt : null;
}

export default async function singingEvidence(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    await requireAdmin(req);
    const { workspaceId, userId } = requireAuth(req);
    const input = singingEvidenceSchema.parse(req.body);
    const [vocal, job] = await Promise.all([
      prisma.vocalRender.findFirst({
        where: { id: input.vocalRenderId, project: { workspaceId } },
        select: {
          id: true,
          contentHash: true,
          verifiedAt: true,
          qualityState: true,
          approved: true,
          assetKind: true,
        },
      }),
      prisma.providerJob.findFirst({
        where: {
          id: input.providerJobId,
          workspaceId,
          kind: "voice",
          provider: "afroone-singing",
          status: "SUCCEEDED",
        },
        select: { id: true, outputJson: true, finishedAt: true },
      }),
    ]);
    if (!vocal || !job) {
      return reply.code(404).send({ error: "singing_evidence_target_not_found" });
    }
    const output = record(job.outputJson);
    if (
      vocal.assetKind !== "isolated_vocal" ||
      vocal.qualityState !== "passed" ||
      !vocal.approved ||
      !vocal.verifiedAt ||
      vocal.contentHash !== input.contentHash ||
      output.vocalRenderId !== vocal.id ||
      output.contentHash !== vocal.contentHash ||
      output.performanceKind !== "sung_vocal"
    ) {
      return reply.code(409).send({ error: "singing_evidence_target_uncertified" });
    }

    const measuredAt = input.measuredAt ?? new Date().toISOString();
    const measuredAtMs = Date.parse(measuredAt);
    const latestSourceAt = Math.max(
      vocal.verifiedAt.getTime(),
      job.finishedAt?.getTime() ?? 0
    );
    if (measuredAtMs < latestSourceAt || measuredAtMs > Date.now() + 5 * 60_000) {
      return reply.code(409).send({ error: "singing_evidence_timestamp_invalid" });
    }

    const priorRows = await prisma.analyticsEvent.findMany({
      where: { workspaceId, name: SINGING_EXTERNAL_SCORE_EVENT },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { properties: true },
    });
    const evaluatorKey = input.evaluatorId.toLocaleLowerCase("en-US");
    const duplicate = priorRows
      .map(row => receiptFromProperties(row.properties))
      .filter((receipt): receipt is SingingExternalScoreReceipt => Boolean(receipt))
      .some(receipt =>
        receipt.vocalRenderId === vocal.id &&
        receipt.evaluatorId.toLocaleLowerCase("en-US") === evaluatorKey
      );
    if (duplicate) {
      return reply.code(409).send({ error: "singing_evidence_already_recorded" });
    }

    const receipt: SingingExternalScoreReceipt = {
      version: SINGING_EXTERNAL_SCORE_VERSION,
      providerJobId: job.id,
      vocalRenderId: vocal.id,
      contentHash: vocal.contentHash,
      evaluatorId: input.evaluatorId,
      independent: true,
      source: "external_human",
      measuredAt,
      releaseUsable: input.releaseUsable,
      scores: input.scores,
    };
    const event = await prisma.analyticsEvent.create({
      data: {
        workspaceId,
        userId,
        name: SINGING_EXTERNAL_SCORE_EVENT,
        properties: { receipt } as never,
      },
      select: { id: true, createdAt: true },
    });
    reply.code(201);
    return {
      id: event.id,
      createdAt: event.createdAt,
      receipt,
      averageScore: singingExternalScoreAverage(receipt),
    };
  });

  app.get("/", async req => {
    await requireAdmin(req);
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.analyticsEvent.findMany({
      where: { workspaceId, name: SINGING_EXTERNAL_SCORE_EVENT },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, createdAt: true, properties: true },
    });
    return {
      items: rows.flatMap(row => {
        const receipt = receiptFromProperties(row.properties);
        return receipt
          ? [{
              id: row.id,
              createdAt: row.createdAt,
              receipt,
              averageScore: singingExternalScoreAverage(receipt),
            }]
          : [];
      }),
    };
  });
}
