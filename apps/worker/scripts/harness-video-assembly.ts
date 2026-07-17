/**
 * WAVE 9 PROOF HARNESS — full music-video assembly, measured, no fakes.
 *
 *   pnpm --filter @afrohit/worker exec tsx scripts/harness-video-assembly.ts
 *
 * Generates SYNTHETIC rendered shots (lavfi solid colors, mixed sizes/fps,
 * 9s each — like real 5-10s provider renders) and a synthetic "master"
 * (220 Hz for 10s, then 1760 Hz — a frequency step at the hook), then drives
 * the EXACT assembler the worker ships (assembleMusicVideoTimeline) and
 * MEASURES the outputs with ffprobe/ffmpeg:
 *
 *   FULL  (3 sequences / 6 shots, slots sum 20s):
 *     - duration == sum of treatment slots ±0.2s (the handle law makes the
 *       crossfades consume rendered handles, not timeline)
 *     - 1920x1080, h264, HAS an aac audio stream
 *     - frame count ≈ 20s * 30fps (CFR proof)
 *     - crossfades EXIST at both sequence boundaries: the boundary-window
 *       frame is a measured BLEND of the two adjacent solid colors, while
 *       frames outside the window are pure
 *   TRIM LAW: a 9s rendered clip in a 4s slot occupies exactly 4s
 *   TEASER (4 refs, slots sum 16s, cap 15s, hook at 10s):
 *     - duration == teaserCut.durationS ±0.2s, 1080x1920
 *     - audio STARTS AT THE HOOK: the first second of output audio is the
 *       1760 Hz region (high-band RMS >> low-band RMS); the 220 Hz opening
 *       of the master never appears
 *     - 1s audio fade-out: the last 0.3s is markedly quieter than the middle
 *
 * NOT registered in test-all.ts (needs ffmpeg + ~2 min of encoding); the
 * suite carries the pure gating law in test-video-assembly.ts. Exits 0 with
 * a SKIP note when ffmpeg is absent — never a fake pass.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleMusicVideoTimeline,
  ffmpegAvailable,
  normalizeVideoClip,
  probeMediaDurationPreciseS,
  runFfmpeg,
  ASSEMBLY_FPS,
} from "../src/lib/ffmpeg";
import { planVideoAssembly, type AssemblyRenderRow } from "@afrohit/shared";

function run(
  command: string,
  args: string[]
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", c => out.push(Buffer.from(c)));
    child.stderr.on("data", c => {
      if (err.length < 200_000) err += c.toString("utf8");
    });
    child.once("close", code => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
    child.once("error", () => resolve({ code: null, stdout: Buffer.alloc(0), stderr: "spawn failed" }));
  });
}

async function probeJson(path: string): Promise<{
  width: number;
  height: number;
  vcodec: string;
  acodec: string | null;
  nbFrames: number;
}> {
  const { code, stdout } = await run("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames",
    "-of", "json",
    path,
  ]);
  assert.equal(code, 0, "ffprobe must read the output");
  const parsed = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<Record<string, unknown>>;
  };
  const v = parsed.streams?.find(s => s.codec_type === "video");
  const a = parsed.streams?.find(s => s.codec_type === "audio");
  assert.ok(v, "output must carry a video stream");
  return {
    width: Number(v!.width),
    height: Number(v!.height),
    vcodec: String(v!.codec_name),
    acodec: a ? String(a.codec_name) : null,
    nbFrames: Number(v!.nb_read_frames ?? 0),
  };
}

/** Mean R/G/B of ONE frame at time t — the crossfade-blend measurement. */
async function frameMeanRgb(path: string, t: number): Promise<{ r: number; g: number; b: number }> {
  const { code, stdout } = await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", t.toFixed(3), "-i", path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  assert.equal(code, 0, `frame extraction at ${t}s must succeed`);
  assert.ok(stdout.length >= 3, "frame must have pixels");
  let r = 0, g = 0, b = 0;
  const pixels = Math.floor(stdout.length / 3);
  for (let i = 0; i < pixels; i++) {
    r += stdout[i * 3]!;
    g += stdout[i * 3 + 1]!;
    b += stdout[i * 3 + 2]!;
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

/** Overall RMS (dB) of a slice of the output's AUDIO through a filter. */
async function audioRmsDb(path: string, startS: number, durS: number, extraFilter?: string): Promise<number> {
  const { code, stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats",
    "-ss", startS.toFixed(3), "-t", durS.toFixed(3), "-i", path,
    "-map", "0:a:0",
    "-af", `${extraFilter ? `${extraFilter},` : ""}astats=metadata=0`,
    "-f", "null", "-",
  ]);
  assert.equal(code, 0, "audio measurement must run");
  const overall = stderr.slice(stderr.lastIndexOf("Overall"));
  const m = overall.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/);
  assert.ok(m, "astats must report an RMS level");
  return m![1] === "-inf" ? -120 : Number.parseFloat(m![1]!);
}

