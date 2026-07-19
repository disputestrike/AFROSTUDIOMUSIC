import { prisma } from '@afrohit/db';
import { runTrainingFlywheel } from '../src/lib/training-flywheel';

async function latestTrainingReceipt() {
  const job = await prisma.providerJob.findFirst({
    where: { workspaceId: 'training', kind: 'music-training' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      externalId: true,
      inputJson: true,
      outputJson: true,
      errorJson: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!job) return null;
  const input = (job.inputJson ?? {}) as Record<string, unknown>;
  const output = (job.outputJson ?? {}) as Record<string, unknown>;
  const error = (job.errorJson ?? {}) as Record<string, unknown>;
  return {
    id: job.id,
    status: job.status,
    externalId: job.externalId,
    phase: output.phase ?? null,
    providerStatus: output.providerStatus ?? null,
    error:
      typeof error.message === 'string' ? error.message.slice(0, 300) : null,
    datasetHash: input.datasetHash ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function main() {
  const result = await runTrainingFlywheel();
  console.log(
    JSON.stringify({ result, latestTraining: await latestTrainingReceipt() })
  );
}

main()
  .catch(error => {
    console.error(
      JSON.stringify({
        ran: false,
        reason: (error as Error)?.message ?? 'training flywheel failed',
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
