/**
 * MASTERING PHASE test — the report card, the LRA density iteration, and the
 * clamped match-EQ reference seam.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-master-report.ts
 *
 * OFFLINE half (always runs, no ffmpeg needed):
 *   - the reference seam is a PROVABLE NO-OP while references are absent
 *     (masterReferenceVectorFor/masterReferenceDelta null; masterPreChain
 *     byte-identical with and without a null match-EQ),
 *   - masterMatchEqCorrection: mean-removed (pure level offset → null),
 *     per-band clamped to ±3 dB, deadbanded, correct equalizer-bank string,
 *     placed BEFORE the multiband stage,
 *   - masterReferenceStoreToVectors: honest element-wise aggregation of the
 *     DB store (numbers only, malformed octave vectors excluded),
 *   - buildMasterReport serializes every report-card field through JSON.
 *
 * LIVE half (needs the system ffmpeg; SKIPs cleanly without failing when the
 * binary is absent — the worker image always has it):
 *   - synthetic WIDE vs DENSE material through master('afro_stream_-9'):
 *     the density pass triggers EXACTLY when the pass-1 driven LRA exceeds
 *     the 8.5 ceiling and never runs twice,
 *   - match-EQ no-ops on a real render with no references, and applies
 *     clamped with a synthetic injected reference vector,
 *   - the rendered master lands near the -9 LUFS target (measured).
 */
import assert from "node:assert/strict";
import {
  ffmpegAvailable,
  master,
  masterMatchEqCorrection,
  masterPreChain,
  masterReferenceDelta,
  masterReferenceStoreToVectors,
  masterReferenceVectorFor,
  measureAudioBufferQuality,
  runFfmpeg,
  MASTER_LRA_DENSITY_CEILING,
  MASTER_MATCH_EQ_CLAMP_DB,
  MASTER_TARGETS,
  _setMasterReferenceDbSnapshotForTest,
  type AudioQuality,
} from "../src/lib/ffmpeg";
import { buildMasterReport } from "../src/processors/master";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
    process.exitCode = 1;
  } else console.log("  ok:", msg);
}

const syntheticQc = (over: Partial<AudioQuality> = {}): AudioQuality => ({
  durationS: 30,
  integratedLufs: -9.1,
  loudnessRangeLra: 7.2,
  truePeakDb: -1.0,
  crestFactorDb: 9.4,
  flatFactor: 0,
  spectralTiltDbPerOct: -2.7,
  octaveRmsDb: [-18, -20, -22, -24, -26, -28, -30, -32],
  stereoCorrelation: 0.94,
  flags: [],
  verdict: "pass",
  ok: true,
  ...over,
});

