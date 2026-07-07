import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateHooksInputSchema, langSchema } from '@afrohit/shared';
import { joinBriefs, prompts, generateJson, directorRefineHooks, researchTrends, anthropicEnabled, soundBrief} from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { memoryContext, recordFeedback } from '../services/artist-memory';
import { learnedReferenceBrief, learnedLyricCraftBrief, snapshotTrend, freshnessBrief } from '../lib/learned';
import { lexiconPalette } from '../lib/lexicon';

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
      // Live trends so hooks reflect what's popping right now — and the digest
      // is shelved in the data lake (one snapshot/genre/day) so it compounds.
      const trendData = await researchTrends({ genre: project.genre }).catch(() => null);
      const trends = trendData?.digest;
      void snapshotTrend(workspaceId, project.genre, trendData);
      // Genre Sound DNA + the artist's LEARNED references + STUDIED lyric craft
      // + HIT-CRAFT — the full data lake behind every hook.
      const soundDna = joinBriefs([
        await freshnessBrief(workspaceId),
        await lexiconPalette({ workspaceId, mood: (brief as { mood?: string } | undefined)?.mood, rotate: input.count }),
        soundBrief(project.genre).brief,
        await learnedReferenceBrief(workspaceId, project.genre),
        await learnedLyricCraftBrief(workspaceId, project.genre),
        prompts.hitCraftBrief('hook', (brief as { mood?: string } | undefined)?.mood),
      ]);

      // FAST + RELIABLE: OpenAI writes the hooks (~15s, never rate-limited for
      // us, and the word-palette in soundDna gives it the vocab), then Claude
      // scores them in a LEAN A&R pass (~10s). Two heavy Claude calls were the
      // 67-104s stall; this is ~25s and the A&R score is reliable.
      type DraftHook = { text: string; language?: string[]; syllablePattern?: string; melodyNotes?: string; callResponse?: boolean };
      // Claude-first (OpenAI account is quota-exhausted → must not depend on it).
      // Lean prompt + tokens keep it fast; the lean A&R scorer follows.
      const result = await generateJson<{ hooks?: DraftHook[] }>({
        system: prompts.HOOK_SYSTEM,
        user: prompts.hookUserPrompt({ artist: project.artist as never, brief: brief as never, count: input.count, tasteMemory, trends, soundDna: soundDna.slice(0, 2600) }),
        temperature: 0.95,
        maxTokens: 3_500,
      });
      const refined = await directorRefineHooks({
        artist: project.artist as never,
        brief: brief as never,
        drafts: (result.hooks ?? []).map((h) => h.text),
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
            meta: { reason: h.reason, needsNativeReview: h.needsNativeReview, director: 'claude', viralScore: h.viralScore, dimensions: h.dimensions, tiktokMoment: h.tiktokMoment },
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
      // Idempotent: re-approving an already-approved hook returns its song instead
      // of spawning a duplicate (matters now that the UI has a direct Approve button).
      if (hook.approved && hook.songId) {
        return { hookId: hook.id, songId: hook.songId, alreadyApproved: true };
      }
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

  // Edit a hook's wording before (or after) approving it — surgical control.
  const hookEditSchema = z.object({ text: z.string().trim().min(1, 'Hook text cannot be empty.').max(500, 'Keep the hook under 500 characters.') });
  app.patch<{ Params: { projectId: string; hookId: string } }>(
    '/:hookId',
    { schema: { body: hookEditSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { text } = hookEditSchema.parse(req.body);
      const hook = await prisma.hookCandidate.findFirst({ where: { id: req.params.hookId, project: { workspaceId } } });
      if (!hook) return reply.code(404).send({ error: 'hook_not_found' });
      const updated = await prisma.hookCandidate.update({
        where: { id: hook.id },
        data: { text, meta: { ...((hook.meta as Record<string, unknown>) ?? {}), edited: true } as never },
      });
      // If this hook is bound to a song whose title still mirrors the OLD hook,
      // keep the title in sync. Read-compare-update (no heuristic updateMany).
      if (hook.songId) {
        const oldTitle = hook.text.split('\n')[0]!.slice(0, 80);
        const song = await prisma.song.findFirst({ where: { id: hook.songId, workspaceId }, select: { id: true, title: true } });
        if (song && song.title === oldTitle) {
          await prisma.song.update({ where: { id: song.id }, data: { title: text.split('\n')[0]!.slice(0, 80) } }).catch(() => {});
        }
      }
      return { hookId: updated.id, text: updated.text };
    }
  );
}
