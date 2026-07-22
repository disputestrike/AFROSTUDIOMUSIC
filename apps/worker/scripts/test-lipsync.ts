/**
 * LIP-SYNC LAWS — proof (2026-07-17, owner: "the big issue is lip syncing").
 *
 * Pinned: the EXACT verified engine body ({video_url, audio_file} — nothing
 * else, nothing renamed); the offset math that finds each clip's slice of
 * the record (hard cuts accumulate, crossfaded sequence boundaries overlap
 * by the assembler's own XFADE constant — the two can never drift apart);
 * and the wiring laws (flag-gated, full-cut only, per-clip best effort that
 * keeps the original on failure, honest meta receipt).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lipSyncModelBody, LIPSYNC_MODEL } from "@afrohit/ai";
import { computeClipAudioOffsets, ASSEMBLY_XFADE_S } from "../src/lib/ffmpeg";

// --- The exact engine contract (verified live schema 2026-07-17).
assert.equal(LIPSYNC_MODEL, "kwaivgi/kling-lip-sync");
assert.deepEqual(
  lipSyncModelBody({ videoUrl: "https://v/x.mp4", audioUrl: "https://a/x.wav" }),
  { video_url: "https://v/x.mp4", audio_file: "https://a/x.wav" },
  "the engine body is exactly video_url + audio_file — drift is a burned render"
);

// --- Offset math mirrors the assembler's timeline.
assert.equal(ASSEMBLY_XFADE_S, 0.5, "the shared crossfade constant");
const offsets = computeClipAudioOffsets(
  [
    { slotS: 4, sequenceIndex: 0 },
    { slotS: 3, sequenceIndex: 0 }, // hard cut: 0 + 4
    { slotS: 4, sequenceIndex: 1 }, // boundary: 7 - 0.5 crossfade = 6.5
    { slotS: 2, sequenceIndex: 1 }, // hard cut: 6.5 + 4
  ],
  ASSEMBLY_XFADE_S
);
assert.deepEqual(offsets, [0, 4, 6.5, 10.5], "hard cuts accumulate; boundaries overlap by the crossfade");
assert.deepEqual(
  computeClipAudioOffsets([{ slotS: 6, sequenceIndex: 0 }], ASSEMBLY_XFADE_S),
  [0],
  "a single clip starts at zero"
);

// --- Wiring laws in the assembler.
const assemble = readFileSync(
  join(process.cwd(), "src/processors/assemble-video.ts"),
  "utf8"
);
assert.match(
  assemble,
  /process\.env\.LIPSYNC_ENABLED !== "0" && p\.kind === "full"/,
  "ON by default (owner order) and full-cut only — LIPSYNC_ENABLED=0 disables it"
);
assert.match(
  assemble,
  /lip-sync kept the original for clip/,
  "per-clip best effort: a failed sync keeps the original, never fails the cut"
);
assert.match(assemble, /lipSync!\.estimatedUsd \+= clip\.slotS \* 0\.014/, "honest engine-spend estimate at the verified rate");
assert.match(assemble, /\n\s+lipSync,\r?\n/, "the assembly meta carries the sync receipt");
const syncAt = assemble.indexOf("LIP-SYNC PASS");
const assembleCallAt = assemble.indexOf("assembleMusicVideoTimeline({");
assert.ok(syncAt >= 0 && syncAt < assembleCallAt, "clips sync BEFORE the timeline is cut");

console.log("lip-sync: exact engine body, offset math, flag gate, best-effort law, and receipts all hold");
