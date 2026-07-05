import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateHooksInputSchema, langSchema } from '@afrohit/shared';
import { prompts, generateJson, directorRefineHooks, researchTrends, anthropicEnabled, soundBrief } from '@afrohit/ai';
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
      // Live trends (Tavily) so hooks reflect what's popping right now.
      const trendData = await researchTrends({ genre: project.genre }).catch(() => null);
      const trends = trendData?.digest;
      // Genre Sound DNA so hooks sit in the lane's pocket/arrangement.
      const soundDna = soundBrief(project.genre).brief;

      const result = await generateJson<{
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
          trends,
          soundDna,
        }),
        temperature: 0.95,
        maxTokens: 4_000,
      });

      // Secret sauce — multi-model: GPT wrote the drafts (breadth); now Claude
      // acts as A&R director (taste, cultural authenticity, refine, score, rank).
      // Falls back to the GPT drafts if Anthropic isn't configured or errors.
      const drafts = (result.hooks ?? []).map((h) => h.text);
      const refined = await directorRefineHooks({
        artist: project.artist as never,
        brief: brief as never,
        drafts,
        tasteMemory,
        trends,
        soundDna,
      });

      const langFilter = (arr: string[]) =>
        arr.filter(
          (c): c is z.infer<typeof langSchema> =>
            ['yo', 'ig', 'ha', 'pcm', 'en', 'fr', 'pt', 'sw', 'zu', 'xh', 'twi'].includes(c)
        );

      const rows = refined
        ? refined.map((h) => ({
            text: h.text,
            language: langFilter(h.language ?? []),
            score: typeof h.score === 'number' ? h.score : null,
            meta: { reason: h.reason, needsNativeReview: h.needsNativeReview, director: 'claude' },
          }))
        : (result.hooks ?? []).map((h) => ({
            text: h.text,
            language: langFilter(h.language ?? []),
            score: null as number | null,
            meta: {
              syllablePattern: h.syllablePattern,
              melodyNotes: h.melodyNotes,
              callResponse: h.callResponse,
              director: 'none',
            },
          }));

      const created = await prisma.$transaction(
        rows.map((r) =>
          prisma.hookCandidate.create({
            data: {
              projectId: project.id,
              text: r.text,
              language: r.language,
              score: r.score,
              meta: r.meta as never,
            },
          })
        )
      );
      // Best-first when the A&R director scored them.
      created.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      reply.code(201);
      return {
        hooks: created,
        charged: charge.balance,
        director: refined ? 'claude' : 'none',
        // Diagnostics: does the API actually see the keys?
        anthropicKeyOnApi: anthropicEnabled(),
        trendsPulled: !!trends,
      };
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
