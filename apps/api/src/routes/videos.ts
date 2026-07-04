import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateStoryboardInputSchema, renderVideoInputSchema } from '@afrohit/shared';
import { prompts, responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

export default async function videos(app: FastifyInstance) {
  /**
   * Build a storyboard — cheap text generation, no video render yet.
   * User reviews/approves before any expensive video credit is spent.
   */
  app.post(
    '/storyboards',
    { schema: { body: generateStoryboardInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateStoryboardInputSchema.parse(req.body);

      const project = await prisma.project.findFirstOrThrow({
        where: { id: input.projectId, workspaceId },
        include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
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
          artist: { stageName: project.artist.stageName, lane: project.artist.laneSummary },
          brief: project.briefs[0] ?? {},
          totalDurationS: input.durationS,
          format: input.format,
          extraPrompt: input.prompt,
        }),
        temperature: 0.7,
        maxOutputTokens: 1_500,
      });

      const concept = await prisma.videoConcept.create({
        data: {
          projectId: project.id,
          title: result.title,
          storyboard: result.shots as never,
          durationS: input.durationS,
          format: input.format,
        },
      });

      reply.code(201);
      return { concept };
    }
  );

  app.post(
    '/renders',
    { schema: { body: renderVideoInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVideoInputSchema.parse(req.body);

      const concept = await prisma.videoConcept.findFirstOrThrow({
        where: { id: input.conceptId, project: { workspaceId } },
      });

      const shots = (concept.storyboard as Array<{ duration_s?: number }>) ?? [];
      const totalSec =
        input.shotIndex == null
          ? shots.reduce((s, sh) => s + (sh.duration_s ?? 3), 0)
          : shots[input.shotIndex]?.duration_s ?? 3;
      const charge = await app.chargeCredits({
        workspaceId,
        key: totalSec <= 8 ? 'video_8s' : 'video_20s',
        refTable: 'VideoConcept',
        refId: concept.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: input.projectId,
          kind: 'video',
          provider: process.env.VIDEO_PROVIDER ?? 'stub',
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.video,
        name: 'render-video',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: input.projectId,
          conceptId: concept.id,
          shotIndex: input.shotIndex,
          shots,
          format: concept.format,
        },
      });

      reply.code(202);
      return { jobId: job.id };
    }
  );
}
