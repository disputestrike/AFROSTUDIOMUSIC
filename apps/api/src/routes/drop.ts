import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { dropBatchSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { runChatTool } from '../services/chat-tools';
import { willItBlowGate } from '../lib/will-it-blow';

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

      // ASYNC BY DESIGN: the pipeline takes 1–3 minutes of LLM work. Holding one
      // HTTP request open that long dies on real-world networks/proxies (browser
      // click-through proved it: ECONNRESET mid-drop → user sees a dead button).
      // So: 202 + a job id IMMEDIATELY; the pipeline runs detached and writes its
      // result to the ProviderJob row; clients poll /jobs/:id.
      const dropJob = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'drop',
          provider: 'internal',
          status: 'RUNNING',
          startedAt: new Date(),
          inputJson: input as never,
        },
      });

      void runDropPipeline(app, ctx, input, dropJob.id).catch(async (err) => {
        app.log.error({ err, dropJobId: dropJob.id }, 'drop pipeline crashed');
        await prisma.providerJob
          .update({ where: { id: dropJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: 'drop pipeline failed — try again' as never } })
          .catch(() => {});
      });

      reply.code(202);
      return { jobId: dropJob.id, status: 'queued', theme: input.theme };
    }
  );
}

export type DropCtx = { app: FastifyInstance; workspaceId: string; userId: string; projectId: string };
export type DropInput = ReturnType<typeof dropBatchSchema.parse>;

/** The actual Drop Machine pipeline — runs detached; result lands on the job row.
 *  Exported so Albums can generate "the next track in this album's style". */
export async function runDropPipeline(app: FastifyInstance, ctx: DropCtx, input: DropInput, dropJobId: string) {
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
          const hk = (await runChatTool({ ...ctx, name: 'generate_hooks', args: { count: 6, languages: input.languages } })) as {
            hooks?: Array<{ id: string; text: string; score: number | null }>;
          };
          let hooks = hk?.hooks ?? [];
          if (!hooks.length) continue;
          // If the Claude A&R didn't score them, score via the taste engine — but
          // NEVER let a scoring hiccup kill the whole take. If it fails, we ship
          // the hooks unscored (ranked by generation order) rather than failing.
          if (hooks.every((h) => h.score == null)) {
            try {
              const sc = (await runChatTool({ ...ctx, name: 'score_hooks', args: { hookIds: hooks.map((h) => h.id) } })) as { scores?: Array<{ id: string; overall: number }> };
              const m = new Map((sc?.scores ?? []).map((s) => [s.id, s.overall]));
              hooks = hooks.map((h) => ({ ...h, score: m.get(h.id) ?? h.score }));
            } catch { /* scoring unavailable — keep the hooks, pick the first */ }
          }
          let best = hooks.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]!;

          // Quality floor: if the best hook is below the bar, regenerate ONCE more
          // and keep the best across both rounds. Raises the floor without ever
          // hard-failing the drop (a strong hook is what carries an Afrobeats record).
          const MIN_HOOK_SCORE = Number(process.env.MIN_HOOK_SCORE ?? 6.5);
          if ((best.score ?? 0) < MIN_HOOK_SCORE) {
            const hk2 = (await runChatTool({ ...ctx, name: 'generate_hooks', args: { count: 6, languages: input.languages } })) as {
              hooks?: Array<{ id: string; text: string; score: number | null }>;
            };
            let hooks2 = hk2?.hooks ?? [];
            if (hooks2.length && hooks2.every((h) => h.score == null)) {
              try {
                const sc2 = (await runChatTool({ ...ctx, name: 'score_hooks', args: { hookIds: hooks2.map((h) => h.id) } })) as { scores?: Array<{ id: string; overall: number }> };
                const m2 = new Map((sc2?.scores ?? []).map((s) => [s.id, s.overall]));
                hooks2 = hooks2.map((h) => ({ ...h, score: m2.get(h.id) ?? h.score }));
              } catch { /* scoring unavailable — keep hooks2 as-is */ }
            }
            const combined = [...hooks, ...hooks2].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
            if (combined[0]) best = combined[0];
          }

          const ap = (await runChatTool({ ...ctx, name: 'approve_hook', args: { hookId: best.id } })) as {
            songId?: string;
          };
          await runChatTool({ ...ctx, name: 'generate_lyrics', args: { hookId: best.id, cleanVersion: true, languages: input.languages } });
          const beat = (await runChatTool({
            ...ctx,
            name: 'create_beat_job',
            args: { genre: input.genre, fusionGenres: input.fusionGenres, mood: input.mood, pinnedReferenceId: input.pinnedReferenceId, bpm: input.bpm, withVocals: input.withVocals, songEngine: input.songEngine, influence: input.influence, languages: input.languages },
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
      app.log.warn({ err }, 'drop iteration failed');
      // Surface the REAL reason (truncated) so failures are diagnosable instead
      // of a generic "take failed" — the user (and we) can see WHY.
      const why = (err as Error)?.message?.slice(0, 160) || 'unknown error';
      drops.push({ score: null, error: `this take failed: ${why}` });
    }
  }

  drops.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  await prisma.providerJob.update({
    where: { id: dropJobId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      outputJson: { theme: input.theme, requested: input.count, produced: drops.length, drop: drops } as never,
    },
  });

  // THE WILL-IT-BLOW GATE — no song ships until it's run through Will-it-hit, and
  // if it won't blow the studio AUTO-APPLIES the A&R's own recommendations (rewrite
  // + re-sing + re-master), re-scores, and KEEPS THE BEST version. Detached; waits
  // for each render, scores, improves below the bar. (WILL_IT_BLOW_MAX_PASSES=0
  // reverts to score-only.)
  void willItBlowGate(app, ctx.workspaceId, drops).catch(() => {});
}
