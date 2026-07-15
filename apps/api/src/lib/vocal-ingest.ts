import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import type { VocalPerformanceSource } from '@afrohit/shared';
import { createQueuedProviderJob } from './queued-job';

interface VocalInspectionRegistration {
  vocal: {
    id: string;
    projectId: string;
    songId: string | null;
    voiceProfileId: string | null;
    role: string;
    url: string;
    duration: number | null;
    language: string | null;
    assetKind: string;
    performanceSource: string;
    qualityState: string;
    approved: boolean;
  };
  job: { jobId: string; replayed: boolean };
}

export async function registerVocalForInspection(opts: {
  app: FastifyInstance;
  workspaceId: string;
  projectId: string;
  songId: string;
  role: 'lead' | 'double' | 'ad-lib' | 'harmony';
  url: string;
  source: VocalPerformanceSource;
  language?: string | null;
  claimedDurationS?: number | null;
  sourceMeta?: Record<string, unknown>;
}): Promise<VocalInspectionRegistration> {
  const fingerprint = createHash('sha256')
    .update([opts.workspaceId, opts.projectId, opts.songId, opts.role, opts.url].join('|'))
    .digest('hex')
    .slice(0, 32);
  const idempotencyKey = `vocal-qc:${fingerprint}`;
  let vocal = await prisma.vocalRender.findFirst({
    where: {
      projectId: opts.projectId,
      songId: opts.songId,
      role: opts.role,
      url: opts.url,
      assetKind: 'isolated_vocal',
    },
  });
  if (!vocal) {
    vocal = await prisma.vocalRender.create({
      data: {
        projectId: opts.projectId,
        songId: opts.songId,
        role: opts.role,
        url: opts.url,
        duration: opts.claimedDurationS ?? null,
        language: opts.language ?? null,
        assetKind: 'isolated_vocal',
        performanceSource: opts.source,
        qualityState: 'pending',
        approved: false,
        meta: {
          ...opts.sourceMeta,
          userAttestedIsolation: true,
          claimedDurationS: opts.claimedDurationS ?? null,
        } as never,
      },
    });
  }
  const job = await createQueuedProviderJob({
    app: opts.app,
    queue: opts.app.queues.voice,
    jobName: 'inspect-vocal',
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    kind: 'vocal_qc',
    provider: 'internal',
    inputJson: { vocalRenderId: vocal.id, source: opts.source },
    idempotencyKey,
    payload: (jobId) => ({
      jobId,
      workspaceId: opts.workspaceId,
      vocalRenderId: vocal!.id,
    }),
  });
  return { vocal, job };
}
