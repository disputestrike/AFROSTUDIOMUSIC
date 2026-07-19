import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  confirmProducerKitSchema,
  inferProducerKitBpm,
  inferProducerKitFile,
  inferProducerKitKey,
  inferProducerKitQuality,
  inferProducerKitRole,
  producerKitManifestSchema,
} from "@afrohit/shared";

const goodMetrics = {
  durationS: 7.384,
  sampleRate: 48_000,
  channels: 2,
  peakDbfs: -1.2,
  rmsDbfs: -17.4,
  clippedSampleRatio: 0.00001,
};

assert.equal(inferProducerKitRole("Lagos_Shaker_104BPM_Amin.wav", "afrobeats").role, "shaker");
assert.equal(inferProducerKitRole("Amapiano Log Drum Lead 112.wav", "amapiano").role, "log_drum_lead");
assert.equal(inferProducerKitRole("Live Highlife Guitar Cmaj.wav", "highlife").role, "highlife_guitar");
assert.equal(inferProducerKitRole("Perc Loop 100bpm.wav", "afrobeats").role, "percussion");
assert.equal(inferProducerKitBpm("Shaker_104BPM.wav"), 104);
assert.equal(inferProducerKitBpm("Bass_808.wav"), null, "808 must not be misread as tempo");
assert.equal(inferProducerKitKey("Rhodes C#min 104.wav"), "C# minor");
assert.equal(inferProducerKitKey("Guitar Bb major.wav"), "Bb major");

assert.deepEqual(inferProducerKitQuality(goodMetrics), { status: "passed", reasons: [] });
assert.equal(inferProducerKitQuality({ ...goodMetrics, rmsDbfs: -90 }).status, "rejected");
assert.equal(inferProducerKitQuality(null).status, "review");

const inferred = inferProducerKitFile("Afro Shaker 105bpm Dm.wav", goodMetrics, {
  genre: "afrobeats",
  bpm: 104,
  keySignature: "A minor",
});
assert.equal(inferred.role.role, "shaker");
assert.equal(inferred.bpm, 105, "filename tempo must beat the kit default");
assert.equal(inferred.keySignature, "D minor", "filename key must beat the kit default");

const manifest = {
  kitId: "be2cfd26-d5b5-44f7-ab4d-a68d2d172ab2",
  name: "Session kit",
  genre: "afrobeats",
  defaultBpm: 104,
  files: [
    {
      clientId: "16e82b49-8f3f-4cc5-8ad4-b2738e427c9d",
      key: "workspace/uploads/stem/shaker.wav",
      fileName: "Shaker 104bpm.wav",
      sizeBytes: 20_000,
      kind: "loop",
      metrics: goodMetrics,
      proposedRole: "shaker",
      proposedBpm: 104,
    },
  ],
  rightsConfirmation: { version: 1, confirmed: true },
} as const;
assert.equal(producerKitManifestSchema.parse(manifest).files.length, 1);
assert.throws(
  () => producerKitManifestSchema.parse({
    ...manifest,
    files: [manifest.files[0], { ...manifest.files[0] }],
  }),
  /duplicate clientId|duplicate upload key/
);

assert.equal(
  confirmProducerKitSchema.parse({
    files: [{
      materialId: "clz1234567890abcdefghijk",
      decision: "accept",
      role: "shaker",
      bpm: 104,
      keySignature: null,
      qualityConfirmed: true,
    }],
  }).files[0]?.decision,
  "accept"
);

const root = resolve(import.meta.dirname, "../../..");
const route = readFileSync(resolve(root, "apps/api/src/routes/producer-kits.ts"), "utf8");
const operatorRoute = readFileSync(resolve(root, "apps/api/src/routes/materials.ts"), "utf8");
const apiIndex = readFileSync(resolve(root, "apps/api/src/index.ts"), "utf8");
const page = readFileSync(resolve(root, "apps/web/app/(app)/materials/page.tsx"), "utf8");

assert.doesNotMatch(route, /requireAdmin/, "producer routes must not inherit the operator wall");
assert.ok((route.match(/requireAuth\(req\)/g) ?? []).length >= 4, "every producer route must authenticate");
assert.match(route, /fingerprintUploadedAudio\(workspaceId, file\.key\)/, "uploads must be owned, sniffed, and hashed");
assert.match(route, /where: \{ workspaceId, id: \{ in:/, "material reads must stay workspace-scoped");
assert.match(route, /workspaceId_contentHash/, "dedupe must be workspace-scoped");
assert.match(route, /roleEvidence: "human-confirmed"/, "inference must not masquerade as confirmation");
assert.match(route, /readiness: "pending"/, "staged files must fail closed before confirmation");
assert.match(operatorRoute, /await requireAdmin\(req\)/, "operator Materials API must remain admin-only");
assert.match(apiIndex, /prefix: "\/producer-kits"/, "producer routes must be registered");
assert.match(page, /<ProducerKitShelf \/>/, "producer shelf must be mounted on Materials");
assert.match(page, /view\.effectiveOperator/, "engine room must remain operator-only in presentation");

console.log("producer kits: inference, schemas, workspace guards, and operator boundary passed");
