import { getOpenAI, MODELS } from "../openai-client";
import type {
  ImageInput,
  ImageOutput,
  ImageProviderAdapter,
  ProviderJobResult,
} from "./types";

function provider(): string {
  return (process.env.IMAGE_PROVIDER ?? "openai").trim().toLowerCase();
}

class OpenAiImageAdapter implements ImageProviderAdapter {
  readonly name = "openai";

  async generate(input: ImageInput): Promise<ProviderJobResult<ImageOutput>> {
    const client = getOpenAI();
    const res = await client.images.generate({
      model: MODELS.image,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: 1,
    });
    const d = res.data?.[0];
    const [w, h] = input.size.split("x").map(Number) as [number, number];
    const costMap = { low: 0.006, medium: 0.053, high: 0.211 } as const;

    if (d?.b64_json) {
      return {
        status: "succeeded",
        output: { imageBase64: d.b64_json, width: w, height: h },
        estimatedCostUsd: costMap[input.quality],
      };
    }
    if (d?.url) {
      return {
        status: "succeeded",
        output: { imageUrl: d.url, width: w, height: h },
        estimatedCostUsd: costMap[input.quality],
      };
    }
    return { status: "failed", error: "no image returned" };
  }
}

class StubImageAdapter implements ImageProviderAdapter {
  readonly name = "stub";

  async generate(input: ImageInput): Promise<ProviderJobResult<ImageOutput>> {
    const [w, h] = input.size.split("x").map(Number) as [number, number];
    return {
      status: "succeeded",
      output: {
        imageUrl: `https://picsum.photos/seed/${Math.random().toString(36).slice(2)}/${w}/${h}`,
        width: w,
        height: h,
      },
      estimatedCostUsd: 0,
    };
  }
}

class UnavailableImageAdapter implements ImageProviderAdapter {
  readonly name = "unavailable";

  constructor(private readonly requested: string) {}

  async generate(): Promise<ProviderJobResult<ImageOutput>> {
    return {
      status: "failed",
      error: `unsupported or disabled image provider: ${this.requested || "unconfigured"}`,
    };
  }
}

export function imageAdapter(override?: string): ImageProviderAdapter {
  const selected = (override ?? provider()).trim().toLowerCase();
  switch (selected) {
    case "openai":
      return new OpenAiImageAdapter();
    case "stub":
      if (
        process.env.NODE_ENV === "production" ||
        process.env.ALLOW_STUB_AUDIO !== "1"
      ) {
        return new UnavailableImageAdapter("stub");
      }
      return new StubImageAdapter();
    default:
      return new UnavailableImageAdapter(selected);
  }
}
