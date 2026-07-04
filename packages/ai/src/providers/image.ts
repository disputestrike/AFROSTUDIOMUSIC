import { getOpenAI, MODELS } from '../openai-client';
import type {
  ImageInput,
  ImageOutput,
  ImageProviderAdapter,
  ProviderJobResult,
} from './types';

function provider(): string {
  return (process.env.IMAGE_PROVIDER ?? 'openai').toLowerCase();
}

class OpenAiImageAdapter implements ImageProviderAdapter {
  readonly name = 'openai';
  async generate(input: ImageInput): Promise<ProviderJobResult<ImageOutput>> {
    const client = getOpenAI();
    const res = await client.images.generate({
      model: MODELS.image,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: 1,
    });
    const url = res.data?.[0]?.url;
    if (!url) return { status: 'failed', error: 'no image returned' };
    const [w, h] = input.size.split('x').map(Number) as [number, number];
    const costMap = { low: 0.006, medium: 0.053, high: 0.211 } as const;
    return {
      status: 'succeeded',
      output: { imageUrl: url, width: w, height: h },
      estimatedCostUsd: costMap[input.quality],
    };
  }
}

class StubImageAdapter implements ImageProviderAdapter {
  readonly name = 'stub';
  async generate(input: ImageInput): Promise<ProviderJobResult<ImageOutput>> {
    const [w, h] = input.size.split('x').map(Number) as [number, number];
    return {
      status: 'succeeded',
      output: {
        imageUrl: `https://picsum.photos/seed/${Math.random().toString(36).slice(2)}/${w}/${h}`,
        width: w,
        height: h,
      },
      estimatedCostUsd: 0,
    };
  }
}

export function imageAdapter(): ImageProviderAdapter {
  return provider() === 'openai' ? new OpenAiImageAdapter() : new StubImageAdapter();
}
