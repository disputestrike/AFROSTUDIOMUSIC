/**
 * VIDEO ENGINE TIERS — three Replicate-backed adapters behind the engine-class
 * wall (ADDENDUM §1.11 applied to video):
 *
 *   'draft'    → Wan 2.1 480p (t2v + a separate i2v deployment) or LTX-Video —
 *                open models, cheapest per second, for iteration.
 *   'standard' → MiniMax Hailuo video-01 (the DEFAULT) — t2v and i2v via
 *                first_frame_image on the same model.
 *   'flagship' → Kling v2.1 — t2v and i2v (start_image), 5s/10s.
 *
 * User surfaces speak CLASS language only; the slugs here are internal
 * operator config (env-overridable). All three follow the repo's Replicate
 * law from music.ts: these are community/official models reached through the
 * VERSIONED /v1/predictions endpoint — resolve the version via
 * GET /v1/models/{slug} unless an env pin is set (the
 * /models/{owner}/{name}/predictions path 404s for community models).
 *
 * Cost honesty: no invented estimates. estimatedCostUsd is emitted only when
 * the operator configures {ENGINE}_COST_USD_PER_SECOND (consumed by the
 * worker's estimateVideoCostUsd); otherwise cost evidence is honestly
 * incomplete. Public list prices move too often to hardcode.
 */

import { replicateToken } from "./music";
import type {
  ProviderJobResult,
  VideoEngineCapabilities,
  VideoProviderAdapter,
  VideoRenderOutput,
  VideoShotInput,
} from "./types";

export type VideoEngineClass = "draft" | "standard" | "flagship";

const REPLICATE_API = "https://api.replicate.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface VideoEngineSpec {
  /** Internal adapter name (never shown on public surfaces). */
  name: string;
  engineClass: VideoEngineClass;
  /** Text-to-video model slug ("owner/name"). */
  t2vModel: string;
  /** Image-to-video slug; null = the engine genuinely cannot do i2v. */
  i2vModel: string | null;
  /** Env var holding an optional version pin for t2v / i2v. */
  t2vVersionEnv: string;
  i2vVersionEnv: string;
  /** Durations (seconds) the model actually renders — requests snap UP to the
   *  nearest supported value (never a silent truncation downward). */
  allowedDurations: readonly number[];
}

/**
 * Resolve the engine spec for a class from env (pure — unit-tested). Defaults:
 *   draft    wan-video 480p t2v/i2v (swap to lightricks/ltx-video via env)
 *   standard minimax/video-01 (Hailuo)
 *   flagship kwaivgi/kling-v2.1
 */
export function videoEngineSpec(
  engineClass: VideoEngineClass,
  env: Record<string, string | undefined> = process.env
): VideoEngineSpec {
  switch (engineClass) {
    case "draft":
      return {
        name: "wan",
        engineClass,
        t2vModel:
          env.REPLICATE_VIDEO_DRAFT_MODEL?.trim() ||
          "wavespeedai/wan-2.1-t2v-480p",
        i2vModel:
          env.REPLICATE_VIDEO_DRAFT_I2V_MODEL === ""
            ? null
            : env.REPLICATE_VIDEO_DRAFT_I2V_MODEL?.trim() ||
              "wavespeedai/wan-2.1-i2v-480p",
        t2vVersionEnv: "REPLICATE_VIDEO_DRAFT_VERSION",
        i2vVersionEnv: "REPLICATE_VIDEO_DRAFT_I2V_VERSION",
        allowedDurations: [5],
      };
    case "flagship":
      return {
        name: "kling",
        engineClass,
        t2vModel:
          env.REPLICATE_VIDEO_FLAGSHIP_MODEL?.trim() || "kwaivgi/kling-v2.1",
        i2vModel:
          env.REPLICATE_VIDEO_FLAGSHIP_I2V_MODEL === ""
            ? null
            : env.REPLICATE_VIDEO_FLAGSHIP_I2V_MODEL?.trim() ||
              env.REPLICATE_VIDEO_FLAGSHIP_MODEL?.trim() ||
              "kwaivgi/kling-v2.1",
        t2vVersionEnv: "REPLICATE_VIDEO_FLAGSHIP_VERSION",
        i2vVersionEnv: "REPLICATE_VIDEO_FLAGSHIP_I2V_VERSION",
        allowedDurations: [5, 10],
      };
    case "standard":
    default:
      return {
        name: "hailuo",
        engineClass: "standard",
        t2vModel:
          env.REPLICATE_VIDEO_STANDARD_MODEL?.trim() || "minimax/video-01",
        i2vModel:
          env.REPLICATE_VIDEO_STANDARD_I2V_MODEL === ""
            ? null
            : env.REPLICATE_VIDEO_STANDARD_I2V_MODEL?.trim() ||
              env.REPLICATE_VIDEO_STANDARD_MODEL?.trim() ||
              "minimax/video-01",
        t2vVersionEnv: "REPLICATE_VIDEO_STANDARD_VERSION",
        i2vVersionEnv: "REPLICATE_VIDEO_STANDARD_I2V_VERSION",
        allowedDurations: [6],
      };
  }
}

