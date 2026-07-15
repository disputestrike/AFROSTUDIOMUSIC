import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { createQueuedProviderJob } from './queued-job';

interface BeatInspectionRegistration {
  beat: {
    id: string;
    projectId: string;
    songId: string | null;
    url: string;
    format: string;
    bpm: number | null;
    keySignature: string | null;
    duration: number | null;
    provider: string;
    assetKind: string;
    qualityState: string;
    approved: boolean;
  };
  job: { jobId: string; replayed: boolean };
}

/** Register an instrumental as pending, then let the worker hash and measure the
 * exact stored bytes. No upload/import becomes a mixer input on attestation alone. */
export async function registerBeatForInspection(opts: {
  app: FastifyInstance;
  workspaceId: string;
  projectId: string;
  songId: string;
  url: string;
  format: string;
  provider: string;
  bpm?: number | null;
  keySignature?: string | null;
  claimedDurationS?: number | null;
  sourceMeta?: Record<string, unknown>;
}): Promise<BeatInspectionRegistration> {
  const fingerprint = createHash('sha256')
    .update([opts.workspaceId, opts.projectId, opts.songId, opts.url].join('|'))
    .digest('hex')
    .slice(0, 32);
  const idempotencyKey = `beat-qc:${fingerprint}`;
  let beat = await prisma.beatAsset.findFirst({
    where: { projectId: opts.projectId, songId: opts.songId, url: opts.url, assetKind: 'instrumental' },
  });
  if (!beat) {
    beat = await prisma.beatAsset.create({
      data: {
        projectId: opts.projectId,
        songId: opts.songId,
        url: opts.url,
        format: opts.format,
        bpm: opts.bpm ?? null,
        keySignature: opts.keySignature ?? null,
        duration: opts.claimedDurationS ?? null,
        provider: opts.provider,
        assetKind: 'instrumental',
        qualityState: 'unmeasured',
        approved: false,
        meta: { ...opts.sourceMeta, claimedDurationS: opts.claimedDurationS ?? null } as never,
      },
    });
  }
  const job = await createQueuedProviderJob({
    app: opts.app,
    queue: opts.app.queues.music,
    jobName: 'inspect-beat',
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    kind: 'beat_qc',
    provider: 'internal',
    inputJson: { beatAssetId: beat.id, provider: opts.provider },
    idempotencyKey,
    payload: (jobId) => ({ jobId, workspaceId: opts.workspaceId, beatAssetId: beat!.id }),
  });
  return { beat, job };
}
