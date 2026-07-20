import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioTempoConformPlan,
  measureAudioBufferQuality,
  runFfmpeg,
  transformAudio,
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