export function videoEngineCapabilities(
  spec: VideoEngineSpec
): VideoEngineCapabilities {
  return { textToVideo: true, imageToVideo: spec.i2vModel !== null };
}

/** Snap a requested duration UP to the nearest supported value. */
export function snapDuration(
  requested: number,
  allowed: readonly number[]
): number {
  const target = Math.max(1, Math.round(requested));
  return (
    allowed.find(seconds => seconds >= target) ?? allowed[allowed.length - 1]!
  );
}

function composedPrompt(input: VideoShotInput): string {
  return [
    input.prompt.trim(),
    input.motion ? `Camera motion: ${input.motion.trim()}.` : "",
    input.lighting ? `Lighting: ${input.lighting.trim()}.` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6_000);
}

/**
 * The EXACT model input body per engine family — pure and unit-tested against
 * literal JSON so a payload drift is a failing test, not a burned render.
 * Returns the slug that must serve the request (i2v models are separate
 * deployments for Wan) or an honest error when the engine cannot honor it.
 */
export function videoModelInput(
  spec: VideoEngineSpec,
  input: VideoShotInput
): { slug: string; body: Record<string, unknown> } | { error: string } {
  const wantsKeyframe = !!input.keyframeUrl;
  if (wantsKeyframe && !spec.i2vModel) {
    return {
      error: `the ${spec.engineClass} engine cannot start from a keyframe image`,
    };
  }
  const slug = wantsKeyframe ? spec.i2vModel! : spec.t2vModel;
  const prompt = composedPrompt(input);
  const durationS = snapDuration(input.durationS, spec.allowedDurations);

  switch (spec.name) {
    case "wan": {
      // Wan 2.1 (wavespeedai deployments): 16 fps, 81 frames ≈ 5s. The i2v
      // deployment takes the conditioning frame as `image`.
      const body: Record<string, unknown> = {
        prompt,
        negative_prompt: input.negativePrompt?.trim() || undefined,
        aspect_ratio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
        num_frames: 81,
        frames_per_second: 16,
        fast_mode: "Balanced",
      };
      if (wantsKeyframe) body.image = input.keyframeUrl;
      return { slug, body: prune(body) };
    }
    case "hailuo": {
      // MiniMax video-01 (Hailuo): fixed ~6s; i2v via first_frame_image on the
      // SAME model. No duration/aspect inputs — the model decides.
      const body: Record<string, unknown> = {
        prompt,
        prompt_optimizer: true,
      };
      if (wantsKeyframe) body.first_frame_image = input.keyframeUrl;
      return { slug, body: prune(body) };
    }
    case "kling": {
      // Kling v2.1: duration 5|10, i2v via start_image; aspect_ratio applies
      // to t2v only (i2v inherits the start image's framing).
      const body: Record<string, unknown> = {
        prompt,
        negative_prompt: input.negativePrompt?.trim() || undefined,
        duration: durationS,
        mode: "standard",
      };
      if (wantsKeyframe) body.start_image = input.keyframeUrl;
      else
        body.aspect_ratio =
          input.aspectRatio === "9:16"
            ? "9:16"
            : input.aspectRatio === "1:1"
              ? "1:1"
              : "16:9";
      return { slug, body: prune(body) };
    }
    default:
      return { error: `unknown video engine spec: ${spec.name}` };
  }
}

function prune(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  logs?: string | null;
}

/** ENGINE-REPORTED progress only: the LAST "NN%" the engine printed in its
 *  logs. Returns null when the engine says nothing — the meter law forbids a
 *  fabricated percent, so null means "honest indeterminate motion". */
export function progressFromLogs(logs: unknown): number | null {
  if (typeof logs !== "string" || !logs) return null;
  const matches = logs.match(/(\d{1,3})\s*%/g);
  if (!matches?.length) return null;
  const last = Number.parseInt(matches[matches.length - 1]!, 10);
  return Number.isFinite(last) && last >= 0 && last <= 100 ? last : null;
}

/** First fetchable video URL out of Replicate's output shapes
 *  (string | string[] | {video|url|output}). */
export function predictionVideoUrl(output: unknown): string | null {
  if (typeof output === "string") {
    return /^https?:\/\//i.test(output) ? output : null;
  }
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = predictionVideoUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["video", "url", "output"]) {
      const url = predictionVideoUrl(record[key]);
      if (url) return url;
    }
  }
  return null;
}

