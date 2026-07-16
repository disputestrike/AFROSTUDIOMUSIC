/**
 * POST-RENDER SALVAGE LAW — proof (2026-07-16).
 *
 * The money rule under test: a scene whose render was PAID at the engine but
 * never delivered (download failure after the prediction finished) must be
 * pulled back in for free — never re-billed, never re-rendered — and a scene
 * PROVEN dead (unrecoverable) must be released for an honest fresh render
 * instead of looping in recovery forever.
 *
 * Part 1 unit-tests the pure claims law. Part 2 pins the route and worker
 * wiring (same style as the worker's stem-integrity pins) so no refactor can
 * silently drop the salvage-before-billing order or the no-new-spend gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { salvageClaims } from "../src/lib/video-salvage";

function testClaimsLaw(): void {
  // Paid-but-undelivered: submitted prediction id survives → claimable.
  const claims = salvageClaims([
    {
      id: "job_new",
      inputJson: { conceptId: "c1", shotIndex: 2, engineClass: "standard" },
      outputJson: {
        videoProgress: [
          { shotIndex: 2, state: "submitted", externalId: "pred_live" },
        ],
      },
    },
    {
      id: "job_old",
      inputJson: { conceptId: "c1", shotIndex: 2, engineClass: "draft" },
      outputJson: {
        videoProgress: [
          { shotIndex: 2, state: "submitted", externalId: "pred_older" },
        ],
      },
    },
  ]);
  assert.equal(claims.get(2)?.jobId, "job_new", "newest failed job wins the scene");
  assert.equal(claims.get(2)?.engineClass, "standard");

  // PROVEN-DEAD entries are excluded — no recover-forever trap.
  const dead = salvageClaims([
    {
      id: "job_dead",
      inputJson: { shotIndex: 0 },
      outputJson: {
        videoProgress: [
          {
            shotIndex: 0,
            state: "submitted",
            externalId: "pred_expired",
            unrecoverable: "download link is no longer live",
          },
        ],
      },
    },
  ]);
  assert.equal(dead.size, 0, "an unrecoverable entry must release the scene for fresh billing");

  // Committed-but-uncredited (url already in owned storage) also claims.
  const committed = salvageClaims([
    {
      id: "job_url",
      inputJson: {},
      outputJson: {
        videoProgress: [
          { shotIndex: 1, state: "succeeded", url: "https://r2.example/clip.mp4" },
          { shotIndex: 3, state: "submitted" }, // no externalId → nothing to recover
        ],
      },
    },
  ]);
  assert.deepEqual([...committed.keys()], [1], "url-committed claims; empty submissions never do");
  assert.equal(committed.get(1)?.shotIndex, null, "whole-board job carries null shotIndex");

  // A single-scene job can only claim ITS scene, even if stale progress
  // rows from other scenes leak into its output.
  const scoped = salvageClaims([
    {
      id: "job_scoped",
      inputJson: { shotIndex: 4 },
      outputJson: {
        videoProgress: [
          { shotIndex: 4, state: "submitted", externalId: "pred_a" },
          { shotIndex: 5, state: "submitted", externalId: "pred_b" },
        ],
      },
    },
  ]);
  assert.deepEqual([...scoped.keys()], [4]);

  // Garbage shapes never throw and never claim.
  assert.equal(
    salvageClaims([
      { id: "j", inputJson: null, outputJson: { videoProgress: "nope" } },
      { id: "k", inputJson: [], outputJson: null },
    ]).size,
    0
  );
}

function testWiring(): void {
  const routes = readFileSync(
    join(process.cwd(), "src/routes/videos.ts"),
    "utf8"
  );
  // /renders: salvage consult BEFORE the charge — recovered scenes are never billed.
  const rendersAt = routes.indexOf('"/renders"');
  const salvageAt = routes.indexOf("salvageableVideoShots", rendersAt);
  const requeueAt = routes.indexOf("requeueVideoRecovery", salvageAt);
  const chargeAt = routes.indexOf("app.chargeCredits", rendersAt);
  assert.ok(
    rendersAt >= 0 && salvageAt > rendersAt && requeueAt > salvageAt && chargeAt > requeueAt,
    "/renders must consult salvage and requeue BEFORE any charge"
  );
  // /render-all: bill from the salvage-adjusted usage, and requeue claims
  // before queueing fresh renders.
  const renderAllAt = routes.indexOf('"/render-all"');
  const allSalvageAt = routes.indexOf("salvageableVideoShots", renderAllAt);
  const billUsageAt = routes.indexOf("const billUsage = videoRenderAllUsage", allSalvageAt);
  const allChargeAt = routes.indexOf("app.chargeCredits", renderAllAt);
  const allRequeueAt = routes.indexOf("requeueVideoRecovery", renderAllAt);
  const freshQueueAt = routes.indexOf("billUsage.shotIndexes[i]", renderAllAt);
  assert.ok(
    renderAllAt >= 0 &&
      allSalvageAt > renderAllAt &&
      billUsageAt > allSalvageAt &&
      allChargeAt > billUsageAt &&
      allRequeueAt > allChargeAt &&
      freshQueueAt > allRequeueAt,
    "/render-all must charge from salvage-adjusted usage and requeue claims before fresh queueing"
  );
  assert.match(
    routes.slice(renderAllAt),
    /multiplier:\s*billUsage\.billingUnits/,
    "the batch charge must use the salvage-adjusted units"
  );

  // Worker contract: recovery runs can never start fresh provider spend.
  const worker = readFileSync(
    join(process.cwd(), "../worker/src/processors/video.ts"),
    "utf8"
  );
  assert.match(
    worker,
    /p\.recoverOnly && !\(existing\?\.externalId && adapter\.poll\)/,
    "recover-only gate: no submitted prediction → skip, never renderShot"
  );
  assert.match(
    worker,
    /!entry\.keyframeRef && !p\.recoverOnly/,
    "recovery must never regenerate a billable likeness keyframe"
  );
  assert.match(
    worker,
    /existing\.unrecoverable = reason;[\s\S]{0,80}await save\(existing\.externalId\);/,
    "proven-dead entries must be marked AND persisted"
  );
  assert.match(
    worker,
    /p\.recoverOnly && !results\.length[\s\S]{0,600}recovery found nothing downloadable/,
    "all-dead recovery must fail honestly, not succeed empty"
  );
  assert.match(
    worker,
    /recoveredShotIndexes: results\.map\(r => r\.shotIndex\)/,
    "recovery success must carry its receipt"
  );
}

testClaimsLaw();
testWiring();
console.log(
  "video salvage: claims law, dead-entry release, route order, and no-new-spend gate all hold"
);
