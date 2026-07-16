import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSecret, prisma } from "@afrohit/db";
import {
  generateLikenessKeyframe,
  videoAdapter,
  videoAdapterForClass,
  type VideoEngineClass,
  type VideoProviderAdapter,
  type VideoRenderOutput,
  type VideoShotInput,
} from "@afrohit/ai";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import {
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "../lib/storage";
import {
  estimateVideoCostUsd,
  inspectVideoBytes,
  type VideoInspection,
} from "../lib/video-inspection";

interface VideoShot {
  index?: number;
  prompt: string;
  duration_s: number;
  motion?: string;
  lighting?: string;
  negativePrompt?: string;
}

interface VideoPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  conceptId: string;
  shotIndex?: number;
  shots: VideoShot[];
  format: "vertical" | "square" | "landscape";
  /** Engine class (public wall): absent on legacy queued jobs → env adapter. */
  engineClass?: VideoEngineClass;
  /** Own-face likeness: keyframe-first (LoRA image) then image-to-video. */
  likeness?: {
    trainedModelRef: string;
    triggerWord: string;
    consentId: string;
    rightsBasis: "user-attested-likeness";
  };
}

interface VideoProgress {
  shotIndex: number;
  state: "submitted" | "succeeded";
  externalId?: string;
  url?: string;
  durationS?: number;
  contentHash?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  costUsd?: number;
  /** Keyframe provenance (likeness path): stored ref + provider run id. */
  keyframeRef?: string;
  keyframeExternalId?: string;
}

const ASPECT: Record<VideoPayload["format"], VideoShotInput["aspectRatio"]> = {
  vertical: "9:16",
  square: "1:1",
  landscape: "16:9",
};
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

function savedProgress(value: unknown): VideoProgress[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = (value as { videoProgress?: unknown }).videoProgress;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is VideoProgress => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const item = row as Partial<VideoProgress>;
    return (
      Number.isInteger(item.shotIndex) &&
      (item.state === "submitted" || item.state === "succeeded")
    );
  });
}

function shotInput(
  shot: VideoShot,
  format: VideoPayload["format"]
): VideoShotInput {
  return {
    prompt: shot.prompt,
    durationS: shot.duration_s,
    motion: shot.motion,
    lighting: shot.lighting,
    aspectRatio: ASPECT[format],
    negativePrompt: shot.negativePrompt,
  };
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `video crop failed (${code ?? "unknown"}): ${stderr.slice(-1_000)}`
          )
        );
    });
  });
}

