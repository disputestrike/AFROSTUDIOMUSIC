/**
 * LIKENESS TRAINING — Flux LoRA fine-tune of the artist's OWN face on
 * Replicate, mirroring the voice-training seam (apps/api lib/voice-training +
 * the Replicate trainings API):
 *
 *   POST /v1/models/{owner}/{name}/versions/{version}/trainings
 *     { destination: "user/model", input: { input_images, trigger_word, ... } }
 *   GET  /v1/trainings/{id}   → status + output { version | weights }
 *
 * Default trainer: replicate/fast-flux-trainer (Replicate's official fast Flux
 * LoRA trainer; ostris/flux-dev-lora-trainer works through the same shape —
 * set LIKENESS_TRAINER_MODEL/LIKENESS_TRAINER_VERSION to switch). Provider
 * cost is ~$2–5 per training run (GPU-time billed by Replicate) — the product
 * charges the `likeness_training` credit key on kickoff.
 *
 * Everything that builds a request body is a PURE exported function so the
 * exact JSON is unit-tested without spending a cent.
 */

import { replicateToken } from "./music";
import { isValidLikenessModelSlug } from "@afrohit/shared";

const REPLICATE_API = "https://api.replicate.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;

export interface LikenessTrainerConfig {
  /** Trainer slug "owner/name". */
  model: string;
  /** Optional pinned version hash; unpinned resolves latest at kickoff. */
  version?: string;
}

export function likenessTrainerConfig(
  env: Record<string, string | undefined> = process.env
): LikenessTrainerConfig {
  return {
    model: env.LIKENESS_TRAINER_MODEL?.trim() || "replicate/fast-flux-trainer",
    version: env.LIKENESS_TRAINER_VERSION?.trim() || undefined,
  };
}

export interface LikenessTrainingRequestInput {
  model: string;
  version: string;
  /** "user/model" in the operator's Replicate account — trained weights land there. Keep it private. */
  destination: string;
  /** Presigned URL of the zip of the artist's own photos. */
  inputImagesUrl: string;
  /** The token that summons this face in generation prompts (e.g. "BXP"). */
  triggerWord: string;
  steps?: number;
}

/** The EXACT trainings-API request — pure, unit-tested as literal JSON. */
export function likenessTrainingRequest(input: LikenessTrainingRequestInput): {
  url: string;
  body: Record<string, unknown>;
} {
  return {
    url: `${REPLICATE_API}/models/${input.model}/versions/${input.version}/trainings`,
    body: {
      destination: input.destination,
      input: {
        input_images: input.inputImagesUrl,
        trigger_word: input.triggerWord,
        lora_type: "subject",
        ...(input.steps ? { steps: input.steps } : {}),
      },
    },
  };
}

export interface LikenessTrainingState {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
}

/**
 * "owner/model:version" out of a finished training — the durable reference a
 * keyframe render runs against. fast-flux-trainer reports output.version as
 * "owner/model:hash"; some trainers report only { weights } (a file URL),
 * which is honored as-is. Null = no usable artifact → the run FAILED, no
 * matter what the provider's status claims.
 */
export function trainedModelRefFromOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const version = record.version;
  if (
    typeof version === "string" &&
    /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*:[A-Za-z0-9_-]{8,128}$/.test(
      version.trim()
    )
  ) {
    return version.trim();
  }
  const weights = record.weights;
  if (typeof weights === "string" && /^https?:\/\//i.test(weights.trim())) {
    return weights.trim();
  }
  return null;
}

