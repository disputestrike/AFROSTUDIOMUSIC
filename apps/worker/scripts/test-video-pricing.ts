/**
 * OWNER-APPROVED PER-CLASS VIDEO PRICING + ONE-CLICK RENDER-ALL — pure proof.
 *
 * The law (owner verdict, verbatim 2026-07-16: "I like your pricing"):
 *   Draft $0.50/scene · Standard $2.00/scene · Flagship $6.00/scene.
 *
 * What must hold, forever:
 *   1. The price table is exactly the approved table.
 *   2. CLIENT MATH === SERVER MATH: the web confirm displays
 *      videoRenderTotalCost(n, class) and the server debits
 *      costOf(videoShotCreditKey(class)) × n — the same pure functions, and
 *      videoRenderAllUsage().totalCost agrees for 0/3/10 unrendered shots at
 *      every class.
 *   3. NO DOUBLE-BILLING: already-rendered shots are excluded from the
 *      render-all bill by construction (and evidence comes only from real
 *      per-shot renders — assembly artifacts are never "rendered shots").
 *   4. LEGACY DEFAULTS: callers without a class bill as 'standard'.
 *   5. FAIL CLOSED: non-arrays and oversized storyboards price nothing.
 */
import assert from "node:assert/strict";
import {
  CREDIT_COSTS,
  costOf,
  formatCredits,
  perShotRenders,
  videoRenderAllUsage,
  videoRenderTotalCost,
  videoRenderUsage,
  videoShotCreditKey,
  VIDEO_ENGINE_CLASSES,
  type VideoEngineClass,
} from "@afrohit/shared";

// ---- 1. The approved price table --------------------------------------------
assert.equal(CREDIT_COSTS.video_shot_draft, 5_000, "draft = $0.50/scene");
assert.equal(CREDIT_COSTS.video_shot_standard, 20_000, "standard = $2.00/scene");
assert.equal(CREDIT_COSTS.video_shot_flagship, 60_000, "flagship = $6.00/scene");
assert.equal(formatCredits(CREDIT_COSTS.video_shot_draft), "$0.50");
assert.equal(formatCredits(CREDIT_COSTS.video_shot_standard), "$2.00");
assert.equal(formatCredits(CREDIT_COSTS.video_shot_flagship), "$6.00");
// Legacy duration keys stay resolvable for HISTORY — never re-key old rows.
assert.equal(CREDIT_COSTS.video_8s, 100_000);
assert.equal(CREDIT_COSTS.video_20s, 250_000);

// ---- 2. Client math === server math for 0/3/10 shots at every class ---------
const shots = Array.from({ length: 10 }, (_, index) => ({
  index,
  prompt: `shot ${index}`,
  duration_s: 4,
}));
for (const engineClass of VIDEO_ENGINE_CLASSES) {
  const key = videoShotCreditKey(engineClass);
  for (const unrendered of [0, 3, 10]) {
    // The set of already-rendered indexes that leaves `unrendered` missing.
    const rendered = shots
      .slice(0, shots.length - unrendered)
      .map(shot => shot.index);
    const usage = videoRenderAllUsage(shots, rendered, engineClass);
    assert.ok(usage, `usage exists for ${engineClass}/${unrendered}`);
    assert.equal(usage.creditKey, key);
    assert.equal(usage.billingUnits, unrendered, "bill = unrendered scenes");
    // SERVER side: chargeCredits debits costOf(key) × multiplier.
    const serverCharge = costOf(usage.creditKey) * usage.billingUnits;
    // CLIENT side: the confirm dialog displays videoRenderTotalCost(n, class).
    const clientTotal = videoRenderTotalCost(unrendered, engineClass);
    assert.equal(usage.totalCost, serverCharge, "usage total = server charge");
    assert.equal(clientTotal, serverCharge, "client math = server math");
  }
}
// Spot-check the approved dollar figures end to end.
assert.equal(videoRenderTotalCost(3, "draft"), 15_000, "3 draft = $1.50");
assert.equal(videoRenderTotalCost(3, "standard"), 60_000, "3 standard = $6.00");
assert.equal(videoRenderTotalCost(10, "flagship"), 600_000, "10 flagship = $60.00");
assert.equal(videoRenderTotalCost(0, "flagship"), 0, "0 shots = $0.00");