async function cropSquare(bytes: Uint8Array): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "afrohit-video-"));
  const input = join(directory, "input.mp4");
  const output = join(directory, "square.mp4");
  try {
    await writeFile(input, bytes);
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "crop=min(iw\\,ih):min(iw\\,ih),scale=720:720:flags=lanczos",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output,
    ]);
    const cropped = await readFile(output);
    if (!cropped.length || cropped.length > MAX_VIDEO_BYTES) {
      throw new Error("cropped video is empty or too large");
    }
    return cropped;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function storeVideo(
  workspaceId: string,
  format: VideoPayload["format"],
  output: VideoRenderOutput,
  expectedDurationS: number
): Promise<{ url: string; inspection: VideoInspection }> {
  if (!output.videoBytes && !output.videoUrl) {
    throw new Error("video provider returned no media");
  }

  let bytes = output.videoBytes
    ? Buffer.from(output.videoBytes)
    : await downloadToBuffer(output.videoUrl!, {
        maxBytes: MAX_VIDEO_BYTES,
        timeoutMs: 10 * 60_000,
      });
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) {
    throw new Error("video provider returned empty or oversized media");
  }
  if (format === "square") bytes = await cropSquare(bytes);
  const inspection = await inspectVideoBytes(bytes, {
    format,
    expectedDurationS,
    maxBytes: MAX_VIDEO_BYTES,
  });
  const url = await uploadBytes({
    workspaceId,
    kind: "videos",
    bytes,
    ext: "mp4",
    contentType: "video/mp4",
  });
  return { url, inspection };
}
export async function processVideo(p: VideoPayload) {
  await markRunning(p.jobId);
  let knownCostUsd = 0;
  let hasCostEvidence = false;
  let costEvidenceComplete = true;
  try {
    // ENGINE SELECTION. Class-tagged payloads (draft|standard|flagship) route
    // to the Replicate-backed tier adapters; a workspace-pasted Replicate key
    // (Settings → Music engine) overrides env, matching the voices pattern.
    // No Replicate token → fall back to the legacy env adapter (veo/sora)
    // so existing installs keep their exact behavior; nothing configured →
    // honest failure. Legacy payloads (no engineClass) skip the tiers.
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const workspaceKey =
      ws?.musicProvider === "replicate"
        ? (openSecret(ws.musicApiKey) ?? undefined)
        : undefined;
    let adapter: VideoProviderAdapter | null = null;
    if (p.engineClass) {
      adapter = videoAdapterForClass(p.engineClass, workspaceKey);
    }
    adapter = adapter ?? videoAdapter();
    if (adapter.name === "stub" && process.env.ALLOW_STUB_AUDIO !== "1") {
      await markFailed(p.jobId, "video_failed: no video engine configured");
      return;
    }
    await prisma.providerJob.updateMany({
      where: { id: p.jobId, workspaceId: p.workspaceId },
      data: { provider: adapter.name },
    });
    const supportedEngines = ["veo", "sora", "stub", "wan", "hailuo", "kling"];
    if (!supportedEngines.includes(adapter.name)) {
      await markFailed(
        p.jobId,
        `video_failed: unsupported video engine ${adapter.name}`
      );
      return;
    }
    // CAPABILITY GATE — a likeness render is keyframe-first (image-to-video).
    // An engine that cannot condition on an image must refuse the job here,
    // not silently render a face-less video the user paid for.
    if (p.likeness && adapter.capabilities?.imageToVideo !== true) {
      await markFailed(
        p.jobId,
        `video_failed: the selected ${p.engineClass ?? "configured"} engine cannot start from a likeness keyframe — pick a class that supports it`
      );
      return;
    }

    const job = await prisma.providerJob.findUnique({
      where: { id: p.jobId },
      select: { outputJson: true },
    });
    const progress = savedProgress(job?.outputJson);
    const selected = p.shots
      .map((shot, shotIndex) => ({ shot, shotIndex }))
      .filter(
        ({ shotIndex }) => p.shotIndex == null || shotIndex === p.shotIndex
      );
    if (!selected.length) throw new Error("video shot selection is empty");

    const results: Array<{
      shotIndex: number;
      url: string;
      durationS: number;
      contentHash: string;
      sizeBytes: number;
      width: number;
      height: number;
      qualityState: "passed";
      /** Likeness path: the stored keyframe this shot was rendered from. */
      keyframeRef?: string | null;
    }> = [];

    const maxPollAttempts = Math.max(
      1,
      Math.min(180, Number(process.env.VIDEO_POLL_MAX_ATTEMPTS ?? 90) || 90)
    );

    const save = async (latestExternalId?: string) => {
      await prisma.providerJob.update({
        where: { id: p.jobId },
        data: {
          externalId: latestExternalId,
          outputJson: { videoProgress: progress } as never,
          cost: hasCostEvidence
            ? (knownCostUsd.toFixed(6) as never)
            : undefined,
        },
      });
    };

    for (const { shot, shotIndex } of selected) {
      const existing = progress.find(entry => entry.shotIndex === shotIndex);
      if (existing?.state === "succeeded" && existing.url) {
        let progressChanged = false;
        if (
          !existing.contentHash ||
          !existing.sizeBytes ||
          !existing.width ||
          !existing.height
        ) {
          const bytes = await downloadToBuffer(existing.url, {
            maxBytes: MAX_VIDEO_BYTES,
            timeoutMs: 10 * 60_000,
          });
          const inspection = await inspectVideoBytes(bytes, {
            format: p.format,
            expectedDurationS: shot.duration_s,
            maxBytes: MAX_VIDEO_BYTES,
          });
          existing.contentHash = inspection.contentHash;
          existing.sizeBytes = inspection.sizeBytes;
          existing.width = inspection.width;
          existing.height = inspection.height;
          existing.durationS = inspection.durationS;
          progressChanged = true;
        }
        const resumedCost =
          Number.isFinite(existing.costUsd) && existing.costUsd! >= 0
            ? existing.costUsd!
            : estimateVideoCostUsd(
                adapter.name,
                existing.durationS ?? shot.duration_s,
                undefined
              );
        if (resumedCost === null) costEvidenceComplete = false;
        else {
          existing.costUsd = resumedCost;
          knownCostUsd += resumedCost;
          hasCostEvidence = true;
          progressChanged = true;
        }
        if (progressChanged) await save(existing.externalId);
        results.push({
          shotIndex,
          url: existing.url,
          durationS: existing.durationS ?? shot.duration_s,
          contentHash: existing.contentHash,
          sizeBytes: existing.sizeBytes,
          width: existing.width,
          height: existing.height,
          qualityState: "passed",
          keyframeRef: existing.keyframeRef ?? null,
        });
        continue;
      }

      const input = shotInput(shot, p.format);

      // LIKENESS KEYFRAME (own-face path): generate the shot's first frame
      // from the artist's TRAINED model, store it in owned storage, then run
      // the engine image-to-video from it. Resumable — a stored keyframeRef
      // is reused on retry, never regenerated (and never re-billed).
      if (p.likeness) {
        let entry =
          existing ?? progress.find(item => item.shotIndex === shotIndex);
        if (!entry) {
          entry = { shotIndex, state: "submitted" };
          progress.push(entry);
        }
        if (!entry.keyframeRef) {
          const keyframe = await generateLikenessKeyframe(
            {
              trainedModelRef: p.likeness.trainedModelRef,
              prompt: shot.prompt,
              triggerWord: p.likeness.triggerWord,
              aspectRatio: input.aspectRatio,
            },
            { apiKey: workspaceKey }
          );
          if (keyframe.status !== "succeeded" || !keyframe.imageUrl) {
            throw new Error(
              `likeness keyframe failed: ${keyframe.error ?? "no image returned"}`
            );
          }
          const imageBytes = await downloadToBuffer(keyframe.imageUrl, {
            maxBytes: 30 * 1024 * 1024,
            timeoutMs: 120_000,
          });
          entry.keyframeRef = await uploadBytes({
            workspaceId: p.workspaceId,
            kind: "videos/keyframes",
            bytes: imageBytes,
            contentType: "image/png",
            ext: "png",
          });
          entry.keyframeExternalId = keyframe.externalId;
          await save(entry.externalId);
        }
        input.keyframeUrl = await resolveAssetForProvider(
          entry.keyframeRef,
          3600
        );
      }

      let render =
        existing?.externalId && adapter.poll
          ? await adapter.poll(existing.externalId, input)
          : await adapter.renderShot(input);

      let reportedCostUsd = render.estimatedCostUsd;
      if (render.externalId) {
        const entry = existing ?? { shotIndex, state: "submitted" as const };
        entry.state = "submitted";
        entry.externalId = render.externalId;
        if (!existing) progress.push(entry);
        await save(render.externalId);
      }

      let attempts = 0;
      while (render.status === "queued" || render.status === "running") {
        if (!adapter.poll || !render.externalId) {
          throw new Error("video provider cannot resume its queued job");
        }
        if (attempts >= maxPollAttempts) {
          throw new Error(
            "video provider timed out before confirmed completion"
          );
        }
        await new Promise(resolve =>
          setTimeout(resolve, render.pollAfterMs ?? 10_000)
        );
        attempts += 1;
        render = await adapter.poll(render.externalId, input);
        if (render.estimatedCostUsd != null) {
          reportedCostUsd = render.estimatedCostUsd;
        }
      }
      if (render.status !== "succeeded" || !render.output) {
        throw new Error(
          render.error ?? "video provider failed without a reason"
        );
      }

      let entry =
        existing ?? progress.find(item => item.shotIndex === shotIndex);
      if (!entry) {
        entry = { shotIndex, state: "submitted" };
        progress.push(entry);
      }
      entry.externalId = render.externalId ?? entry.externalId;
      const shotCost =
        Number.isFinite(entry.costUsd) && entry.costUsd! >= 0
          ? entry.costUsd!
          : estimateVideoCostUsd(
              adapter.name,
              Number.isFinite(render.output.durationS) &&
                render.output.durationS > 0
                ? render.output.durationS
                : shot.duration_s,
              reportedCostUsd
            );
      if (shotCost === null) costEvidenceComplete = false;
      else {
        entry.costUsd = shotCost;
        knownCostUsd += shotCost;
        hasCostEvidence = true;
      }
      await save(entry.externalId);
      const stored = await storeVideo(
        p.workspaceId,
        p.format,
        render.output,
        shot.duration_s
      );
      const renderId = `video_${createHash("sha256")
        .update(`${p.jobId}:${shotIndex}`)
        .digest("hex")
        .slice(0, 24)}`;
      const renderMeta = {
        shotIndex,
        shotPrompt: shot.prompt,
        motion: shot.motion,
        contentHash: stored.inspection.contentHash,
        sizeBytes: stored.inspection.sizeBytes,
        width: stored.inspection.width,
        height: stored.inspection.height,
        measuredDurationS: stored.inspection.durationS,
        codec: stored.inspection.codec,
        container: stored.inspection.container,
        qualityState: stored.inspection.qualityState,
        sourceAspectRatio:
          input.aspectRatio === "1:1" ? "16:9" : input.aspectRatio,
        outputAspectRatio: input.aspectRatio,
        // Class language for user surfaces; the provider column stays internal.
        engineClass: p.engineClass ?? null,
        // LIKENESS PROVENANCE — every likeness render says whose face, under
        // which consent, from which keyframe. Rights basis is the law.
        ...(p.likeness
          ? {
              likeness: {
                rightsBasis: p.likeness.rightsBasis,
                trainedModelRef: p.likeness.trainedModelRef,
                consentId: p.likeness.consentId,
                keyframeRef: entry.keyframeRef ?? null,
                keyframeExternalId: entry.keyframeExternalId ?? null,
              },
            }
          : {}),
      };
      await prisma.videoRender.upsert({
        where: { id: renderId },
        create: {
          id: renderId,
          projectId: p.projectId,
          conceptId: p.conceptId,
          url: stored.url,
          durationS: stored.inspection.durationS,
          provider: adapter.name,
          meta: renderMeta as never,
        },
        update: {
          url: stored.url,
          durationS: stored.inspection.durationS,
          provider: adapter.name,
          meta: renderMeta as never,
        },
      });

      entry.state = "succeeded";
      entry.externalId = render.externalId ?? entry.externalId;
      entry.url = stored.url;
      entry.durationS = stored.inspection.durationS;
      entry.contentHash = stored.inspection.contentHash;
      entry.sizeBytes = stored.inspection.sizeBytes;
      entry.width = stored.inspection.width;
      entry.height = stored.inspection.height;
      await save(entry.externalId);
      results.push({
        shotIndex,
        url: stored.url,
        durationS: stored.inspection.durationS,
        contentHash: stored.inspection.contentHash,
        sizeBytes: stored.inspection.sizeBytes,
        width: stored.inspection.width,
        height: stored.inspection.height,
        qualityState: stored.inspection.qualityState,
        keyframeRef: entry.keyframeRef ?? null,
      });
    }

    await markSucceeded(
      p.jobId,
      {
        renders: results,
        // HONEST PER-STEP PROVENANCE: which class rendered, and — on the
        // likeness path — whose consented face seeded each shot's keyframe.
        engineClass: p.engineClass ?? null,
        likeness: p.likeness
          ? {
              rightsBasis: p.likeness.rightsBasis,
              trainedModelRef: p.likeness.trainedModelRef,
              consentId: p.likeness.consentId,
            }
          : null,
        estimatedCostUsd:
          costEvidenceComplete && hasCostEvidence ? knownCostUsd : null,
        knownCostUsd: hasCostEvidence ? knownCostUsd : null,
        costEvidenceComplete: costEvidenceComplete && hasCostEvidence,
      },
      hasCostEvidence ? knownCostUsd : undefined
    );
  } catch (error) {
    if (hasCostEvidence) {
      await prisma.providerJob
        .updateMany({
          where: { id: p.jobId, workspaceId: p.workspaceId },
          data: { cost: knownCostUsd.toFixed(6) as never },
        })
        .catch((costError: unknown) =>
          console.warn(
            `[video ${p.jobId}] failed to persist known provider cost:`,
            (costError as Error).message
          )
        );
    }
    await markFailed(p.jobId, error);
  }
}
