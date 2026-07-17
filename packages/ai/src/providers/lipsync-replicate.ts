/**
 * LIP-SYNC — the frontier the owner named ("the big issue is lip syncing:
 * sing and face the camera"). Verified engine (2026-07-17, live schema):
 * kwaivgi/kling-lip-sync — video_url (mp4/mov, 2-10s, 720p-1080p window,
 * dims 720-1920px, <100MB) + audio_file (mp3/wav/m4a/aac, <5MB) → synced
 * mp4. $0.014/second of output (~$0.084 per 6s clip; a full video's sync
 * ≈ $1). Same versioned-predictions law as every Replicate adapter here.
 */
import { replicateToken } from "./music";

const REPLICATE_API = "https://api.replicate.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
export const LIPSYNC_MODEL = "kwaivgi/kling-lip-sync";

export interface LipSyncResult {
  status: "succeeded" | "failed";
  videoUrl?: string;
  error?: string;
}

async function resolveVersion(token: string): Promise<string | null> {
  const pinned = process.env.REPLICATE_LIPSYNC_VERSION?.trim();
  if (pinned) return pinned;
  const res = await fetch(`${REPLICATE_API}/models/${LIPSYNC_MODEL}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { latest_version?: { id?: string } };
  return body.latest_version?.id ?? null;
}

/** EXACT model body — pure and unit-tested so drift is a failing test, not a
 *  burned render. Kling validates at runtime: video_url + audio_file. */
export function lipSyncModelBody(options: {
  videoUrl: string;
  audioUrl: string;
}): Record<string, unknown> {
  return {
    video_url: options.videoUrl,
    audio_file: options.audioUrl,
  };
}

/** Sync one clip's mouth to one audio slice. Submits, polls to terminal.
 *  429s wait (the throttle law); every other failure is honest. */
export async function lipSyncClip(options: {
  videoUrl: string;
  audioUrl: string;
  apiKey?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}): Promise<LipSyncResult> {
  const token = options.apiKey || replicateToken();
  if (!token) return { status: "failed", error: "REPLICATE_API_TOKEN missing" };
  try {
    const version = await resolveVersion(token);
    if (!version) return { status: "failed", error: "lip-sync engine version unavailable" };

    const backoffMs = Math.max(1, Number(process.env.REPLICATE_429_RETRY_MS ?? 20_000));
    let res: Response | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(`${REPLICATE_API}/predictions`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ version, input: lipSyncModelBody(options) }),
      });
      if (res.status !== 429 || attempt === 4) break;
      await new Promise(resolve =>
        setTimeout(resolve, backoffMs * attempt + Math.random() * backoffMs)
      );
    }
    if (!res!.ok) {
      return { status: "failed", error: `lip-sync engine ${res!.status}: ${(await res!.text()).slice(0, 160)}` };
    }
    let prediction = (await res!.json()) as {
      id?: string;
      status?: string;
      output?: unknown;
      error?: string | null;
    };
    const interval = options.pollIntervalMs ?? 8_000;
    const maxAttempts = options.maxPollAttempts ?? 60;
    let attempts = 0;
    while (prediction.status === "starting" || prediction.status === "processing") {
      if (!prediction.id || attempts >= maxAttempts) {
        return { status: "failed", error: "lip-sync engine timed out" };
      }
      await new Promise(resolve => setTimeout(resolve, interval));
      attempts += 1;
      const poll = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}` },
      });
      if (!poll.ok) return { status: "failed", error: `lip-sync poll ${poll.status}` };
      prediction = (await poll.json()) as typeof prediction;
    }
    if (prediction.status !== "succeeded" || typeof prediction.output !== "string") {
      return { status: "failed", error: prediction.error?.slice(0, 200) || "lip-sync engine failed" };
    }
    return { status: "succeeded", videoUrl: prediction.output };
  } catch (error) {
    return { status: "failed", error: (error as Error).message };
  }
}
