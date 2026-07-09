/**
 * §10 — ADJUST SONG: hear → classify → confirm → plan → repair → compare.
 *
 * The contract, verbatim from the FINAL INSTRUCTION:
 *  - the repair plan is shown BEFORE any spend (GET lane-report / POST plan cost $0);
 *  - the USER confirms or overrides the target lane before execution (their ear
 *    outranks the machine's — anti-pattern #8);
 *  - execute repairs ONLY the failing layer by dispatching to the EXISTING routes
 *    (material rebuild / steered re-render / master chain / hook rewrite) via
 *    app.inject — same auth, same credits, same steering, zero duplicated logic;
 *  - never regenerate the whole song unless the lane itself is wrong (and even
 *    then, lyrics/hook are preserved by the material + regenerate paths);
 *  - the response DISCLOSES which route ran. Compare/revert of the resulting take
 *    already exists (POST /songs/:id/versions/revert).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { buildLaneReport, planAdjustRoutes, classifyAllLanes, unseededForLane, type AdjustRoute } from '../lib/lane-report';
import type { MeasuredAnalysis } from '@afrohit/shared';

export default async function adjust(app: FastifyInstance) {
  // §9 — the producer-brain block for a song. Read-only, always honest.
  app.get<{ Params: { id: string } }>('/:id/lane-report', async (req) => {
    const { workspaceId } = requireAuth(req);
    return buildLaneReport(workspaceId, req.params.id);
  });

  // §10 steps 2–5 — hear / classify(all lanes) / plan. ZERO spend.
  const planSchema = z.object({ targetLane: z.string().max(40).optional() });
  app.post<{ Params: { id: string } }>('/:id/adjust/plan', { schema: { body: planSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = planSchema.parse(req.body ?? {});
    const report = await buildLaneReport(workspaceId, req.params.id);
    if (!report.available) return reply.code(422).send({ error: 'not_measurable', ...report });

    // User override of the target lane (§10 step 4) — rebuild the report against it.
    const finalReport = body.targetLane && body.targetLane !== report.targetLane
      ? await (async () => {
          // ownership already verified by buildLaneReport above (BeatAsset has no workspaceId column)
          const beat = await prisma.beatAsset.findFirst({ where: { songId: req.params.id }, orderBy: { createdAt: 'desc' }, select: { id: true, meta: true } });
          const meta = (beat?.meta ?? {}) as Record<string, unknown>;
          await prisma.beatAsset.update({ where: { id: beat!.id }, data: { meta: { ...meta, assessedGenre: body.targetLane } as never } });
          return buildLaneReport(workspaceId, req.params.id);
        })()
      : report;

    return {
      report: finalReport,
      routes: planAdjustRoutes(finalReport),
      spend: 'NOTHING has been charged. Executing a route below charges exactly what that existing action always costs.',
    };
  });

  // §10 step 6 — execute ONE confirmed route by dispatching to the existing endpoint.
  const execSchema = z.object({
    route: z.enum(['rebuild_beat_material', 'rerender_steered', 'remix_only', 'rewrite_hook']),
    targetLane: z.string().max(40).optional(),
  });
  app.post<{ Params: { id: string } }>('/:id/adjust/execute', { schema: { body: execSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = execSchema.parse(req.body);
    const song = await prisma.song.findFirst({
      where: { id: req.params.id, workspaceId },
      select: { id: true, projectId: true, project: { select: { genre: true, bpm: true } } },
    });
    if (!song) return reply.code(404).send({ error: 'song_not_found' });
    const genre = body.targetLane ?? song.project.genre ?? 'afrobeats';

    const headers = { authorization: (req.headers.authorization as string) ?? '', 'content-type': 'application/json', cookie: (req.headers.cookie as string) ?? '' };
    const dispatch: Record<AdjustRoute['route'], { method: 'POST'; url: string; payload: unknown }> = {
      rebuild_beat_material: { method: 'POST', url: '/api/v1/materials/auto', payload: { projectId: song.projectId, genre, bpm: song.project.bpm ?? undefined, songId: song.id } },
      rerender_steered: { method: 'POST', url: `/api/v1/songs/${song.id}/regenerate-beat`, payload: {} },
      remix_only: { method: 'POST', url: `/api/v1/songs/${song.id}/master`, payload: {} },
      rewrite_hook: { method: 'POST', url: `/api/v1/projects/${song.projectId}/hooks`, payload: {} },
    };
    const d = dispatch[body.route];
    const res = await app.inject({ method: d.method, url: d.url, headers, payload: d.payload as never });
    const out = res.json() as Record<string, unknown>;
    return reply.code(res.statusCode >= 400 ? res.statusCode : 202).send({
      dispatched: `${d.method} ${d.url}`, // disclosed — the user sees exactly which repair ran
      route: body.route,
      targetLane: genre,
      result: out,
      next: 'Poll the returned job, then compare takes (versions panel) — the winner is explained in lane terms, never “this one was louder.”',
    });
  });

  // Classify an arbitrary MeasuredAnalysis against ALL profiled lanes (Listen page §9).
  app.post('/classify', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const body = (req.body ?? {}) as { analysis?: MeasuredAnalysis; songId?: string };
    let analysis = body.analysis;
    if (!analysis && body.songId) {
      const beat = await prisma.beatAsset.findFirst({ where: { songId: body.songId, song: { workspaceId } }, orderBy: { createdAt: 'desc' }, select: { meta: true } });
      analysis = ((beat?.meta ?? {}) as { measured?: MeasuredAnalysis }).measured;
    }
    if (!analysis) return reply.code(400).send({ error: 'need_analysis_or_measured_songId' });
    const dist = await classifyAllLanes(workspaceId, analysis);
    return { ...dist, lexiconUnseeded: dist.distribution[0] ? await unseededForLane(dist.distribution[0].lane) : [] };
  });
}
