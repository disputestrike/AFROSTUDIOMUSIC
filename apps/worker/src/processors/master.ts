import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@afrohit/db';
import { certifyAudioBytes } from '../lib/certified-assets';
import { ffmpegAvailable, master as ffmpegMaster, MASTER_TARGETS } from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';

interface MasterPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  mixId?: string;
  preset: string;
  finished?: boolean;
}

export async function processMaster(payload: MasterPayload): Promise<void> {
  await markRunning(payload.jobId);
  const uploaded: string[] = [];
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host');
    }
    const mix = payload.mixId
      ? await prisma.mix.findFirstOrThrow({
          where: {
            id: payload.mixId,
            songId: payload.songId,
            projectId: payload.projectId,
            project: { workspaceId: payload.workspaceId },
            approved: true,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
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

    const sourceBytes = await downloadToBuffer(mix.url);
    const finished = payload.finished || mix.preset === 'uploaded';
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
    const mp3Url = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: rendered.mp3,
      contentType: 'audio/mpeg',
      ext: 'mp3',
    });
    uploaded.push(mp3Url);

    const target = MASTER_TARGETS[payload.preset] ?? MASTER_TARGETS['streaming_lufs_-14']!;
    const mp3Hash = createHash('sha256').update(rendered.mp3).digest('hex');
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
            deliveryMp3: { url: mp3Url, contentHash: mp3Hash },
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
            mp3Url,
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
