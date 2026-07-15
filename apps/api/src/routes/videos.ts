import type { FastifyInstance } from "fastify";
import { prisma } from "@afrohit/db";
import {
  generateStoryboardInputSchema,
  normalizeStoryboardShots,
  renderVideoInputSchema,
  videoRenderUsage,
} from "@afrohit/shared";
import { prompts, responsesJson } from "@afrohit/ai";
import { requireAuth } from "../middleware/auth";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";

export default async function videos(app: FastifyInstance) {
  /**
   * Build a storyboard — cheap text generation, no video render yet.
   * User reviews/approves before any expensive video credit is spent.
   */
  app.post(
    "/storyboards",
    { schema: { body: generateStoryboardInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateStoryboardInputSchema.parse(req.body);

      const project = await prisma.project.findFirstOrThrow({
        where: { id: input.projectId, workspaceId },
        include: {
          artist: true,
          briefs: { take: 1, orderBy: { createdAt: "desc" } },
        },
      });

      const result = await responsesJson<{
        title: string;
        shots: Array<{
          index: number;
          prompt: string;
          duration_s: number;
          motion?: string;
          lighting?: string;
          subjects?: string[];
          negativePrompt?: string;
        }>;
      }>({
        system: prompts.STORYBOARD_SYSTEM,
        user: JSON.stringify({
          artist: {
            stageName: project.artist.stageName,
            lane: project.artist.laneSummary,
          },
          brief: project.briefs[0] ?? {},
          totalDurationS: input.durationS,
          format: input.format,
          extraPrompt: input.prompt,
        }),
        temperature: 0.7,
        maxOutputTokens: 1_500,
      });

      const storyboard = normalizeStoryboardShots(
        result.shots,
        input.durationS
      );
      if (!storyboard.length) {
        return reply.code(502).send({ error: "invalid_storyboard_output" });
      }
      const concept = await prisma.videoConcept.create({
        data: {
          projectId: project.id,
          title: result.title,
          storyboard: storyboard as never,
          durationS: storyboard.reduce((sum, shot) => sum + shot.duration_s, 0),
          format: input.format,
        },
      });

      reply.code(201);
      return { concept };
    }
  );

  app.post(
    "/renders",
    { schema: { body: renderVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVideoInputSchema.parse(req.body);

      const concept = await prisma.videoConcept.findFirstOrThrow({
        where: { id: input.conceptId, project: { workspaceId } },
      });
      if (concept.projectId !== input.projectId) {
        return reply.code(409).send({ error: "concept_project_mismatch" });
      }

      const shots =
        (concept.storyboard as Array<{ duration_s?: number }>) ?? [];
      const usage = videoRenderUsage(shots, input.shotIndex);
      if (!usage) {
        return reply.code(400).send({ error: "invalid_video_shot_selection" });
      }
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "video-render"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: usage.creditKey,
        multiplier: usage.billingUnits,
        planUnits: usage.planUnits,
        refTable: "VideoConcept",
        refId: concept.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.video,
        jobName: "render-video",
        workspaceId,
        projectId: concept.projectId,
        kind: "video",
        provider: process.env.VIDEO_PROVIDER ?? "unavailable",
        inputJson: input,
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: concept.projectId,
          conceptId: concept.id,
          shotIndex: input.shotIndex,
          shots,
          format: concept.format,
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}