export async function startLikenessTraining(opts: {
  config: LikenessTrainerConfig;
  destination: string;
  inputImagesUrl: string;
  triggerWord: string;
  apiKey?: string;
}): Promise<LikenessTrainingState> {
  const token = opts.apiKey || replicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN missing");

  let version = opts.config.version;
  if (!version) {
    const res = await fetch(`${REPLICATE_API}/models/${opts.config.model}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `likeness trainer lookup ${res.status}: ${(await res.text()).slice(0, 160)}`
      );
    }
    const data = (await res.json()) as { latest_version?: { id?: string } };
    version = data.latest_version?.id;
    if (!version) throw new Error("likeness trainer has no published version");
  }

  const request = likenessTrainingRequest({
    model: opts.config.model,
    version,
    destination: opts.destination,
    inputImagesUrl: opts.inputImagesUrl,
    triggerWord: opts.triggerWord,
  });
  const res = await fetch(request.url, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request.body),
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(
        `likeness training kickoff ${res.status}: ${(await res.text()).slice(0, 200)}`
      ),
      { statusCode: res.status }
    );
  }
  const data = (await res.json()) as LikenessTrainingState;
  if (!data.id) throw new Error("likeness training returned no id");
  return data;
}

export async function getLikenessTraining(
  trainingId: string,
  apiKey?: string
): Promise<LikenessTrainingState> {
  const token = apiKey || replicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN missing");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(trainingId)) {
    throw new Error("likeness training id is invalid");
  }
  const res = await fetch(`${REPLICATE_API}/trainings/${trainingId}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`likeness training poll ${res.status}`);
  return (await res.json()) as LikenessTrainingState;
}

export interface LikenessDestinationModel {
  owner?: string;
  name?: string;
  visibility?: string;
}

/** Fail closed if a provider destination is not exactly the requested private model. */
export function likenessDestinationModelIssue(
  destination: string,
  model: LikenessDestinationModel
): string | null {
  if (!isValidLikenessModelSlug(destination)) {
    return 'destination must be a valid "owner/model" slug';
  }
  const [owner, name] = destination.split("/");
  if (model.owner !== owner || model.name !== name) {
    return "provider returned a different destination model";
  }
  if (model.visibility !== "private") {
    return "likeness destination model must be private";
  }
  return null;
}

async function assertPrivateDestinationResponse(
  destination: string,
  response: Response
): Promise<void> {
  let model: LikenessDestinationModel;
  try {
    model = (await response.json()) as LikenessDestinationModel;
  } catch {
    throw new Error("likeness destination returned unreadable metadata");
  }
  const issue = likenessDestinationModelIssue(destination, model);
  if (issue) throw new Error(`unsafe likeness destination: ${issue}`);
}

/**
 * Ensure the destination model exists on Replicate (trainings refuse an
 * unknown destination). Idempotent: 409/already-exists is success. Private
 * visibility — a person's likeness model must never be public.
 */
export async function ensureDestinationModel(
  destination: string,
  apiKey?: string
): Promise<void> {
  const token = apiKey || replicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN missing");
  if (!isValidLikenessModelSlug(destination)) {
    throw new Error('destination must be a valid "owner/model" slug');
  }
  const [owner, name] = destination.split("/") as [string, string];

  const existing = await fetch(`${REPLICATE_API}/models/${destination}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (existing.ok) {
    await assertPrivateDestinationResponse(destination, existing);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`likeness destination lookup ${existing.status}`);
  }
  const created = await fetch(`${REPLICATE_API}/models`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      owner,
      name,
      visibility: "private",
      hardware: "cpu",
      description:
        "AfroHits Studio own-face likeness LoRA (user-attested-likeness)",
    }),
  });
  if (created.ok) {
    await assertPrivateDestinationResponse(destination, created);
    return;
  }
  if (created.status !== 409) {
    throw new Error(
      `likeness destination create ${created.status}: ${(await created.text()).slice(0, 160)}`
    );
  }

  // A concurrent request may have created it. Re-read and still enforce
  // private visibility instead of treating every conflict as safe.
  const raced = await fetch(`${REPLICATE_API}/models/${destination}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!raced.ok) {
    throw new Error(`likeness destination recheck ${raced.status}`);
  }
  await assertPrivateDestinationResponse(destination, raced);
}

// ---------------------------------------------------------------------------
// KEYFRAME generation from a trained likeness (the LoRA the artist trained).
// ---------------------------------------------------------------------------

export interface LikenessKeyframeInput {
  /** "owner/model:version" from training. */
  trainedModelRef: string;
  prompt: string;
  triggerWord: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
}

/** EXACT prediction body for a likeness keyframe — pure, unit-tested. The
 *  trigger word LEADS the prompt so the LoRA subject anchors the frame. */
export function likenessKeyframeRequest(input: LikenessKeyframeInput): {
  version: string;
  body: Record<string, unknown>;
} | null {
  const match = input.trainedModelRef.match(/^([^:]+):([A-Za-z0-9_-]{8,128})$/);
  if (!match) return null; // weights-URL refs can't run as a version — honest null
  return {
    version: match[2]!,
    body: {
      prompt: `${input.triggerWord}, ${input.prompt}`.slice(0, 4_000),
      aspect_ratio: input.aspectRatio,
      num_outputs: 1,
      output_format: "png",
      // Flux fine-tunes: lora_scale defaults are trainer-tuned; go_fast keeps
      // keyframes cheap (~$0.02-0.04 each on fast-flux).
      go_fast: true,
    },
  };
}

export interface LikenessKeyframeResult {
  status: "succeeded" | "failed";
  imageUrl?: string;
  externalId?: string;
  error?: string;
}

function firstImageUrl(output: unknown): string | null {
  if (typeof output === "string")
    return /^https?:\/\//i.test(output) ? output : null;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = firstImageUrl(item);
      if (url) return url;
    }
  }
  return null;
}

