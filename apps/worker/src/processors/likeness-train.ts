import { createHash } from "node:crypto";
import JSZip from "jszip";

import { openSecret, prisma } from "@afrohit/db";
import {
  ensureDestinationModel,
  getLikenessTraining,
  likenessTrainerConfig,
  startLikenessTraining,
  trainedModelRefFromOutput,
} from "@afrohit/ai";
import {
  LIKENESS_RIGHTS_BASIS,
  MIN_LIKENESS_TRAINING_PHOTOS,
  isValidLikenessModelSlug,
  likenessTrainingGate,
  nextLikenessStatus,
  type LikenessStatus,
  type LikenessStatusEvent,
} from "@afrohit/shared";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import {
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "../lib/storage";

/**
 * LIKENESS TRAINING JOB — Flux LoRA fine-tune on the artist's OWN photos.
 *
 * The API gate already ran; this processor re-runs EVERY gate against the
 * database (defense in depth: consent could be revoked between kickoff and
 * pickup) and then owns the honest status story:
 *
 *   pending → training  when the provider ACCEPTS the run
 *   training → trained  ONLY with a real trainedModelRef from the provider
 *   training → failed   with the provider's reason — never a fake success
 *
 * Provider cost ~$2-5 per run (Replicate GPU time); the credit charge
 * happened at kickoff. Requires LIKENESS_TRAINING_ENABLED=1 (operator flag).
 */

interface LikenessTrainPayload {
  jobId: string;
  workspaceId: string;
  artistId: string;
  consentId: string;
  likenessIds: string[];
  triggerWord: string;
  destination: string;
}

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

async function setStatuses(
  p: LikenessTrainPayload,
  ids: string[],
  from: LikenessStatus[],
  to: LikenessStatus,
  metaPatch: Record<string, unknown>
): Promise<number> {
  // Merge meta per row (jsonb concatenation) so provenance accumulates
  // instead of being overwritten. Status guard keeps transitions legal.
  const rows = (await prisma.artistLikeness.findMany({
    where: {
      id: { in: ids },
      workspaceId: p.workspaceId,
      artistId: p.artistId,
      consentId: p.consentId,
      deletedAt: null,
      status: { in: from },
    },
    select: { id: true, status: true, meta: true },
  })) as Array<{ id: string; status: string; meta: unknown }>;
  let updated = 0;
  for (const row of rows) {
    const event: LikenessStatusEvent =
      to === "training"
        ? { type: "training_started" }
        : to === "trained"
          ? {
              type: "training_succeeded",
              trainedModelRef: String(metaPatch.trainedModelRef ?? ""),
            }
          : { type: "training_failed", reason: String(metaPatch.error ?? "unknown") };
    const legal = nextLikenessStatus(row.status as LikenessStatus, event);
    if (legal !== to) continue;
    const currentMeta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const { trainedModelRef, ...restPatch } = metaPatch;
    await prisma.artistLikeness.update({
      where: { id: row.id },
      data: {
        status: to,
        ...(typeof trainedModelRef === "string" && trainedModelRef
          ? { trainedModelRef }
          : {}),
        meta: { ...currentMeta, ...restPatch } as never,
      },
    });
    updated += 1;
  }
  return updated;
}

export async function processLikenessTrain(p: LikenessTrainPayload) {
  await markRunning(p.jobId);
  let movedToTraining = false;
  try {
    // ---- Re-run the whole gate against live state (fail closed) ----
    if ((process.env.LIKENESS_TRAINING_ENABLED ?? "0") !== "1") {
      await markFailed(
        p.jobId,
        "likeness_training_disabled: the operator has not set LIKENESS_TRAINING_ENABLED=1"
      );
      return;
    }
    const consent = await prisma.likenessConsent.findFirst({
      where: {
        id: p.consentId,
        workspaceId: p.workspaceId,
        artistId: p.artistId,
      },
      select: { id: true, revokedAt: true },
    });
    const photos = (await prisma.artistLikeness.findMany({
      where: {
        id: { in: p.likenessIds },
        workspaceId: p.workspaceId,
        artistId: p.artistId,
        consentId: p.consentId,
        kind: "photo",
        deletedAt: null,
      },
      select: { id: true, url: true, meta: true },
    })) as Array<{ id: string; url: string; meta: unknown }>;

    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const apiKey =
      ws?.musicProvider === "replicate"
        ? (openSecret(ws.musicApiKey) ?? undefined)
        : undefined;

    const gate = likenessTrainingGate({
      trainingEnabled: true,
      photoCount: photos.length,
      consentRecorded: !!consent,
      consentRevoked: !!consent?.revokedAt,
      replicateConfigured: Boolean(
        apiKey || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN
      ),
      destinationConfigured: isValidLikenessModelSlug(p.destination),
    });
    if (!gate.ok) {
      await markFailed(p.jobId, `likeness_training_refused: ${gate.reasons.join(" ")}`);
      return;
    }
    if (photos.length < MIN_LIKENESS_TRAINING_PHOTOS) {
      // Unreachable given the gate, kept as a hard floor.
      await markFailed(p.jobId, "likeness_training_refused: not enough photos");
      return;
    }

    // ---- Build the training zip from the artist's own photos ----
    const zip = new JSZip();
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index]!;
      const bytes = await downloadToBuffer(photo.url, {
        maxBytes: MAX_PHOTO_BYTES,
        timeoutMs: 120_000,
      });
      const meta =
        photo.meta && typeof photo.meta === "object" && !Array.isArray(photo.meta)
          ? (photo.meta as Record<string, unknown>)
          : {};
      const format = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpg";
      zip.file(`photo_${String(index + 1).padStart(2, "0")}.${format}`, bytes);
    }
    const zipBytes = await zip.generateAsync({
      type: "nodebuffer",
      compression: "STORE", // images are already compressed
    });
    const zipHash = createHash("sha256").update(zipBytes).digest("hex");
    const zipRef = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: "likeness/datasets",
      bytes: zipBytes,
      contentType: "application/zip",
      ext: "zip",
    });
    const providerZipUrl = await resolveAssetForProvider(zipRef, 3600);

    // ---- Kick off training on Replicate ----
    const config = likenessTrainerConfig();
    await ensureDestinationModel(p.destination, apiKey);
    const training = await startLikenessTraining({
      config,
      destination: p.destination,
      inputImagesUrl: providerZipUrl,
      triggerWord: p.triggerWord,
      apiKey,
    });

    movedToTraining =
      (await setStatuses(p, p.likenessIds, ["pending", "trained", "failed"], "training", {
        trainingJobId: p.jobId,
        trainingId: training.id,
        trainer: config.model,
        triggerWord: p.triggerWord,
        datasetZipRef: zipRef,
        datasetZipHash: zipHash,
        rightsBasis: LIKENESS_RIGHTS_BASIS,
      })) > 0;

    await prisma.providerJob.updateMany({
      where: { id: p.jobId, workspaceId: p.workspaceId },
      data: {
        externalId: training.id,
        outputJson: {
          state: "training_started",
          trainingId: training.id,
          trainer: config.model,
          photoCount: photos.length,
          datasetZipHash: zipHash,
        } as never,
      },
    });

    // ---- Poll to a TERMINAL provider state — no optimistic completion ----
    const maxAttempts = Math.max(
      1,
      Math.min(240, Number(process.env.LIKENESS_POLL_MAX_ATTEMPTS ?? 120) || 120)
    );
    const delayMs = Math.max(
      2_000,
      Math.min(60_000, Number(process.env.LIKENESS_POLL_DELAY_MS ?? 15_000) || 15_000)
    );
    let state = training;
    let attempts = 0;
    while (state.status === "starting" || state.status === "processing") {
      if (attempts >= maxAttempts) {
        throw new Error(
          "likeness training timed out before confirmed completion — it may still finish on the provider; retry to resync"
        );
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      attempts += 1;
      state = await getLikenessTraining(training.id, apiKey);
    }

    if (state.status !== "succeeded") {
      const reason = state.error?.slice(0, 300) || `likeness training ${state.status}`;
      await setStatuses(p, p.likenessIds, ["training"], "failed", {
        error: reason,
        failedAt: new Date().toISOString(),
      });
      await markFailed(p.jobId, `likeness_training_failed: ${reason}`);
      return;
    }

    const trainedModelRef = trainedModelRefFromOutput(state.output);
    if (!trainedModelRef) {
      // Provider says "succeeded" with no usable artifact — that is a FAILURE.
      const reason = "trained_model_artifact_missing";
      await setStatuses(p, p.likenessIds, ["training"], "failed", {
        error: reason,
        failedAt: new Date().toISOString(),
      });
      await markFailed(p.jobId, `likeness_training_failed: ${reason}`);
      return;
    }

    const trainedAt = new Date().toISOString();
    const trainedCount = await setStatuses(
      p,
      p.likenessIds,
      ["training"],
      "trained",
      {
        trainedModelRef,
        trainingId: training.id,
        trainer: config.model,
        triggerWord: p.triggerWord,
        trainedAt,
        rightsBasis: LIKENESS_RIGHTS_BASIS,
      }
    );
    if (trainedCount === 0) {
      // Consent revoked / photos deleted while training ran — the model must
      // not become usable. Honest failure; the operator can clean the
      // destination version manually (reported in the error).
      await markFailed(
        p.jobId,
        `likeness_training_orphaned: training ${training.id} finished but no photo rows were eligible to persist it (consent revoked or photos removed mid-run). Trained version ${trainedModelRef} in ${p.destination} should be deleted from the provider.`
      );
      return;
    }

    await markSucceeded(p.jobId, {
      state: "trained",
      trainedModelRef,
      trainingId: training.id,
      trainer: config.model,
      triggerWord: p.triggerWord,
      photoCount: photos.length,
      trainedPhotoRows: trainedCount,
      datasetZipHash: zipHash,
      rightsBasis: LIKENESS_RIGHTS_BASIS,
      trainedAt,
    });
  } catch (error) {
    if (movedToTraining) {
      await setStatuses(p, p.likenessIds, ["training"], "failed", {
        error: (error as Error).message?.slice(0, 300) ?? "unknown",
        failedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
    await markFailed(p.jobId, error);
  }
}
