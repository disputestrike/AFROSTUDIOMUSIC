/**
 * Admin pathway — operator tools gated by ADMIN_EMAILS (comma-separated env).
 * Same pattern as the GOVSURE remediation: no separate role system, just an
 * allowlist of operator emails checked against the authenticated user.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { isInternalMode, requireAuth } from '../middleware/auth';
import { enqueue, QUEUES, type QueueName } from '../lib/queue';

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  const { userId } = requireAuth(req);
  // WO-1 SAFETY RAIL: the API is publicly reachable, and in internal mode
  // requireAuth never rejects — so "the one resolved user IS the operator" made
  // every admin/trigger route (spend triggers included) open to the internet.
  // Internal mode now requires the ADMIN_SECRET header. No secret configured =
  // 401 for everyone (set ADMIN_SECRET on the API service; send x-admin-secret).
  if (isInternalMode()) {
    const secret = process.env.ADMIN_SECRET ?? '';
    const given = String(req.headers['x-admin-secret'] ?? '');
    if (!secret) {
      throw Object.assign(new Error('admin locked: set ADMIN_SECRET on the API service and send the x-admin-secret header'), { statusCode: 401 });
    }
    if (given !== secret) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return;
  }
  // Multi-user modes: gate by ADMIN_EMAILS allowlist.
  const allow = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) throw Object.assign(new Error('admin not configured'), { statusCode: 403 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || !allow.includes(user.email.toLowerCase())) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }
}

const grantSchema = z.object({
  deltaCents: z.number().int(), // positive = grant, negative = clawback (1/100-cent units)
  reason: z.string().min(3).max(200),
});

export default async function admin(app: FastifyInstance) {
  // One-tap compounding: run the lake jobs NOW instead of waiting for tonight.
  const runSchema = z.object({ task: z.enum(['nightly-compound', 'measure-backfill', 'learn-backfill', 'listen-back', 'mine-lexicon', 'lexicon-research', 'wiktionary-harvest', 'wiktionary-burst', 'lexicon-gloss']) });
  app.post('/run', { schema: { body: runSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { task } = runSchema.parse(req.body);
    await enqueue({ queue: app.queues.music, name: task, payload: {} });
    reply.code(202);
    return { queued: task, note: 'Running on the worker now — watch worker logs; results land in /lanes/inventory.' };
  });

  // WO-15 — ECONOMICS: marginal cost per render and RENDERS-PER-KEPT-SONG (the
  // margin number; the ear's success metric — quality structurally lowers cost).
  app.get<{ Querystring: { days?: string } }>('/economics', async (req) => {
    await requireAdmin(req);
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [renders, failed, costAgg, keptSongs] = await Promise.all([
      prisma.providerJob.findMany({
        where: { kind: 'music', status: 'SUCCEEDED', createdAt: { gte: since } },
        select: { provider: true, cost: true, outputJson: true },
      }),
      prisma.providerJob.count({ where: { kind: 'music', status: 'FAILED', createdAt: { gte: since } } }),
      prisma.providerJob.aggregate({ where: { kind: 'music', status: 'SUCCEEDED', createdAt: { gte: since } }, _sum: { cost: true } }),
      prisma.song.count({
        where: { createdAt: { gte: since }, OR: [{ masters: { some: {} } }, { mixes: { some: {} } }, { beats: { some: {} } }] },
      }),
    ]);
    const byEngine = new Map<string, { engine: string; renders: number; costUsd: number }>();
    let candidatesRendered = 0;
    for (const r of renders) {
      const k = r.provider ?? 'unknown';
      const cur = byEngine.get(k) ?? { engine: k, renders: 0, costUsd: 0 };
      cur.renders++;
      cur.costUsd += Number(r.cost ?? 0);
      byEngine.set(k, cur);
      const bo = ((r.outputJson ?? {}) as { bestOf?: { rendered?: number } }).bestOf;
      candidatesRendered += Math.max(1, bo?.rendered ?? 1);
    }
    const totalCost = Number(costAgg._sum.cost ?? 0);
    return {
      windowDays: days,
      renders: { succeeded: renders.length, failed, candidatesRendered },
      costUsd: { total: Math.round(totalCost * 100) / 100, perRender: renders.length ? Math.round((totalCost / renders.length) * 1000) / 1000 : null },
      keptSongs,
      rendersPerKeptSong: keptSongs ? Math.round((candidatesRendered / keptSongs) * 100) / 100 : null,
      byEngine: [...byEngine.values()].map((e) => ({ ...e, costUsd: Math.round(e.costUsd * 100) / 100 })).sort((a, b) => b.renders - a.renders),
      note: 'rendersPerKeptSong is THE margin number — the ear lowering it is the moat (§E2). Costs are provider estimates recorded per job.',
    };
  });

  app.get('/stats', async (req) => {
    await requireAdmin(req);
    const [workspaces, users, songs, jobs, openReviews, failedJobs] = await Promise.all([
      prisma.workspace.count(),
      prisma.user.count(),
      prisma.song.count(),
      prisma.providerJob.count(),
      prisma.reviewTask.count({ where: { status: 'open' } }),
      prisma.providerJob.count({ where: { status: 'FAILED' } }),
    ]);
    return { workspaces, users, songs, jobs, openReviews, failedJobs };
  });

  app.get('/workspaces', async (req) => {
    await requireAdmin(req);
    return prisma.workspace.findMany({
      select: {
        id: true, name: true, slug: true, plan: true, creditsCents: true,
        suspendedAt: true, createdAt: true,
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/workspaces/:id/credits',
    { schema: { body: grantSchema } },
    async (req) => {
      await requireAdmin(req);
      const { deltaCents, reason } = grantSchema.parse(req.body);
      const [ws] = await prisma.$transaction([
        prisma.workspace.update({
          where: { id: req.params.id },
          data: { creditsCents: { increment: deltaCents } },
        }),
        prisma.creditLedger.create({
          data: {
            workspaceId: req.params.id,
            delta: deltaCents,
            reason: `admin_${deltaCents >= 0 ? 'grant' : 'clawback'}: ${reason}`,
          },
        }),
      ]);
      return { id: ws.id, creditsCents: ws.creditsCents };
    }
  );

  app.post<{ Params: { id: string } }>('/workspaces/:id/suspend', async (req) => {
    await requireAdmin(req);
    const ws = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { suspendedAt: new Date() },
    });
    return { id: ws.id, suspendedAt: ws.suspendedAt };
  });

  app.post<{ Params: { id: string } }>('/workspaces/:id/unsuspend', async (req) => {
    await requireAdmin(req);
    const ws = await prisma.workspace.update({
      where: { id: req.params.id },
      data: { suspendedAt: null },
    });
    return { id: ws.id, suspendedAt: null };
  });

  /** Re-enqueue a failed job from its persisted inputJson. */
  app.post<{ Params: { id: string } }>('/jobs/:id/retry', async (req, reply) => {
    await requireAdmin(req);
    const job = await prisma.providerJob.findUniqueOrThrow({ where: { id: req.params.id } });
    if (job.status !== 'FAILED') return reply.code(400).send({ error: 'only_failed_jobs' });

    const queueForKind: Record<string, QueueName> = {
      music: QUEUES.music,
      voice: QUEUES.voice,
      voice_profile: QUEUES.voice,
      mix: QUEUES.mix,
      master: QUEUES.master,
      image: QUEUES.image,
      video: QUEUES.video,
      export: QUEUES.exportBundle,
    };
    const queueName = queueForKind[job.kind];
    if (!queueName) return reply.code(400).send({ error: `no_queue_for_kind:${job.kind}` });

    await prisma.providerJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', errorJson: undefined, startedAt: null, finishedAt: null },
    });
    await enqueue({
      queue: app.queues[queueName],
      name: job.kind === 'voice_profile' ? 'setup-voice-profile' : `retry-${job.kind}`,
      payload: { jobId: job.id, workspaceId: job.workspaceId, projectId: job.projectId, ...(job.inputJson as Record<string, unknown>) },
    });
    return { id: job.id, status: 'requeued' };
  });

  app.get('/jobs/failed', async (req) => {
    await requireAdmin(req);
    return prisma.providerJob.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
}