/** Run the trained LoRA once and wait (bounded) for the keyframe image. */
export async function generateLikenessKeyframe(
  input: LikenessKeyframeInput,
  opts: { apiKey?: string; maxPollAttempts?: number; pollDelayMs?: number } = {}
): Promise<LikenessKeyframeResult> {
  const token = opts.apiKey || replicateToken();
  if (!token) return { status: "failed", error: "REPLICATE_API_TOKEN missing" };
  const request = likenessKeyframeRequest(input);
  if (!request) {
    return {
      status: "failed",
      error: "trained likeness has no runnable model version",
    };
  }
  try {
    const res = await fetch(`${REPLICATE_API}/predictions`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: request.version, input: request.body }),
    });
    if (!res.ok) {
      return {
        status: "failed",
        error: `keyframe ${res.status}: ${(await res.text()).slice(0, 160)}`,
      };
    }
    let prediction = (await res.json()) as {
      id: string;
      status: string;
      output?: unknown;
      error?: string | null;
    };
    const maxAttempts = Math.max(1, opts.maxPollAttempts ?? 60);
    for (
      let attempt = 0;
      (prediction.status === "starting" ||
        prediction.status === "processing") &&
      attempt < maxAttempts;
      attempt++
    ) {
      await new Promise(resolve =>
        setTimeout(resolve, opts.pollDelayMs ?? 5_000)
      );
      const poll = await fetch(
        `${REPLICATE_API}/predictions/${prediction.id}`,
        {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { authorization: `Bearer ${token}` },
        }
      );
      if (!poll.ok) {
        return {
          status: "failed",
          externalId: prediction.id,
          error: `keyframe poll ${poll.status}`,
        };
      }
      prediction = (await poll.json()) as typeof prediction;
    }
    if (prediction.status !== "succeeded") {
      return {
        status: "failed",
        externalId: prediction.id,
        error:
          prediction.error?.slice(0, 200) ||
          (prediction.status === "processing" ||
          prediction.status === "starting"
            ? "keyframe generation timed out before completion"
            : `keyframe ${prediction.status}`),
      };
    }
    const imageUrl = firstImageUrl(prediction.output);
    if (!imageUrl) {
      return {
        status: "failed",
        externalId: prediction.id,
        error: "keyframe run returned no image URL",
      };
    }
    return { status: "succeeded", externalId: prediction.id, imageUrl };
  } catch (error) {
    return { status: "failed", error: (error as Error).message };
  }
}
