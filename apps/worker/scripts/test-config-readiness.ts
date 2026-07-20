import assert from "node:assert/strict";
import {
  workerRuntimeReadiness,
  workerVideoProviderReadiness,
} from "../src/lib/config-readiness";

const replicate = workerVideoProviderReadiness({
  provider: "hailuo",
  workspaceReplicateKey: "workspace-token",
  imageToVideo: true,
  useLikeness: true,
  env: {},
});
assert.equal(replicate.ready, true);
assert.equal(replicate.liveSafe, true);

const missingReplicate = workerVideoProviderReadiness({
  provider: "hailuo",
  env: {},
});
assert.equal(missingReplicate.ready, false);
assert.ok(missingReplicate.missing.some(item => item.includes("REPLICATE")));

const noLikenessCapability = workerVideoProviderReadiness({
  provider: "sora",
  useLikeness: true,
  imageToVideo: false,
  env: { OPENAI_API_KEY: "configured" },
});
assert.equal(noLikenessCapability.ready, false);
assert.ok(noLikenessCapability.issues.some(item => item.includes("likeness")));

const productionStub = workerVideoProviderReadiness({
  provider: "stub",
  env: {
    NODE_ENV: "production",
    ALLOW_STUB_AUDIO: "1",
  },
});
assert.equal(productionStub.ready, false);
assert.equal(productionStub.liveSafe, false);

const report = workerRuntimeReadiness({
  VIDEO_PROVIDER: "sora",
  OPENAI_API_KEY: "configured",
  LIKENESS_TRAINING_ENABLED: "1",
  REPLICATE_API_TOKEN: "configured",
  REPLICATE_USERNAME: "afrohit",
});
assert.equal(report.video.ready, true);
assert.equal(report.likenessTraining.ready, true);

const malformed = workerRuntimeReadiness({
  LIKENESS_TRAINING_ENABLED: "1",
  REPLICATE_API_TOKEN: "configured",
  LIKENESS_LORA_DESTINATION: "not/a/valid/slug",
});
assert.equal(malformed.likenessTraining.ready, false);
assert.ok(
  malformed.likenessTraining.issues.some(item =>
    item.toLowerCase().includes("destination")
  )
);

console.log("worker runtime readiness tests passed");
