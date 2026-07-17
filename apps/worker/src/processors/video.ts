import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSecret, prisma } from "@afrohit/db";
import {
  characterSheetPrompt,
  currentPlayableAsset,
  planVideoAssembly,
  playableArrangement,
  playableAssetHistory,
  videoTreatmentOf,
} from "@afrohit/shared";
import {
  generateLikenessKeyframe,
  imageAdapter,
  videoAdapter,
  videoAdapterForClass,
  type VideoEngineClass,
  type VideoProviderAdapter,
  type VideoRenderOutput,
  type VideoShotInput,
} from "@afrohit/ai";
import { enqueueJob } from "../lib/enqueue";
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
  /** PERFORMER/CAST LAW: who is on screen — folded into the engine prompt
   *  (engines only ever see prompt text; dropping this dropped the cast). */
  subjects?: string[];
  negativePrompt?: string;
  /** PACKAGE B: which treatment sequence this shot belongs to, and the
   *  roster lead who fronts it (character-sheet keyframe key). */
  sequenceIndex?: number;
  lead?: string;
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
  /** POST-RENDER SALVAGE (recover-only): this run exists ONLY to pull down
   *  work the engine already finished and was already paid for — submitted
   *  predictions are re-polled and their outputs committed; a shot with no
   *  submitted prediction is skipped honestly. A recovery run NEVER calls
   *  renderShot and NEVER generates a keyframe: zero new provider spend,
   *  by construction. */
  recoverOnly?: boolean;
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
  /** Set by a recovery run that PROVED this shot cannot be salvaged (link
   *  expired, engine-side failure). The salvage law skips marked entries so
   *  a dead prediction can never trap the scene in a recover-forever loop —
   *  the next render press bills and renders fresh, honestly. */
  unrecoverable?: string;
  /** LIVE METER heartbeat (persisted every poll tick so the UI can show
   *  motion that is TRUE): poll count, last-seen time, the engine-reported
   *  percent when its logs print one (never fabricated), and the current
   *  step ("engine-rendering" | "downloading" | "done"). */
  pollAttempts?: number;
  lastPollAt?: string;
  progressPct?: number;
  step?: string;
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
  const cast = (shot.subjects ?? []).filter(
    subject => typeof subject === "string" && subject.trim()
  );
  return {
    prompt: cast.length
      ? `${shot.prompt}
On screen: ${cast.join("; ")}.`
      : shot.prompt,
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

// PAID-BYTES CONFORM LAW (2026-07-17). Some engines decide their own frame —
// the standard engine takes NO aspect input and always returns widescreen —
// so "output aspect ratio does not match the request" used to reject FINISHED,
// PAID renders wholesale (nine clips in one press, live incident). A paid
// render is NEVER rejected for its shape: we center-crop it to the requested
// format locally (free CPU, same ffmpeg law the square path always used) and
// certify the conformed bytes instead.
const CONFORM_FILTER: Record<VideoPayload["format"], string> = {
  square: "crop=min(iw\\,ih):min(iw\\,ih),scale=720:720:flags=lanczos",
  vertical:
    "crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9),scale=720:1280:flags=lanczos",
  landscape:
    "crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16),scale=1280:720:flags=lanczos",
};

async function conformAspect(
  bytes: Uint8Array,
  format: VideoPayload["format"]
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "afrohit-video-"));
  const input = join(directory, "input.mp4");
  const output = join(directory, "conformed.mp4");
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
      CONFORM_FILTER[format],
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
    const conformed = await readFile(output);
    if (!conformed.length || conformed.length > MAX_VIDEO_BYTES) {
      throw new Error("conformed video is empty or too large");
    }
    return conformed;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const cropSquare = (bytes: Uint8Array): Promise<Buffer> =>
  conformAspect(bytes, "square");

