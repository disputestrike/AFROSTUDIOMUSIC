import { createHash } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { downloadToBuffer } from '../lib/storage';
import { measureAudioQuality } from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';

const objectMeta = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function inspectAndPersist(workspaceId: string, beatId: string, successJobId?: string) {
  const beat = await prisma.beatAsset.findFirst({
    where: { id: beatId, project: { workspaceId } },
    select: { id: true, url: true, assetKind: true, meta: true, songId: true },
  });
  if (!beat) throw new Error('beat_asset_not_found');
  if (beat.assetKind !== 'instrumental') throw new Error(`beat_qc_refused_for_${beat.assetKind}`);
  const bytes = await downloadToBuffer(beat.url, { maxBytes: 640 * 1024 * 1024 });
  const qc = await measureAudioQuality(beat.url);
  const qualityState = qc.verdict === 'pass' ? 'passed' : qc.verdict;
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const updateData = {
      qualityState,
      contentHash,
      verifiedAt: new Date(),
      approved: qualityState === 'passed',
      meta: {
        ...objectMeta(beat.meta),
        qc,
        qcInspection: { measuredAt: new Date().toISOString(), version: 1 },
      } as never,
  };
  const updated = qualityState === 'passed' && successJobId
    ? (await prisma.$transaction([
        prisma.beatAsset.update({ where: { id: beat.id }, data: updateData }),
        prisma.providerJob.update({
          where: { id: successJobId },
          data: {
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            outputJson: {
              beatId: beat.id,
              songId: beat.songId,
              url: beat.url,
              qualityState,
              contentHash,
              qc,
            } as never,
          },
        }),
      ]))[0]
    : await prisma.beatAsset.update({ where: { id: beat.id }, data: updateData });
  return { beat: updated, qc };
}

export async function processBeatInspect(payload: {
  jobId: string;
  workspaceId: string;
  beatAssetId: string;
}): Promise<void> {
  await markRunning(payload.jobId);
  try {
    const result = await inspectAndPersist(payload.workspaceId, payload.beatAssetId, payload.jobId);
    if (!result.beat.approved) {
      await markFailed(payload.jobId, `beat_qc_failed: ${result.qc.flags.join(', ') || result.qc.verdict}`);
      return;
    }
  } catch (error) {
    await markFailed(payload.jobId, error);
  }
}

/** Re-certify historical instrumentals before the strict mixer selector admits
 * them. Failed and unreadable rows stay in the audit trail but are deapproved. */
export async function processBeatQcBackfill(): Promise<void> {
  const pending = await prisma.beatAsset.findMany({
    where: {
      assetKind: 'instrumental',
      OR: [
        { qualityState: 'unmeasured' },
        { contentHash: null },
        { verifiedAt: null },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true, url: true, meta: true },
  });
  let passed = 0;
  let rejected = 0;
  for (const beat of pending) {
    try {
      const result = await inspectAndPersist(
        (await prisma.beatAsset.findUniqueOrThrow({
          where: { id: beat.id },
          select: { project: { select: { workspaceId: true } } },
        })).project.workspaceId,
        beat.id,
      );
      if (result.beat.approved) passed += 1;
      else rejected += 1;
    } catch (error) {
      rejected += 1;
      await prisma.beatAsset.update({
        where: { id: beat.id },
        data: {
          approved: false,
          qualityState: 'failed',
          verifiedAt: new Date(),
          meta: {
            ...objectMeta(beat.meta),
            qcBackfill: {
              measuredAt: new Date().toISOString(),
              version: 1,
              error: (error as Error).message.slice(0, 200),
            },
          } as never,
        },
      }).catch(() => undefined);
    }
  }
  console.log(`[beat-qc] backfill checked=${pending.length} passed=${passed} rejected=${rejected}`);
}
