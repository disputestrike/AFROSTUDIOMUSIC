import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EAR_CORPUS_SCHEMA_VERSION,
  EAR_HOLDOUT_PURPOSE,
  EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION,
  LOGDRUM_CALIBRATION_SCHEMA_VERSION,
  calibrationGateStatus,
  earHoldoutExclusions,
  signCalibrationArtifact,
  validateEarCorpusManifest,
} from "../src/lib/ear-corpus";
import { logDrumScoreForCalibration } from "./eval-ear";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

async function expectReject(name: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(name, false);
  } catch {
    check(name, true);
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "afrohit-ear-corpus-"));
  try {
    let seed = 1;
    const addFile = async (path: string) => {
      const samples = 2_048;
      const bytes = Buffer.alloc(44 + samples * 2);
      bytes.write("RIFF", 0, "ascii");
      bytes.writeUInt32LE(bytes.length - 8, 4);
      bytes.write("WAVEfmt ", 8, "ascii");
      bytes.writeUInt32LE(16, 16);
      bytes.writeUInt16LE(1, 20);
      bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(44_100, 24);
      bytes.writeUInt32LE(88_200, 28);
      bytes.writeUInt16LE(2, 32);
      bytes.writeUInt16LE(16, 34);
      bytes.write("data", 36, "ascii");
      bytes.writeUInt32LE(samples * 2, 40);
      const amplitude = 500 + seed++;
      for (let index = 0; index < samples; index++)
        bytes.writeInt16LE(Math.round(Math.sin(index / 10) * amplitude), 44 + index * 2);
      const absolute = join(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
      return {
        path: path.replace(/\\/g, "/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    };

    const genres = [
      "amapiano",
      "amapiano",
      "amapiano",
      "afrobeats",
      "afrobeats",
      "afrobeats",
      "house",
      "house",
      "house",
    ] as const;
    const tracks = [];
    for (const [index, genre] of genres.entries()) {
      const id = `${genre}-${String(index + 1).padStart(2, "0")}`;
      tracks.push({
        id,
        ...(await addFile(`${id}.wav`)),
        genre,
        sourceAssetIds: [`beat:holdout-${index + 1}`],
        sourceFamilyId: `song:holdout-${index + 1}`,
        recordingType:
          index % 2
            ? "licensed-reference-recording"
            : "human-produced-master",
        expectTempoBpm:
          genre === "house" ? 124 : genre === "amapiano" ? 112 : 104,
        fourOnFloor: genre !== "afrobeats",
        stems: {
          bass: await addFile(`stems/${id}/bass.wav`),
          drums: await addFile(`stems/${id}/drums.wav`),
          other: await addFile(`stems/${id}/other.wav`),
          vocals: await addFile(`stems/${id}/vocals.wav`),
        },
        rights: {
          basis: index % 2 ? "licensed-evaluation" : "owned-master",
          reference: `rights-record-${index + 1}`,
          attestedBy: "AfroHit acceptance operator",
          attestedAt: new Date(Date.now() - 60_000).toISOString(),
        },
      });
    }
    const trainingSnapshot = {
      schemaVersion: EAR_TRAINING_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: new Date(Date.now() - 120_000).toISOString(),
      datasetHash: "f".repeat(64),
      assets: Array.from({ length: 3 }, (_, index) => ({
        id: `beat:training-${index + 1}`,
        contentHash: createHash("sha256")
          .update(`training-${index + 1}`)
          .digest("hex"),
        sourceFamilyId: `song:training-${index + 1}`,
      })),
    };
    const trainingSnapshotBytes = Buffer.from(
      JSON.stringify(trainingSnapshot, null, 2) + "\n"
    );
    await writeFile(join(root, "training-snapshot.json"), trainingSnapshotBytes);
    const manifest = {
      schemaVersion: EAR_CORPUS_SCHEMA_VERSION,
      freeze: {
        purpose: EAR_HOLDOUT_PURPOSE,
        frozenAt: new Date(Date.now() - 60_000).toISOString(),
        frozenBy: "AfroHit acceptance operator",
        selectionMethod: "rights-cleared-stratified-holdout",
        trainingSnapshot: {
          path: "training-snapshot.json",
          sha256: createHash("sha256").update(trainingSnapshotBytes).digest("hex"),
        },
      },
      tracks,
    };
    const validated = await validateEarCorpusManifest(manifest, root);
    check(
      "exactly nine hash-verified filesets pass",
      validated.tracks.length === 9
    );
    check(
      "corpus requires three tracks per genre",
      Object.values(validated.genreCounts).every(count => count === 3)
    );
    check(
      "corpus emits a SHA-256 fingerprint",
      /^[a-f0-9]{64}$/.test(validated.corpusHash)
    );
    check(
      "corpus is frozen against a hash-pinned training snapshot",
      validated.leakageVerified === true &&
        validated.trainingSnapshotHash === manifest.freeze.trainingSnapshot.sha256
    );
    const exclusions = earHoldoutExclusions(manifest);
    check(
      "future training receives source, family, and byte exclusions",
      exclusions.sourceAssetIds.size === 9 &&
        exclusions.sourceFamilyIds.size === 9 &&
        exclusions.contentHashes.size === 45
    );

    const reordered = {
      ...manifest,
      tracks: [...manifest.tracks].reverse(),
    };
    const reorderedResult = await validateEarCorpusManifest(reordered, root);
    check(
      "corpus fingerprint is independent of manifest row order",
      reorderedResult.corpusHash === validated.corpusHash
    );

    const bootstrapScores = [
      0.72, 0.68, 0.64, 0.31, 0.27, 0.22, 0.34, 0.29, 0.25,
    ].map(value => logDrumScoreForCalibration({ source: "inferred", value }));
    check(
      "computed inferred log-drum scores can bootstrap calibration",
      bootstrapScores.every(score => score !== null) &&
        Math.min(...(bootstrapScores.slice(0, 3) as number[])) >
          Math.max(...(bootstrapScores.slice(3) as number[]))
    );
    check(
      "unknown, missing, or non-finite scores cannot pass calibration",
      logDrumScoreForCalibration({ source: "unknown", value: 0.9 }) === null &&
        logDrumScoreForCalibration({ source: "inferred" }) === null &&
        logDrumScoreForCalibration(undefined) === null &&
        logDrumScoreForCalibration({ source: "inferred", value: NaN }) ===
          null &&
        logDrumScoreForCalibration({
          source: "measured",
          value: Number.POSITIVE_INFINITY,
        }) === null
    );

    const duplicateId = structuredClone(manifest);
    duplicateId.tracks[1]!.id = duplicateId.tracks[0]!.id;
    await expectReject("duplicate track IDs are rejected", () =>
      validateEarCorpusManifest(duplicateId, root)
    );

    const wrongHash = structuredClone(manifest);
    wrongHash.tracks[0]!.sha256 = "0".repeat(64);
    await expectReject("content hash mismatches are rejected", () =>
      validateEarCorpusManifest(wrongHash, root)
    );

    const fakeAudio = structuredClone(manifest);
    const fakePath = join(root, "placeholder.wav");
    const fakeBytes = Buffer.alloc(2_048, 7);
    await writeFile(fakePath, fakeBytes);
    fakeAudio.tracks[0]!.path = "placeholder.wav";
    fakeAudio.tracks[0]!.sha256 = createHash("sha256")
      .update(fakeBytes)
      .digest("hex");
    await expectReject("non-audio placeholder bytes are rejected", () =>
      validateEarCorpusManifest(fakeAudio, root)
    );

    const missingRights = structuredClone(manifest) as unknown as {
      tracks: Array<{ rights?: unknown }>;
    };
    delete missingRights.tracks[0]!.rights;
    await expectReject("missing rights attestations are rejected", () =>
      validateEarCorpusManifest(missingRights, root)
    );

    const unbalanced = structuredClone(manifest);
    unbalanced.tracks[0]!.genre = "house";
    await expectReject("unbalanced genre coverage is rejected", () =>
      validateEarCorpusManifest(unbalanced, root)
    );

    const sourceLeak = structuredClone(manifest);
    sourceLeak.tracks[0]!.sourceAssetIds = [trainingSnapshot.assets[0]!.id];
    await expectReject("training source identity leakage is rejected", () =>
      validateEarCorpusManifest(sourceLeak, root)
    );

    const familyLeak = structuredClone(manifest);
    familyLeak.tracks[0]!.sourceFamilyId =
      trainingSnapshot.assets[0]!.sourceFamilyId;
    await expectReject("training lineage-family leakage is rejected", () =>
      validateEarCorpusManifest(familyLeak, root)
    );

    const hashLeakSnapshot = structuredClone(trainingSnapshot);
    hashLeakSnapshot.assets[0]!.contentHash = manifest.tracks[0]!.sha256;
    const hashLeakBytes = Buffer.from(
      JSON.stringify(hashLeakSnapshot, null, 2) + "\n"
    );
    await writeFile(join(root, "training-snapshot-leak.json"), hashLeakBytes);
    const hashLeak = structuredClone(manifest);
    hashLeak.freeze.trainingSnapshot = {
      path: "training-snapshot-leak.json",
      sha256: createHash("sha256").update(hashLeakBytes).digest("hex"),
    };
    await expectReject("training audio-byte leakage is rejected", () =>
      validateEarCorpusManifest(hashLeak, root)
    );

    const duplicateFamily = structuredClone(manifest);
    duplicateFamily.tracks[1]!.sourceFamilyId =
      duplicateFamily.tracks[0]!.sourceFamilyId;
    await expectReject("holdout tracks must come from distinct source families", () =>
      validateEarCorpusManifest(duplicateFamily, root)
    );

    const syntheticDeclaration = structuredClone(manifest) as unknown as {
      tracks: Array<{ recordingType: string }>;
    };
    syntheticDeclaration.tracks[0]!.recordingType = "synthetic";
    await expectReject("synthetic recording declarations are rejected", () =>
      validateEarCorpusManifest(syntheticDeclaration, root)
    );

    const staleSnapshotHash = structuredClone(manifest);
    staleSnapshotHash.freeze.trainingSnapshot.sha256 = "0".repeat(64);
    await expectReject("training snapshot hash mismatches are rejected", () =>
      validateEarCorpusManifest(staleSnapshotHash, root)
    );

    const signingKey = "test-only-calibration-signing-key-32-bytes-minimum";
    const artifact = signCalibrationArtifact(
      {
        schemaVersion: LOGDRUM_CALIBRATION_SCHEMA_VERSION,
        manifestSchemaVersion: EAR_CORPUS_SCHEMA_VERSION,
        gatesPassed: true,
        provenance: "real-9track",
        rightsVerified: true,
        leakageVerified: true,
        trackCount: 9,
        trackIds: validated.tracks.map(track => track.id).sort(),
        corpusHash: validated.corpusHash,
        trainingSnapshotHash: validated.trainingSnapshotHash,
        holdoutFrozenAt: validated.frozenAt,
        genreCounts: validated.genreCounts,
        rightsBasisCounts: validated.rightsBasisCounts,
        separationMargin: 0.2,
        gates: {
          tempo: true,
          fourOnFloor: true,
          logDrumSeparation: true,
        },
        params: {
          r0: 0.45,
          s: 0.12,
          w1: 1.2,
          w2: 0.15,
          glideFloor: 0.3,
        },
      },
      signingKey
    );
    check(
      "signed rights-clean artifact opens the gate",
      calibrationGateStatus(artifact, signingKey).open
    );
    check(
      "missing runtime signing key closes the gate",
      calibrationGateStatus(artifact, undefined).reason ===
        "missing-signing-key"
    );
    check(
      "post-signature parameter edits close the gate",
      calibrationGateStatus({ ...artifact, separationMargin: 0.3 }, signingKey)
        .reason === "invalid-signature"
    );
    check(
      "a calibration without leakage proof cannot open the gate",
      calibrationGateStatus(
        signCalibrationArtifact(
          { ...artifact, leakageVerified: false, signature: undefined },
          signingKey
        ),
        signingKey
      ).reason === "training-leakage-unverified"
    );
    check(
      "synthetic provenance cannot open the gate",
      calibrationGateStatus(
        { ...artifact, provenance: "synthetic" },
        signingKey
      ).reason === "synthetic-calibration"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
