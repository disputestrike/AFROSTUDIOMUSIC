import assert from "node:assert/strict";
import {
  assemblyEvidenceReport,
  completeSceneRows,
  sceneEvidenceReport,
  VIDEO_EVIDENCE_VERSION,
} from "../src/lib/video-evidence";

const meta = {
  evidenceVersion: VIDEO_EVIDENCE_VERSION,
  providerJobId: "job_1",
  renderedAt: "2026-07-19T00:00:00.000Z",
  shotIndex: 0,
  shotPrompt: "A Lagos performance",
  contentHash: "a".repeat(64),
  sizeBytes: 4096,
  width: 1080,
  height: 1920,
  measuredDurationS: 6,
  codec: "h264",
  container: "mp4",
  qualityState: "passed",
  outputAspectRatio: "9:16",
};
const scene = {
  id: "scene_1",
  url: "s3://bucket/ws/videos/scene.mp4",
  durationS: 6,
  provider: "hailuo",
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  meta,
};
assert.equal(sceneEvidenceReport(scene).ok, true);

const legacy = sceneEvidenceReport({
  ...scene,
  id: "scene_legacy",
  meta: { ...meta, evidenceVersion: undefined, providerJobId: undefined },
});
assert.equal(legacy.ok, true);
assert.ok(legacy.warnings.length >= 1);

const incomplete = {
  ...scene,
  id: "scene_bad",
  meta: { ...meta, contentHash: null },
};
assert.equal(sceneEvidenceReport(incomplete).ok, false);

const assembly = {
  id: "assembly_1",
  url: "s3://bucket/ws/videos/full.mp4",
  durationS: 120,
  provider: "assembler",
  createdAt: new Date("2026-07-19T00:10:00.000Z"),
  meta: {
    assembly: {
      evidenceVersion: VIDEO_EVIDENCE_VERSION,
      providerJobId: "job_assembly_1",
      kind: "full",
      durationS: 120,
      contentHash: "b".repeat(64),
      sizeBytes: 8192,
      width: 1920,
      height: 1080,
      codec: "h264",
      container: "mp4",
      qualityState: "passed",
      renderedAt: "2026-07-19T00:10:00.000Z",
      shotsUsed: [0],
      renderIdsUsed: ["scene_1"],
      sourceSceneHashes: [
        { renderId: "scene_1", contentHash: "a".repeat(64) },
      ],
      audioSource: { id: "master_1", type: "master", startS: 0 },
    },
  },
};
assert.equal(assemblyEvidenceReport(assembly).ok, true);

const filtered = completeSceneRows([scene, incomplete, assembly]);
assert.deepEqual(filtered.complete.map(row => row.id), ["scene_1"]);
assert.equal(filtered.reports.length, 2);

console.log("API scene and assembled-video evidence tests passed");
