import { prisma } from '@afrohit/db';
import { isMixableVocal } from '@afrohit/shared';
import { markFailed, markRunning } from '../lib/jobs';
import { downloadToBuffer, deleteObjectByUrl } from '../lib/storage';
import { inspectIsolatedVocal } from '../lib/vocal-inspection';

interface VocalInspectPayload {
  jobId: string;
  workspaceId: string;
  vocalRenderId: string;
}

function objectMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function inspectAndPersist(workspaceId: string, vocalRenderId: string, successJobId?: string) {
  const vocal = await prisma.vocalRender.findFirst({
    where: { id: vocalRenderId, project: { workspaceId } },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!vocal) throw new Error('vocal_asset_not_found');
  if (vocal.assetKind !== 'isolated_vocal') throw new Error(`vocal_qc_refused_for_${vocal.assetKind}`);

  const meta = objectMeta(vocal.meta);
  const isolationConfirmed = meta.userAttestedIsolation === true
    || vocal.performanceSource === 'artist_upload'
    || vocal.performanceSource === 'artist_import'
    || vocal.performanceSource === 'voice_conversion'
    || vocal.performanceSource === 'stem_separation';
  const bytes = await downloadToBuffer(vocal.url, { maxBytes: 256 * 1024 * 1024 });
  const inspection = await inspectIsolatedVocal({ bytes, url: vocal.url, isolationConfirmed });
  const duplicate = inspection.qualityState === 'passed'
    ? await prisma.vocalRender.findFirst({
        where: {
          id: { not: vocal.id },
          project: { workspaceId },
          assetKind: 'isolated_vocal',
          qualityState: 'passed',
          contentHash: inspection.contentHash,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, url: true },
      })
    : null;

  const canonicalUrl = duplicate?.url ?? vocal.url;
  const approved = isMixableVocal({
    approved: inspection.qualityState === 'passed',
    assetKind: vocal.assetKind,
    qualityState: inspection.qualityState,
    contentHash: inspection.contentHash,
    verifiedAt: inspection.verifiedAt,
  });
  const updateData = {
      url: canonicalUrl,
      duration: inspection.durationS,
      qualityState: inspection.qualityState,
      contentHash: inspection.contentHash,
      verifiedAt: inspection.verifiedAt,
      approved,
      meta: {
        ...meta,
        userAttestedIsolation: isolationConfirmed,
        qc: inspection.qc,
        activeRatio: inspection.activeRatio,
        qcReasons: inspection.reasons,
        purgedAfterQcFailure: inspection.qualityState === 'failed',
        ...(duplicate ? { duplicateOf: duplicate.id } : {}),
      } as never,
  };
  const updated = approved && successJobId
    ? (await prisma.$transaction([
        prisma.vocalRender.update({ where: { id: vocal.id }, data: updateData }),
        prisma.providerJob.update({
          where: { id: successJobId },
          data: {
            status: 'SUCCEEDED',
            finishedAt: new Date(),
            outputJson: {
              vocalRenderId: vocal.id,
              songId: vocal.songId,
              url: canonicalUrl,
              durationS: inspection.durationS,
              contentHash: inspection.contentHash,
              qualityState: inspection.qualityState,
              duplicateOf: duplicate?.id ?? null,
            } as never,
          },
        }),
      ]))[0]
    : await prisma.vocalRender.update({ where: { id: vocal.id }, data: updateData });
  if (duplicate && duplicate.url !== vocal.url) {
    await deleteObjectByUrl(vocal.url).catch(() => undefined);
  } else if (inspection.qualityState === 'failed') {
    await deleteObjectByUrl(vocal.url).catch(() => undefined);
  }
  return { vocal: updated, inspection, duplicateOf: duplicate?.id ?? null };
}

export async function processVocalInspect(payload: VocalInspectPayload): Promise<void> {
  await markRunning(payload.jobId);
  try {
    const result = await inspectAndPersist(payload.workspaceId, payload.vocalRenderId, payload.jobId);
    if (!result.vocal.approved) {
      await markFailed(
        payload.jobId,
        new Error(`vocal_qc_failed: ${result.inspection.reasons.join(', ') || result.inspection.qualityState}`),
      );
      return;
    }
  } catch (error) {
    await markFailed(payload.jobId, error);
  }
}

/** Conservative deploy backfill. Old approved uploads are re-measured before
 * the mixer can use them; speech/full-mix rows remain permanently excluded. */
export async function processVocalQcBackfill(): Promise<void> {
  const pending = await prisma.vocalRender.findMany({
    where: {
      assetKind: 'isolated_vocal',
      qualityState: { in: ['pending', 'unmeasured'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true, project: { select: { workspaceId: true } } },
  });
  let passed = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const result = await inspectAndPersist(row.project.workspaceId, row.id);
      if (result.vocal.approved) passed += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[vocal-qc] backfill ${row.id} failed: ${(error as Error).message}`);
    }
  }
  console.log(`[vocal-qc] backfill checked=${pending.length} passed=${passed} failed=${failed}`);
}
