/**
 * Real-audio acceptance gate for the AfroHit DSP ear.
 *
 * The committed manifest must describe exactly nine local, rights-clean tracks:
 * three Amapiano, three Afrobeats, and three house records. Every mix and stem is
 * hash-pinned. A passing calibration is signed with a secret held outside Git;
 * a failed run never overwrites the last valid artifact.
 *
 * Run:
 *   LOGDRUM_CALIBRATION_SIGNING_KEY=<32+ byte secret>
 *   pnpm --filter @afrohit/worker exec tsx scripts/eval-ear.ts
 */
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  EAR_CORPUS_SCHEMA_VERSION,
  LOGDRUM_CALIBRATION_SCHEMA_VERSION,
  calibrationGateStatus,
  calibrationSigningKey,
  signCalibrationArtifact,
  validateEarCorpusManifest,
  type ValidatedEarCorpusTrack,
} from "../src/lib/ear-corpus";
import { dspAvailable, measureAudio, type StemInputs } from "../src/lib/dsp";

const fixturesDir = resolve(process.cwd(), "py", "fixtures");
const manifestPath = join(fixturesDir, "manifest.json");
const artifactPath = join(fixturesDir, "logdrum_calibration.json");
const failedReportPath = join(fixturesDir, "logdrum_calibration.failed.json");

type Result = {
  row: ValidatedEarCorpusTrack;
  tempo: number | null;
  tempoOk: boolean;
  fourOnFloor: boolean | null;
  fourOnFloorOk: boolean;
  logDrumLikelihood: number | null;
};

type CalibrationLogDrumEvidence = {
  source?: unknown;
  value?: unknown;
};

export function logDrumScoreForCalibration(
  evidence: CalibrationLogDrumEvidence | null | undefined
): number | null {
  const acceptedSource =
    evidence?.source === "measured" || evidence?.source === "inferred";
  if (
    !acceptedSource ||
    typeof evidence.value !== "number" ||
    !Number.isFinite(evidence.value)
  ) {
    return null;
  }
  return evidence.value;
}

