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
import { isOutsideRenderLearningEnabled, prisma } from "@afrohit/db";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import {
  beatIngredientIds,
  manifestFromCatalog,
  resolveTrainingConsent,
  TRAINING_LICENSE_CLAUSE,
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

/** Workspaces holding a VALID recorded training-license grant — resolved
 *  through the same pure fail-closed resolver as the API, hash-verified
 *  against the current clause (the consent DOOR, 2026-07-19). */
async function consentedWorkspaceIds(): Promise<Set<string>> {
  const expectedHash = createHash("sha256")
    .update(TRAINING_LICENSE_CLAUSE, "utf8")
    .digest("hex");
  const rows = await prisma.trainingConsent.findMany({
    where: { revokedAt: null },
    select: { workspaceId: true, consentVersion: true, signedAt: true, consentTextHash: true, revokedAt: true },
    orderBy: { signedAt: "desc" },
    take: 10000,
  });
  const granted = new Set<string>();
  for (const row of rows) {
    if (granted.has(row.workspaceId)) continue;
    const verdict = resolveTrainingConsent(
      { version: row.consentVersion, acceptedAt: row.signedAt, textHash: row.consentTextHash, revokedAt: row.revokedAt },
      { expectedHash }
    );
    if (verdict.granted && verdict.current) granted.add(row.workspaceId);
  }
  return granted;
}

/** Merge two manifests (consented + unconsented splits) into one. */
function mergeManifests(a: TrainingManifest, b: TrainingManifest): TrainingManifest {
  const byOrigin: Record<string, number> = { ...a.counts.byOrigin };
  for (const [k, v] of Object.entries(b.counts.byOrigin)) byOrigin[k] = (byOrigin[k] ?? 0) + v;
  return {
    eligible: [...a.eligible, ...b.eligible],
    rejected: [...a.rejected, ...b.rejected],
    counts: { total: a.counts.total + b.counts.total, byOrigin: byOrigin as TrainingManifest["counts"]["byOrigin"] },
  } as TrainingManifest;
}

/** Live catalog read (worker-side twin of the API's admin manifest read —
 *  the CLASSIFICATION is the shared pure law, only the query is local).
 *  PER-WORKSPACE CONSENT (the audit's root defect fixed): rows from workspaces
 *  with a valid recorded grant are classified consentGranted=true, so their
 *  user-original catalog (the owner's masters, artists' consented uploads)
 *  finally reaches the trainer. Everyone else stays fail-closed. */
async function liveManifest(): Promise<{
  manifest: TrainingManifest;
  urlById: Map<string, string>;
}> {
  const take = 5000;
  const [materials, beats, vocals, granted] = await Promise.all([
    prisma.materialAsset.findMany({
      where: { readiness: "ready", qualityState: { notIn: ["failed", "duplicate"] } },
      select: { id: true, source: true, rightsBasis: true, url: true, workspaceId: true },
      take,
    }),
    prisma.beatAsset.findMany({
      where: { approved: true },
      select: { id: true, provider: true, meta: true, url: true, project: { select: { workspaceId: true } } },
      take,
    }),
    prisma.vocalRender.findMany({
      where: { approved: true },
      select: { id: true, performanceSource: true, url: true, project: { select: { workspaceId: true } } },
      take,
    }),
    consentedWorkspaceIds(),
  ]);
  // INGREDIENT LINEAGE (owner incident 2026-07-19 "why only 38?"): assembled
  // beds (provider 'material') classified UNKNOWN because their rights live in
  // the ingredient loops. Resolve every bed's meta.materialIds -> rightsBasis
  // in one batch; the pure classifier then rates each bed by its dirtiest loop.
  const allIngredientIds = [
    ...new Set(beats.flatMap(row => beatIngredientIds(row.meta))),
  ];
  const rightsById = new Map<string, string | null>();
  if (allIngredientIds.length) {
    const rows = await prisma.materialAsset.findMany({
      where: { id: { in: allIngredientIds } },
      select: { id: true, rightsBasis: true },
    });
    for (const row of rows) rightsById.set(row.id, row.rightsBasis);
  }
  const enrichedBeats = beats.map(row => {
    const ids = beatIngredientIds(row.meta);
    return ids.length
      ? { ...row, ingredientRights: ids.map(id => rightsById.get(id) ?? "unknown") }
      : row;
  });
  const isGranted = (ws?: string | null) => !!ws && granted.has(ws);
  const split = <T>(rows: T[], ws: (r: T) => string | null | undefined) => ({
    yes: rows.filter(r => isGranted(ws(r))),
    no: rows.filter(r => !isGranted(ws(r))),
  });
  const m = split(materials, r => r.workspaceId);
  const b = split(enrichedBeats, r => r.project?.workspaceId);
  const v = split(vocals, r => r.project?.workspaceId);
  // OUTSIDE-RENDER LEARNING: same operator toggle the API manifest honors —
  // one law, two callers, zero drift. Fail-closed; provenance labels survive.
  const policy = { allowThirdPartyRenders: await isOutsideRenderLearningEnabled() };
  if (policy.allowThirdPartyRenders) {
    console.warn("[flywheel] OUTSIDE-RENDER LEARNING is ON (operator override) — third-party renders admitted as fuel, labeled third-party-render");
  }
  const manifest = mergeManifests(
    manifestFromCatalog({ materials: m.yes, beats: b.yes, vocals: v.yes }, true, policy),
    manifestFromCatalog({ materials: m.no, beats: b.no, vocals: v.no }, false, policy)
  );
  const urlById = new Map<string, string>();
  for (const row of materials) urlById.set(`material:${row.id}`, row.url);
  for (const row of beats) urlById.set(`beat:${row.id}`, row.url);
  for (const row of vocals) urlById.set(`vocal:${row.id}`, row.url);
  console.log(
    `[flywheel] consent door: ${granted.size} workspace(s) granted — eligible ${manifest.eligible.length} of ${manifest.counts.total}`
  );
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
