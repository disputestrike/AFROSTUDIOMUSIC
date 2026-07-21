import { createSign } from "node:crypto";
import type {
  ProviderJobResult,
  VideoProviderAdapter,
  VideoRenderOutput,
  VideoShotInput,
} from "./types";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OPENAI_VIDEO_URL = "https://api.openai.com/v1/videos";
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

interface GoogleServiceAccount {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

interface GoogleAccessToken {
  token: string;
  clientEmail: string;
  expiresAt: number;
}

interface OpenAiVideo {
  id?: string;
  status?: "queued" | "in_progress" | "completed" | "failed";
  seconds?: string;
  error?: { message?: string };
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    videos?: Array<{
      bytesBase64Encoded?: string;
      gcsUri?: string;
      mimeType?: string;
    }>;
    raiMediaFilteredCount?: number;
  };
}

let googleToken: GoogleAccessToken | null = null;

function selectedProvider(): string {
  return (process.env.VIDEO_PROVIDER ?? "unavailable").trim().toLowerCase();
}

/**
 * The ENGINE INPUT BUILDER: fold a shot's motion/lighting and — critically —
 * its negative ("Avoid: no rain.") into the single prompt string the model
 * actually receives. Exported (as composeVideoEnginePrompt) so the negativePrompt
 * wiring can be asserted directly: a scene edit's negative MUST reach the engine.
 */
export function promptFor(input: VideoShotInput): string {
  return [
    input.prompt.trim(),
    input.motion ? `Camera motion: ${input.motion.trim()}.` : "",
    input.lighting ? `Lighting: ${input.lighting.trim()}.` : "",
    input.negativePrompt ? `Avoid: ${input.negativePrompt.trim()}.` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8_000);
}

export { promptFor as composeVideoEnginePrompt };

function supportedDuration(
  requested: number,
  allowed: readonly number[]
): number {
  const target = Math.max(1, Math.round(requested));
  return (
    allowed.find(seconds => seconds >= target) ?? allowed[allowed.length - 1]!
  );
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function serviceAccount(): GoogleServiceAccount {
  const encoded = process.env.GCP_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (!encoded) throw new Error("GCP_SERVICE_ACCOUNT_JSON_B64 missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON_B64 is invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("GCP service account is invalid");
  }
  const account = parsed as GoogleServiceAccount;
  if (!account.client_email || !account.private_key) {
    throw new Error("GCP service account email/private key missing");
  }
  return account;
}

function veoConfig() {
  const account = serviceAccount();
  const project = (
    process.env.GCP_PROJECT_ID ??
    account.project_id ??
    ""
  ).trim();
  const location = (process.env.GCP_LOCATION ?? "us-central1").trim();
  const model = (process.env.VEO_MODEL ?? "veo-3.1-fast-generate-001").trim();
  const resolution = (process.env.VEO_RESOLUTION ?? "720p").trim();

  if (!/^[a-z][a-z0-9-]{4,62}$/.test(project))
    throw new Error("GCP_PROJECT_ID is invalid");
  if (!/^[a-z0-9-]{2,30}$/.test(location))
    throw new Error("GCP_LOCATION is invalid");
  if (!/^veo-[a-z0-9.-]+$/.test(model)) throw new Error("VEO_MODEL is invalid");
  if (!["720p", "1080p"].includes(resolution))
    throw new Error("VEO_RESOLUTION is invalid");

  const modelPath = `projects/${project}/locations/${location}/publishers/google/models/${model}`;
  const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/${modelPath}`;
  return { account, modelPath, baseUrl, resolution };
}

async function googleAccessToken(
  account: GoogleServiceAccount
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (
    googleToken &&
    googleToken.clientEmail === account.client_email &&
    googleToken.expiresAt > now + 60
  ) {
    return googleToken.token;
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3_600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key!))}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok)
    throw new Error(`Google OAuth returned HTTP ${response.status}`);
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token)
    throw new Error("Google OAuth returned no access token");

  googleToken = {
    token: data.access_token,
    clientEmail: account.client_email!,
    expiresAt: now + Math.max(300, Number(data.expires_in ?? 3_600)),
  };
  return data.access_token;
}

function decodeVideo(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  const unpadded = compact.replace(/=+$/, "");
  if (
    !compact ||
    compact.length > Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 4 ||
    compact.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new Error("video payload is invalid or too large");
  }
  const bytes = Buffer.from(compact, "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (
    !bytes.length ||
    bytes.length > MAX_VIDEO_BYTES ||
    canonical !== unpadded
  ) {
    throw new Error("video payload is invalid or too large");
  }
  return bytes;
}

async function readVideoBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok)
    throw new Error("video content returned HTTP " + response.status);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
    throw new Error("video content is too large");
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("video/") &&
    !contentType.includes("octet-stream")
  ) {
    throw new Error("video content type is invalid");
  }
  if (!response.body) throw new Error("video content is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > MAX_VIDEO_BYTES) {
        await reader.cancel("video content is too large");
        throw new Error("video content is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("video content is empty");

  const bytes = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function openAiCompleted(
  video: OpenAiVideo,
  key: string,
  input?: VideoShotInput
): Promise<ProviderJobResult<VideoRenderOutput>> {
  if (!video.id)
    return { status: "failed", error: "OpenAI video response has no job ID" };
  const content = await fetch(
    `${OPENAI_VIDEO_URL}/${encodeURIComponent(video.id)}/content`,
    {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${key}` },
    }
  );
  const videoBytes = await readVideoBytes(content);
  return {
    externalId: video.id,
    status: "succeeded",
    output: {
      videoBytes,
      durationS:
        Number(video.seconds) ||
        supportedDuration(input?.durationS ?? 4, [4, 8, 12]),
      format: "mp4",
    },
  };
}

