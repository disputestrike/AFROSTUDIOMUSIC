import { prisma } from '@afrohit/db';
import { videoAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile } from '../lib/storage';

interface VideoPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  conceptId: string;
  shotIndex?: number;
  shots: Array<{ index?: number; prompt: string; duration_s: number; motion?: string; lighting?: string; negativePrompt?: string }>;
  format: 'vertical' | 'square' | 'landscape';
}

const ASPECT: Record<VideoPayload['format'], '9:16' | '1:1' | '16:9'> = {
  vertical: '9:16',
  square: '1:1',
  landscape: '16:9',
};

export async function processVideo(p: VideoPayload) {
  await markRunning(p.jobId);
  try {
    const adapter = videoAdapter();
    const shots = p.shotIndex == null ? p.shots : [p.shots[p.shotIndex]!];
    const results: Array<{ url: string; durationS: number }> = [];

    for (const shot of shots) {
      let r = await adapter.renderShot({
        prompt: shot.prompt,
        durationS: shot.duration_s,
        motion: shot.motion,
        lighting: shot.lighting,
        aspectRatio: ASPECT[p.format],
        negativePrompt: shot.negativePrompt,
      });
      let attempts = 0;
      while (r.status === 'queued' || r.status === 'running') {
        if (!adapter.poll || !r.externalId) break;
        await new Promise((res) => setTimeout(res, r.pollAfterMs ?? 8_000));
        attempts += 1;
        if (attempts > 30) break;
        r = await adapter.poll(r.externalId);
      }
      if (r.status !== 'succeeded' || !r.output) throw new Error(r.error ?? 'video_failed');
      const url = await ingestRemoteFile({
        workspaceId: p.workspaceId,
        url: r.output.videoUrl,
        kind: 'videos',
        ext: 'mp4',
        contentType: 'video/mp4',
      });
      results.push({ url, durationS: r.output.durationS });
      await prisma.videoRender.create({
        data: {
          projectId: p.projectId,
          conceptId: p.conceptId,
          url,
          durationS: r.output.durationS,
          provider: adapter.name,
          meta: { shotPrompt: shot.prompt, motion: shot.motion } as never,
        },
      });
    }

    await markSucceeded(p.jobId, { renders: results });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
