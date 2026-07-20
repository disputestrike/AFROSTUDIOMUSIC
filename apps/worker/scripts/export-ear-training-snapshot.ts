/** Export the active, byte-bound AfroOne training corpus for holdout freezing. */
import { createHash } from "node:crypto";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@afrohit/db";
import {
  EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION,
  parseEarTrainingSnapshot,
} from "../src/lib/ear-corpus";
import { ACTIVE_MUSIC_MODEL_SETTING_KEY } from "../src/lib/training-flywheel";

type JsonRecord = Record<string, unknown>;
const args = process.argv.slice(2).filter(value => value !== "--");

function valueFor(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

async function main(): Promise<void> {
  const outputArgument = valueFor("--output");
  if (!outputArgument) throw new Error("--output is required");
  const output = resolve(outputArgument);
  try {
    await lstat(output);
    if (!args.includes("--replace"))
      throw new Error(`${output} already exists; use --replace for an intentional refresh`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const routeSetting = await prisma.systemSetting.findUnique({
    where: { key: ACTIVE_MUSIC_MODEL_SETTING_KEY },
    select: { value: true },
  });
  const route = record(routeSetting?.value ? JSON.parse(routeSetting.value) : null);
  const active = record(route.active);
  const providerJobId =
    typeof active.providerJobId === "string" ? active.providerJobId : null;
  const datasetHash =
    typeof active.datasetHash === "string" ? active.datasetHash : null;
  if (!providerJobId || !datasetHash)
    throw new Error("the active AfroOne route has no bound training job and dataset hash");

  const job = await prisma.providerJob.findUnique({
    where: { id: providerJobId },
    select: { kind: true, status: true, inputJson: true },
  });
  if (!job || job.kind !== "music-training" || job.status !== "SUCCEEDED")
    throw new Error("the active AfroOne training receipt is missing or not successful");
  const input = record(job.inputJson);
  if (input.datasetHash !== datasetHash || !Array.isArray(input.trainingAssets))
    throw new Error("the active route and training receipt dataset do not match");

  const assets = input.trainingAssets.map((value, index) => {
    const row = record(value);
    if (
      typeof row.id !== "string" ||
      typeof row.contentHash !== "string" ||
      typeof row.sourceFamilyId !== "string"
    )
      throw new Error(
        `trainingAssets[${index}] lacks id, contentHash, or sourceFamilyId; run one training snapshot with the upgraded lineage code before freezing the holdout`
      );
    return {
      id: row.id,
      contentHash: row.contentHash,
      sourceFamilyId: row.sourceFamilyId,
    };
  });
  const snapshot = parseEarTrainingSnapshot({
    schemaVersion: EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    datasetHash,
    assets,
  });
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + "\n");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, output);
  console.log(`Exported ${assets.length} active training assets to ${output}`);
  console.log(`Training snapshot SHA-256: ${hash}`);
}

void main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
