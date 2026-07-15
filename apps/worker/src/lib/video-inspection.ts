import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type VideoFormat = "vertical" | "square" | "landscape";

export interface VideoProbe {
  width: number;
  height: number;
  durationS: number;
  codec: string;
  container: string;
}

export interface VideoInspection extends VideoProbe {
  contentHash: string;
  sizeBytes: number;
  qualityState: "passed";
}

const TARGET_RATIO: Record<VideoFormat, number> = {
  vertical: 9 / 16,
  square: 1,
  landscape: 16 / 9,
};
const VIDEO_TOOL_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(
    10 * 60_000,
    Number(process.env.VIDEO_TOOL_TIMEOUT_MS ?? 180_000) || 180_000
  )
);

export function estimateVideoCostUsd(
  provider: string,
  durationS: number,
  reportedCostUsd: number | undefined,
  env: Record<string, string | undefined> = process.env
): number | null {
  if (Number.isFinite(reportedCostUsd) && reportedCostUsd! >= 0) {
    return Number(reportedCostUsd!.toFixed(6));
  }
  const providerKey = provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const rate = Number(
    env[providerKey + "_COST_USD_PER_SECOND"] ?? env.VIDEO_COST_USD_PER_SECOND
  );
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(durationS)) {
    return null;
  }
  return Number((rate * durationS).toFixed(6));
}

export function validateVideoProbe(
  probe: VideoProbe,
  options: { format: VideoFormat; expectedDurationS: number }
): VideoProbe {
  if (
    !Number.isInteger(probe.width) ||
    !Number.isInteger(probe.height) ||
    probe.width < 320 ||
    probe.height < 320 ||
    probe.width > 8192 ||
    probe.height > 8192 ||
    probe.width * probe.height > 33_554_432
  ) {
    throw new Error("video_qc_failed: invalid frame dimensions");
  }
  if (!Number.isFinite(probe.durationS) || probe.durationS <= 0) {
    throw new Error("video_qc_failed: duration is unavailable");
  }
  if (probe.codec.toLowerCase() !== "h264") {
    throw new Error(
      "video_qc_failed: browser-compatible H.264 video is required"
    );
  }
  if (!/(^|,)mp4(,|$)/i.test(probe.container)) {
    throw new Error("video_qc_failed: MP4 container is required");
  }
  const ratio = probe.width / probe.height;
  if (Math.abs(ratio - TARGET_RATIO[options.format]) > 0.08) {
    throw new Error(
      "video_qc_failed: output aspect ratio does not match the request"
    );
  }
  const durationTolerance = Math.max(2, options.expectedDurationS * 0.35);
  if (
    Math.abs(probe.durationS - options.expectedDurationS) > durationTolerance
  ) {
    throw new Error(
      "video_qc_failed: output duration does not match the requested shot"
    );
  }
  return probe;
}

async function runVideoTool(
  command: "ffprobe" | "ffmpeg",
  args: string[],
  label: string,
  captureStdout = false
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${label} timed out after ${VIDEO_TOOL_TIMEOUT_MS}ms`));
    }, VIDEO_TOOL_TIMEOUT_MS);
    child.stdout?.on("data", chunk => {
      const remaining = 64_000 - stdout.length;
      if (remaining > 0) stdout += chunk.toString("utf8").slice(0, remaining);
    });
    child.stderr?.on("data", chunk => {
      const remaining = 4_000 - stderr.length;
      if (remaining > 0) stderr += chunk.toString("utf8").slice(0, remaining);
    });
    child.once("error", error =>
      finish(new Error(`${label} failed to start: ${error.message}`))
    );
    child.once("close", code => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `${label} failed (${code ?? "unknown"}): ${stderr.slice(-1_000)}`
          )
        );
    });
  });
}

async function probeVideo(path: string): Promise<VideoProbe> {
  const output = await runVideoTool(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,duration:format=duration,format_name",
      "-of",
      "json",
      path,
    ],
    "video probe",
    true
  );
  let parsed: {
    streams?: Array<{
      codec_name?: unknown;
      width?: unknown;
      height?: unknown;
      duration?: unknown;
    }>;
    format?: { duration?: unknown; format_name?: unknown };
  };
  try {
    parsed = JSON.parse(output) as typeof parsed;
  } catch {
    throw new Error("video_qc_failed: ffprobe returned invalid JSON");
  }
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error("video_qc_failed: no video stream");
  const streamDuration = Number(stream.duration);
  const formatDuration = Number(parsed.format?.duration);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    durationS: Number.isFinite(streamDuration)
      ? streamDuration
      : formatDuration,
    codec: String(stream.codec_name ?? ""),
    container: String(parsed.format?.format_name ?? ""),
  };
}

async function verifyVideoDecode(path: string): Promise<void> {
  await runVideoTool(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-v",
      "error",
      "-xerror",
      "-threads",
      "2",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-",
    ],
    "video decode"
  );
}
export async function inspectVideoBytes(
  bytes: Uint8Array,
  options: { format: VideoFormat; expectedDurationS: number; maxBytes: number }
): Promise<VideoInspection> {
  if (bytes.byteLength < 1_000 || bytes.byteLength > options.maxBytes) {
    throw new Error("video_qc_failed: output is empty or oversized");
  }
  const directory = await mkdtemp(join(tmpdir(), "afrohit-video-qc-"));
  const path = join(directory, "render.mp4");
  try {
    await writeFile(path, bytes);
    const probe = validateVideoProbe(await probeVideo(path), options);
    await verifyVideoDecode(path);
    return {
      ...probe,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      qualityState: "passed",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
