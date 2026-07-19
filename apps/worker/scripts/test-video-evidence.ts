import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateVideoCostUsd,
  inspectVideoBytes,
  validateVideoProbe,
} from "../src/lib/video-inspection";
import {
  assemblyEvidenceCompleteness,
  sceneEvidenceCompleteness,
  VIDEO_EVIDENCE_VERSION,
} from "../src/lib/video-evidence";

const valid = {
  width: 1080,
  height: 1920,
  durationS: 8,
  codec: "h264",
  container: "mov,mp4,m4a,3gp,3g2,mj2",
};

function generateFixture(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=360x640:r=24:d=1",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        path,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("video fixture generation timed out"));
    }, 30_000);
    child.stderr.on("data", chunk => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.once("error", error => finish(error));
    child.once("close", code => {
      if (code === 0) finish();
      else finish(new Error(`ffmpeg fixture failed: ${stderr.slice(-1_000)}`));
    });
  });
}

async function main() {
  const sceneMeta = {
    evidenceVersion: VIDEO_EVIDENCE_VERSION,
    providerJobId: "job_video_1",
    renderedAt: "2026-07-19T12:00:00.000Z",
    shotIndex: 0,
    shotPrompt: "A Lagos stage performance",
    contentHash: "a".repeat(64),
    sizeBytes: 2048,
    width: 1080,
    height: 1920,
    measuredDurationS: 8,
    codec: "h264",
    container: "mp4",
    qualityState: "passed",
    outputAspectRatio: "9:16",
  };
  const scene = {
    id: "scene_1",
    url: "s3://bucket/workspace/videos/scene.mp4",
    durationS: 8,
    provider: "hailuo",
    meta: sceneMeta,
  };
  assert.equal(
    sceneEvidenceCompleteness(scene, { requireVersion: true }).ok,
    true
  );
  assert.equal(
    sceneEvidenceCompleteness({
      ...scene,
      meta: { ...sceneMeta, contentHash: null },
    }).ok,
    false
  );
  assert.equal(
    sceneEvidenceCompleteness({
      ...scene,
      meta: { ...sceneMeta, evidenceVersion: undefined, providerJobId: undefined },
    }).ok,
    true,
    "complete legacy scene evidence remains usable"
  );
  assert.equal(
    sceneEvidenceCompleteness(
      {
        ...scene,
        meta: {
          ...sceneMeta,
          likeness: {
            rightsBasis: "user-attested-likeness",
            trainedModelRef: "owner/model:abc12345",
            consentId: "consent_1",
            keyframeRef: null,
          },
        },
      },
      { likenessRequired: true }
    ).ok,
    false,
    "likeness scenes require their keyframe lineage"
  );

  const assembly = {
    kind: "full",
    evidenceVersion: VIDEO_EVIDENCE_VERSION,
    providerJobId: "job_assembly_1",
    durationS: 120,
    contentHash: "b".repeat(64),
    sizeBytes: 4096,
    width: 1920,
    height: 1080,
    codec: "h264",
    container: "mp4",
    qualityState: "passed",
    renderedAt: "2026-07-19T12:10:00.000Z",
    shotsUsed: [0],
    renderIdsUsed: ["scene_1"],
    sourceSceneHashes: [
      { renderId: "scene_1", contentHash: "a".repeat(64) },
    ],
    audioSource: { id: "master_1", type: "master", startS: 0 },
  };
  assert.equal(
    assemblyEvidenceCompleteness({
      url: "s3://bucket/workspace/videos/full.mp4",
      durationS: 120,
      provider: "assembler",
      meta: { assembly },
    }).ok,
    true
  );
  assert.equal(
    assemblyEvidenceCompleteness({
      url: "s3://bucket/workspace/videos/full.mp4",
      durationS: 120,
      provider: "assembler",
      meta: { assembly: { ...assembly, sourceSceneHashes: [] } },
    }).ok,
    false
  );

  assert.deepEqual(
    validateVideoProbe(valid, { format: "vertical", expectedDurationS: 8 }),
    valid
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, width: 1920, height: 1080 },
        { format: "vertical", expectedDurationS: 8 }
      ),
    /aspect ratio/
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, codec: "vp9" },
        { format: "vertical", expectedDurationS: 8 }
      ),
    /H\.264/
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, container: "matroska,webm" },
        { format: "vertical", expectedDurationS: 8 }
      ),
    /MP4/
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, durationS: 30 },
        { format: "vertical", expectedDurationS: 8 }
      ),
    /duration/
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, width: 100, height: 100 },
        { format: "square", expectedDurationS: 8 }
      ),
    /dimensions/
  );
  assert.throws(
    () =>
      validateVideoProbe(
        { ...valid, width: 10_000, height: 10_000 },
        { format: "square", expectedDurationS: 8 }
      ),
    /dimensions/
  );

  assert.equal(estimateVideoCostUsd("sora", 8, 1.2345678), 1.234568);
  assert.equal(estimateVideoCostUsd("stub", 8, 0), 0);
  assert.equal(
    estimateVideoCostUsd("sora", 8, undefined, {
      SORA_COST_USD_PER_SECOND: "0.1",
    }),
    0.8
  );
  assert.equal(
    estimateVideoCostUsd("veo", 8, undefined, {
      VIDEO_COST_USD_PER_SECOND: "0.2",
    }),
    1.6
  );
  assert.equal(estimateVideoCostUsd("sora", 8, undefined, {}), null);

  const directory = await mkdtemp(join(tmpdir(), "afrohit-video-proof-"));
  try {
    const path = join(directory, "fixture.mp4");
    await generateFixture(path);
    const bytes = await readFile(path);
    const inspected = await inspectVideoBytes(bytes, {
      format: "vertical",
      expectedDurationS: 1,
      maxBytes: 10 * 1024 * 1024,
    });
    assert.equal(inspected.width, 360);
    assert.equal(inspected.height, 640);
    assert.equal(inspected.codec, "h264");
    assert.match(inspected.container, /(^|,)mp4(,|$)/);
    assert.ok(inspected.durationS >= 0.9 && inspected.durationS <= 1.1);
    assert.equal(inspected.sizeBytes, bytes.byteLength);
    assert.match(inspected.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(inspected.qualityState, "passed");

    await assert.rejects(
      inspectVideoBytes(Buffer.alloc(2_048), {
        format: "vertical",
        expectedDurationS: 1,
        maxBytes: 10 * 1024 * 1024,
      }),
      /video probe/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  console.log("video render decode, integrity, and cost evidence tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
