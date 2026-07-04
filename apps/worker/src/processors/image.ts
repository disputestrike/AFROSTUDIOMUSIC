import { prisma } from '@afrohit/db';
import { imageAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile, uploadBytes } from '../lib/storage';

interface ImagePayload {
  jobId: string;
  workspaceId: string;
  projectId?: string;
  brandKitId?: string;
  prompt: string;
  size: '1024x1024' | '1024x1792' | '1792x1024';
  quality: 'low' | 'medium' | 'high';
  kind: 'cover' | 'social' | 'lyric_card' | 'logo' | 'promo';
}

export async function processImage(p: ImagePayload) {
  await markRunning(p.jobId);
  try {
    let adapter = imageAdapter();
    let result = await adapter.generate({ prompt: p.prompt, size: p.size, quality: p.quality });
    // Fallback to a marked placeholder image if the real provider fails.
    if ((result.status !== 'succeeded' || !result.output) && adapter.name !== 'stub') {
      const stub = imageAdapter('stub');
      result = await stub.generate({ prompt: p.prompt, size: p.size, quality: p.quality });
      adapter = stub;
    }
    if (result.status !== 'succeeded' || !result.output) {
      await markFailed(p.jobId, result.error ?? 'image_failed');
      return;
    }
    // gpt-image-1 → base64 (upload bytes directly); dall-e/stub → URL (re-host).
    let url: string;
    if (result.output.imageBase64) {
      url = await uploadBytes({
        workspaceId: p.workspaceId,
        kind: `images/${p.kind}`,
        bytes: Buffer.from(result.output.imageBase64, 'base64'),
        contentType: 'image/png',
        ext: 'png',
      });
    } else if (result.output.imageUrl) {
      url = await ingestRemoteFile({
        workspaceId: p.workspaceId,
        url: result.output.imageUrl,
        kind: `images/${p.kind}`,
        ext: 'png',
        contentType: 'image/png',
      });
    } else {
      await markFailed(p.jobId, 'image provider returned neither url nor base64');
      return;
    }
    await prisma.imageAsset.create({
      data: {
        projectId: p.projectId,
        brandKitId: p.brandKitId,
        kind: p.kind,
        prompt: p.prompt,
        url,
        width: result.output.width,
        height: result.output.height,
        provider: adapter.name,
      },
    });
    await markSucceeded(p.jobId, { url }, result.estimatedCostUsd);
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
