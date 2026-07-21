/**
 * SYNTH-BED-FIRST STREAMING — the fast synth-only preview bed makes a song
 * AUDIBLE in ~15-20s instead of 2-6 minutes, then hot-swaps to the forged bed,
 * then the master. FLAG-GATED (SONG_BED_FIRST_STREAMING, default OFF) so it
 * ships off and can never glitch current playback.
 *
 * This is the worker-side proof:
 *   1. FLAG OFF  → exactly ONE terminal bed_ready with NO `stage` field, no
 *      preview, no synth-preview provider jobs — byte-identical to today.
 *   2. FLAG ON   → bed_preview{stage:'synth'} emitted BEFORE the forge fan-out
 *      settles, THEN bed_ready{stage:'forged'} after, on a monotonic seq.
 *   3. FAIL-SOFT → when the synth preview throws, NO bed_preview is emitted, the
 *      helper never throws, and the render falls back to the barrier path.
 *
 * Behavioral (the pure runSynthBedPreview helper with injected deps) + source
 * inspection (the own-engine wiring / flag gating / stage ordering) — no DB, no
 * storage, no python. Run:
 *   pnpm --filter @afrohit/worker exec tsx scripts/test-bed-first-streaming.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSynthBedPreview } from "../src/lib/bed-first-stream";
import {
  bedStageOfEvent,
  shouldApplyBedStage,
  BED_STAGE_RANK,
} from "@afrohit/shared";

const ownEngineSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "own-engine.ts"),
  "utf-8"
);
const synthSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "synth-material.ts"),
  "utf-8"
);

// A recording emit that also stamps a monotonic seq, like the real JobEvent
// autoincrement — so ordering + monotonicity are provable without a DB.
function recorder() {
  const events: Array<{ seq: number; phase: string; payload: unknown }> = [];
  let seq = 0;
  return {
    events,
    emit: async (phase: string, payload: unknown) => {
      events.push({ seq: ++seq, phase, payload });
    },
  };
}

async function main(): Promise<void> {
// ── 1. HAPPY PATH: bed_preview{synth} emitted BEFORE the forge stage runs ─────
{
  const rec = recorder();
  const order: string[] = [];
  const clock = 1_000_000; // ms (fixed injected clock)
  const result = await runSynthBedPreview(clock - 17_000 /* started 17s ago */, {
    synthFullKit: async () => {
      order.push("synth");
    },
    pickPreviewKit: async () => {
      order.push("pick");
      return [{ role: "drums" }, { role: "bass" }, { role: "chords" }];
    },
    assemblePreview: async () => {
      order.push("assemble");
      return { beatId: "beat_preview_1", url: "https://cdn/preview.wav" };
    },
    emit: rec.emit,
    now: () => clock,
    log: () => undefined,
  });

  assert.equal(result.emitted, true, "a playable synth bed must emit bed_preview");
  assert.deepEqual(
    order,
    ["synth", "pick", "assemble"],
    "the preview runs synth -> pick -> assemble, in that order, before emit"
  );
  assert.equal(rec.events.length, 1, "exactly one preview event");
  const [ev] = rec.events;
  assert.equal(ev!.phase, "bed_preview");
  const payload = ev!.payload as { stage?: string; url?: string; ttfaS?: number };
  assert.equal(payload.stage, "synth", "the preview stage is 'synth'");
  assert.equal(payload.url, "https://cdn/preview.wav");
  // Time-to-first-audio metric: ~17s from the injected start, carried on the event.
  assert.equal(payload.ttfaS, 17, "ttfaS = now - startedAt (seconds)");
  assert.equal(result.ttfaS, 17);
  assert.match(result.note ?? "", /audible in ~17s/);
}

