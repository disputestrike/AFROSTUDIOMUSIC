import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateBeatInputSchema } from "@afrohit/shared";
import {
  resolveOwnEngineRouting,
  unsupportedOwnEngineControls,
} from "../src/routes/beats";

const parsed = generateBeatInputSchema.parse({
  projectId: "cm12345678901234567890123",
  genre: "afrobeats",
  bpm: 108,
  songEngine: "own",
  withVocals: false,
  withStems: false,
  candidates: 3,
  renderSeed: 12345,
  directionProfiles: [
    "commercial_safe",
    "spacious_restrained",
    "energetic_hook_forward",
  ],
});
assert.equal(parsed.renderSeed, 12345);
assert.equal(parsed.directionProfiles?.length, 3);
assert.deepEqual(
  unsupportedOwnEngineControls(parsed),
  [],
  "three controlled directions and a render seed are native AfroOne controls"
);
assert.equal(resolveOwnEngineRouting(parsed).mode, "own");

const vocalParsed = generateBeatInputSchema.parse({
  projectId: "cm12345678901234567890123",
  genre: "afrobeats",
  bpm: 108,
  songEngine: "own",
  withVocals: true,
  lyrics: "[Hook]\nCarry me go",
  withStems: true,
});
assert.equal(resolveOwnEngineRouting(vocalParsed).mode, "own");
assert.deepEqual(
  unsupportedOwnEngineControls(vocalParsed),
  [],
  "singing and native stems are owned-engine controls"
);

const source = readFileSync(
  join(process.cwd(), "src", "routes", "beats.ts"),
  "utf8"
);
assert.match(source, /'\/:beatId\/replay'/);
assert.match(source, /lockedMaterialIds/);
assert.match(source, /renderSpec/);
assert.match(source, /deriveAfroOneSeed/);
assert.match(source, /directionCharges/);
assert.match(source, /refundCredits/);
assert.doesNotMatch(source, /own_vocal_pipeline_unavailable/);
assert.match(source, /withVocals: input\.withVocals/);
assert.match(source, /voiceProfileId/);
assert.match(source, /replayTrainingUsage/);
assert.match(source, /batchSeed: baseSeed/);

const workerSource = readFileSync(
  join(process.cwd(), "..", "worker", "src", "processors", "own-engine.ts"),
  "utf8"
);
assert.match(workerSource, /referenceUsage\.createMany/);
assert.match(workerSource, /afroone-producer-brain\+measured-lane-tags/);

const evidenceSource = readFileSync(
  join(process.cwd(), "src", "routes", "producer-evidence.ts"),
  "utf8"
);
assert.match(evidenceSource, /evaluateProducerEvidence/);
assert.match(evidenceSource, /producer\.evidence_pack/);
assert.match(evidenceSource, /source\.contentHash === replay\.contentHash/);
assert.match(evidenceSource, /project: \{ workspaceId \}/);

console.log("AfroOne API render, batch-direction, and exact-replay contracts passed");