async function resolveModelVersion(
  slug: string,
  pinned: string | undefined,
  token: string
): Promise<{ version: string } | { error: string }> {
  if (pinned?.trim()) return { version: pinned.trim() };
  // Community-model law: resolve the current version, then POST the versioned
  // /predictions endpoint (see music.ts — the model-scoped predictions path is
  // official-only and 404s for community deployments).
  const res = await fetch(`${REPLICATE_API}/models/${slug}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return {
      error: `video model lookup ${res.status}: ${(await res.text()).slice(0, 160)}`,
    };
  }
  const data = (await res.json()) as { latest_version?: { id?: string } };
  if (!data.latest_version?.id) {
    return { error: `video model ${slug} has no published version` };
  }
  return { version: data.latest_version.id };
}

export class ReplicateVideoAdapter implements VideoProviderAdapter {
  readonly name: string;
  readonly capabilities: VideoEngineCapabilities;

  constructor(
    private readonly spec: VideoEngineSpec,
    private readonly apiKey?: string
  ) {
    this.name = spec.name;
    this.capabilities = videoEngineCapabilities(spec);
  }

  get engineClass(): VideoEngineClass {
    return this.spec.engineClass;
  }

  async renderShot(
    input: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token) return { status: "failed", error: "REPLICATE_API_TOKEN missing" };

    const request = videoModelInput(this.spec, input);
    if ("error" in request) return { status: "failed", error: request.error };

    try {
      const pin = input.keyframeUrl
        ? process.env[this.spec.i2vVersionEnv]
        : process.env[this.spec.t2vVersionEnv];
      const resolved = await resolveModelVersion(request.slug, pin, token);
      if ("error" in resolved) return { status: "failed", error: resolved.error };

      const res = await fetch(`${REPLICATE_API}/predictions`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ version: resolved.version, input: request.body }),
      });
      if (!res.ok) {
        return {
          status: "failed",
          error: `video engine ${res.status}: ${(await res.text()).slice(0, 200)}`,
        };
      }
      return this.toResult((await res.json()) as ReplicatePrediction, input);
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  async poll(
    externalId: string,
    input?: VideoShotInput
  ): Promise<ProviderJobResult<VideoRenderOutput>> {
    const token = this.apiKey || replicateToken();
    if (!token)
      return { externalId, status: "failed", error: "REPLICATE_API_TOKEN missing" };
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(externalId)) {
      return { externalId, status: "failed", error: "video job ID is invalid" };
    }
    try {
      const res = await fetch(`${REPLICATE_API}/predictions/${externalId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return {
          externalId,
          status: "failed",
          error: `video engine poll ${res.status}`,
        };
      }
      return this.toResult((await res.json()) as ReplicatePrediction, input);
    } catch (error) {
      return { externalId, status: "failed", error: (error as Error).message };
    }
  }

  private toResult(
    data: ReplicatePrediction,
    input?: VideoShotInput
  ): ProviderJobResult<VideoRenderOutput> {
    if (data.status === "succeeded") {
      const url = predictionVideoUrl(data.output);
      if (!url) {
        return {
          externalId: data.id,
          status: "failed",
          error: "video engine returned no video URL",
        };
      }
      return {
        externalId: data.id,
        status: "succeeded",
        output: {
          videoUrl: url,
          durationS: snapDuration(
            input?.durationS ?? this.spec.allowedDurations[0]!,
            this.spec.allowedDurations
          ),
          format: "mp4",
        },
      };
    }
    if (data.status === "failed" || data.status === "canceled") {
      return {
        externalId: data.id,
        status: "failed",
        error: data.error?.slice(0, 300) || "video engine failed",
      };
    }
    const progressPct = progressFromLogs(data.logs);
    return {
      externalId: data.id,
      status: "running",
      pollAfterMs: 10_000,
      ...(progressPct != null ? { progressPct } : {}),
    };
  }
}

/**
 * The class → adapter factory. Requires a Replicate token (workspace key
 * override wins, matching the voices pattern); without one it returns null so
 * the worker can fall back to the legacy env-selected adapter (veo/sora) or
 * fail honestly — never a silent stub.
 */
export function videoAdapterForClass(
  engineClass: VideoEngineClass,
  apiKey?: string,
  env: Record<string, string | undefined> = process.env
): ReplicateVideoAdapter | null {
  const token = apiKey || env.REPLICATE_API_TOKEN || env.REPLICATE_TOKEN;
  if (!token) return null;
  return new ReplicateVideoAdapter(videoEngineSpec(engineClass, env), apiKey);
}