// ── 2. FAIL-SOFT: the synth pass throws → no emit, no throw, barrier fallback ─
{
  const rec = recorder();
  let threw = false;
  let result;
  try {
    result = await runSynthBedPreview(Date.now(), {
      synthFullKit: async () => {
        throw new Error("python synth stack unavailable");
      },
      pickPreviewKit: async () => {
        throw new Error("must not reach pick after synth failed");
      },
      assemblePreview: async () => null,
      emit: rec.emit,
      now: () => Date.now(),
      log: () => undefined,
    });
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "runSynthBedPreview must NEVER throw (fail-soft)");
  assert.equal(result!.emitted, false, "a failed synth preview emits nothing");
  assert.equal(rec.events.length, 0, "no bed_preview on failure");
  assert.match(result!.note ?? "", /fail-soft/i);
  assert.match(result!.note ?? "", /barrier path/i);
}

// ── 3. FAIL-SOFT: assembly yields no bed → no emit, honest note ───────────────
{
  const rec = recorder();
  const result = await runSynthBedPreview(Date.now(), {
    synthFullKit: async () => undefined,
    pickPreviewKit: async () => [{ role: "drums" }],
    assemblePreview: async () => null, // produced no playable bed
    emit: rec.emit,
    now: () => Date.now(),
    log: () => undefined,
  });
  assert.equal(result.emitted, false);
  assert.equal(rec.events.length, 0);
  assert.match(result.note ?? "", /provisional assembly produced no bed/i);
}

// ── 4. FAIL-SOFT: empty pick (no playable kit) → no emit ─────────────────────
{
  const rec = recorder();
  const result = await runSynthBedPreview(Date.now(), {
    synthFullKit: async () => undefined,
    pickPreviewKit: async () => [],
    assemblePreview: async () => {
      throw new Error("must not assemble an empty kit");
    },
    emit: rec.emit,
    now: () => Date.now(),
    log: () => undefined,
  });
  assert.equal(result.emitted, false);
  assert.equal(rec.events.length, 0);
  assert.match(result.note ?? "", /no playable kit/i);
}

// ── 5. MONOTONIC THREE-STAGE SEQUENCE (preview BEFORE forged, forged after) ──
// Simulate the whole render's event tail: the preview emits stage:'synth' first,
// then (after the forge fan-out settles) the terminal bed_ready emits
// stage:'forged'. The player consumes this exact tail.
{
  const rec = recorder();
  await runSynthBedPreview(Date.now(), {
    synthFullKit: async () => undefined,
    pickPreviewKit: async () => [{ role: "drums" }, { role: "bass" }],
    assemblePreview: async () => ({ beatId: "b1", url: "https://cdn/synth.wav" }),
    emit: rec.emit,
    now: () => Date.now(),
    log: () => undefined,
  });
  // ... forge fan-out settles here (minutes) ...
  await rec.emit("bed_ready", { url: "https://cdn/forged.wav", beatId: "b2", stage: "forged" });

  assert.equal(rec.events.length, 2);
  assert.equal(rec.events[0]!.phase, "bed_preview");
  assert.equal(rec.events[1]!.phase, "bed_ready");
  assert.ok(
    rec.events[0]!.seq < rec.events[1]!.seq,
    "bed_preview must carry a strictly-lower seq than the forged bed_ready"
  );
  assert.equal(
    (rec.events[0]!.payload as { stage?: string }).stage,
    "synth"
  );
  assert.equal(
    (rec.events[1]!.payload as { stage?: string }).stage,
    "forged"
  );
  // The consumer maps the tail to a strictly-increasing stage rank.
  const r0 = BED_STAGE_RANK[bedStageOfEvent(rec.events[0]!.phase, rec.events[0]!.payload)!];
  const r1 = BED_STAGE_RANK[bedStageOfEvent(rec.events[1]!.phase, rec.events[1]!.payload)!];
  assert.ok(r0 < r1, "synth rank (1) < forged rank (2) — an upgrade, never a downgrade");
}

