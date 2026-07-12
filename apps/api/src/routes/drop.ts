import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { runWithBrainContext, brainRunCosts } from '@afrohit/ai';
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

      // IDEMPOTENT START: the client retries a network-dead POST (redeploy
      // window) with the SAME Idempotency-Key — a duplicate key returns the
      // drop already running instead of double-creating (and double-charging).
      const idem = (req.headers['idempotency-key'] as string) || undefined;
      if (idem) {
        const existing = await prisma.providerJob.findFirst({
          where: { workspaceId, kind: 'drop', inputJson: { path: ['_idem'], equals: idem } },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          reply.code(202);
          return { jobId: existing.id, status: 'queued', theme: input.theme };
        }
      }

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
          inputJson: { ...input, ...(idem ? { _idem: idem } : {}) } as never,
        },
      });

      void runDropPipeline(app, ctx, input, dropJob.id).catch(async (err) => {
        app.log.error({ err, dropJobId: dropJob.id }, 'drop pipeline crashed');
        await prisma.providerJob
          // { message } shape — the web reads j.errorJson?.message; a bare string
          // here rendered as nothing and the user saw a blank failure.
          .update({ where: { id: dropJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: { message: 'drop pipeline failed — try again' } as never } })
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
  // COST RECEIPT: the whole pipeline runs inside a metered brain context — every
  // LLM call lands on this run's bill, and the drop's outputJson carries it
  // ("one song, this much", not a vibe). User drops keep their taste tiers;
  // only the NIGHT runs force bulk.
  return runWithBrainContext({ runId: dropJobId }, () => runDropPipelineInner(app, ctx, input, dropJobId));
}

async function runDropPipelineInner(app: FastifyInstance, ctx: DropCtx, input: DropInput, dropJobId: string) {
  // STAGE TIMING — the writer now drafts + critic-polishes + arranges before the
  // render is queued, so this can run several minutes. Log where the time goes
  // so a slow drop is diagnosable from the API logs (not guessed at).
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  app.log.info({ dropJobId, count: input.count }, `[drop] start`);
  // One shared brief for the whole drop. ADVISORY, NEVER LOAD-BEARING: when the
  // polish LLM fails (cap hit, bad JSON, provider down) the writers used to read
  // briefs[0] === undefined and the user's ENTIRE description — song-name anchor,
  // vibe, mood, fusion, influence — silently never reached a single prompt. Now a
  // failed polish falls back to a brief built VERBATIM from the structured input.
  try {
    const polished = (await runChatTool({ ...ctx, name: 'polish_brief', args: { rawIdea: input.theme } })) as { error?: string } | null;
    if (polished && (polished as { error?: string }).error) throw new Error((polished as { error: string }).error);
    app.log.info({ dropJobId }, `[drop] brief polished @${secs()}s`);
  } catch (err) {
    app.log.error({ err, dropJobId }, '[drop] polish_brief failed — writing the fallback brief from the structured input');
    await prisma.songBrief
      .create({
        data: {
          projectId: ctx.projectId,
          mood: input.mood ?? null,
          topic: input.vibe ?? input.theme,
          language: input.languages ?? [],
          bpm: input.bpm ?? null,
          notes: [
            input.songTitle ? `Song title (law): ${input.songTitle}` : null,
            input.influence ? `Influence: ${input.influence}` : null,
            input.fusionGenres?.length ? `Fusion: ${input.fusionGenres.join(', ')}` : null,
          ].filter(Boolean).join('\n') || null,
          approved: true,
        },
      })
      .catch(() => undefined);
  }

  const drops: Array<{
        songId?: string;
        hookId?: string;
        hookText?: string;
        title?: string;
        score: number | null;
        jobId?: string;
        error?: string;
      }> = [];

      for (let i = 0; i < input.count; i++) {
        try {
          // Structured selections ride FIRST-CLASS next to languages — the
          // polish-brief LLM re-extracting them from the theme prose was the
          // only carrier before, so a polish hiccup dropped mood/fusion/influence.
          const sel = { mood: input.mood, fusionGenres: input.fusionGenres, influence: input.influence, songTitle: input.songTitle };
          const hk = (await runChatTool({ ...ctx, name: 'generate_hooks', args: { count: 3, languages: input.languages, ...sel } })) as {
            hooks?: Array<{ id: string; text: string; score: number | null }>;
          };
          let hooks = hk?.hooks ?? [];
          if (!hooks.length) {
            // NEVER skip silently. Empty hooks = the creative brain returned
            // nothing usable (down/degraded, or JSON that didn't match the
            // schema). Record WHY so the drop surfaces a real reason instead of a
            // blank "Could not start the render".
            const why = (hk as { error?: string })?.error;
            drops.push({ score: null, error: why ? `no hooks: ${why}` : 'no hooks — the creative brain returned nothing (check ANTHROPIC / OPENAI keys + billing on the API service, then Try again)' });
            continue;
          }
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
            const hk2 = (await runChatTool({ ...ctx, name: 'generate_hooks', args: { count: 3, languages: input.languages, ...sel } })) as {
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

          app.log.info({ dropJobId }, `[drop] take ${i + 1}: hook picked @${secs()}s`);
          const ap = (await runChatTool({ ...ctx, name: 'approve_hook', args: { hookId: best.id } })) as {
            songId?: string;
          };
          await runChatTool({ ...ctx, name: 'generate_lyrics', args: { hookId: best.id, cleanVersion: true, languages: input.languages, ...sel } });
          app.log.info({ dropJobId }, `[drop] take ${i + 1}: lyrics written (draft+polish) @${secs()}s`);
          const beat = (await runChatTool({
            ...ctx,
            name: 'create_beat_job',
            // THE CREATE-PAGE PATH: this is the render users actually hit. It must
            // carry the SAME brief the chat path (runDropTool) carries — voice and
            // vibe were silently dropped here while the fix landed only in chat.
            // vibe (the raw musical description) is preferred over theme, which is
            // wrapped in title-anchor boilerplate the music engine can't use.
            args: { genre: input.genre, fusionGenres: input.fusionGenres, mood: input.mood, pinnedReferenceId: input.pinnedReferenceId, bpm: input.bpm, withVocals: input.withVocals, songEngine: input.songEngine, influence: input.influence, languages: input.languages, voice: input.voice, vibePrompt: input.vibe, candidates: input.candidates, instruments: input.instruments },
          })) as { jobId?: string; songId?: string; error?: string };

          // The user's typed song name IS the title — the writers already treat it
          // as the creative anchor (via theme); without this the field was dead
          // and the song shipped under the AI's own title.
          const producedSongId = ap?.songId ?? beat?.songId;
          if (input.songTitle && producedSongId) {
            const t = input.songTitle.slice(0, 80);
            await prisma.song.update({ where: { id: producedSongId }, data: { title: t } }).catch(() => undefined);
            await prisma.lyricDraft.updateMany({ where: { songId: producedSongId }, data: { title: t } }).catch(() => undefined);
          }

          app.log.info({ dropJobId, jobId: beat?.jobId, err: beat?.error }, `[drop] take ${i + 1}: render ${beat?.jobId ? 'QUEUED' : 'NOT queued'} @${secs()}s`);
          drops.push({
            songId: producedSongId,
            hookId: best.id,
            hookText: best.text,
            title: input.songTitle?.slice(0, 80),
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
  // If NOT ONE take produced a render job, the drop failed even though the
  // pipeline ran to completion. Surface the real reason (the first take's error)
  // at the TOP LEVEL so every UI shows WHY instead of a blank "Could not start
  // the render". produced now counts REAL renders, not attempted takes.
  const rendered = drops.filter((d) => d.jobId);
  const failReason = rendered.length === 0
    ? (drops.find((d) => d.error)?.error ?? 'the studio produced no song this run — check the API brain keys (ANTHROPIC / OPENAI) and try again')
    : undefined;
  // The run's LLM bill (metered by the brain context; estimates, labeled so).
  // The RENDER cost lands on the render job itself when the engine reports it.
  const costs = brainRunCosts();
  await prisma.providerJob.update({
    where: { id: dropJobId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      outputJson: {
        theme: input.theme,
        requested: input.count,
        produced: rendered.length,
        drop: drops,
        error: failReason,
        ...(costs ? { llmCosts: { estUsd: +costs.estUsd.toFixed(4), calls: costs.calls, byBrain: Object.fromEntries(Object.entries(costs.byBrain).map(([k, v]) => [k, { calls: v.calls, estUsd: +v.estUsd.toFixed(4) }])), degraded: costs.degraded, note: 'LLM writing bill (estimates); the render cost lands on the render job' } } : {}),
      } as never,
    },
  });

  // THE WILL-IT-BLOW GATE — no song ships until it's run through Will-it-hit, and
  // if it won't blow the studio AUTO-APPLIES the A&R's own recommendations (rewrite
  // + re-sing + re-master), re-scores, and KEEPS THE BEST version. Detached; waits
  // for each render, scores, improves below the bar. (WILL_IT_BLOW_MAX_PASSES=0
  // reverts to score-only.)
  void willItBlowGate(app, ctx.workspaceId, drops).catch(() => {});
}