async function storeVideo(
  workspaceId: string,
  format: VideoPayload["format"],
  output: VideoRenderOutput,
  expectedDurationS: number
): Promise<{
  url: string;
  inspection: VideoInspection;
  /** Set when the engine returned a different shape than requested and the
   *  NATIVE bytes were kept verbatim (certified against their actual shape). */
  nativeFormat: VideoPayload["format"] | null;
}> {
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
  let nativeFormat: VideoPayload["format"] | null = null;
  let inspection: VideoInspection;
  try {
    inspection = await inspectVideoBytes(bytes, {
      format,
      expectedDurationS,
      maxBytes: MAX_VIDEO_BYTES,
    });
  } catch (error) {
    // NATIVE-MASTER LAW (2026-07-17, owner: "once we get the render, we keep
    // it — fix it on our side"): the engine's original pixels are stored
    // VERBATIM. Some engines pick their own frame; cropping at ingest
    // destroyed paid picture (live incident: widescreen masters cropped to a
    // 9:16 sliver, then pillarboxed back into the widescreen full cut). A
    // shape mismatch is certified against the shape the clip actually IS —
    // requested vs actual rides the meta, and each cut (full 16:9 / teaser
    // 9:16) conforms its own COPY at assembly. Every other QC failure
    // (codec, container, duration, corrupt bytes) still fails honestly.
    if (!/aspect ratio does not match/.test((error as Error).message ?? "")) {
      throw error;
    }
    for (const actual of ["landscape", "vertical", "square"] as const) {
      if (actual === format) continue;
      try {
        inspection = await inspectVideoBytes(bytes, {
          format: actual,
          expectedDurationS,
          maxBytes: MAX_VIDEO_BYTES,
        });
        nativeFormat = actual;
        break;
      } catch {
        // not this shape either — keep looking
      }
    }
    if (!nativeFormat) throw error; // no known shape fits — honest failure
  }
  const url = await uploadBytes({
    workspaceId,
    kind: "videos",
    bytes,
    ext: "mp4",
    contentType: "video/mp4",
  });
  return { url, inspection: inspection!, nativeFormat };
}
// ===========================================================================
// PACKAGE B — CHARACTER SHEETS ("same faces all video", 2026-07-17). Scene
// renders have no memory; one portrait per roster lead, generated ONCE per
// concept and used as the i2v keyframe on that lead's scenes, holds identity
// across the whole video. Best-effort by LAW: a sheet failure never fails a
// paid render — scenes fall back to t2v exactly as before. Single-generation
// is enforced by an ATOMIC jsonb claim (the auto-assemble pattern) so
// parallel per-scene jobs cannot mint duplicate sheets.
// ===========================================================================
async function ensureCharacterSheets(
  p: VideoPayload
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  try {
    const concept = await prisma.videoConcept.findFirst({
      where: { id: p.conceptId, project: { workspaceId: p.workspaceId } },
      select: { id: true, storyboard: true, meta: true },
    });
    if (!concept) return empty;
    const meta =
      concept.meta && typeof concept.meta === "object" && !Array.isArray(concept.meta)
        ? (concept.meta as Record<string, unknown>)
        : {};
    const existing = meta.characterSheets;
    const readSheets = (value: unknown): Map<string, string> => {
      const sheets = new Map<string, string>();
      if (Array.isArray(value)) {
        for (const row of value) {
          const entry = row as { rosterId?: unknown; ref?: unknown };
          if (typeof entry?.rosterId === "string" && typeof entry?.ref === "string") {
            sheets.set(entry.rosterId, entry.ref);
          }
        }
      }
      return sheets;
    };
    const ready = readSheets(existing);
    if (ready.size) return ready;

    const performers = meta.performers as
      | { roster?: Array<{ id?: unknown; vocal?: unknown }> }
      | undefined;
    const roster = (performers?.roster ?? []).filter(
      (lead): lead is { id: string; vocal: string } =>
        typeof lead?.id === "string"
    );
    if (!roster.length) return empty;

    // Atomic claim — exactly one job generates; the rest wait briefly.
    const claimed = await prisma.$executeRaw`
      UPDATE "VideoConcept"
      SET "meta" = jsonb_set(COALESCE("meta", '{}'::jsonb), '{characterSheetsClaim}', 'true'::jsonb)
      WHERE "id" = ${concept.id}
        AND COALESCE("meta"->>'characterSheetsClaim', '') = ''
        AND COALESCE("meta"->>'characterSheets', '') = ''
    `;
    if (claimed !== 1) {
      // Another scene's job is generating — poll up to ~50s, then proceed
      // honestly sheetless (t2v, exactly the pre-B behavior).
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5_000));
        const fresh = await prisma.videoConcept.findUnique({
          where: { id: concept.id },
          select: { meta: true },
        });
        const freshMeta =
          fresh?.meta && typeof fresh.meta === "object" && !Array.isArray(fresh.meta)
            ? (fresh.meta as Record<string, unknown>)
            : {};
        const sheets = readSheets(freshMeta.characterSheets);
        if (sheets.size) return sheets;
      }
      return empty;
    }

    const treatment = videoTreatmentOf(concept.storyboard);
    const castingNotes = treatment?.castingNotes;
    const adapter = imageAdapter();
    if (adapter.name === "stub" && process.env.ALLOW_STUB_AUDIO !== "1") {
      return empty;
    }
    const generated: Array<{ rosterId: string; ref: string }> = [];
    for (const lead of roster) {
      const result = await adapter.generate({
        prompt: characterSheetPrompt(castingNotes, lead.id),
        size: "1024x1024",
        quality: "medium",
      });
      if (result.status !== "succeeded" || !result.output) continue;
      let bytes: Buffer | null = null;
      if (result.output.imageBase64) {
        bytes = Buffer.from(result.output.imageBase64, "base64");
      } else if (result.output.imageUrl) {
        bytes = await downloadToBuffer(result.output.imageUrl, {
          maxBytes: 30 * 1024 * 1024,
          timeoutMs: 120_000,
        });
      }
      if (!bytes?.length) continue;
      const ref = await uploadBytes({
        workspaceId: p.workspaceId,
        kind: "videos/character-sheets",
        bytes,
        contentType: "image/png",
        ext: "png",
      });
      generated.push({ rosterId: lead.id, ref });
    }
    await prisma.$executeRaw`
      UPDATE "VideoConcept"
      SET "meta" = jsonb_set(COALESCE("meta", '{}'::jsonb), '{characterSheets}', ${JSON.stringify(generated)}::jsonb)
      WHERE "id" = ${concept.id}
    `;
    console.log(
      `[video ${p.jobId}] character sheets ready for concept ${p.conceptId}: ${generated.map(g => g.rosterId).join(", ") || "none"}`
    );
    return readSheets(generated);
  } catch (error) {
    console.warn(
      `[video ${p.jobId}] character sheets skipped:`,
      (error as Error).message
    );
    return empty;
  }
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

    // Recovery bookkeeping — every shot a recover-only run could NOT deliver
    // is recorded with its reason and surfaced in the job output. Honest,
    // never silent.
    const recoverySkipped: Array<{ shotIndex: number; reason: string }> = [];

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

    // PACKAGE B: one portrait per lead, used as the i2v keyframe on that
    // lead's scenes — same faces across the whole video. Never on recovery
    // runs (no new spend law) and never on the likeness path (its own
    // keyframes rule there).
    const characterSheets =
      !p.recoverOnly && !p.likeness && adapter.capabilities?.imageToVideo === true
        ? await ensureCharacterSheets(p)
        : new Map<string, string>();

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

      // RECOVER-ONLY GATE: no submitted prediction (or an engine that cannot
      // re-poll) means there is nothing paid-for to pull down. Skip — a
      // recovery run must never trigger fresh provider spend.
      if (p.recoverOnly && !(existing?.externalId && adapter.poll)) {
        recoverySkipped.push({
          shotIndex,
          reason: existing?.externalId
            ? "this engine cannot re-poll a finished render"
            : "no submitted render to recover — this scene needs a fresh render",
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
        // A recovery run never regenerates a keyframe (that is billable
        // image spend) — the submitted prediction already carries the frame
        // it was rendered from.
        if (!entry.keyframeRef && !p.recoverOnly) {
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
        if (entry.keyframeRef) {
          input.keyframeUrl = await resolveAssetForProvider(
            entry.keyframeRef,
            3600
          );
        }
      }

      // On a recovery run a shot-level fault is tolerated: mark the entry
      // unrecoverable (so the salvage law never re-tries a proven-dead
      // prediction) and move on to salvage the sibling shots.
      const recoverySkip = async (reason: string): Promise<void> => {
        recoverySkipped.push({ shotIndex, reason });
        if (existing) {
          existing.unrecoverable = reason;
          await save(existing.externalId);
        }
      };

      // PACKAGE B keyframe: the fronting lead's character sheet drives the
      // scene (i2v) so the same face carries shot to shot. Likeness keyframes
      // (set above) always win; sheetless shots render t2v as before.
      if (!input.keyframeUrl && shot.lead && characterSheets.has(shot.lead)) {
        input.keyframeUrl = await resolveAssetForProvider(
          characterSheets.get(shot.lead)!,
          3600
        );
      }

      let render: Awaited<ReturnType<typeof adapter.renderShot>>;
      try {
        render =
          existing?.externalId && adapter.poll
            ? await adapter.poll(existing.externalId, input)
            : await adapter.renderShot(input);
      } catch (pollError) {
        if (p.recoverOnly) {
          await recoverySkip(
            `could not re-poll the finished render: ${(pollError as Error).message}`
          );
          continue;
        }
        throw pollError;
      }

      let reportedCostUsd = render.estimatedCostUsd;
      if (render.externalId) {
        const entry = existing ?? { shotIndex, state: "submitted" as const };
        entry.state = "submitted";
        entry.externalId = render.externalId;
        if (!existing) progress.push(entry);
        await save(render.externalId);
      }

      let attempts = 0;
      let stillRunning = false;
      while (render.status === "queued" || render.status === "running") {
        if (!adapter.poll || !render.externalId) {
          throw new Error("video provider cannot resume its queued job");
        }
        if (attempts >= maxPollAttempts) {
          if (p.recoverOnly) {
            // The prediction is ALIVE — no unrecoverable marker, so the next
            // recovery pass keeps waiting on the same paid render instead of
            // abandoning it and paying for a fresh one.
            recoverySkipped.push({
              shotIndex,
              reason:
                "the engine is still finishing this render — recover again shortly",
            });
            stillRunning = true;
            break;
          }
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
        // LIVE METER heartbeat — persist real progress each tick ("it doesn't
        // show anything was working" — owner). Attempts + engine-reported
        // percent + step; the assembly endpoint serves these to the meter.
        const beat =
          existing ?? progress.find(item => item.shotIndex === shotIndex);
        if (beat) {
          beat.pollAttempts = attempts;
          beat.lastPollAt = new Date().toISOString();
          if (typeof render.progressPct === "number") {
            beat.progressPct = render.progressPct;
          }
          beat.step = "engine-rendering";
          await save(beat.externalId ?? render.externalId ?? undefined);
        }
      }
      if (stillRunning) continue;
      if (render.status !== "succeeded" || !render.output) {
        if (p.recoverOnly) {
          await recoverySkip(
            render.error ??
              `the engine reports ${render.status} — nothing finished to recover`
          );
          continue;
        }
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
      entry.step = "downloading";
      await save(entry.externalId);
      let stored: Awaited<ReturnType<typeof storeVideo>>;
      try {
        stored = await storeVideo(
          p.workspaceId,
          p.format,
          render.output,
          shot.duration_s
        );
      } catch (downloadError) {
        if (p.recoverOnly) {
          // Engine delivery links expire (~1 hour). A dead link is proven
          // unrecoverable — mark it so the salvage law releases this scene
          // for an honest fresh render instead of looping forever.
          await recoverySkip(
            `the finished render's download link is no longer live: ${(downloadError as Error).message}`
          );
          continue;
        }
        throw downloadError;
      }
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
        // NATIVE-MASTER PROVENANCE: when the engine chose its own frame, the
        // stored clip IS that frame — untouched paid pixels; the requested
        // shape is derived per-cut at assembly, never at ingest.
        ...(stored.nativeFormat
          ? {
              aspectNative: true,
              actualFormat: stored.nativeFormat,
              actualAspectRatio: ASPECT[stored.nativeFormat],
            }
          : {}),
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
      entry.step = "done";
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

    if (p.recoverOnly && !results.length) {
      // Recovery that delivered nothing is a FAILURE, stated plainly — with
      // the per-scene reasons, so "why" is never a mystery. Dead entries are
      // already marked unrecoverable; the next render press bills fresh.
      await markFailed(
        p.jobId,
        `recovery found nothing downloadable — ${
          recoverySkipped
            .map(s => `scene ${s.shotIndex + 1}: ${s.reason}`)
            .join("; ") || "no salvageable shots"
        }`
      );
      await maybeTriggerAutoAssemble(p);
      return;
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
        // RECOVERY RECEIPT — which paid scenes were pulled back in, and
        // which could not be (with reasons). Zero new provider spend.
        ...(p.recoverOnly
          ? {
              recovery: {
                recoveredShotIndexes: results.map(r => r.shotIndex),
                skipped: recoverySkipped,
              },
            }
          : {}),
      },
      hasCostEvidence ? knownCostUsd : undefined
    );
    // ONE-CLICK FULL VIDEO: a completed shot may be the last piece the
    // assembler was waiting for. Never throws — the render's own success is
    // already recorded and must not be disturbed by trigger trouble.
    await maybeTriggerAutoAssemble(p);
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
    // A terminal shot FAILURE can also settle the auto-assemble question: if
    // every queued shot has reached a terminal state and coverage is still
    // short, the trigger writes an honest 'incomplete' outcome instead of
    // waiting forever for a success event that will never come.
    await maybeTriggerAutoAssemble(p);
  }
}

// ===========================================================================
// AUTO-ASSEMBLE TRIGGER (one-click full video). POST /videos/render-all
// stamps concept meta.autoAssemble = { requested: true, kind: 'full', ... };
// this trigger runs after EVERY terminal shot event for that concept and:
//   - when the shared gating law (planVideoAssembly, the exact function the
//     /videos/assemble route gates with) says every sequence now holds >=1
//     successful render → enqueue ONE assemble-video job with the same
//     payload shape the route builds, then clear the flag (single-fire);
//   - when every queued shot job is terminal and coverage is still short →
//     write meta.autoAssemble.outcome = 'incomplete' with the exact missing
//     list. Honest, never spinning.
// Single-fire is enforced by an ATOMIC conditional jsonb claim: only the
// worker that flips requested:true→false proceeds, so two shots completing
// at once cannot enqueue two assemblies.
//
// WHY WORKER-SIDE ENQUEUE (design choice): the /videos/assemble route
// resolves auth + audio API-side, but its AUDIO and GATING laws are pure and
// now live in @afrohit/shared (playable-asset.ts was moved there and the API
// re-exports it), so the worker resolves the concept's audio through the
// EXACT same law with its own prisma read and mirrors the route's payload
// field-for-field. The job is made durable the same way the API makes jobs
// durable: ProviderJob + JobOutbox in one transaction, then a direct BullMQ
// publish under the dispatcher's stable id (provider-<jobId>) — if the
// publish fails, the API's 15s outbox dispatcher republishes the row.
// ===========================================================================

const autoRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Flip meta.autoAssemble atomically; only one caller wins the claim. */
async function claimAutoAssemble(
  conceptId: string,
  next: Record<string, unknown>
): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    UPDATE "VideoConcept"
    SET "meta" = jsonb_set(
      COALESCE("meta", '{}'::jsonb),
      '{autoAssemble}',
      ${JSON.stringify(next)}::jsonb
    )
    WHERE "id" = ${conceptId}
      AND COALESCE("meta"->'autoAssemble'->>'requested', '') = 'true'
  `;
  return affected === 1;
}

/** The concept's CURRENT audio — the same playable-asset law the API uses
 *  (shared module), fed by the worker's own scoped read. */
async function resolveConceptAudio(
  songId: string | null,
  workspaceId: string
): Promise<
  | {
      ok: true;
      sourceId: string;
      sourceType: "beat" | "mix" | "master";
      url: string;
      songId: string;
      songDurationS: number | null;
    }
  | { ok: false; error: "no_song_bound" | "no_song_audio" }
> {
  if (!songId) return { ok: false, error: "no_song_bound" };
  const song = await prisma.song.findFirst({
    where: { id: songId, workspaceId },
    include: {
      masters: { orderBy: { createdAt: "desc" }, take: 20 },
      mixes: { orderBy: { createdAt: "desc" }, take: 20 },
      beats: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!song) return { ok: false, error: "no_song_bound" };
  const history = playableAssetHistory(song);
  const current = currentPlayableAsset(song);
  if (!current) return { ok: false, error: "no_song_audio" };
  const arrangement = playableArrangement(history, current);
  return {
    ok: true,
    sourceId: current.id,
    sourceType: current.type,
    url: current.url,
    songId: song.id,
    songDurationS: arrangement?.durationS ?? current.durationS ?? null,
  };
}

async function maybeTriggerAutoAssemble(p: {
  jobId: string;
  workspaceId: string;
  projectId: string;
  conceptId: string;
}): Promise<void> {
  try {
    const concept = await prisma.videoConcept.findFirst({
      where: { id: p.conceptId, project: { workspaceId: p.workspaceId } },
      select: {
        id: true,
        projectId: true,
        songId: true,
        storyboard: true,
        meta: true,
      },
    });
    if (!concept) return;
    const auto = autoRecord(autoRecord(concept.meta).autoAssemble);
    if (auto.requested !== true) return;

    const renders = await prisma.videoRender.findMany({
      where: { conceptId: concept.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, url: true, createdAt: true, meta: true },
    });
    const audio = await resolveConceptAudio(concept.songId, p.workspaceId);
    const gate = planVideoAssembly({
      kind: auto.kind === "teaser" ? "teaser" : "full",
      storyboard: concept.storyboard,
      renders,
      songDurationS: audio.ok ? audio.songDurationS : null,
    });

    if (gate.ok) {
      if (!audio.ok) {
        // Coverage is complete but the song has no audio — an honest terminal
        // outcome the modal can show; assembling would only fail later.
        await claimAutoAssemble(concept.id, {
          ...auto,
          requested: false,
          outcome: audio.error,
          decidedAt: new Date().toISOString(),
        });
        return;
      }
      const firedAt = new Date().toISOString();
      const claimed = await claimAutoAssemble(concept.id, {
        ...auto,
        requested: false,
        outcome: "enqueued",
        firedAt,
      });
      if (!claimed) return; // another shot's completion already fired it

      // Durable enqueue — ProviderJob + JobOutbox in ONE transaction (the
      // API's own durability pattern), then a direct publish under the
      // dispatcher's stable BullMQ id. Payload mirrors POST /videos/assemble
      // field-for-field. NO charge: assembly is local CPU, already-paid work.
      const created = await prisma.$transaction(async tx => {
        const job = await tx.providerJob.create({
          data: {
            workspaceId: p.workspaceId,
            projectId: concept.projectId,
            kind: "video",
            provider: "assembler",
            status: "QUEUED",
            inputJson: {
              conceptId: concept.id,
              kind: gate.plan.kind,
              trigger: "auto-assemble",
            } as never,
          },
          select: { id: true },
        });
        const payload = {
          jobId: job.id,
          workspaceId: p.workspaceId,
          projectId: concept.projectId,
          conceptId: concept.id,
          kind: gate.plan.kind,
          clips: gate.plan.clips,
          plannedS: gate.plan.plannedS,
          maxDurationS: gate.plan.maxDurationS,
          audio: {
            url: audio.url,
            sourceId: audio.sourceId,
            sourceType: audio.sourceType,
            startS: gate.plan.audioStartS,
            songId: audio.songId,
            songDurationS: audio.songDurationS,
          },
        };
        await tx.jobOutbox.create({
          data: {
            workspaceId: p.workspaceId,
            providerJobId: job.id,
            queueName: "video",
            jobName: "assemble-video",
            payload: payload as never,
          },
        });
        return { jobId: job.id, payload };
      });
      try {
        await enqueueJob("video", "assemble-video", created.payload, {
          jobId: `provider-${created.jobId}`,
        });
        await prisma.jobOutbox.update({
          where: { providerJobId: created.jobId },
          data: { status: "DISPATCHED", dispatchedAt: new Date() },
        });
      } catch (publishError) {
        // Durable by design: the PENDING outbox row is republished by the
        // API dispatcher within ~15s; the stable jobId dedupes any race.
        console.warn(
          `[video ${p.jobId}] auto-assemble publish deferred to the outbox dispatcher:`,
          (publishError as Error).message
        );
      }
      // Record which job carried the cut (best-effort bookkeeping).
      await prisma.$executeRaw`
        UPDATE "VideoConcept"
        SET "meta" = jsonb_set(
          COALESCE("meta", '{}'::jsonb),
          '{autoAssemble,assembleJobId}',
          ${JSON.stringify(created.jobId)}::jsonb
        )
        WHERE "id" = ${concept.id}
      `.catch(() => undefined);
      console.log(
        `[video ${p.jobId}] auto-assemble fired for concept ${concept.id} (job ${created.jobId})`
      );
      return;
    }

    // Gate not passable yet. If ANY render job for this concept is still
    // queued or running, more evidence is coming — do nothing. Only when
    // every shot job is terminal and coverage is still short do we settle
    // honestly with the exact missing list.
    const pending = await prisma.providerJob.count({
      where: {
        workspaceId: p.workspaceId,
        kind: "video",
        status: { in: ["QUEUED", "RUNNING"] },
        NOT: { provider: "assembler" },
        inputJson: { path: ["conceptId"], equals: concept.id },
      },
    });
    if (pending > 0) return;
    await claimAutoAssemble(concept.id, {
      ...auto,
      requested: false,
      outcome: "incomplete",
      missing: gate.error === "shots_missing" ? gate.missing : [],
      reason: gate.error,
      decidedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Best-effort by contract: the shot render's own outcome is already
    // recorded and a trigger fault must never disturb it.
    console.warn(
      `[video ${p.jobId}] auto-assemble trigger error:`,
      (error as Error).message
    );
  }
}
