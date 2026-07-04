import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateHooksInputSchema, langSchema } from '@afrohit/shared';
import { prompts, responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { memoryContext, recordFeedback } from '../services/artist-memory';

export default async function hooks(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>(
    '/',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      return prisma.hookCandidate.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      });
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/generate',
    { schema: { body: generateHooksInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateHooksInputSchema.omit({ projectId: true }).parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true, briefs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'hooks_batch_20',
        multiplier: Math.max(1, Math.ceil(input.count / 20)),
        refTable: 'Project',
        refId: project.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const brief = input.brief ?? project.briefs[0] ?? undefined;
      // Taste feedback loop — recent approvals/rejections steer generation.
      const tasteMemory = await memoryContext(project.artistId);

      const result = await responsesJson<{
        hooks: Array<{
          text: string;
          language?: string[];
          bpm?: number;
          syllablePattern?: string;
          melodyNotes?: string;
          callResponse?: boolean;
        }>;
      }>({
        system: prompts.HOOK_SYSTEM,
        user: prompts.hookUserPrompt({
          artist: project.artist as never,
          brief: brief as never,
          count: input.count,
          tasteMemory,
        }),
        temperature: 0.95,
        maxOutputTokens: 4_000,
      });

      const created = await prisma.$transaction(
        (result.hooks ?? []).map((h) =>
          prisma.hookCandidate.create({
            data: {
              projectId: project.id,
              text: h.text,
              language: (h.language ?? []).filter(
                (c): c is z.infer<typeof langSchema> =>
                  ['yo', 'ig', 'ha', 'pcm', 'en', 'fr', 'pt', 'sw', 'zu', 'xh', 'twi'].includes(c)
              ),
              bpm: h.bpm,
              meta: {
                syllablePattern: h.syllablePattern,
                melodyNotes: h.melodyNotes,
                callResponse: h.callResponse,
              },
            },
          })
        )
      );

      reply.code(201);
      return { hooks: created, charged: charge.balance };
    }
  );

  app.post<{ Params: { projectId: string; hookId: string } }>(
    '/:hookId/approve',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: { id: req.params.hookId, project: { workspaceId } },
        include: { project: { select: { artistId: true } } },
      });
      const song = await prisma.song.create({
        data: {
          workspaceId,
          projectId: hook.projectId,
          title: hook.text.split('\n')[0]!.slice(0, 80),
          status: 'SKETCH',
        },
      });
      await prisma.hookCandidate.update({
        where: { id: hook.id },
        data: { approved: true, songId: song.id },
      });
      // Feed the taste loop — future generations converge on this.
      await recordFeedback({
        workspaceId,
        artistId: hook.project.artistId,
        kind: 'approved',
        content: hook.text,
        sourceKind: 'hook',
        sourceId: hook.id,
      });
      return { hookId: hook.id, songId: song.id };
    }
  );

  app.post<{ Params: { projectId: string; hookId: string } }>(
    '/:hookId/reject',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const hook = await prisma.hookCandidate.findFirstOrThrow({
        where: { id: req.params.hookId, project: { workspaceId } },
        include: { project: { select: { artistId: true } } },
      });
      await prisma.hookCandidate.update({
        where: { id: hook.id },
        data: { approved: false, score: 0 },
      });
      await recordFeedback({
        workspaceId,
        artistId: hook.project.artistId,
        kind: 'rejected',
        content: hook.text,
        sourceKind: 'hook',
        sourceId: hook.id,
      });
      return { hookId: hook.id, rejected: true };
    }
  );
}
