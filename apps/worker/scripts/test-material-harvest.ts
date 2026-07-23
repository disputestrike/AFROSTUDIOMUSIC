/**
 * MATERIAL HARVEST — offline evidence test (no DB, no demucs, no network).
 *
 * 1. planLoopOffsets: bar-aligned, non-overlapping, in-bounds, honest [] on
 *    too-short sources.
 * 2. cutLoopWav (only when HARVEST_TEST_FILE points at a local audio file —
 *    CI-safe): cuts a real 8-bar loop, verifies EXACT duration math via
 *    ffprobe, valid 44.1k stereo WAV bytes, and a live RMS receipt.
 *
 * Run against an OWN render for a rights-clean live receipt:
 *   HARVEST_TEST_FILE="...\City Shout - audio.wav" npx tsx scripts/test-material-harvest.ts
 */
import { execFileSync } from "node:child_process";
import { planLoopOffsets, cutLoopWav } from "../src/processors/material-harvest";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
}

// ---- 1. pure offset planning ----
const bpm = 110;
const barS = (60 / bpm) * 4;
const loopS = barS * 8;
const offsets = planLoopOffsets(235, bpm, 8, 2);
assert(offsets.length === 2, `expected 2 offsets, got ${offsets.length}`);
for (const o of offsets) {
  assert(Math.abs(o / barS - Math.round(o / barS)) < 1e-6, `offset ${o} is not bar-aligned (bar=${barS.toFixed(3)}s)`);
  assert(o + loopS <= 235, `offset ${o} overruns the source`);
}
assert(Math.abs(offsets[0]! - offsets[1]!) >= loopS, "offsets overlap");
assert(planLoopOffsets(20, bpm, 8, 2).length === 0, "too-short source must yield NO offsets, never junk");
assert(planLoopOffsets(30, 0, 8, 2).length === 0, "bpm 0 must yield NO offsets");
console.log(`offsets OK: ${offsets.map(o => o.toFixed(2)).join(", ")} (bar-aligned 8-bar @110bpm)`);

// ---- 2. real cut when a local file is supplied ----
async function liveCut(): Promise<void> {
  const file = process.env.HARVEST_TEST_FILE;
  if (!file) {
    console.log("cutLoopWav skipped (set HARVEST_TEST_FILE for the live-cut receipt)");
    return;
  }
  const loop = await cutLoopWav({ sourcePath: file, offsetS: offsets[0]!, bpm, bars: 8 });
  assert(loop.bytes.length > 100_000, `loop suspiciously small (${loop.bytes.length} bytes)`);
  const expectS = loopS;
  assert(Math.abs(loop.durationS - expectS) < 0.01, `duration math drifted: ${loop.durationS} vs ${expectS}`);
  // probe the actual bytes — the receipt must match the claim
  const { writeFileSync, rmSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "afh-harvest-test-"));
  const p = join(dir, "loop.wav");
  writeFileSync(p, loop.bytes);
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=sample_rate,channels", "-of", "default=noprint_wrappers=1", p]).toString();
  rmSync(dir, { recursive: true, force: true });
  assert(/sample_rate=44100/.test(probe), `not 44.1k: ${probe}`);
  assert(/channels=2/.test(probe), `not stereo: ${probe}`);
  const dur = Number(probe.match(/duration=([\d.]+)/)?.[1] ?? 0);
  assert(Math.abs(dur - expectS) < 0.05, `probed duration ${dur}s vs expected ${expectS.toFixed(3)}s`);
  assert(loop.rmsDb === null || loop.rmsDb > -60, `cut is near-silence (RMS ${loop.rmsDb})`);
  console.log(`live cut OK: ${expectS.toFixed(2)}s 44.1k stereo, ${(loop.bytes.length / 1024).toFixed(0)}KB, RMS ${loop.rmsDb?.toFixed(1)} dB`);
}

void liveCut().then(() => console.log("test-material-harvest: PASS"));