async function main() {
  if (!existsSync(manifestPath))
    throw new Error(`No ear corpus manifest at ${manifestPath}`);

  const rawManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const corpus = await validateEarCorpusManifest(rawManifest, fixturesDir);
  const signingKey = calibrationSigningKey(
    process.env.LOGDRUM_CALIBRATION_SIGNING_KEY
  );

  if (!(await dspAvailable())) {
    throw new Error(
      "DSP engine unavailable (Python, librosa, and ffmpeg are required)"
    );
  }

  const results: Result[] = [];
  for (const row of corpus.tracks) {
    const stems: StemInputs = {
      bass: row.absoluteStems.bass,
      drums: row.absoluteStems.drums,
      other: row.absoluteStems.other,
      vocals: row.absoluteStems.vocals,
    };
    const analysis = await measureAudio(row.absolutePath, stems);
    const tempo =
      analysis.tempoBpm.source === "measured" &&
      typeof analysis.tempoBpm.value === "number"
        ? analysis.tempoBpm.value
        : null;
    const fourOnFloor =
      analysis.fourOnFloor.source === "measured" &&
      typeof analysis.fourOnFloor.value === "boolean"
        ? analysis.fourOnFloor.value
        : null;
    const logDrumLikelihood = logDrumScoreForCalibration(
      analysis.logDrumLikelihood
    );
    results.push({
      row,
      tempo,
      tempoOk: tempo !== null && Math.abs(tempo - row.expectTempoBpm) <= 2,
      fourOnFloor,
      fourOnFloorOk: fourOnFloor !== null && fourOnFloor === row.fourOnFloor,
      logDrumLikelihood,
    });
  }

  console.log(
    "\nid                     genre      expTempo  measTempo  delta  4OTF exp/meas  logDrL"
  );
  console.log("-".repeat(91));
  for (const result of results) {
    const delta =
      result.tempo === null
        ? "n/a"
        : (result.tempo - result.row.expectTempoBpm).toFixed(1);
    console.log(
      `${result.row.id.padEnd(22)} ${result.row.genre.padEnd(10)} ${String(result.row.expectTempoBpm).padStart(7)}  ${String(result.tempo ?? "unknown").padStart(8)}  ${delta.padStart(5)} ${(String(result.row.fourOnFloor) + "/" + String(result.fourOnFloor ?? "unknown")).padStart(13)}  ${result.logDrumLikelihood === null ? "unknown" : result.logDrumLikelihood.toFixed(3)}`
    );
  }

  const tempoFailures = results.filter(result => !result.tempoOk);
  const fourOnFloorFailures = results.filter(result => !result.fourOnFloorOk);
  const amapiano = results
    .filter(result => result.row.genre === "amapiano")
    .map(result => result.logDrumLikelihood);
  const comparison = results
    .filter(result => result.row.genre !== "amapiano")
    .map(result => result.logDrumLikelihood);
  const completeSeparationEvidence = [...amapiano, ...comparison].every(
    value => value !== null
  );
  const separationMargin = completeSeparationEvidence
    ? Math.min(...(amapiano as number[])) -
      Math.max(...(comparison as number[]))
    : Number.NaN;
  const gates = {
    tempo: tempoFailures.length === 0,
    fourOnFloor: fourOnFloorFailures.length === 0,
    logDrumSeparation:
      Number.isFinite(separationMargin) && separationMargin > 0,
  };
  const passed = Object.values(gates).every(Boolean);

  console.log("\n-- GATES --");
  console.log(
    `GATE 1 tempo +/-2 BPM:        ${gates.tempo ? "PASS" : `FAIL (${tempoFailures.map(result => result.row.id).join(", ")})`}`
  );
  console.log(
    `GATE 2 four-on-floor 9/9:    ${gates.fourOnFloor ? "PASS" : `FAIL (${fourOnFloorFailures.map(result => result.row.id).join(", ")})`}`
  );
  console.log(
    `GATE 3 log-drum separation:  ${gates.logDrumSeparation ? `PASS (margin ${separationMargin.toFixed(3)})` : "FAIL"}`
  );

  const commonEvidence = {
    schemaVersion: LOGDRUM_CALIBRATION_SCHEMA_VERSION,
    manifestSchemaVersion: EAR_CORPUS_SCHEMA_VERSION,
    corpusHash: corpus.corpusHash,
    trackCount: corpus.tracks.length,
    trackIds: corpus.tracks.map(track => track.id).sort(),
    genreCounts: corpus.genreCounts,
    rightsBasisCounts: corpus.rightsBasisCounts,
    separationMargin: Number.isFinite(separationMargin)
      ? Math.round(separationMargin * 1000) / 1000
      : null,
    fittedOn: new Date().toISOString().slice(0, 10),
    evaluatedAt: new Date().toISOString(),
    gates,
    params: {
      r0: 0.45,
      s: 0.12,
      w1: 1.2,
      w2: 0.15,
      glideFloor: 0.3,
    },
  };

  if (!passed) {
    await writeFile(
      failedReportPath,
      JSON.stringify(
        {
          ...commonEvidence,
          gatesPassed: false,
          provenance: "failed-real-evaluation",
          rightsVerified: true,
          failures: {
            tempo: tempoFailures.map(result => result.row.id),
            fourOnFloor: fourOnFloorFailures.map(result => result.row.id),
          },
        },
        null,
        2
      ) + "\n"
    );
    console.error(
      `\nPHASE 0 ACCEPTANCE FAILED. Diagnostic written to ${failedReportPath}; the calibration artifact was not changed.`
    );
    process.exitCode = 1;
    return;
  }

  const artifact = signCalibrationArtifact(
    {
      ...commonEvidence,
      gatesPassed: true,
      provenance: "real-9track",
      rightsVerified: true,
      calibratedOn: "rights-clean-9track",
    },
    signingKey
  );
  const gate = calibrationGateStatus(artifact, signingKey);
  if (!gate.open)
    throw new Error(`Refusing to write a closed calibration: ${gate.reason}`);

  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
  await unlink(failedReportPath).catch(() => undefined);
  console.log(
    `\nPHASE 0 ACCEPTANCE PASSED. Signed calibration written to ${artifactPath}.`
  );
  console.log(`Corpus SHA-256: ${corpus.corpusHash}`);
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
