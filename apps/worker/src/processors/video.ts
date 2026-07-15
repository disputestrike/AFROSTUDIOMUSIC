import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "@afrohit/db";
import {
  videoAdapter,
  type VideoRenderOutput,
  type VideoShotInput,
} from "@afrohit/ai";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import { downloadToBuffer, uploadBytes } from "../lib/storage";
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
    const adapter = videoAdapter();
    if (adapter.name === "stub" && process.env.ALLOW_STUB_AUDIO !== "1") {
      await markFailed(p.jobId, "video_failed: no video engine configured");
      return;
    }
    await prisma.providerJob.updateMany({
      where: { id: p.jobId, workspaceId: p.workspaceId },
      data: { provider: adapter.name },
    });
    if (
      adapter.name !== "veo" &&
      adapter.name !== "sora" &&
      adapter.name !== "stub"
    ) {
      await markFailed(
        p.jobId,
        `video_failed: unsupported video engine ${adapter.name}`
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
        });
        continue;
      }

      const input = shotInput(shot, p.format);
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
      await prisma.videoRender.upsert({
        where: { id: renderId },
        create: {
          id: renderId,
          projectId: p.projectId,
          conceptId: p.conceptId,
          url: stored.url,
          durationS: stored.inspection.durationS,
          provider: adapter.name,
          meta: {
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
          } as never,
        },
        update: {
          url: stored.url,
          durationS: stored.inspection.durationS,
          provider: adapter.name,
          meta: {
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
          } as never,
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
      });
    }

    await markSucceeded(
      p.jobId,
      {
        renders: results,
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