function openAiPending(
  video: OpenAiVideo
): ProviderJobResult<VideoRenderOutput> {
  if (!video.id)
    return { status: "failed", error: "OpenAI video response has no job ID" };
  if (video.status === "failed") {
    return {
      externalId: video.id,
      status: "failed",
      error:
        video.error?.message?.slice(0, 300) || "OpenAI video generation failed",
    };
  }
  if (
    video.status !== "queued" &&
    video.status !== "in_progress" &&
    video.status !== "completed"
  ) {
    return {
      externalId: video.id,
      status: "failed",
      error: "OpenAI video returned an unknown status",
    };
  }
  return { externalId: video.id, status: "running", pollAfterMs: 10_000 };
}

class VeoAdapter implements VideoProviderAdapter {
  readonly name = "veo";

  async renderShot(
    input: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    try {
      const config = veoConfig();
      const token = await googleAccessToken(config.account);
      const durationSeconds = supportedDuration(input.durationS, [4, 6, 8]);
      const response = await fetch(`${config.baseUrl}:predictLongRunning`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          instances: [{ prompt: promptFor(input) }],
          parameters: {
            aspectRatio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
            durationSeconds,
            negativePrompt: input.negativePrompt?.trim() || undefined,
            personGeneration:
              process.env.VEO_PERSON_GENERATION ?? "allow_adult",
            resolution: config.resolution,
            sampleCount: 1,
          },
        }),
      });
      if (!response.ok)
        return {
          status: "failed",
          error: `Veo returned HTTP ${response.status}`,
        };
      const operation = (await response.json()) as VeoOperation;
      if (
        !operation.name ||
        !operation.name.startsWith(`${config.modelPath}/operations/`)
      ) {
        return {
          status: "failed",
          error: "Veo returned an invalid operation name",
        };
      }
      return {
        externalId: operation.name,
        status: "running",
        pollAfterMs: 10_000,
      };
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  async poll(
    externalId: string,
    input?: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    try {
      const config = veoConfig();
      if (!externalId.startsWith(`${config.modelPath}/operations/`)) {
        return {
          externalId,
          status: "failed",
          error: "Veo operation does not match configured model",
        };
      }
      const token = await googleAccessToken(config.account);
      const response = await fetch(`${config.baseUrl}:fetchPredictOperation`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ operationName: externalId }),
      });
      if (!response.ok) {
        return {
          externalId,
          status: "failed",
          error: `Veo poll returned HTTP ${response.status}`,
        };
      }
      const operation = (await response.json()) as VeoOperation;
      if (!operation.done)
        return { externalId, status: "running", pollAfterMs: 10_000 };
      if (operation.error) {
        return {
          externalId,
          status: "failed",
          error:
            operation.error.message?.slice(0, 300) || "Veo generation failed",
        };
      }
      const video = operation.response?.videos?.[0];
      if (!video?.bytesBase64Encoded) {
        const filtered = Number(operation.response?.raiMediaFilteredCount ?? 0);
        return {
          externalId,
          status: "failed",
          error:
            filtered > 0
              ? "Veo filtered the requested video under its media policy"
              : "Veo returned no inline video bytes",
        };
      }
      return {
        externalId,
        status: "succeeded",
        output: {
          videoBytes: decodeVideo(video.bytesBase64Encoded),
          durationS: supportedDuration(input?.durationS ?? 4, [4, 6, 8]),
          format: "mp4",
        },
      };
    } catch (error) {
      return { externalId, status: "failed", error: (error as Error).message };
    }
  }
}