async function makeColorClip(path: string, color: string, seconds: number, w: number, h: number, fps: number) {
  await runFfmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}:r=${fps}:d=${seconds}`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    path,
  ]);
}

async function main() {
  if (!(await ffmpegAvailable())) {
    console.log("SKIP: ffmpeg is not available on this host — the harness needs it (runs in the worker image).");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "wave9-proof-"));
  const measurements: string[] = [];
  try {
    // ---- synthetic master: 220 Hz for 10s, then 1760 Hz for 50s ----------
    const master = join(dir, "master.wav");
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=220:duration=10",
      "-f", "lavfi", "-i", "sine=frequency=1760:duration=50",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[a]",
      "-map", "[a]", "-ar", "44100", "-ac", "2",
      master,
    ]);
    const masterS = await probeMediaDurationPreciseS(master);
    assert.ok(Math.abs(masterS - 60) < 0.2, `master is ~60s (got ${masterS})`);

    // ---- synthetic rendered shots: 9s each (real renders run 5-10s), -----
    // mixed sizes AND fps to prove normalization; boundary-adjacent clips
    // are pure colors so the crossfade is measurable.
    const clips: Record<string, string> = {};
    const specs: Array<[string, string, number, number, number]> = [
      // name, color, w, h, fps
      ["a0", "gray", 1080, 1920, 25], // portrait source → letterbox pad proof
      ["a1", "red", 1280, 720, 25], // last of seq0 → boundary 1 color A
      ["b0", "blue", 1920, 1080, 30], // first of seq1 → boundary 1 color B
      ["b1", "lime", 960, 540, 24], // last of seq1 → boundary 2 color A (lime = full green 0,255,0)
      ["c0", "magenta", 1280, 720, 30], // first of seq2 → boundary 2 color B
      ["c1", "yellow", 1920, 1080, 25],
    ];
    for (const [name, color, w, h, fps] of specs) {
      const path = join(dir, `${name}.mp4`);
      await makeColorClip(path, color, 9, w, h, fps);
      clips[name] = path;
    }

    // ---- TRIM LAW in isolation: 9s render, 4s slot → exactly 4s ----------
    {
      const trimmed = join(dir, "trim-proof.mp4");
      await normalizeVideoClip({
        input: clips.a1!,
        output: trimmed,
        width: 1920,
        height: 1080,
        fit: "pad",
        trimS: 4,
      });
      const d = await probeMediaDurationPreciseS(trimmed);
      measurements.push(`trim law: 9s render in a 4s slot → ${d.toFixed(3)}s`);
      assert.ok(Math.abs(d - 4) <= 0.1, `trim law: expected 4s, measured ${d}`);
    }

    // ---- FULL: 3 sequences / 6 shots, slots [4,3][4,2][3,4] = 20s --------
    // EDL: seq0 ends at 7, seq1 at 13, total 20. Crossfade windows (handle
    // law): [7.0, 7.5] red→blue and [13.0, 13.5] green→magenta.
    const full = await assembleMusicVideoTimeline({
      workDir: dir,
      kind: "full",
      clips: [
        { path: clips.a0!, slotS: 4, sequenceIndex: 0, shotIndex: 0 },
        { path: clips.a1!, slotS: 3, sequenceIndex: 0, shotIndex: 1 },
        { path: clips.b0!, slotS: 4, sequenceIndex: 1, shotIndex: 2 },
        { path: clips.b1!, slotS: 2, sequenceIndex: 1, shotIndex: 3 },
        { path: clips.c0!, slotS: 3, sequenceIndex: 2, shotIndex: 4 },
        { path: clips.c1!, slotS: 4, sequenceIndex: 2, shotIndex: 5 },
      ],
      audioPath: master,
      audioStartS: 0,
      maxDurationS: null,
    });
    measurements.push(
      `full: duration ${full.durationS}s (planned 20s), covered ${full.coveredS}s, crossfades ${full.crossfadeCount}`
    );
    assert.ok(
      Math.abs(full.durationS - 20) <= 0.2,
      `full duration must be 20±0.2s, measured ${full.durationS}`
    );
    const fullProbe = await probeJson(full.path);
    measurements.push(
      `full: ${fullProbe.width}x${fullProbe.height} ${fullProbe.vcodec}, audio=${fullProbe.acodec}, frames=${fullProbe.nbFrames}`
    );
    assert.equal(fullProbe.width, 1920);
    assert.equal(fullProbe.height, 1080);
    assert.equal(fullProbe.vcodec, "h264");
    assert.equal(fullProbe.acodec, "aac", "the master must be muxed in");
    const expectedFrames = 20 * ASSEMBLY_FPS;
    assert.ok(
      Math.abs(fullProbe.nbFrames - expectedFrames) <= 15,
      `frame count ~${expectedFrames} (CFR ${ASSEMBLY_FPS}), measured ${fullProbe.nbFrames}`
    );
    assert.equal(full.crossfadeCount, 2, "exactly one crossfade per sequence boundary");

    // Crossfade blend proof, boundary 1 (red→blue, window [7.0, 7.5]):
    {
      const before = await frameMeanRgb(full.path, 6.5); // pure red
      const mid = await frameMeanRgb(full.path, 7.25); // blend
      const after = await frameMeanRgb(full.path, 7.8); // pure blue
      measurements.push(
        `boundary1 rgb — before(6.5s) R${before.r.toFixed(0)}/B${before.b.toFixed(0)}, mid(7.25s) R${mid.r.toFixed(0)}/B${mid.b.toFixed(0)}, after(7.8s) R${after.r.toFixed(0)}/B${after.b.toFixed(0)}`
      );
      assert.ok(before.r > 180 && before.b < 60, "6.5s is pure red (no early fade)");
      assert.ok(after.b > 180 && after.r < 60, "7.8s is pure blue (fade is over)");
      assert.ok(
        mid.r > 40 && mid.r < 215 && mid.b > 40 && mid.b < 215,
        `7.25s must be a red/blue BLEND (measured R${mid.r.toFixed(0)} B${mid.b.toFixed(0)})`
      );
    }
    // Crossfade blend proof, boundary 2 (green→magenta, window [13.0, 13.5]):
    {
      const before = await frameMeanRgb(full.path, 12.5); // pure green
      const mid = await frameMeanRgb(full.path, 13.25); // blend
      const after = await frameMeanRgb(full.path, 13.8); // pure magenta
      measurements.push(
        `boundary2 rgb — before(12.5s) G${before.g.toFixed(0)}/R${before.r.toFixed(0)}, mid(13.25s) G${mid.g.toFixed(0)}/R${mid.r.toFixed(0)}, after(13.8s) G${after.g.toFixed(0)}/R${after.r.toFixed(0)}`
      );
      assert.ok(before.g > 130 && before.r < 60, "12.5s is pure green");
      assert.ok(after.r > 180 && after.g < 90, "13.8s is pure magenta");
      assert.ok(
        mid.g > 40 && mid.g < 215 && mid.r > 40 && mid.r < 215,
        `13.25s must be a green/magenta BLEND (measured G${mid.g.toFixed(0)} R${mid.r.toFixed(0)})`
      );
    }
    // Letterbox proof: the portrait gray source (shot 0) must be pillarboxed —
    // black columns pull the frame mean far below pure gray (128,128,128).
    {
      const padded = await frameMeanRgb(full.path, 2.0);
      measurements.push(`pad proof (2.0s, portrait source): mean R${padded.r.toFixed(0)}`);
      assert.ok(
        padded.r > 20 && padded.r < 100,
        `portrait source must be pillarboxed (gray+black mean, measured ${padded.r.toFixed(0)})`
      );
    }

    // ---- HONEST 409 path (pure law, asserted here too) --------------------
    {
      const storyboard = {
        kind: "treatment",
        concept: "x",
        logline: "x",
        motifs: [],
        structureSource: "measured",
        durationS: 60,
        sequences: [
          { index: 0, label: "Intro", startS: 0, endS: 20, shotIndexes: [0] },
          { index: 1, label: "Hook", startS: 20, endS: 40, shotIndexes: [1] },
        ],
        shots: [
          { index: 0, sequenceIndex: 0, prompt: "a", duration_s: 4 },
          { index: 1, sequenceIndex: 1, prompt: "b", duration_s: 4 },
        ],
        teaserCut: { durationS: 15, format: "vertical", shotRefs: [1] },
      };
      const renders: AssemblyRenderRow[] = [
        { id: "r0", url: "s3://b/w/r0.mp4", createdAt: "2026-07-01T00:00:00Z", meta: { shotIndex: 0 } },
      ];
      const gate = planVideoAssembly({ kind: "full", storyboard, renders });
      assert.equal(gate.ok, false);
      assert.deepEqual(
        !gate.ok && gate.error === "shots_missing" ? gate.missing.map(m => m.label) : [],
        ["Hook"],
        "the 409 names exactly the sequence lacking renders"
      );
      measurements.push("409 path: missing=[Hook] — exact, honest");
    }

    // ---- TEASER: 4 refs, slots 4+4+4+4=16, cap 15, hook offset 10s -------
    const teaser = await assembleMusicVideoTimeline({
      workDir: dir,
      kind: "teaser",
      clips: [
        { path: clips.b0!, slotS: 4, sequenceIndex: 1, shotIndex: 2 },
        { path: clips.b1!, slotS: 4, sequenceIndex: 1, shotIndex: 3 },
        { path: clips.c0!, slotS: 4, sequenceIndex: 2, shotIndex: 4 },
        { path: clips.c1!, slotS: 4, sequenceIndex: 2, shotIndex: 5 },
      ],
      audioPath: master,
      audioStartS: 10, // the hook sequence's startS — where 1760 Hz begins
      maxDurationS: 15,
    });
    measurements.push(
      `teaser: duration ${teaser.durationS}s (cap 15s, slots 16s), covered ${teaser.coveredS}s, crossfades ${teaser.crossfadeCount}`
    );
    assert.ok(
      Math.abs(teaser.durationS - 15) <= 0.2,
      `teaser duration must be 15±0.2s, measured ${teaser.durationS}`
    );
    const teaserProbe = await probeJson(teaser.path);
    measurements.push(
      `teaser: ${teaserProbe.width}x${teaserProbe.height} ${teaserProbe.vcodec}, audio=${teaserProbe.acodec}, frames=${teaserProbe.nbFrames}`
    );
    assert.equal(teaserProbe.width, 1080);
    assert.equal(teaserProbe.height, 1920);
    assert.equal(teaserProbe.acodec, "aac");
    assert.equal(teaser.crossfadeCount, 0, "the teaser is hard cuts only");

    // AUDIO STARTS AT THE HOOK: the first second must be the 1760 Hz region.
    {
      const highDb = await audioRmsDb(teaser.path, 0, 1, "highpass=f=800");
      const lowDb = await audioRmsDb(teaser.path, 0, 1, "lowpass=f=400");
      measurements.push(
        `teaser audio start: high-band(>800Hz) ${highDb.toFixed(1)} dB vs low-band(<400Hz) ${lowDb.toFixed(1)} dB`
      );
      assert.ok(
        highDb - lowDb > 20,
        `first second must be the 1760Hz hook region (high ${highDb} vs low ${lowDb})`
      );
    }
    // 1s AUDIO FADE-OUT: the last 0.3s is much quieter than the middle.
    {
      const midDb = await audioRmsDb(teaser.path, 7, 1);
      const tailDb = await audioRmsDb(teaser.path, 14.7, 0.3);
      measurements.push(
        `teaser fade-out: mid(7-8s) ${midDb.toFixed(1)} dB vs tail(last 0.3s) ${tailDb.toFixed(1)} dB`
      );
      assert.ok(midDb - tailDb > 6, `the tail must fade (mid ${midDb} vs tail ${tailDb})`);
    }

    // ---- MIN-LAW: audio shorter than the timeline caps the output --------
    {
      const shortAudio = join(dir, "short.wav");
      await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ar", "44100", "-ac", "2", shortAudio]);
      const capped = await assembleMusicVideoTimeline({
        workDir: await mkdtemp(join(dir, "min-")),
        kind: "full",
        clips: [
          { path: clips.a1!, slotS: 4, sequenceIndex: 0, shotIndex: 0 },
          { path: clips.b0!, slotS: 4, sequenceIndex: 1, shotIndex: 1 },
        ],
        audioPath: shortAudio,
        audioStartS: 0,
        maxDurationS: null,
      });
      measurements.push(
        `min-law: 8s timeline over 6s audio → ${capped.durationS}s (covered ${capped.coveredS}s stays honest)`
      );
      assert.ok(Math.abs(capped.durationS - 6) <= 0.2, `min(video,audio) law: expected 6s, measured ${capped.durationS}`);
      assert.ok(Math.abs(capped.coveredS - 8) <= 0.2, "coveredS still reports the full timeline");
      assert.equal(capped.loopedCycles, 1, "min-law cut never loops");
    }

    // ---- FULL-SONG COVERAGE LAW (2026-07-17): the record leads ------------
    // 8s of rendered scenes under a 30s song + coverAudio → the cut runs the
    // WHOLE song by cycling the scenes; loopedCycles says so honestly.
    {
      const song = join(dir, "song30.wav");
      await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=30", "-ar", "44100", "-ac", "2", song]);
      const covered = await assembleMusicVideoTimeline({
        workDir: await mkdtemp(join(dir, "cover-")),
        kind: "full",
        clips: [
          { path: clips.a1!, slotS: 4, sequenceIndex: 0, shotIndex: 0 },
          { path: clips.b0!, slotS: 4, sequenceIndex: 1, shotIndex: 1 },
        ],
        audioPath: song,
        audioStartS: 0,
        maxDurationS: null,
        coverAudio: true,
      });
      measurements.push(
        `full-song coverage: 8s scenes over 30s song → ${covered.durationS}s cut, ${covered.loopedCycles} cycles (coveredS ${covered.coveredS}s unique)`
      );
      assert.ok(
        Math.abs(covered.durationS - 30) <= 0.3,
        `the cut must run the whole record: expected 30s, measured ${covered.durationS}`
      );
      assert.ok(covered.loopedCycles >= 4, `8s scenes need >=4 cycles for 30s, got ${covered.loopedCycles}`);
      assert.ok(Math.abs(covered.coveredS - 8) <= 0.3, "coveredS still reports UNIQUE visual length");
      const coveredProbe = await probeJson(covered.path);
      assert.equal(coveredProbe.acodec, "aac", "the song must be muxed through the whole cut");
      const loopTailDb = await audioRmsDb(covered.path, 27, 1);
      assert.ok(loopTailDb > -40, `the song must still be audible near the end (measured ${loopTailDb} dB at 27s)`);
    }

    console.log("\n==== WAVE 9 PROOF — every assertion passed ====");
    for (const line of measurements) console.log("  " + line);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error("HARNESS FAILED:", error);
  process.exit(1);
});
