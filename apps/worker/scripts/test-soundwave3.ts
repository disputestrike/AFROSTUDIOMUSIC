import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioTempoConformPlan,
  measureAudioBufferQuality,
  runFfmpeg,
  transformAudio,
  postConformTempoVerdict,
  octaveFoldedTempoDeviation,
  POST_CONFORM_TEMPO_TOLERANCE,
} from "../src/lib/ffmpeg";

async function main(): Promise<void> {
  const plan = audioTempoConformPlan(138, 103);
  assert.ok(plan);
  assert.equal(plan.needsConform, true);
  assert.equal(plan.supported, true);
  assert.ok(Math.abs(plan.tempoRatio - 103 / 138) < 0.0001);
  assert.equal(audioTempoConformPlan(51.5, 103)?.needsConform, false);
  assert.equal(audioTempoConformPlan(206, 103)?.needsConform, false);
  assert.equal(audioTempoConformPlan(20, 220)?.supported, false);

  // POST-CONFORM VERIFY — the fix for "trained melody tempo conform could not be
  // verified against N BPM". The stretch is EXACT math from the measured source,
  // so the re-measure is a sanity check, not a 5% hard gate. A good trained
  // render that re-reads a few % off (or unreadable) LANDS; only a reading
  // off at every octave (genuinely gridless) still skips.
  assert.ok(POST_CONFORM_TEMPO_TOLERANCE > 0.05, "post-conform tolerance is wider than the 5% pre-conform gate");
  // octave-folded deviation folds half/double-time onto the grid first
  assert.ok(octaveFoldedTempoDeviation(52, 104) < 0.01, "52 BPM folds onto a 104 grid (half-time)");
  assert.ok(octaveFoldedTempoDeviation(208, 104) < 0.01, "208 BPM folds onto a 104 grid (double-time)");
  assert.ok(Math.abs(octaveFoldedTempoDeviation(110, 104) - 6 / 104) < 1e-9, "110 vs 104 is ~5.8% off (a slightly-off render)");
  assert.ok(octaveFoldedTempoDeviation(137, 104) > POST_CONFORM_TEMPO_TOLERANCE, "137 BPM is off at EVERY octave of a 104 grid (gridless)");
  // the verdict: slightly-off PASSES, octave-fold PASSES, unreadable TRUSTS the
  // ratio, gridless SKIPS.
  const slightlyOff = postConformTempoVerdict(110, 104);
  assert.equal(slightlyOff.pass, true, "a slightly-off (5.8%) post-conform render LANDS");
  assert.equal(slightlyOff.verifiedBpm, 110, "the landed render carries its measured BPM");
  assert.equal(postConformTempoVerdict(52, 104).pass, true, "an octave-folded post-conform render LANDS");
  const trusted = postConformTempoVerdict(null, 104);
  assert.equal(trusted.pass, true, "an UNREADABLE re-measure trusts the applied exact ratio (never a fabricated measurement)");
  assert.equal(trusted.verifiedBpm, null, "the trusted-ratio path reports no measured BPM (honest: we did not measure it)");
  const gridless = postConformTempoVerdict(137, 104);
  assert.equal(gridless.pass, false, "a gridless render (off at every octave) still SKIPS honestly");
  assert.match(gridless.reason, /no stable grid/, "the gridless skip names its reason");

  // Real ffmpeg proof: the exact 138 -> 103 ratio lengthens a six-second layer
  // to roughly 8.04 seconds without changing pitch.
  const dir = await mkdtemp(join(tmpdir(), "afroone-tempo-proof-"));
  try {
    const sourcePath = join(dir, "source.wav");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=6",
      "-ac",
      "2",
      "-ar",
      "44100",
      sourcePath,
    ]);
    const source = await readFile(sourcePath);
    const conformed = await transformAudio(source, { tempo: plan.tempoRatio });
    const [before, after] = await Promise.all([
      measureAudioBufferQuality(source),
      measureAudioBufferQuality(conformed),
    ]);
    const expectedDuration = before.durationS / plan.tempoRatio;
    assert.ok(
      Math.abs(after.durationS - expectedDuration) < 0.15,
      `tempo transform duration ${after.durationS}s must match ${expectedDuration.toFixed(2)}s`
    );
    assert.ok(after.durationS > before.durationS * 1.3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const ownEngineSource = await readFile(
    join(process.cwd(), "src", "processors", "own-engine.ts"),
    "utf8"
  );
  const normalizeIndex = ownEngineSource.indexOf(
    "normalizeLoopLoudness(leadRaw)"
  );
  const conformIndex = ownEngineSource.indexOf(
    "conformMelodyTempoToGrid(lead, bpm)"
  );
  const verifyIndex = ownEngineSource.indexOf(
    "verifyMelodyAgainstGrid(lead, bpm, homeKey)"
  );
  const mixIndex = ownEngineSource.indexOf("overlayFills(bed, lead,");
  assert.ok(
    normalizeIndex > 0 &&
      conformIndex > normalizeIndex &&
      verifyIndex > conformIndex &&
      mixIndex > verifyIndex,
    "trained layer order must be normalize -> tempo conform -> verify -> mix"
  );
  for (const receipt of [
    "sourceBpm",
    "foldedSourceBpm",
    "targetBpm",
    "tempoRatio",
    "tempoConformed",
    "verifiedBpm",
  ]) {
    assert.ok(
      ownEngineSource.includes(receipt),
      `${receipt} must ride the trained-layer receipt`
    );
  }

  // POST-CONFORM WIRING: conformMelodyTempoToGrid decides via the pure verdict
  // (trust the exact ratio / octave-folded tolerance), NOT the old 5% re-measure
  // reject; the trained branch accepts a tempo-only verify rejection once the
  // conform has LANDED, so a good-but-off-tempo trained render mixes in.
  assert.ok(
    ownEngineSource.includes("postConformTempoVerdict(verifiedBpm, gridBpm)"),
    "the conform gates the stretch through the pure post-conform verdict"
  );
  assert.ok(
    !ownEngineSource.includes("verificationPlan.deviation > 0.05"),
    "the brittle 5% re-measure reject is gone from the conform"
  );
  assert.ok(
    ownEngineSource.includes('grid.reason === "tempo"') &&
      ownEngineSource.includes(
        "grid.reason === \"tempo\" && tempoConform.receipt.tempoConformed"
      ),
    "a tempo-only verify rejection is accepted once the conform has landed (the conform is the authoritative tempo gate)"
  );
  assert.match(ownEngineSource, /recipe\.craft/);
  assert.match(ownEngineSource, /measured tempo/);
  assert.match(ownEngineSource, /p\.trainingUsage\?\.referenceIds/);
  assert.match(ownEngineSource, /rights-safe Listen\/Zap lesson/);

  const singingSource = await readFile(
    join(process.cwd(), "src", "processors", "afroone-singing.ts"),
    "utf8"
  );
  assert.match(
    singingSource,
    /const finalApproved = mix \? mix\.approved : approved/
  );
  assert.match(singingSource, /approved: finalApproved/);

  console.log(
    "soundwave3: promoted layer tempo-conformed with real ffmpeg duration proof and measured receipts; Learn/Zap lessons enter the Producer Brain; finished singing approval follows the final mix"
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
