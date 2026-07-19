import assert from "node:assert/strict";
import {
  publicRuntimeReadiness,
  resolveVideoProviderReadiness,
  runtimeReadinessReport,
} from "../src/lib/config-readiness";
import {
  distributionConfigurationStatus,
  distributionLifecycleDiagnostics,
} from "../src/lib/distribution";

const workspaceTier = resolveVideoProviderReadiness({
  engineClass: "standard",
  workspaceReplicateKey: "workspace-token",
  env: {},
});
assert.equal(workspaceTier.ready, true);
assert.equal(workspaceTier.selected, "hailuo");
assert.equal(workspaceTier.source, "workspace");

const sora = resolveVideoProviderReadiness({
  engineClass: "standard",
  env: { VIDEO_PROVIDER: "sora", OPENAI_API_KEY: "configured" },
});
assert.equal(sora.ready, true);
assert.equal(sora.liveSafe, true);

const likenessWithoutI2v = resolveVideoProviderReadiness({
  engineClass: "standard",
  useLikeness: true,
  env: { VIDEO_PROVIDER: "sora", OPENAI_API_KEY: "configured" },
});
assert.equal(likenessWithoutI2v.ready, false);
assert.ok(likenessWithoutI2v.issues.some(issue => issue.includes("likeness")));

const disabledTierI2v = resolveVideoProviderReadiness({
  engineClass: "standard",
  useLikeness: true,
  env: {
    REPLICATE_API_TOKEN: "configured",
    REPLICATE_VIDEO_STANDARD_I2V_MODEL: "",
  },
});
assert.equal(disabledTierI2v.ready, false);

const productionStub = resolveVideoProviderReadiness({
  engineClass: "standard",
  env: {
    VIDEO_PROVIDER: "stub",
    NODE_ENV: "production",
    ALLOW_STUB_AUDIO: "1",
  },
});
assert.equal(productionStub.ready, false);
assert.equal(productionStub.liveSafe, false);

const distribution = distributionConfigurationStatus({
  DISTRIBUTOR: "partner",
  DISTRIBUTOR_WEBHOOK_URL: "https://distribution.example/v1/releases",
  DISTRIBUTOR_WEBHOOK_SECRET: "s".repeat(32),
});
assert.equal(distribution.ready, true);
assert.equal(distribution.endpointHost, "distribution.example");
assert.equal(distribution.inboundWebhookReady, true);

const weakDistribution = distributionConfigurationStatus({
  DISTRIBUTOR_WEBHOOK_URL: "http://localhost/distribute",
  DISTRIBUTOR_WEBHOOK_SECRET: "short",
});
assert.equal(weakDistribution.ready, false);
assert.ok(weakDistribution.issues.length >= 2);

const stale = distributionLifecycleDiagnostics(
  {
    status: "submitted",
    distributor: "partner",
    externalId: "release_1",
    distributionStatusAt: new Date("2026-07-01T00:00:00.000Z"),
  },
  distribution,
  new Date("2026-07-19T00:00:00.000Z")
);
assert.equal(stale.stale, true);
assert.equal(stale.healthy, false);

const report = runtimeReadinessReport({
  VIDEO_PROVIDER: "sora",
  OPENAI_API_KEY: "configured",
  LIKENESS_TRAINING_ENABLED: "1",
  REPLICATE_API_TOKEN: "configured",
  REPLICATE_USERNAME: "afrohit",
  DISTRIBUTOR_WEBHOOK_URL: "https://distribution.example/v1/releases",
  DISTRIBUTOR_WEBHOOK_SECRET: "s".repeat(32),
});
assert.deepEqual(publicRuntimeReadiness(report), {
  video: true,
  likenessTraining: true,
  distribution: true,
});

console.log("API runtime readiness and distribution diagnostics tests passed");
