/**
 * ASYNC STORYBOARD TREATMENT — proof (2026-07-17).
 *
 * Owner's law: "anywhere we have slow time-to-action is a customer loss —
 * speed, speed, speed" and "once I say make a video, just go ahead." The
 * full-song creative-director treatment ran a multi-minute LLM chain (main pass
 * 120s + optional critic 60s + optional repair 120s) SYNCHRONOUSLY on the
 * request path, so "Make the whole video" could 502 at Railway/Cloudflare's
 * ~100s edge while the work kept running. This pins the fix:
 *   - the route returns 202 + jobId for full_song and enqueues on the video queue
 *   - mode:'short' stays synchronous (a single fast call, no edge risk)
 *   - the worker owns the compute (same laws: song-subject, performer/duet gate,
 *     grounded critic) and marks the job SUCCEEDED with the conceptId
 *   - a domain rejection is a SUCCEEDED job whose output says `rejected`
 *   - both web callers poll the job to terminal BEFORE re-fetching the concept /
 *     firing scene renders — the one press never renders against a stale plan
 *
 * House idiom: source-invariant pins — a regression that resynchronizes the
 * route, drops the worker dispatch, or lets the UI skip the poll trips exactly
 * the assertion naming it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const route = read("src/routes/videos.ts");
const worker = read("../worker/src/processors/video-treatment.ts");
const workerIndex = read("../worker/src/index.ts");
const grid = read("../web/components/CatalogGrid.tsx");

// ── ROUTE: full_song enqueues (202), short stays sync ────────────────────────
assert.match(
  route,
  /if \(input\.mode !== "short"\) \{/,
  "route: everything but short mode goes to the queue"
);
assert.match(
  route,
  /jobName: "video-treatment"/,
  "route: the treatment job is named for the worker dispatch"
);
assert.match(
  route,
  /queue: app\.queues\.video/,
  "route: the treatment rides the video queue (which has a worker)"
);
assert.match(
  route,
  /reply\.code\(202\);/,
  "route: full_song responds 202 (queued), not an inline 201 concept"
);
assert.match(
  route,
  /jobId: treatmentJob\.jobId,\s*\r?\n?\s*status: "queued"/,
  "route: the 202 body carries the jobId the client polls"
);
// The pre-spend fast checks still fail instantly (before the queue).
const gateAt = route.indexOf('error: "content_not_allowed"');
const enqueueAt = route.indexOf('if (input.mode !== "short")');
assert.ok(
  gateAt >= 0 && enqueueAt > gateAt,
  "route: the content-abuse gate still runs BEFORE the enqueue"
);
// The heavy inline compute is GONE from the request path.
assert.ok(
  !route.includes("mode:'full_song' — the creative-director treatment"),
  "route: the full_song compute no longer lives on the request path"
);
assert.ok(
  !/task: "video-treatment"/.test(route),
  "route: the treatment LLM call is no longer made inline"
);
// Short mode is untouched — still synchronous, still returns the concept.
assert.match(
  route,
  /if \(input\.mode === "short"\) \{/,
  "route: short mode still runs synchronously"
);

// ── WORKER: owns the compute, marks the job, honest rejections ───────────────
assert.match(
  workerIndex,
  /else if \(job\.name === "video-treatment"\)\s*\r?\n?\s*await processVideoTreatment/,
  "worker: the video queue dispatches video-treatment to the processor"
);
assert.match(
  worker,
  /await markSucceeded\(jobId, \{\s*\r?\n?\s*conceptId: concept\.id/,
  "worker: a successful treatment marks the job SUCCEEDED with the conceptId"
);
assert.match(
  worker,
  /rejected: true,\s*\r?\n?\s*code: "invalid_storyboard_output"/,
  "worker: an unusable treatment is a SUCCEEDED job flagged rejected (no retry storm)"
);
assert.match(
  worker,
  /missingDuetLeads\(performers, treatment\)/,
  "worker: the duet/performer gate still runs before any concept is written"
);
assert.match(
  worker,
  /prisma\.videoConcept\.create/,
  "worker: the worker is what persists the concept now"
);
// Text only — nothing to charge or refund (the enqueue carried no charge).
assert.ok(
  !/chargeCredits|refundCredits/.test(worker),
  "worker: the treatment spends no credit (text only)"
);

// ── WEB: both callers wait for the job before using the plan ─────────────────
assert.match(
  grid,
  /async function settleStoryboard\(resp: \{/,
  "web: a shared poller settles the treatment job"
);
assert.match(
  grid,
  /if \(!resp\?\.jobId\) return \{ ok: true \};/,
  "web: short mode (inline concept, no jobId) resolves instantly"
);
assert.match(
  grid,
  /job\.outputJson\?\.rejected/,
  "web: a rejected treatment is surfaced from the job output, not thrown"
);
// makeVideoPlan awaits the poll before re-fetching the concept.
const planAt = grid.indexOf("async function makeVideoPlan");
const planSettleAt = grid.indexOf("await settleStoryboard(resp)", planAt);
const planLoadAt = grid.indexOf("await loadVideoConcept(s.id)", planSettleAt);
assert.ok(
  planAt >= 0 && planSettleAt > planAt && planLoadAt > planSettleAt,
  "web: makeVideoPlan polls the job BEFORE re-loading the concept"
);
// makeWholeVideo awaits the poll before firing scene renders.
const wholeAt = grid.indexOf("async function makeWholeVideo");
const wholeSettleAt = grid.indexOf("await settleStoryboard(resp)", wholeAt);
const wholeRenderAt = grid.indexOf("/videos/render-all", wholeSettleAt);
assert.ok(
  wholeAt >= 0 && wholeSettleAt > wholeAt && wholeRenderAt > wholeSettleAt,
  "web: the one-press flow waits for the plan BEFORE rendering scenes"
);

// ── REVIEW FIXES (adversarial pass, 2026-07-17) ──────────────────────────────
// 1. The client poll ceiling must clear the worker's real worst case (main 120s
//    + critic 60s + repair 120s + queue latency + provider failover) or the
//    one-press flow abandons a render the server actually completes.
assert.match(
  grid,
  /const deadline = Date\.now\(\) \+ 12 \* 60_000;/,
  "fix1: the storyboard poll ceiling is 12 min, above the worker's worst case"
);
// 2. The treatment enqueue threads the client's idempotency-key (like the render
//    routes), so a POST retried during a redeploy dedupes instead of minting a
//    second treatment job + duplicate concept.
assert.match(
  route,
  /const idempotencyKey = scopedRequestKey\(\s*\r?\n?\s*req\.headers as Record<string, unknown>,\s*\r?\n?\s*`video-treatment:/,
  "fix2: the treatment enqueue scopes an idempotency key per song"
);
const enqAt = route.indexOf('jobName: "video-treatment"');
const keyPassAt = route.indexOf("idempotencyKey,", enqAt);
assert.ok(
  enqAt >= 0 && keyPassAt > enqAt,
  "fix2: the idempotency key is actually passed into createQueuedProviderJob"
);

console.log(
  "async storyboard: route 202-enqueues (idempotent), worker owns the compute, UI polls with a worst-case-safe ceiling before using the plan"
);