class SoraAdapter implements VideoProviderAdapter {
  readonly name = "sora";

  async renderShot(
    input: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return { status: "failed", error: "OPENAI_API_KEY missing" };

    try {
      const seconds = supportedDuration(input.durationS, [4, 8, 12]);
      const form = new FormData();
      form.set("model", process.env.OPENAI_VIDEO_MODEL ?? "sora-2");
      form.set("prompt", promptFor(input));
      form.set("seconds", String(seconds));
      form.set("size", input.aspectRatio === "9:16" ? "720x1280" : "1280x720");

      const response = await fetch(OPENAI_VIDEO_URL, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      if (!response.ok) {
        return {
          status: "failed",
          error: `OpenAI video returned HTTP ${response.status}`,
        };
      }
      const video = (await response.json()) as OpenAiVideo;
      if (video.status === "completed")
        return await openAiCompleted(video, key, input);
      return openAiPending(video);
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  async poll(
    externalId: string,
    input?: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key)
      return { externalId, status: "failed", error: "OPENAI_API_KEY missing" };
    if (!/^video_[A-Za-z0-9_-]+$/.test(externalId)) {
      return {
        externalId,
        status: "failed",
        error: "OpenAI video job ID is invalid",
      };
    }

    try {
      const response = await fetch(
        `${OPENAI_VIDEO_URL}/${encodeURIComponent(externalId)}`,
        {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { authorization: `Bearer ${key}` },
        }
      );
      if (!response.ok) {
        return {
          externalId,
          status: "failed",
          error: `OpenAI video poll returned HTTP ${response.status}`,
        };
      }
      const video = (await response.json()) as OpenAiVideo;
      if (video.status === "completed")
        return await openAiCompleted(video, key, input);
      return openAiPending({ ...video, id: video.id ?? externalId });
    } catch (error) {
      return { externalId, status: "failed", error: (error as Error).message };
    }
  }
}

class StubVideoAdapter implements VideoProviderAdapter {
  readonly name = "stub";

  async renderShot(
    input: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    return {
      status: "succeeded",
      output: {
        videoUrl:
          "https://cdn.pixabay.com/video/2024/02/18/200854-915143046_large.mp4",
        durationS: input.durationS,
        format: "mp4",
      },
      estimatedCostUsd: 0,
    };
  }
}

class UnavailableVideoAdapter implements VideoProviderAdapter {
  readonly name: string;

  constructor(name: string) {
    this.name = name || "unavailable";
  }

  async renderShot(): Promise<ProviderJobResult<VideoRenderOutput>> {
    return {
      status: "failed",
      error: `unsupported video provider: ${this.name}`,
    };
  }
}

export function videoAdapter(): VideoProviderAdapter {
  const provider = selectedProvider();
  switch (provider) {
    case "veo":
      return new VeoAdapter();
    case "sora":
      return new SoraAdapter();
    case "stub":
      if (
        process.env.NODE_ENV === "production" ||
        process.env.ALLOW_STUB_AUDIO !== "1"
      ) {
        return new UnavailableVideoAdapter("stub");
      }
      return new StubVideoAdapter();
    default:
      return new UnavailableVideoAdapter(provider);
  }
}