// ---- 3. No double-billing ----------------------------------------------------
{
  const five = shots.slice(0, 5);
  const usage = videoRenderAllUsage(five, [0, 2], "standard");
  assert.ok(usage);
  assert.deepEqual(usage.shotIndexes, [1, 3, 4], "only missing scenes queue");
  assert.deepEqual(usage.renderedShotIndexes, [0, 2], "rendered are excluded");
  assert.equal(usage.billingUnits, 3);
  assert.equal(usage.totalCost, videoRenderTotalCost(3, "standard"));
  // Everything rendered → bill NOTHING (the route 409s with this breakdown).
  const done = videoRenderAllUsage(five, [0, 1, 2, 3, 4], "flagship");
  assert.ok(done);
  assert.equal(done.billingUnits, 0);
  assert.equal(done.totalCost, 0);
  assert.deepEqual(done.shotIndexes, []);
  // Junk render indexes (out of range, non-integer) can't distort the bill.
  const junk = videoRenderAllUsage(five, [-1, 99, 2.5] as number[], "draft");
  assert.ok(junk);
  assert.equal(junk.billingUnits, 5, "junk evidence bills the full set");

  // "Rendered" evidence comes from the SAME shared law the assembly gate
  // reads (perShotRenders): only real per-shot rows count — an assembled cut
  // must never masquerade as a rendered shot, and url-less rows are nothing.
  const rendered = perShotRenders([
    { id: "r0", url: "https://cdn/x0.mp4", createdAt: "2026-07-16T00:00:00Z", meta: { shotIndex: 0 } },
    { id: "a1", url: "https://cdn/full.mp4", createdAt: "2026-07-16T00:01:00Z", meta: { assembly: { kind: "full" } } },
    { id: "r9", url: "", createdAt: "2026-07-16T00:02:00Z", meta: { shotIndex: 1 } },
  ]);
  const gated = videoRenderAllUsage(five, rendered.keys(), "standard");
  assert.ok(gated);
  assert.deepEqual(gated.renderedShotIndexes, [0], "only the real shot render counts");
  assert.equal(gated.billingUnits, 4);
}

// ---- 4. Legacy callers default to 'standard' ---------------------------------
assert.equal(videoShotCreditKey(), "video_shot_standard");
assert.equal(videoShotCreditKey(null), "video_shot_standard");
assert.equal(videoShotCreditKey(undefined), "video_shot_standard");
{
  const legacySingle = videoRenderUsage(shots, 2);
  assert.ok(legacySingle);
  assert.equal(legacySingle.creditKey, "video_shot_standard");
  assert.equal(legacySingle.billingUnits, 1, "one scene = one unit");
  const classed: Record<VideoEngineClass, number> = {
    draft: 5_000,
    standard: 20_000,
    flagship: 60_000,
  };
  for (const engineClass of VIDEO_ENGINE_CLASSES) {
    const usage = videoRenderUsage(shots, 2, engineClass);
    assert.ok(usage);
    assert.equal(costOf(usage.creditKey), classed[engineClass]);
  }
}

// ---- 5. Fail closed -----------------------------------------------------------
assert.equal(videoRenderAllUsage([], [], "standard"), null, "no shots = no price");
assert.equal(
  videoRenderAllUsage({ shots } as never, [], "standard"),
  null,
  "a treatment object passed whole prices nothing"
);
assert.equal(
  videoRenderAllUsage(
    Array.from({ length: 41 }, () => ({ duration_s: 4 })),
    [],
    "draft"
  ),
  null,
  "past MAX_TREATMENT_SHOTS the law refuses"
);

console.log(
  "video pricing: owner-approved class table, client/server parity, no-double-billing, legacy standard default and fail-closed all passed"
);
