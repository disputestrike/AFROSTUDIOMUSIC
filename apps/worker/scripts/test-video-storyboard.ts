import assert from "node:assert/strict";
import { normalizeStoryboardShots, videoRenderUsage } from "@afrohit/shared";

const normalized = normalizeStoryboardShots(
  [
    { prompt: " first shot ", duration_s: 1 },
    { prompt: "", duration_s: 12 },
    { prompt: "second", duration_s: 5, subjects: ["lead", "", 42] },
    { prompt: "third", duration_s: 99 },
    { prompt: "fourth", duration_s: 3 },
  ],
  20
);
assert.deepEqual(
  normalized.map(shot => shot.duration_s),
  [4, 8, 8],
  "durations should use provider-supported values within the approved total"
);
assert.equal(
  normalized.reduce((sum, shot) => sum + shot.duration_s, 0),
  20
);
assert.deepEqual(normalized[1]!.subjects, ["lead"]);
assert.deepEqual(
  normalized.map(shot => shot.index),
  [0, 1, 2]
);

// OWNER-APPROVED PER-SCENE PRICING: no engine class → bills as 'standard'
// ($2.00/scene); billingUnits = scenes, planUnits still meter provider
// seconds for the plan caps. (Legacy video_8s/video_20s keys survive only
// for historical ledger rows — never for a new charge.)
const fanOut = videoRenderUsage(
  Array.from({ length: 6 }, () => ({ duration_s: 1 }))
);
assert.deepEqual(fanOut, {
  creditKey: "video_shot_standard",
  billingUnits: 6,
  planUnits: 24,
  shotCount: 6,
});

const single = videoRenderUsage(normalized, 0);
assert.deepEqual(single, {
  creditKey: "video_shot_standard",
  billingUnits: 1,
  planUnits: 4,
  shotCount: 1,
});
assert.equal(
  videoRenderUsage(normalized, 0, "draft")!.creditKey,
  "video_shot_draft"
);
assert.equal(
  videoRenderUsage(normalized, 0, "flagship")!.creditKey,
  "video_shot_flagship"
);
assert.equal(videoRenderUsage(normalized, 99), null);
assert.equal(
  videoRenderUsage(Array.from({ length: 16 }, () => ({ duration_s: 4 }))),
  null
);

console.log("video storyboard: normalization and shot-aware billing passed");
