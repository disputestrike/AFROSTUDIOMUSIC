import { Prisma, prisma } from '@afrohit/db';
import { assertStoredContentHash, certifyAudioBytes } from '../lib/certified-assets';
import {
  ffmpegAvailable,
  master as ffmpegMaster,
  MASTER_TARGETS,
  NATIVE_AUDIO_LIMITS,
} from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer } from '../lib/storage';

interface MasterPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  mixId?: string;
  preset: string;
  finished?: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isAttestedDirectUpload(meta: unknown): boolean {
  const direct = record(record(meta)?.directOwnedUpload);
  const rights = record(direct?.rightsConfirmation);
  return (
    direct?.schemaVersion === 1
    && (direct.sourceKind === 'workspace_upload' || direct.sourceKind === 'url_import')
    && rights?.version === 1
    && rights.confirmed === true
  );
}

export async function processMaster(payload: MasterPayload): Promise<void> {
  await markRunning(payload.jobId);
  const uploaded: string[] = [];
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host');
    }
    let mix = payload.mixId
      ? await prisma.mix.findFirstOrThrow({
          where: {
            id: payload.mixId,
            songId: payload.songId,
            projectId: payload.projectId,
            project: { workspaceId: payload.workspaceId },
          },
        })
      : await prisma.mix.findFirstOrThrow({
          where: {
            songId: payload.songId,
            projectId: payload.projectId,
            project: { workspaceId: payload.workspaceId },
            approved: true,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        });

    const sourceBytes = await downloadToBuffer(mix.url, {
      maxBytes: NATIVE_AUDIO_LIMITS.remoteInputMaxBytes,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    const sourceAlreadyCertified =
      mix.approved
      && mix.qualityState === 'passed'
      && typeof mix.contentHash === 'string'
      && /^[a-f0-9]{64}$/i.test(mix.contentHash)
      && !!mix.verifiedAt;
    if (sourceAlreadyCertified) {
      assertStoredContentHash(sourceBytes, mix.contentHash, 'master_source_mix');
    } else {
      if (
        !payload.finished
        || !['uploaded', 'imported'].includes(mix.preset)
        || !isAttestedDirectUpload(mix.meta)
      ) {
        throw new Error('master_source_mix_not_certified');
      }
      const certifiedSource = await certifyAudioBytes({
        workspaceId: payload.workspaceId,
        kind: 'mixes',
        bytes: sourceBytes,
      });
      uploaded.push(certifiedSource.url);
      const existingMeta = record(mix.meta) ?? {};
      const directOwnedUpload = record(existingMeta.directOwnedUpload) ?? {};
      mix = await prisma.mix.update({
        where: { id: mix.id },
        data: {
          url: certifiedSource.url,
          qualityState: certifiedSource.qualityState,
          contentHash: certifiedSource.contentHash,
          verifiedAt: certifiedSource.verifiedAt,
          approved: true,
          meta: {
            ...existingMeta,
            directOwnedUpload: {
              ...directOwnedUpload,
              sourceContentHash: certifiedSource.contentHash,
              certifiedAt: certifiedSource.verifiedAt.toISOString(),
            },
            qc: certifiedSource.qc,
            releaseLineageCertified: false,
          } as never,
        },
      });
      uploaded.splice(uploaded.indexOf(certifiedSource.url), 1);
    }
    const finished =
      payload.finished || mix.preset === 'uploaded' || mix.preset === 'imported';
    const rendered = await ffmpegMaster({
      mix: sourceBytes,
      preset: payload.preset,
      finished,
    });
    const certified = await certifyAudioBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: rendered.wav,
    });
    uploaded.push(certified.url);
    const certifiedMp3 = await certifyAudioBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: rendered.mp3,
      contentType: 'audio/mpeg',
      ext: 'mp3',
    });
    uploaded.push(certifiedMp3.url);

    const target = MASTER_TARGETS[payload.preset] ?? MASTER_TARGETS['streaming_lufs_-14']!;
    const master = await prisma.$transaction(async (tx) => {
      const created = await tx.master.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId,
          mixId: mix.id,
          preset: payload.preset,
          url: certified.url,
          loudness: certified.qc.integratedLufs ?? target.lufs,
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            sourceMixId: mix.id,
            sourceContentHash: mix.contentHash,
            releaseLineageCertified:
              record(mix.meta)?.releaseLineageCertified === true,
            deliveryMp3: {
              url: certifiedMp3.url,
              contentHash: certifiedMp3.contentHash,
              qualityState: certifiedMp3.qualityState,
              verifiedAt: certifiedMp3.verifiedAt.toISOString(),
              qc: certifiedMp3.qc,
            },
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
            wavUrl: certified.url,
            mp3Url: certifiedMp3.url,
            targetLufs: target.lufs,
            measuredLufs: certified.qc.integratedLufs,
            qualityState: certified.qualityState,
            contentHash: certified.contentHash,
          } as never,
        },
      });
      return created;
    });
    void master;
    uploaded.length = 0;
  } catch (error) {
    await Promise.allSettled(uploaded.map((url) => deleteObjectByUrl(url)));
    await markFailed(payload.jobId, error);
  }
}
