import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { generateLyricsInputSchema } from '@afrohit/shared';
import { prompts, responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';

export default async function lyrics(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>(
    '/',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      return prisma.lyricDraft.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'desc' },
      });
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/generate',
    { schema: { body: generateLyricsInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateLyricsInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true, briefs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: { id: input.hookId, projectId: project.id },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'lyrics_full',
        refTable: 'Hook',
        refId: hook.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const output = await responsesJson<{
        title: string;
        body: string;
        cleanVersion?: string;
        explicit?: boolean;
        structure?: unknown;
        languageMix?: Record<string, number>;
        needsNativeReview?: string[];
      }>({
        system: prompts.LYRIC_SYSTEM,
        user: prompts.lyricUserPrompt({
          artist: project.artist as never,
          brief: project.briefs[0] as never,
          hookText: hook.text,
          cleanVersion: input.cleanVersion,
          languageMix: input.languageMix as never,
        }),
        temperature: 0.8,
        maxOutputTokens: 4_000,
      });

      const lyric = await prisma.lyricDraft.create({
        data: {
          projectId: project.id,
          songId: hook.songId,
          title: output.title,
          body: output.body,
          cleanVersion: output.cleanVersion,
          explicit: output.explicit ?? false,
          structure: output.structure as never,
          languageMix: output.languageMix as never,
          approved: false,
        },
      });

      if (hook.songId) {
        await prisma.song.update({
          where: { id: hook.songId },
          data: { lyricId: lyric.id, status: 'DEMO' },
        });
      }

      // Uncertain heritage-language lines become a review task for a native
      // speaker. The lyric stays usable, but the flag is now tracked, not lost.
      const flags = output.needsNativeReview ?? [];
      let reviewTaskId: string | null = null;
      if (flags.length > 0) {
        const task = await prisma.reviewTask.create({
          data: {
            workspaceId,
            projectId: project.id,
            lyricId: lyric.id,
            kind: 'native_language',
            language: flags[0]?.split(':')[0] ?? null,
            items: flags.map((ref) => ({ ref })) as never,
          },
        });
        reviewTaskId = task.id;
      }

      reply.code(201);
      return { lyric, needsNativeReview: flags, reviewTaskId };
    }
  );

  app.post<{ Params: { projectId: string; lyricId: string } }>(
    '/:lyricId/approve',
    async (req) => {
      const { userId, workspaceId } = requireAuth(req);
      const lyric = await prisma.lyricDraft.update({
        where: { id: req.params.lyricId },
        data: { approved: true },
      });
      await prisma.approval.create({
        data: {
          workspaceId,
          projectId: req.params.projectId,
          userId,
          gate: 'lyrics',
          decision: 'approved',
        },
      });
      return lyric;
    }
  );
}