async function offline() {
  console.log("\n-- reference seam: provable no-op while references are absent --");
  // Pin "DB has none" so the assertion holds even on a machine with a live DB.
  _setMasterReferenceDbSnapshotForTest(null);
  check(masterReferenceVectorFor("afrobeats") === null, "no fixture + no DB rows → vector null");
  check(masterReferenceDelta("afrobeats", syntheticQc()) === null, "reference delta null (no fabricated comparison)");
  check(masterMatchEqCorrection(syntheticQc().octaveRmsDb, null) === null, "match-EQ null without a reference");
  const target = MASTER_TARGETS["afro_stream_-9"]!;
  check(
    masterPreChain(target, -14, "afrobeats", null) === masterPreChain(target, -14, "afrobeats"),
    "masterPreChain with null match-EQ is byte-identical to the baseline chain (no-op proof)"
  );

  console.log("\n-- match-EQ correction math --");
  const flat = [-20, -20, -20, -20, -20, -20, -20, -20];
  // A pure LEVEL offset is loudnorm's job, not EQ's: mean removal → no-op.
  check(
    masterMatchEqCorrection(flat, { octaveRmsDb: flat.map(v => v + 6) }) === null,
    "constant level offset → null (mean-removed; level belongs to loudnorm)"
  );
  // A tilt clamps per band to ±3 dB.
  const tiltRef = flat.map((v, i) => v + (i - 3.5) * 2); // -7..+7 around the mean
  const corr = masterMatchEqCorrection(flat, { octaveRmsDb: tiltRef });
  check(!!corr, "tilted reference produces a correction");
  if (corr) {
    check(
      corr.bandsDb.every(b => Math.abs(b) <= MASTER_MATCH_EQ_CLAMP_DB),
      `every band clamped to ±${MASTER_MATCH_EQ_CLAMP_DB} dB (got ${corr.bandsDb.join(",")})`
    );
    check(corr.bandsDb[0] === -3 && corr.bandsDb[7] === 3, "±7 dB asks clamp to exactly ±3 dB");
    check(corr.filter.includes("equalizer=f=63") && corr.filter.includes("equalizer=f=8000"), "equalizer bank spans 63 Hz → 8 kHz");
    const chain = masterPreChain(target, -14, "afrobeats", corr.filter);
    const eqAt = chain.indexOf("equalizer=f=63:width_type=o");
    const glueAt = chain.indexOf("acompressor=threshold=-16dB");
    const mbAt = chain.indexOf("acrossover=split=180");
    check(eqAt >= 0 && glueAt > eqAt && mbAt > eqAt, "match-EQ sits before the glue and the multiband stage");
  }
  check(
    masterMatchEqCorrection([-20, -20], { octaveRmsDb: tiltRef }) === null,
    "malformed measured octave vector → null, never a guess"
  );

  console.log("\n-- DB store aggregation --");
  const vectors = masterReferenceStoreToVectors({
    version: 1,
    genres: {
      afrobeats: {
        tracks: [
          { title: "a", rightsAttestation: "owned", measuredAt: "t", vector: { lufs: -8.6, octaveRmsDb: flat } },
          { title: "b", rightsAttestation: "owned", measuredAt: "t", vector: { lufs: -9.4, octaveRmsDb: flat.map(v => v + 2) } },
          { title: "c", rightsAttestation: "owned", measuredAt: "t", vector: { spectralTiltDbPerOct: -2.5, octaveRmsDb: [-1, -2] } },
        ],
      },
      empty: { tracks: [] },
    },
  });
  check(vectors.afrobeats?.lufs === -9, "lufs aggregates to the mean of measured tracks (-9)");
  check(vectors.afrobeats?.spectralTiltDbPerOct === -2.5, "an axis measured by one track still aggregates");
  check(
    JSON.stringify(vectors.afrobeats?.octaveRmsDb) === JSON.stringify(flat.map(v => v + 1)),
    "octave vectors average element-wise; malformed lengths are excluded"
  );
  check(!("empty" in vectors), "genres with no tracks produce no vector");

  console.log("\n-- injected DB snapshot answers the seam --");
  _setMasterReferenceDbSnapshotForTest({ afrobeats: { lufs: -9, spectralTiltDbPerOct: -2.5 } });
  const delta = masterReferenceDelta("afrobeats", syntheticQc());
  check(!!delta && delta.genre === "afrobeats", "delta computed against the injected reference");
  check(delta?.delta.lufs === -0.1, "lufs delta measured (-9.1 vs -9 → -0.1)");
  _setMasterReferenceDbSnapshotForTest(null);

  console.log("\n-- report card serialization --");
  const report = buildMasterReport(syntheticQc(), "afrobeats", {
    drivePasses: [
      { pass: 0, stage: "raw", measured: { lufs: -18.2, truePeakDb: -4.1, lra: 11.3 } },
      { pass: 1, stage: "drive", driveDb: 8.2, measured: { lufs: -9.8, truePeakDb: -1.0, lra: 9.1 } },
      { pass: 2, stage: "density", driveDb: 0.6, reason: "measured LRA 9.1 > 8.5 after pass 1 (commercial Afro sits ~6-8)", measured: { lufs: -9.2, truePeakDb: -1.0, lra: 8.1 } },
    ],
    appliedMatchEq: { bandsDb: [0, -1.5, 0, 0, 0.5, 0, 0, 1], clampDb: 3, referenceGenre: "afrobeats" },
  });
  const round = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  for (const key of ["lufs", "dBTP", "lra", "crest", "tilt", "correlation", "referenceDelta", "drivePasses", "appliedMatchEq"]) {
    check(key in round, `report card serializes '${key}'`);
  }
  check(round.lufs === -9.1 && round.correlation === 0.94, "measured numbers survive the JSON round-trip verbatim");
  check(round.referenceDelta === null, "no reference on file → referenceDelta serializes as null, never invented");
  check(Array.isArray(round.drivePasses) && (round.drivePasses as unknown[]).length === 3, "both passes' measurements persist in drivePasses");
}

/** Synthesize test material with the system ffmpeg. WIDE = pink noise
 *  alternating loud/soft 5s blocks 12 dB apart — both halves stay inside the
 *  EBU relative gate, so the loudness RANGE is real (measured on this host:
 *  raw LRA ~12, still ~9.7 after the pass-1 chain — above the 8.5 ceiling; a
 *  silent-vs-loud construction gates OUT the quiet half and reads dense).
 *  DENSE = 20s constant loud pink noise (LRA near zero). Deterministic
 *  filters, no assets, no network. */
async function synth(kind: "wide" | "dense", dir: string): Promise<Buffer> {
  const out = join(dir, `${kind}.wav`);
  const shape = kind === "wide"
    ? "volume='if(lt(mod(t,10),5),1.0,0.25)':eval=frame,"
    : "";
  await runFfmpeg([
    "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=20:amplitude=0.7:seed=7",
    "-af", `${shape}aformat=channel_layouts=stereo`,
    "-ar", "44100", "-ac", "2", out,
  ]);
  return readFile(out);
}

