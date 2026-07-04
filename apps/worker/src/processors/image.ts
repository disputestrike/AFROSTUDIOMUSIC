import { prisma } from '@afrohit/db';
import { imageAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile } from '../lib/storage';

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
    const adapter = imageAdapter();
    const result = await adapter.generate({ prompt: p.prompt, size: p.size, quality: p.quality });
    if (result.status !== 'succeeded' || !result.output) {
      await markFailed(p.jobId, result.error ?? 'image_failed');
      return;
    }
    const url = await ingestRemoteFile({
      workspaceId: p.workspaceId,
      url: result.output.imageUrl,
      kind: `images/${p.kind}`,
      ext: 'png',
      contentType: 'image/png',
    });
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
