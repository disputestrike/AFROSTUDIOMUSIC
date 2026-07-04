/**
 * Video provider adapter.
 *
 * Production options:
 *   - veo   — Google Veo 3 via Vertex AI (recommended; predictable pricing)
 *   - sora  — OpenAI Sora Videos API (note: sora-2/sora-2-pro deprecated 2026-09-24;
 *             keep adapter swappable.)
 *   - stub  — placeholder MP4 for dev.
 *
 * Veo pricing (as of writing): $0.10/sec (Fast video-only) up to ~$0.40/sec.
 */
import type {
  ProviderJobResult,
  VideoProviderAdapter,
  VideoRenderOutput,
  VideoShotInput,
} from './types';

function provider(): string {
  return (process.env.VIDEO_PROVIDER ?? 'stub').toLowerCase();
}

class VeoAdapter implements VideoProviderAdapter {
  readonly name = 'veo';
  async renderShot(_input: VideoShotInput): Promise<ProviderJobResult<VideoRenderOutput>> {
    // Veo (Vertex AI) needs a service-account JWT → OAuth access-token exchange
    // that can only be built and tested with real GCP credentials. Rather than
    // silently "queue" and hang forever, fail fast and clearly. Use
    // VIDEO_PROVIDER=sora (implemented) or =stub until GCP is wired.
    return {
      status: 'failed',
      error:
        'Veo provider not yet implemented (needs GCP service-account OAuth). ' +
        'Set VIDEO_PROVIDER=sora or VIDEO_PROVIDER=stub.',
    };
  }
}

class SoraAdapter implements VideoProviderAdapter {
  readonly name = 'sora';
  async renderShot(input: VideoShotInput): Promise<ProviderJobResult<VideoRenderOutput>> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { status: 'failed', error: 'OPENAI_API_KEY missing' };
    // OpenAI Sora Videos API — endpoint shape from current docs.
    const res = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'sora-2',
        prompt: input.prompt,
        duration_seconds: input.durationS,
        aspect_ratio: input.aspectRatio,
        negative_prompt: input.negativePrompt,
      }),
    });
    if (!res.ok) return { status: 'failed', error: `sora ${res.status}` };
    const data = (await res.json()) as { id?: string; status?: string; url?: string };
    if (data.status === 'completed' && data.url) {
      return {
        externalId: data.id,
        status: 'succeeded',
        output: { videoUrl: data.url, durationS: input.durationS, format: 'mp4' },
      };
    }
    return { externalId: data.id, status: 'running', pollAfterMs: 10_000 };
  }
  async poll(externalId: string): Promise<ProviderJobResult<VideoRenderOutput>> {
    const key = process.env.OPENAI_API_KEY!;
    const res = await fetch(`https://api.openai.com/v1/videos/${externalId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { status: 'failed', error: `sora poll ${res.status}` };
    const data = (await res.json()) as { status: string; url?: string; duration_seconds?: number };
    if (data.status === 'completed' && data.url) {
      return {
        externalId,
        status: 'succeeded',
        output: { videoUrl: data.url, durationS: data.duration_seconds ?? 0, format: 'mp4' },
      };
    }
    if (data.status === 'failed') return { externalId, status: 'failed', error: 'sora failed' };
    return { externalId, status: 'running', pollAfterMs: 8_000 };
  }
}

class StubVideoAdapter implements VideoProviderAdapter {
  readonly name = 'stub';
  async renderShot(input: VideoShotInput): Promise<ProviderJobResult<VideoRenderOutput>> {
    return {
      status: 'succeeded',
      output: {
        videoUrl: 'https://cdn.pixabay.com/video/2024/02/18/200854-915143046_large.mp4',
        durationS: input.durationS,
        format: 'mp4',
      },
      estimatedCostUsd: 0,
    };
  }
}

export function videoAdapter(): VideoProviderAdapter {
  switch (provider()) {
    case 'veo':
      return new VeoAdapter();
    case 'sora':
      return new SoraAdapter();
    default:
      return new StubVideoAdapter();
  }
}
