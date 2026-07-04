import { prisma, JobStatus } from '@afrohit/db';

export async function markRunning(jobId: string) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
}

export async function markSucceeded(jobId: string, output: unknown, cost?: number) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputJson: output as never,
      cost: cost == null ? undefined : (cost.toFixed(6) as unknown as never),
    },
  });
}

export async function markFailed(jobId: string, err: unknown) {
  await prisma.providerJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      errorJson: { message: String((err as Error)?.message ?? err) } as never,
    },
  });
}
