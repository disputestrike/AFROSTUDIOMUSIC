import { imageAdapter } from '@afrohit/ai';
import { prisma } from '@afrohit/db';
import { inspectImageBytes } from '../lib/image-inspection';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, ingestRemoteFile, uploadBytes } from '../lib/storage';

interface ImagePayload {
  jobId: string;
  workspaceId: string;
  projectId?: string;
  brandKitId?: string;
  /** When set (POST /songs/:id/cover/generate), the finished cover is also
   *  stamped onto Song.coverUrl — workspace-scoped, so a stale/foreign id
   *  can never repaint another tenant's song. */
  songId?: string;
  prompt: string;
  size: '1024x1024' | '1024x1792' | '1792x1024';
  quality: 'low' | 'medium' | 'high';
  kind: 'cover' | 'social' | 'lyric_card' | 'logo' | 'promo';
}

export async function processImage(payload: ImagePayload): Promise<void> {
  await markRunning(payload.jobId);
  let storedUrl: string | null = null;
  try {
    let adapter = imageAdapter();
    let result = await adapter.generate({
      prompt: payload.prompt,
      size: payload.size,
      quality: payload.quality,
    });
    if ((result.status !== 'succeeded' || !result.output) && adapter.name !== 'stub') {
      if (process.env.ALLOW_STUB_AUDIO === '1') {
        adapter = imageAdapter('stub');
        result = await adapter.generate({
          prompt: payload.prompt,
          size: payload.size,
          quality: payload.quality,
        });
      } else {
        throw new Error('image_failed: ' + (result.error ?? 'no production image engine configured'));
      }
    }
    if (result.status !== 'succeeded' || !result.output) {
      throw new Error(result.error ?? 'image_failed');
    }

    if (result.output.imageBase64) {
      storedUrl = await uploadBytes({
        workspaceId: payload.workspaceId,
        kind: 'images/' + payload.kind,
        bytes: Buffer.from(result.output.imageBase64, 'base64'),
        contentType: 'image/png',
        ext: 'png',
      });
    } else if (result.output.imageUrl) {
      storedUrl = await ingestRemoteFile({
        workspaceId: payload.workspaceId,
        url: result.output.imageUrl,
        kind: 'images/' + payload.kind,
        ext: 'png',
        contentType: 'image/png',
      });
    } else {
      throw new Error('image provider returned neither URL nor bytes');
    }

    const bytes = await downloadToBuffer(storedUrl, { maxBytes: 50 * 1024 * 1024 });
    const inspected = await inspectImageBytes(bytes, payload.kind);
    const verifiedAt = new Date();
    const image = await prisma.$transaction(async (tx) => {
      const created = await tx.imageAsset.create({
        data: {
          projectId: payload.projectId,
          brandKitId: payload.brandKitId,
          kind: payload.kind,
          prompt: payload.prompt,
          url: storedUrl!,
          width: inspected.width,
          height: inspected.height,
          provider: adapter.name,
          qualityState: 'passed',
          contentHash: inspected.contentHash,
          verifiedAt,
          approved: false,
        },
      });
      if (payload.projectId) {
        await tx.song.updateMany({
          where: { projectId: payload.projectId, workspaceId: payload.workspaceId },
          data: { releaseReady: false },
        });
      }
      // PER-SONG COVER (identity wave): an AI cover generated FOR a song
      // becomes that song's cover the moment it is certified + stored.
      if (payload.songId && payload.kind === 'cover') {
        await tx.song.updateMany({
          where: { id: payload.songId, workspaceId: payload.workspaceId },
          data: { coverUrl: storedUrl! },
        });
      }
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          cost: result.estimatedCostUsd == null
            ? undefined
            : (result.estimatedCostUsd.toFixed(6) as never),
          outputJson: {
            imageId: created.id,
            url: created.url,
            width: created.width,
            height: created.height,
            qualityState: created.qualityState,
            contentHash: created.contentHash,
            approved: created.approved,
          } as never,
        },
      });
      return created;
    });
    storedUrl = null;
    void image;
  } catch (error) {
    if (storedUrl) await deleteObjectByUrl(storedUrl).catch(() => undefined);
    await markFailed(payload.jobId, error);
  }
}
