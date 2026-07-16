import { Prisma, prisma } from '@afrohit/db';
import { assertStoredContentHash, certifyAudioBytes } from '../lib/certified-assets';
import { transformAudio } from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer } from '../lib/storage';
import {
  derivedMixLineageMeta,
  resolveCertifiedDerivedAudioSource,
  type CertifiedSourceAssetRef,
} from '../lib/derived-audio-lineage';

export interface TransformPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  sourceUrl: string;
  sourceAsset: CertifiedSourceAssetRef;
  tempo?: number;
  semitones?: number;
}

export async function processTransform(payload: TransformPayload): Promise<void> {
  await markRunning(payload.jobId);
  let storedUrl: string | null = null;
  try {
    const song = await prisma.song.findFirstOrThrow({
      where: {
        id: payload.songId,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
      },
    });
    void song;
    const resolvedSource = await resolveCertifiedDerivedAudioSource({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      source: payload.sourceAsset,
    });
    if (payload.sourceUrl !== resolvedSource.url) {
      throw new Error('transform_source_url_changed');
    }
    const source = await downloadToBuffer(resolvedSource.url);
    assertStoredContentHash(source, resolvedSource.contentHash, 'transform_source_audio');
    const output = await transformAudio(source, {
      tempo: payload.tempo,
      semitones: payload.semitones,
    });
    const certified = await certifyAudioBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: output,
    });
    storedUrl = certified.url;
    const label = [
      payload.tempo && Math.abs(payload.tempo - 1) > 0.001 ? String(payload.tempo) + 'x' : null,
      payload.semitones
        ? (payload.semitones > 0 ? '+' : '') + String(payload.semitones) + 'st'
        : null,
    ].filter(Boolean).join(' ') || 'copy';

    const lineageMeta = derivedMixLineageMeta({
      source: resolvedSource,
      outputContentHash: certified.contentHash,
      derivedAt: certified.verifiedAt,
      operation: { kind: 'transform', tempo: payload.tempo, semitones: payload.semitones },
      preservesSourceContributors: true,
    });
    const master = await prisma.$transaction(async (tx) => {
      const mix = await tx.mix.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId,
          preset: 'transform-source',
          url: certified.url,
          notes: 'Certified transformed mix source',
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            ...lineageMeta,
            transform: { tempo: payload.tempo, semitones: payload.semitones },
          } as never,
        },
      });
      const created = await tx.master.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId,
          mixId: mix.id,
          preset: 'transform ' + label,
          url: certified.url,
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            sourceMixId: mix.id,
            sourceContentHash: mix.contentHash,
            transform: { tempo: payload.tempo, semitones: payload.semitones },
          } as never,
        },
      });
      await tx.song.update({
        where: { id: payload.songId },
        data: {
          status: 'MASTERED',
          releaseReady: false,
          instrumentalUrl: null,
          acapellaUrl: null,
          instrumentalMeta: Prisma.DbNull,
        },
      });
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            masterId: created.id,
            mixId: mix.id,
            url: created.url,
            label,
            qualityState: created.qualityState,
            contentHash: created.contentHash,
          } as never,
        },
      });
      return created;
    });
    storedUrl = null;
    console.log('[transform] song ' + payload.songId + ': ' + label + ' (' + master.id + ')');
  } catch (error) {
    if (storedUrl) await deleteObjectByUrl(storedUrl).catch(() => undefined);
    await markFailed(payload.jobId, error);
  }
}
