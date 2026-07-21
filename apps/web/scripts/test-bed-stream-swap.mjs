import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BED_STAGE_RANK,
  bedStageOfEvent,
  shouldApplyBedStage,
  planBedSwap,
  clampResume,
} from '@afrohit/shared';

// ─────────────────────────────────────────────────────────────────────────────
// SYNTH-BED-FIRST PLAYER HOT-SWAP — the correctness-critical part. The player
// upgrades synth -> forged -> master on the SAME render job, preserving the
// listener's position + play/pause across every source swap, ignoring stale /
// out-of-order events and never downgrading. These are the SHARED rules the
// create page's applyBedStage + <audio onLoadedMetadata> are built on.
// ─────────────────────────────────────────────────────────────────────────────

// ── Stage mapping (what the tail carries) ────────────────────────────────────
assert.equal(bedStageOfEvent('bed_preview', { url: 'u', stage: 'synth' }), 'synth');
assert.equal(bedStageOfEvent('bed_ready', { url: 'u', stage: 'forged' }), 'forged');
// Flag-OFF / legacy bed_ready has no stage → treated as 'forged' (unchanged).
assert.equal(bedStageOfEvent('bed_ready', { url: 'u' }), 'forged');
assert.equal(bedStageOfEvent('running', {}), null);
assert.equal(bedStageOfEvent('render_done', {}), null);
assert.deepEqual(BED_STAGE_RANK, { synth: 1, forged: 2, master: 3 });

// ── Guards: stale job ignored, no downgrade, no re-apply, upgrades only ───────
// Stale: an event for a job other than the active render never moves the player.
assert.equal(shouldApplyBedStage(null, 'jobA', 'jobB', 1), false);
assert.equal(shouldApplyBedStage({ jobId: 'jobA', rank: 2 }, 'jobA', 'jobB', 3), false);
// First audible stage for the active render applies.
assert.equal(shouldApplyBedStage(null, 'jobA', 'jobA', 1), true);
// Upgrades apply; equal or lower ranks do not (out-of-order polls can't rewind).
assert.equal(shouldApplyBedStage({ jobId: 'jobA', rank: 1 }, 'jobA', 'jobA', 2), true);
assert.equal(shouldApplyBedStage({ jobId: 'jobA', rank: 2 }, 'jobA', 'jobA', 3), true);
assert.equal(shouldApplyBedStage({ jobId: 'jobA', rank: 2 }, 'jobA', 'jobA', 1), false, 'no downgrade');
assert.equal(shouldApplyBedStage({ jobId: 'jobA', rank: 2 }, 'jobA', 'jobA', 2), false, 'no re-apply');
// No active render → nothing applies.
assert.equal(shouldApplyBedStage(null, null, 'jobA', 1), false);

// ── clampResume: keep the listener inside the new clip ───────────────────────
assert.equal(clampResume(30, 120), 30, 'a mid-clip position is preserved exactly');
assert.equal(clampResume(0, 120), 0);
assert.equal(clampResume(-5, 120), 0, 'a negative time floors to 0');
assert.equal(clampResume(200, 120), 120 - 0.05, 'a position past the new end clamps just inside it');
assert.equal(clampResume(30, 0), 30, 'unknown new duration keeps the requested time');

// ─────────────────────────────────────────────────────────────────────────────
// END-TO-END: a fake <audio> element driven by the SAME handshake the create
// page uses (capture-before-swap into resumeRef, then planBedSwap on the new
// source's loadedmetadata). Proves position + play/pause survive the swap.
// ─────────────────────────────────────────────────────────────────────────────

function fakeAudio(duration) {
  return {
    currentTime: 0,
    paused: true,
    ended: false,
    duration,
    src: '',
    _play() { this.paused = false; },
    _pause() { this.paused = true; },
  };
}

// Mirrors the create page: applyBedStage captures state before the src change,
// the element loads the new source, and onLoadedMetadata re-applies the plan.
function hotSwap(el, newUrl, newDuration) {
  const prev = { time: el.currentTime || 0, playing: !el.paused && !el.ended };
  // ...source changes (React updates <audio src>); metadata loads for newDuration...
  el.src = newUrl;
  el.duration = newDuration;
  el.currentTime = 0; // a raw src change resets to 0 (the glitch we're undoing)
  const plan = planBedSwap(prev, el.duration);
  el.currentTime = plan.time;
  if (plan.play) el._play();
  else el._pause();
}

// A listener 42s into the synth preview, PLAYING → swap to the forged bed.
{
  const el = fakeAudio(180);
  el._play();
  el.currentTime = 42;
  hotSwap(el, 'https://cdn/forged.wav', 178);
  assert.equal(el.src, 'https://cdn/forged.wav');
  assert.equal(el.currentTime, 42, 'position preserved across the synth -> forged swap');
  assert.equal(el.paused, false, 'a playing listener keeps playing after the swap');
}

// A listener 60s in, PAUSED → swap to the master. Stays paused, position kept.
{
  const el = fakeAudio(178);
  el._pause();
  el.currentTime = 60;
  hotSwap(el, 'https://cdn/master.wav', 178);
  assert.equal(el.currentTime, 60, 'position preserved across the forged -> master swap');
  assert.equal(el.paused, true, 'a paused listener stays paused after the swap');
}

// Swap while near the tail of a longer clip onto a shorter master: clamp inside.
{
  const el = fakeAudio(200);
  el._play();
  el.currentTime = 199.9;
  hotSwap(el, 'https://cdn/master.wav', 178);
  assert.ok(el.currentTime <= 178 - 0.05 + 1e-9, 'position clamps inside the shorter master');
  assert.equal(el.paused, false);
}

// ── SOURCE CONTRACT: the create page wires exactly this handshake ─────────────
const create = readFileSync(new URL('../app/(app)/create/page.tsx', import.meta.url), 'utf8');
// No remount key on the console player (a remount restarts from 0 — the glitch).
assert.doesNotMatch(create, /key=\{nowPlaying\.url\}/, 'the console player must NOT remount on url change');
// The swap handshake: capture into resumeRef, re-apply with planBedSwap on load.
assert.match(create, /resumeRef\.current = \{ time: el\.currentTime \|\| 0, playing:/, 'capture position+state before swap');
assert.match(create, /onLoadedMetadata=\{/, 'the new source restores state on loadedmetadata');
assert.match(create, /planBedSwap\(resume, dur\)/, 'the restore uses the shared planBedSwap handshake');
assert.match(create, /function applyBedStage\(/);
assert.match(create, /shouldApplyBedStage\(cursor, activeRenderJobRef\.current, jobId, rank\)/, 'stage decisions use the shared guard');
assert.match(create, /bedStageOfEvent\(phase, partial\)/, 'events are mapped to stages via the shared helper');
// Preview phase surfaces the honest provisional label.
assert.match(create, /Playing preview - final mix rendering/, 'the preview state is disclosed as provisional');

console.log('bed-stream player hot-swap: position+state preserved, stale/out-of-order/downgrade ignored, no-remount handshake — PASS');
