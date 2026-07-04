import { prisma } from '@afrohit/db';
import { analyzeAudio } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';

interface AnalyzePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  url: string;
}

/**
 * Listen to a reference track and understand it. Uses the workspace's music key
 * (in-app) or the worker's Replicate token. Result (the vibe profile) lands in
 * the job's outputJson for the client to read + create from.
 */
export async function processAnalyze(p: AnalyzePayload) {
  await markRunning(p.jobId);
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicApiKey: true },
    });
    const profile = await analyzeAudio(p.url, ws?.musicApiKey ?? undefined);
    await markSucceeded(p.jobId, { profile });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
