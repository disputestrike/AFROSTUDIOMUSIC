import { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@afrohit/db';
import { dropBatchSchema, redactSensitiveText } from '@afrohit/shared';
import { QUEUES } from './queue';
import { runDropPipeline } from '../routes/drop';
import { finishAutoMaterialBeat, type FinishAutoMaterialPayload } from './material-auto';
import { runArReadAfterRender } from './ar-read';

type DropOrchestrationPayload = {
  jobId: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  input: unknown;
  albumId?: string;
};

export async function startOrchestrationWorker(app: FastifyInstance): Promise<void> {
  const connection = app.redis.duplicate();
  const worker = new Worker(
    QUEUES.orchestration,
    async (bullJob) => {
      if (bullJob.name === 'ar-read-after-render') {
        const data = bullJob.data as { jobId: string; workspaceId: string; items: Array<{ songId: string; jobId: string }> };
        const owned = await prisma.providerJob.findFirst({
          where: { id: data.jobId, workspaceId: data.workspaceId, kind: 'ar-orchestration' },
          select: { id: true, status: true },
        });
        if (!owned) throw new Error('A&R orchestration job missing or outside workspace');
        if (owned.status === 'SUCCEEDED' || owned.status === 'CANCELED') return;
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, errorJson: Prisma.DbNull },
        });
        try {
          const result = await runArReadAfterRender(app, data.workspaceId, data.jobId, data.items);
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: { status: 'SUCCEEDED', finishedAt: new Date(), outputJson: result as never },
          });
        } catch (error) {
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              errorJson: { message: redactSensitiveText((error as Error)?.message ?? 'A&R orchestration failed', 500) } as never,
            },
          });
          throw error;
        }
        return;
      }

      if (bullJob.name === 'finish-auto-material') {
        const data = bullJob.data as FinishAutoMaterialPayload;
        const owned = await prisma.providerJob.findFirst({
          where: { id: data.jobId, workspaceId: data.workspaceId, kind: 'material-orchestration' },
          select: { id: true, status: true },
        });
        if (!owned) throw new Error('material orchestration job missing or outside workspace');
        if (owned.status === 'SUCCEEDED' || owned.status === 'CANCELED') return;
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, errorJson: Prisma.DbNull },
        });
        try {
          const result = await finishAutoMaterialBeat(app, data);
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: { status: 'SUCCEEDED', finishedAt: new Date(), outputJson: result as never },
          });
        } catch (error) {
          await prisma.providerJob.update({
            where: { id: data.jobId },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              errorJson: { message: redactSensitiveText((error as Error)?.message ?? 'material orchestration failed', 500) } as never,
            },
          });
          throw error;
        }
        return;
      }

      if (bullJob.name !== 'run-drop') throw new Error(`unknown orchestration job: ${bullJob.name}`);
      const data = bullJob.data as DropOrchestrationPayload;
      const input = dropBatchSchema.parse(data.input);
      const owned = await prisma.providerJob.findFirst({
        where: { id: data.jobId, workspaceId: data.workspaceId, projectId: data.projectId, kind: 'drop' },
        select: { id: true, status: true },
      });
      if (!owned) throw new Error('drop job missing or outside workspace');
      if (owned.status === 'SUCCEEDED' || owned.status === 'CANCELED') return;

      await prisma.providerJob.update({
        where: { id: data.jobId },
        data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, errorJson: Prisma.DbNull },
      });

      try {
        await runDropPipeline(
          app,
          { app, workspaceId: data.workspaceId, userId: data.userId, projectId: data.projectId },
          input,
          data.jobId
        );
        if (data.albumId) {
          const done = await prisma.providerJob.findUnique({
            where: { id: data.jobId },
            select: { outputJson: true },
          });
          const songId = (done?.outputJson as { drop?: Array<{ songId?: string }> } | null)?.drop?.[0]?.songId;
          if (songId) {
            await prisma.song.updateMany({
              where: { id: songId, workspaceId: data.workspaceId },
              data: { albumId: data.albumId },
            });
          }
        }
      } catch (error) {
        await prisma.providerJob.update({
          where: { id: data.jobId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorJson: { message: redactSensitiveText((error as Error)?.message ?? 'drop pipeline failed', 500) } as never,
          },
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: Math.max(1, Math.min(4, Number(process.env.ORCHESTRATION_CONCURRENCY ?? 1) || 1)),
      lockDuration: 20 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    }
  );

  worker.on('failed', (job, error) => {
    app.log.error({ err: error, bullJobId: job?.id, providerJobId: job?.data?.jobId }, 'orchestration attempt failed');
  });
  worker.on('error', (error) => app.log.error({ err: error }, 'orchestration worker error'));
  await worker.waitUntilReady();

  app.addHook('onClose', async () => {
    await worker.close();
    await connection.quit();
  });
}
