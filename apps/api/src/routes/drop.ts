import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { dropBatchSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { runChatTool } from '../services/chat-tools';

/**
 * The Drop Machine — batch song factory.
 *
 * From one theme, run the full pipeline N times (hooks → A&R picks the best →
 * lyrics → full sung song with the ad-lib arranger), then return a shortlist
 * ranked by the A&R hook score. Audio renders in the background; the daily cost
 * cap still applies so a big batch can never overrun. Turns you from
 * button-presser into curator.
 */
export default async function drop(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: dropBatchSchema } },
    async (req, reply) => {
      const { workspaceId, userId } = requireAuth(req);
      const input = dropBatchSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });
      const ctx = { app, workspaceId, userId, projectId: project.id };

      // One shared brief for the whole drop.
      await runChatTool({ ...ctx, name: 'polish_brief', args: { rawIdea: input.theme } });

      const drops: Array<{
        songId?: string;
        hookId?: string;
        hookText?: string;
        score: number | null;
        jobId?: string;
        error?: string;
      }> = [];

      for (let i = 0; i < input.count; i++) {
        try {
          const hk = (await runChatTool({ ...ctx, name: 'generate_hooks', args: { count: 10 } })) as {
            hooks?: Array<{ id: string; text: string; score: number | null }>;
          };
          let hooks = hk?.hooks ?? [];
          if (!hooks.length) continue;
          // If the Claude A&R didn't score them (no ANTHROPIC_API_KEY), score via
          // the taste engine (OpenAI) so the shortlist actually ranks.
          if (hooks.every((h) => h.score == null)) {
            const sc = (await runChatTool({
              ...ctx,
              name: 'score_hooks',
              args: { hookIds: hooks.map((h) => h.id) },
            })) as { scores?: Array<{ id: string; overall: number }> };
            const m = new Map((sc?.scores ?? []).map((s) => [s.id, s.overall]));
            hooks = hooks.map((h) => ({ ...h, score: m.get(h.id) ?? h.score }));
          }
          const best = hooks.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;

          const ap = (await runChatTool({ ...ctx, name: 'approve_hook', args: { hookId: best.id } })) as {
            songId?: string;
          };
          await runChatTool({ ...ctx, name: 'generate_lyrics', args: { hookId: best.id, cleanVersion: true } });
          const beat = (await runChatTool({
            ...ctx,
            name: 'create_beat_job',
            args: { genre: input.genre, bpm: input.bpm, withVocals: input.withVocals, songEngine: input.songEngine, influence: input.influence },
          })) as { jobId?: string; songId?: string; error?: string };

          drops.push({
            songId: ap?.songId ?? beat?.songId,
            hookId: best.id,
            hookText: best.text,
            score: best.score ?? null,
            jobId: beat?.jobId,
            error: beat?.error,
          });

          // If the daily cap was hit mid-batch, stop cleanly.
          if (beat?.error === 'insufficient_credits') break;
        } catch (err) {
          drops.push({ score: null, error: (err as Error).message });
        }
      }

      drops.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      reply.code(202);
      return { theme: input.theme, requested: input.count, produced: drops.length, drop: drops };
    }
  );
}