// ── 6. SHARED CONSUMER GUARDS (the same rules the web player enforces) ────────
{
  // Legacy / flag-OFF bed_ready (no stage) reads as 'forged' — unchanged behavior.
  assert.equal(bedStageOfEvent("bed_ready", { url: "u" }), "forged");
  assert.equal(bedStageOfEvent("bed_preview", { url: "u", stage: "synth" }), "synth");
  assert.equal(bedStageOfEvent("running", {}), null);

  // Stale event for a different render is ignored.
  assert.equal(shouldApplyBedStage(null, "jobA", "jobB", 1), false);
  // First stage for the active render applies.
  assert.equal(shouldApplyBedStage(null, "jobA", "jobA", 1), true);
  // Upgrade applies; downgrade / re-apply does not.
  assert.equal(shouldApplyBedStage({ jobId: "jobA", rank: 1 }, "jobA", "jobA", 2), true);
  assert.equal(shouldApplyBedStage({ jobId: "jobA", rank: 2 }, "jobA", "jobA", 1), false);
  assert.equal(shouldApplyBedStage({ jobId: "jobA", rank: 2 }, "jobA", "jobA", 2), false);
}

// ── 7. SOURCE WIRING: flag gating, ordering, and the OFF-path invariant ──────
{
  // The flag exists, default OFF (=== "1" opt-in), read once.
  assert.match(
    ownEngineSrc,
    /const bedFirstStreaming = process\.env\.SONG_BED_FIRST_STREAMING === "1"/,
    "SONG_BED_FIRST_STREAMING must be the opt-in flag (default OFF)"
  );

  // The preview stage is gated by the flag AND excludes replay-locked renders.
  assert.match(
    ownEngineSrc,
    /if \(bedFirstStreaming && !replayLocked\) \{/,
    "the preview stage must be gated by the flag and skip replay-locked renders"
  );

  // The preview calls runSynthBedPreview and passes previewOnly synth material.
  assert.match(ownEngineSrc, /runSynthBedPreview\(jobStartedAt, \{/);
  assert.match(ownEngineSrc, /previewOnly: true/, "preview synth must be previewOnly");
  assert.match(
    ownEngineSrc,
    /includePreviewOnly/,
    "pickKit must support excluding preview-only loops from the real bed"
  );

  // STRUCTURAL ORDERING: the preview emit sits BEFORE the forge fan-out barrier
  // (this is what makes audio arrive minutes early).
  const previewAt = ownEngineSrc.indexOf("runSynthBedPreview(jobStartedAt");
  const forgeFanoutAt = ownEngineSrc.indexOf("forEachPool(richMissing");
  assert.ok(previewAt > 0 && forgeFanoutAt > 0, "both the preview and the forge fan-out must exist");
  assert.ok(
    previewAt < forgeFanoutAt,
    "the synth preview must run BEFORE the real-instrument forge fan-out"
  );

  // OFF-PATH INVARIANT: the terminal bed_ready adds stage:'forged' ONLY under the
  // flag; with the flag off the payload is exactly {url, beatId} as today.
  assert.match(
    ownEngineSrc,
    /emitJobEvent\(p\.jobId, "bed_ready", \{\s*url: out\.url,\s*beatId: out\.beatId,\s*\.\.\.\(bedFirstStreaming \? \{ stage: "forged" as const \} : \{\}\),/,
    "the terminal bed_ready must only carry stage:'forged' when the flag is on"
  );

  // The forged bed pickKit calls must NOT opt into preview-only loops (so the
  // forged bed is byte-identical to today) — only the preview pick opts in.
  const includeTrueCount = (ownEngineSrc.match(/true \/\/ include previewOnly loops/g) ?? []).length;
  assert.equal(
    includeTrueCount,
    1,
    "exactly one pickKit (the preview's own) may include preview-only loops"
  );

  // synth-material stamps previewOnly on the loop meta so pickKit can exclude it.
  assert.match(
    synthSrc,
    /p\.previewOnly \? \{ previewOnly: true \}/,
    "synth-material must stamp previewOnly on the loop meta"
  );
}

console.log(
  "bed-first streaming: preview-before-forge, monotonic three-stage tail, fail-soft, flag-OFF byte-identical, previewOnly isolation — PASS"
);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
