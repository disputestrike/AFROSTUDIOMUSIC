/**
 * Build the private, immutable nine-track ear holdout from operator-cleared
 * audio. Audio and the training snapshot remain under py/fixtures/.gitignore;
 * only the hash-pinned manifest is suitable for Git.
 *
 * pnpm --filter @afrohit/worker exec tsx scripts/freeze-ear-corpus.ts -- \
 *   --draft C:/acceptance/ear-candidates.json \
 *   --source-root C:/acceptance/audio \
 *   --training-snapshot C:/acceptance/training-snapshot.json
 */
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  EAR_CORPUS_SCHEMA_VERSION,
  EAR_HOLDOUT_PURPOSE,
  EAR_STEMS,
  parseEarTrainingSnapshot,
  validateEarCorpusManifest,
  type EarCorpusFile,
} from "../src/lib/ear-corpus";

type JsonRecord = Record<string, unknown>;
const args = process.argv.slice(2).filter(value => value !== "--");

function valueFor(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function flag(name: string): boolean {
  return args.includes(name);
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length)
    fail(`${label} has unsupported fields: ${unexpected.join(", ")}`);
}

function textField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required`);
  return value.trim();
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../") && !isAbsolute(rel))
  );
}

async function copySourceAudio(input: {
  sourceRoot: string;
  sourceRootReal: string;
  sourcePath: unknown;
  destinationRoot: string;
  destinationPath: string;
  label: string;
}): Promise<EarCorpusFile> {
  const relativeSource = textField(input.sourcePath, input.label);
  if (isAbsolute(relativeSource)) fail(`${input.label} must be relative to --source-root`);
  const source = resolve(input.sourceRoot, relativeSource);
  if (!inside(input.sourceRoot, source)) fail(`${input.label} escapes --source-root`);
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink())
    fail(`${input.label} must be a regular file, not a link`);
  const sourceReal = await realpath(source);
  if (!inside(input.sourceRootReal, sourceReal))
    fail(`${input.label} resolves outside --source-root`);
  const extension = extname(source).toLowerCase();
  if (![".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a", ".ogg", ".webm"].includes(extension))
    fail(`${input.label} has an unsupported audio extension`);
  const destination = resolve(input.destinationRoot, input.destinationPath + extension);
  if (!inside(input.destinationRoot, destination))
    fail(`${input.label} produced an unsafe destination path`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return {
    path: relative(input.destinationRoot, destination).replace(/\\/g, "/"),
    sha256: await sha256(destination),
  };
}

async function main(): Promise<void> {
  const draftPath = valueFor("--draft");
  const sourceRootArgument = valueFor("--source-root");
  const snapshotArgument = valueFor("--training-snapshot");
  if (!draftPath || !sourceRootArgument || !snapshotArgument) {
    fail("--draft, --source-root, and --training-snapshot are required");
  }
  const sourceRoot = resolve(sourceRootArgument);
  const sourceRootReal = await realpath(sourceRoot);
  const outputRoot = resolve(valueFor("--output-root") ?? join(process.cwd(), "py", "fixtures"));
  const outputManifest = resolve(valueFor("--output") ?? join(outputRoot, "manifest.json"));
  if (!inside(outputRoot, outputManifest)) fail("--output must remain under --output-root");

  const draft = record(JSON.parse(await readFile(resolve(draftPath), "utf8")), "draft");
  exactKeys(draft, ["schemaVersion", "frozenBy", "tracks"], "draft");
  if (draft.schemaVersion !== 1) fail("draft.schemaVersion must be 1");
  const frozenBy = textField(draft.frozenBy, "draft.frozenBy");
  if (!Array.isArray(draft.tracks) || draft.tracks.length !== 9)
    fail("draft.tracks must contain exactly nine candidates");

  const snapshotPath = resolve(snapshotArgument);
  const snapshotBytes = await readFile(snapshotPath);
  parseEarTrainingSnapshot(JSON.parse(snapshotBytes.toString("utf8")));
  const snapshotHash = createHash("sha256").update(snapshotBytes).digest("hex");
  const stagingRoot = await mkdtemp(join(tmpdir(), "afrohit-ear-freeze-"));
  try {
    const corpusFolder = "ear-holdout-v1";
    const stagedSnapshot = join(stagingRoot, corpusFolder, "training-snapshot.json");
    await mkdir(dirname(stagedSnapshot), { recursive: true });
    await writeFile(stagedSnapshot, snapshotBytes);

    const tracks = [];
    for (const [index, raw] of draft.tracks.entries()) {
      const label = `draft.tracks[${index}]`;
      const row = record(raw, label);
      exactKeys(
        row,
        [
          "id",
          "genre",
          "sourceAssetIds",
          "sourceFamilyId",
          "recordingType",
          "expectTempoBpm",
          "fourOnFloor",
          "path",
          "stems",
          "rights",
        ],
        label
      );
      const id = textField(row.id, `${label}.id`);
      if (!/^[a-z0-9][a-z0-9._-]+$/.test(id))
        fail(`${label}.id has an invalid format`);
      const mix = await copySourceAudio({
        sourceRoot,
        sourceRootReal,
        sourcePath: row.path,
        destinationRoot: stagingRoot,
        destinationPath: `${corpusFolder}/${id}/mix`,
        label: `${label}.path`,
      });
      const stemRows = record(row.stems, `${label}.stems`);
      exactKeys(stemRows, [...EAR_STEMS], `${label}.stems`);
      const stems = Object.fromEntries(
        await Promise.all(
          EAR_STEMS.map(async stem => [
            stem,
            await copySourceAudio({
              sourceRoot,
              sourceRootReal,
              sourcePath: stemRows[stem],
              destinationRoot: stagingRoot,
              destinationPath: `${corpusFolder}/${id}/stems/${stem}`,
              label: `${label}.stems.${stem}`,
            }),
          ])
        )
      );
      tracks.push({
        id,
        ...mix,
        genre: row.genre,
        sourceAssetIds: row.sourceAssetIds,
        sourceFamilyId: row.sourceFamilyId,
        recordingType: row.recordingType,
        expectTempoBpm: row.expectTempoBpm,
        fourOnFloor: row.fourOnFloor,
        stems,
        rights: row.rights,
      });
    }

    const manifest = {
      schemaVersion: EAR_CORPUS_SCHEMA_VERSION,
      freeze: {
        purpose: EAR_HOLDOUT_PURPOSE,
        frozenAt: new Date().toISOString(),
        frozenBy,
        selectionMethod: "rights-cleared-stratified-holdout",
        trainingSnapshot: {
          path: `${corpusFolder}/training-snapshot.json`,
          sha256: snapshotHash,
        },
      },
      tracks,
    };
    const validated = await validateEarCorpusManifest(manifest, stagingRoot);
    console.log(`Validated frozen holdout ${validated.corpusHash}`);
    console.log("Genre balance: 3 amapiano, 3 afrobeats, 3 house");
    console.log(`Training snapshot: ${validated.trainingSnapshotHash}`);
    console.log("Leakage checks: source IDs, source families, and audio hashes clear");
    if (flag("--dry-run")) return;

    await mkdir(outputRoot, { recursive: true });
    const targetCorpus = join(outputRoot, corpusFolder);
    try {
      await lstat(targetCorpus);
      if (!flag("--replace"))
        fail(`${targetCorpus} already exists; use --replace only for an intentional refreeze`);
      await rm(targetCorpus, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(join(stagingRoot, corpusFolder), targetCorpus);
    const manifestTemp = `${outputManifest}.${process.pid}.tmp`;
    await writeFile(manifestTemp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await rename(manifestTemp, outputManifest);
    console.log(`Private audio: ${targetCorpus}`);
    console.log(`Git-safe manifest: ${outputManifest}`);
    console.log(`Do not commit ${basename(targetCorpus)} audio or its training snapshot.`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