async function live() {
  if (!(await ffmpegAvailable())) {
    console.log("\n-- live render half SKIPPED: ffmpeg not on this host (worker image always has it) --");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "master-report-test-"));
  try {
    _setMasterReferenceDbSnapshotForTest(null); // no references: seam must no-op on a REAL render

    console.log("\n-- live: WIDE material through afro_stream_-9 --");
    const wide = await synth("wide", dir);
    const wideOut = await master({ mix: wide, preset: "afro_stream_-9" });
    const widePass1 = wideOut.report.drivePasses.find(p => p.stage === "drive");
    const wideDensity = wideOut.report.drivePasses.find(p => p.stage === "density");
    check(!!widePass1?.measured, "pass 1 (driven) measurement recorded");
    // THE TRIGGER LAW, asserted as a biconditional so it is material-robust:
    // a density entry exists exactly when the driven LRA exceeded the ceiling.
    const wideLra = widePass1?.measured?.lra ?? null;
    check(
      wideLra !== null && (wideLra > MASTER_LRA_DENSITY_CEILING) === !!wideDensity,
      `density pass triggers iff driven LRA > ${MASTER_LRA_DENSITY_CEILING} (driven LRA ${wideLra?.toFixed(1)}, density=${!!wideDensity})`
    );
    check(wideLra !== null && wideLra > MASTER_LRA_DENSITY_CEILING, "WIDE synthetic material does exceed the ceiling after pass 1 (the trigger path is exercised)");
    check(wideOut.report.drivePasses.filter(p => p.stage === "density").length <= 1, "the density pass NEVER runs more than once");
    if (wideDensity?.measured && wideLra !== null) {
      check(wideDensity.measured.lra < wideLra, `extra gentle pass reduced LRA (${wideLra.toFixed(1)} → ${wideDensity.measured.lra.toFixed(1)})`);
      check((wideDensity.driveDb ?? 0) > 0 && (wideDensity.driveDb ?? 0) <= 2.5, "extra drive is clamped to the gentle 0.5-2.5 dB window");
    }
    check(wideOut.report.appliedMatchEq === null, "no references on file → appliedMatchEq null on a real render");
    const wideQc = await measureAudioBufferQuality(wideOut.wav);
    check(
      wideQc.integratedLufs !== null && Math.abs(wideQc.integratedLufs - (-9)) <= 1.5,
      `rendered WIDE master lands near -9 LUFS (measured ${wideQc.integratedLufs?.toFixed(1)})`
    );

    console.log("\n-- live: DENSE material skips the density pass --");
    const dense = await synth("dense", dir);
    const denseOut = await master({ mix: dense, preset: "afro_stream_-9" });
    const densePass1 = denseOut.report.drivePasses.find(p => p.stage === "drive");
    const denseLra = densePass1?.measured?.lra ?? null;
    check(denseLra !== null && denseLra <= MASTER_LRA_DENSITY_CEILING, `constant material measures dense after pass 1 (LRA ${denseLra?.toFixed(1)})`);
    check(!denseOut.report.drivePasses.some(p => p.stage === "density"), "density pass correctly SKIPPED for already-dense material");
    const denseQc = await measureAudioBufferQuality(denseOut.wav);
    check(
      denseQc.integratedLufs !== null && Math.abs(denseQc.integratedLufs - (-9)) <= 1.0,
      `rendered DENSE master lands on -9 LUFS (measured ${denseQc.integratedLufs?.toFixed(1)})`
    );

    console.log("\n-- live: match-EQ applies clamped with a synthetic reference --");
    // Reference = this material's own measured octave balance, deliberately
    // tilted — the correction the chain derives must be the clamped tilt back.
    const denseRawQc = await measureAudioBufferQuality(dense);
    check(Array.isArray(denseRawQc.octaveRmsDb), "raw take's octave balance measured");
    if (denseRawQc.octaveRmsDb) {
      const tilted = denseRawQc.octaveRmsDb.map((v, i) => v + (i - 3.5) * 1.2); // ±4.2 dB skew → clamps at ±3
      _setMasterReferenceDbSnapshotForTest({ afrobeats: { octaveRmsDb: tilted } });
      const eqOut = await master({ mix: dense, preset: "afro_stream_-9", genre: "afrobeats" });
      check(!!eqOut.report.appliedMatchEq, "reference on file → match-EQ applied");
      if (eqOut.report.appliedMatchEq) {
        check(
          eqOut.report.appliedMatchEq.bandsDb.every(b => Math.abs(b) <= MASTER_MATCH_EQ_CLAMP_DB),
          `applied bands all within ±${MASTER_MATCH_EQ_CLAMP_DB} dB (${eqOut.report.appliedMatchEq.bandsDb.join(",")})`
        );
        check(eqOut.report.appliedMatchEq.referenceGenre === "afrobeats", "report names the reference lane");
      }
      const eqQc = await measureAudioBufferQuality(eqOut.wav);
      check(eqQc.integratedLufs !== null && Math.abs(eqQc.integratedLufs - (-9)) <= 1.0, `match-EQ'd master still lands on target (measured ${eqQc.integratedLufs?.toFixed(1)})`);
      _setMasterReferenceDbSnapshotForTest(null);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

(async () => {
  await offline();
  await live();
  assert.ok(true);
  console.log(failed ? `\n❌ Master report test FAILED (${failed})` : "\n✅ Master report test PASSED");
})().catch(err => {
  console.error("FAIL (unhandled):", err);
  process.exitCode = 1;
});
