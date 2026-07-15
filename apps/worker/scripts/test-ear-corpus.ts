import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EAR_CORPUS_SCHEMA_VERSION,
  LOGDRUM_CALIBRATION_SCHEMA_VERSION,
  calibrationGateStatus,
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
      const bytes = Buffer.alloc(2_048, seed++ % 251);
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
    const manifest = {
      schemaVersion: EAR_CORPUS_SCHEMA_VERSION,
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

    const signingKey = "test-only-calibration-signing-key-32-bytes-minimum";
    const artifact = signCalibrationArtifact(
      {
        schemaVersion: LOGDRUM_CALIBRATION_SCHEMA_VERSION,
        manifestSchemaVersion: EAR_CORPUS_SCHEMA_VERSION,
        gatesPassed: true,
        provenance: "real-9track",
        rightsVerified: true,
        trackCount: 9,
        trackIds: validated.tracks.map(track => track.id).sort(),
        corpusHash: validated.corpusHash,
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
