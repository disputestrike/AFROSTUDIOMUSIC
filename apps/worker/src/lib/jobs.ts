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

/** §1.11 THE WALL, at the ONE chokepoint every job error flows through:
 *  errorJson reaches user screens (Create page, SongChat, catalog), so vendor
 *  and route names are scrubbed to class language here. The REAL reason is
 *  logged internally first — diagnosis never loses information. */
function wallSafe(message: string): string {
  return message
    .replace(/\bfal\b/gi, 'engine route')
    .replace(/suno|minimax|ace[-_ ]?step|replicate|eleven(labs)?|stable[_ ]?audio|musicgen|demucs|cerebras/gi, 'engine');
}

export async function markFailed(jobId: string, err: unknown) {
  const real = String((err as Error)?.message ?? err ?? '').trim() || 'unknown failure (no message)';
  console.warn(`[job ${jobId}] failed — internal reason: ${real.slice(0, 300)}`);
  await prisma.providerJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      errorJson: { message: wallSafe(real).slice(0, 800) } as never,
    },
  });
}
