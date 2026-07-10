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
  // Internal single-tenant mode: the one resolved user IS the operator.
  if (isInternalMode()) return;
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
  const runSchema = z.object({ task: z.enum(['nightly-compound', 'measure-backfill', 'learn-backfill', 'mine-lexicon', 'lexicon-research', 'wiktionary-harvest', 'wiktionary-burst', 'lexicon-gloss']) });
  app.post('/run', { schema: { body: runSchema } }, async (req, reply) => {
    await requireAdmin(req);
    const { task } = runSchema.parse(req.body);
    await enqueue({ queue: app.queues.music, name: task, payload: {} });
    reply.code(202);
    return { queued: task, note: 'Running on the worker now — watch worker logs; results land in /lanes/inventory.' };
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
