/**
 * THE TRAINING FLYWHEEL (P3 — owner approval 2026-07-19: "CONTINUE UNTIL P3
 * IS BUILT"). Nightly, the worker:
 *
 *   1. builds the rights-gated training manifest from the REAL catalog
 *      (same pure law as the API admin manifest: own-master + licensed +
 *      live-session + CONSENTED user-original; MiniMax/Suno/MusicGen NEVER),
 *   2. zips the eligible audio into a dataset in OUR storage,
 *   3. kicks off the music fine-tune on the operator-configured trainer.
 *
 * EVERY GATE IS HONEST AND OFF BY DEFAULT (the owner's two laws — "not a
 * dime" + "everything trains" — meet here): MUSIC_TRAINER_ENABLED=1 AND
 * MUSIC_TRAINER_MODEL/VERSION must be set or this logs its skip reason and
 * spends nothing. When the corpus is under MUSIC_TRAINER_MIN_CORPUS it
 * reports "keep accumulating" — the flywheel spins the moment the operator
 * arms it and the shelf is big enough. Every run files a providerJob receipt
 * (kind 'music-training') so kickoffs are auditable.
 */
import { prisma } from "@afrohit/db";
import JSZip from "jszip";
import {
  manifestFromCatalog,
  type TrainingManifest,
} from "@afrohit/shared";
import {
  musicTrainerEnabled,
  musicTrainerConfig,
  minCorpusSize,
  kickoffMusicTraining,
} from "@afrohit/ai";
import { downloadToBuffer, uploadBytes } from "./storage";

/** Cap the dataset zip so one nightly run can't swallow the disk/egress. */
const MAX_DATASET_ASSETS = Math.max(
  1,
  Number.parseInt(process.env.MUSIC_TRAINER_MAX_ASSETS ?? "200", 10) || 200
);

interface FlywheelResult {
  ran: boolean;
  reason?: string;
  eligible?: number;
  zipped?: number;
  trainingId?: string;
}

/** Live catalog read (worker-side twin of the API's admin manifest read —
 *  the CLASSIFICATION is the shared pure law, only the query is local). */
async function liveManifest(): Promise<{
  manifest: TrainingManifest;
  urlById: Map<string, string>;
}> {
  const take = 5000;
  const [materials, beats, vocals] = await Promise.all([
    prisma.materialAsset.findMany({
      where: { readiness: "ready", qualityState: { notIn: ["failed", "duplicate"] } },
      select: { id: true, source: true, rightsBasis: true, url: true },
      take,
    }),
    prisma.beatAsset.findMany({
      where: { approved: true },
      select: { id: true, provider: true, meta: true, url: true },
      take,
    }),
    prisma.vocalRender.findMany({
      where: { approved: true },
      select: { id: true, performanceSource: true, url: true },
      take,
    }),
  ]);
  // Consent stays FALSE here: the nightly flywheel trains on the house-clean
  // set only. Consented user-original joins via the admin manifest flow where
  // the consent resolver is wired (fails closed by design).
  const manifest = manifestFromCatalog({ materials, beats, vocals }, false);
  const urlById = new Map<string, string>();
  for (const m of materials) urlById.set(`material:${m.id}`, m.url);
  for (const b of beats) urlById.set(`beat:${b.id}`, b.url);
  for (const v of vocals) urlById.set(`vocal:${v.id}`, v.url);
  return { manifest, urlById };
}

export async function runTrainingFlywheel(): Promise<FlywheelResult> {
  // Gate 1+2 — operator arming (honest no-op, zero spend, reason logged).
  if (!musicTrainerEnabled()) {
    console.log("[flywheel] skipped: MUSIC_TRAINER_ENABLED is not set");
    return { ran: false, reason: "trainer disabled (MUSIC_TRAINER_ENABLED)" };
  }
  if (!musicTrainerConfig()) {
    console.log("[flywheel] skipped: trainer unconfigured (MUSIC_TRAINER_MODEL/VERSION)");
    return { ran: false, reason: "trainer unconfigured" };
  }

  const { manifest, urlById } = await liveManifest();
  if (manifest.eligible.length < minCorpusSize()) {
    console.log(
      `[flywheel] corpus too small (${manifest.eligible.length} < ${minCorpusSize()}) — keep accumulating`
    );
    return { ran: false, reason: "corpus too small", eligible: manifest.eligible.length };
  }

  // Zip the eligible audio (capped) into our own storage.
  const zip = new JSZip();
  let zipped = 0;
  for (const asset of manifest.eligible.slice(0, MAX_DATASET_ASSETS)) {
    const url = urlById.get(asset.id);
    if (!url) continue;
    try {
      const bytes = await downloadToBuffer(url);
      zip.file(`dataset/${asset.id.replace(/[^a-zA-Z0-9_-]+/g, "_")}.wav`, bytes);
      zipped += 1;
    } catch (err) {
      console.warn(`[flywheel] skipped ${asset.id}: ${(err as Error)?.message?.slice(0, 80)}`);
    }
  }
  if (!zipped) return { ran: false, reason: "no asset bytes reachable", eligible: manifest.eligible.length };
  const zipBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const datasetZipUrl = await uploadBytes({
    workspaceId: "training",
    kind: "datasets",
    bytes: zipBytes,
    contentType: "application/zip",
    ext: "zip",
  });

  // Kickoff (all gates re-checked inside; rights re-validated; never throws for policy).
  const result = await kickoffMusicTraining({ manifest, datasetZipUrl });
  // Receipt — every kickoff (or refusal) is auditable.
  await prisma.providerJob.create({
    data: {
      workspaceId: "training",
      kind: "music-training",
      provider: "replicate",
      status: result.started ? "RUNNING" : "FAILED",
      inputJson: {
        datasetZipUrl,
        eligible: manifest.eligible.length,
        zipped,
        byOrigin: manifest.counts.byOrigin,
      } as never,
      ...(result.started
        ? { outputJson: { trainingId: result.trainingId, model: result.model, version: result.version } as never }
        : { errorJson: { message: result.reason } as never }),
    },
  }).catch((err) => console.warn(`[flywheel] receipt failed: ${(err as Error)?.message?.slice(0, 80)}`));

  console.log(
    result.started
      ? `[flywheel] TRAINING STARTED: ${result.trainingId} (${zipped} assets)`
      : `[flywheel] kickoff refused: ${result.reason}`
  );
  return { ran: result.started, reason: result.reason, eligible: manifest.eligible.length, zipped, trainingId: result.trainingId };
}
