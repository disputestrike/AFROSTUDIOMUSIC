/**
 * VIDEO-ASSEMBLY SPEED PROOFS (vidspeed 2026-07-20) — the two latency fixes
 * have receipts, and the receipts prove the OUTPUT is unchanged:
 *
 *   FIX 1 — PARALLEL NORMALIZE: assembleMusicVideoTimeline conforms every shot
 *     through a bounded pool (VIDEO_NORMALIZE_CONCURRENCY) instead of N serial
 *     re-encodes. Order is rebuilt from (group,clip) coordinates, NOT from
 *     completion — so a slow-normalizing FIRST clip still lands first. Proven
 *     functionally: a big (slow) red clip ahead of two small clips assembles
 *     red → green → blue in strict EDL order on a real ffmpeg render.
 *
 *   FIX 2 — FOLDED BRAND PASS: the opening credit and the "afro" watermark are
 *     both drawtext on the identical frame, so overlayCreditsAndWatermark burns
 *     BOTH in ONE re-encode (the pipeline used to spend two). The splash stays
 *     first, the watermark still rides 0s→end (splash included), and the credit
 *     still cues 0.8s into the first scene — its window shifted by the splash
 *     now in front of it. Proven functionally on a black synthetic cut.
 *
 * Offline by design (mirrors test-brand-splash.ts): the construction laws
 * always run; the ffmpeg legs run only when the binary answers, and the
 * drawtext leg additionally needs the cached display font — each skip is
 * announced honestly, never a fake pass.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assembleMusicVideoTimeline,
  buildBrandWatermarkFilters,
  buildVideoCreditFilters,
  buildVideoCreditLines,
  ensureDisplayFont,
  ffmpegAvailable,
  overlayCreditsAndWatermark,
  prependLogoSplash,
  probeMediaDurationPreciseS,
  resolveBrandLogoPath,
  runFfmpeg,
  ASSEMBLY_FPS,
  CREDIT_CUE_START_S,
  CREDIT_CUE_END_S,
  SPLASH_DURATION_S,
  WATERMARK_TEXT,
} from "../src/lib/ffmpeg";

function run(
  command: string,
  args: string[]
): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    child.stdout.on("data", c => out.push(Buffer.from(c)));
    child.once("close", code => resolve({ code, stdout: Buffer.concat(out) }));
    child.once("error", () => resolve({ code: null, stdout: Buffer.alloc(0) }));
  });
}

/** Mean R/G/B of ONE frame at time t (whole frame or a cropped region). */
async function frameMeanRgb(
  path: string,
  t: number,
  crop?: { w: number; h: number; x: number; y: number }
): Promise<{ r: number; g: number; b: number; luma: number }> {
  const vf = crop ? ["-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : [];
  const { code, stdout } = await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", t.toFixed(3), "-i", path,
    "-frames:v", "1", ...vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
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
  r /= pixels; g /= pixels; b /= pixels;
  return { r, g, b, luma: 0.299 * r + 0.587 * g + 0.114 * b };
}

async function makeColorClip(
  path: string, color: string, seconds: number, w: number, h: number, fps: number
) {
  await runFfmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}:r=${fps}:d=${seconds}`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    path,
  ]);
}

async function main() {
  // =====================================================================
  // A) CONSTRUCTION LAWS (pure — always run, no ffmpeg needed)
  // =====================================================================

  // --- FIX 1 wiring: the normalize loop fans out through the pool ---------
  {
    const src = await readFile("src/lib/ffmpeg.ts", "utf8");
    assert.ok(
      /VIDEO_NORMALIZE_CONCURRENCY/.test(src),
      "the normalize concurrency env knob exists"
    );
    assert.ok(
      /VIDEO_NORMALIZE_CONCURRENCY\s*\?\?\s*4|process\.env\.VIDEO_NORMALIZE_CONCURRENCY\s*\?\?\s*4/.test(
        src
      ),
      "normalize pool width defaults to 4"
    );
    assert.ok(
      /await forEachPool\(\s*normalizeTasks/.test(src),
      "the per-clip normalize runs through the bounded pool"
    );
    assert.ok(
      /normalized\[task\.g\]!\[task\.c\]\s*=\s*task\.output/.test(src),
      "results are collected into an index-keyed slot (deterministic order)"
    );
    // The OLD serial shape (push-on-complete inside nested for loops) is gone.
    assert.ok(
      !/files\.push\(output\);\s*\n\s*}\s*\n\s*normalized\.push\(files\)/.test(src),
      "the old serial normalize loop is removed"
    );
    console.log("[fix1] normalize fans out through the bounded pool (order-keyed)");
  }

  // --- FIX 2 wiring: the processor folds credit+watermark into one pass ----
  {
    const proc = await readFile("src/processors/assemble-video.ts", "utf8");
    assert.ok(
      /overlayCreditsAndWatermark\(/.test(proc),
      "the assembler burns credit + watermark in the folded pass"
    );
    assert.ok(
      !/\boverlayVideoCredits\(/.test(proc),
      "the standalone credit re-encode is gone (folded)"
    );
    assert.ok(
      !/\boverlayBrandWatermark\(/.test(proc),
      "the standalone watermark re-encode is gone (folded)"
    );
    // Splash still its own structural pass, ahead of the drawtext fold.
    const splashAt = proc.indexOf("prependLogoSplash(");
    const brandAt = proc.indexOf("overlayCreditsAndWatermark(");
    assert.ok(splashAt > 0 && brandAt > splashAt, "splash runs BEFORE the brand fold");
    // Per-feature fail-soft receipts survive the merge.
    assert.ok(
      /splash\s*=\s*{\s*\n?\s*applied:\s*false/.test(proc),
      "splash still degrades to applied:false on failure"
    );
    assert.ok(
      /credits\s*=\s*null;[\s\S]{0,120}watermark\s*=\s*{\s*\n?\s*applied:\s*false/.test(
        proc
      ),
      "the folded pass degrades to credits=null + watermark applied:false"
    );
    // The credit cue is shifted only when the splash actually shipped.
    assert.ok(
      /creditOffsetS:\s*splash\.applied\s*\?\s*SPLASH_DURATION_S\s*:\s*0/.test(proc),
      "credit cue shifts by the splash length only when the splash shipped"
    );
    console.log("[fix2] processor folds credit+watermark into one pass, splash first, fail-soft intact");
  }

  // --- FIX 2 credit builder: byte-identical no-splash, shifted with splash --
  {
    const lines = buildVideoCreditLines({
      title: "Neon Night Drive",
      artist: "BXP",
      producer: "AfroHits Studio",
      height: 1080,
    });
    assert.equal(lines.length, 3, "title / artist / producer");
    assert.equal(lines[0]!.text, "NEON NIGHT DRIVE", "title is upper-cased");

    const noSplash = buildVideoCreditFilters({
      lines,
      textPaths: ["a.txt", "b.txt", "c.txt"],
      fontPath: "C:/fonts/anton.ttf",
      width: 1920,
      height: 1080,
      enableStartS: CREDIT_CUE_START_S,
      enableEndS: CREDIT_CUE_END_S,
    });
    assert.ok(
      noSplash.every(f => f.includes("enable='between(t,0.8,5.2)'")),
      "no-splash cue window is byte-identical to the historic credit (0.8-5.2)"
    );
    const shifted = buildVideoCreditFilters({
      lines,
      textPaths: ["a.txt", "b.txt", "c.txt"],
      fontPath: "C:/fonts/anton.ttf",
      width: 1920,
      height: 1080,
      enableStartS: CREDIT_CUE_START_S + SPLASH_DURATION_S,
      enableEndS: CREDIT_CUE_END_S + SPLASH_DURATION_S,
    });
    assert.ok(
      shifted.every(f => f.includes("enable='between(t,2.6,7)'")),
      "with a 1.8s splash the cue shifts to 2.6-7.0 (same wall-clock moment)"
    );

    // The FOLD: credit filters + watermark filters chain into ONE -vf.
    const watermark = buildBrandWatermarkFilters({
      fontPath: "C:/fonts/anton.ttf",
      textPath: "C:/tmp/wordmark.txt",
      width: 1920,
      height: 1080,
    });
    const combined = [...shifted, ...watermark];
    assert.equal(combined.length, 5, "3 credit lines + 2 watermark marks in ONE pass");
    const vf = combined.join(",");
    assert.ok(vf.includes("shadowcolor"), "credit drawtext present in the chain");
    assert.ok(
      vf.includes(`fontcolor=white:fontsize=`) && vf.includes("H-text_h-"),
      "watermark drawtext present in the same chain"
    );
    console.log("[fix2] credit+watermark fold into a single -vf; no-splash output byte-identical");
  }

  // =====================================================================
  // B) FIX 1 — parallel normalize preserves EDL order (needs ffmpeg)
  // =====================================================================
  if (!(await ffmpegAvailable())) {
    console.log(
      "[speed] SKIP render legs honestly: ffmpeg not on this host " +
        "(runs in the worker image; construction laws proven above)"
    );
    console.log("test-video-assembly-speed: PASS (construction-only)");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "vidspeed-"));
  try {
    // A 4s silent master to mux under the tiny teaser.
    const master = join(dir, "master.wav");
    await runFfmpeg([
      "-f", "lavfi", "-t", "4", "-i", "anullsrc=r=44100:cl=stereo",
      "-ar", "44100", "-ac", "2", master,
    ]);

    // clip0 (red) is BIG so it normalizes SLOWEST — yet it must land FIRST.
    // clip1 (green) + clip2 (blue) are tiny. Order can only survive if the
    // pool writes results by coordinate, not by completion.
    const red = join(dir, "red.mp4");
    const green = join(dir, "green.mp4");
    const blue = join(dir, "blue.mp4");
    await makeColorClip(red, "red", 2, 1920, 1080, 30);
    await makeColorClip(green, "green", 2, 160, 120, 30); // lime = pure green
    await makeColorClip(blue, "blue", 2, 160, 120, 30);

    const teaser = await assembleMusicVideoTimeline({
      workDir: dir,
      kind: "teaser", // hard cuts only — clean 1s segments, no crossfade blur
      clips: [
        { path: red, slotS: 1, sequenceIndex: 0, shotIndex: 0 },
        { path: green, slotS: 1, sequenceIndex: 0, shotIndex: 1 },
        { path: blue, slotS: 1, sequenceIndex: 0, shotIndex: 2 },
      ],
      audioPath: master,
      audioStartS: 0,
      maxDurationS: null,
    });
    const teaserS = await probeMediaDurationPreciseS(teaser.path);
    assert.ok(Math.abs(teaserS - 3) < 0.3, `teaser is ~3s (got ${teaserS.toFixed(3)})`);

    const seg0 = await frameMeanRgb(teaser.path, 0.5);
    const seg1 = await frameMeanRgb(teaser.path, 1.5);
    const seg2 = await frameMeanRgb(teaser.path, 2.5);
    assert.ok(seg0.r > 150 && seg0.g < 90 && seg0.b < 90, `segment 0 is RED (got R${seg0.r.toFixed(0)} G${seg0.g.toFixed(0)} B${seg0.b.toFixed(0)})`);
    assert.ok(seg1.g > 120 && seg1.r < 90 && seg1.b < 90, `segment 1 is GREEN (got R${seg1.r.toFixed(0)} G${seg1.g.toFixed(0)} B${seg1.b.toFixed(0)})`);
    assert.ok(seg2.b > 150 && seg2.r < 90 && seg2.g < 90, `segment 2 is BLUE (got R${seg2.r.toFixed(0)} G${seg2.g.toFixed(0)} B${seg2.b.toFixed(0)})`);
    console.log(
      `[fix1] parallel normalize preserved EDL order: red@0.5s -> green@1.5s -> blue@2.5s ` +
        `(slow big clip still first)`
    );

    // =====================================================================
    // C) FIX 2 — folded pass on a BLACK cut: splash first, watermark full
    //    duration, credit shifted; each measured on real pixels.
    // =====================================================================
    const logoPath = resolveBrandLogoPath();
    assert.ok(logoPath, "the official logo asset resolves");
    const fontPath = await ensureDisplayFont();
    if (!fontPath) {
      console.log(
        "[fix2] SKIP drawtext render leg honestly: display font unavailable " +
          "offline (construction proven above)"
      );
      console.log("test-video-assembly-speed: PASS (pool order proven, drawtext construction-only)");
      return;
    }

    const W = 640, H = 360;
    // Pure BLACK base so ANY overlay pixel is measurable against luma 0.
    const base = join(dir, "black.mp4");
    await runFfmpeg([
      "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${ASSEMBLY_FPS}:d=2`,
      "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=44100:cl=stereo",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      base,
    ]);

    // Splash FIRST (structural concat) — exactly the processor's order.
    const splashed = join(dir, "splashed.mp4");
    await prependLogoSplash({ input: base, output: splashed, logoPath: logoPath!, width: W, height: H });
    const splashedS = await probeMediaDurationPreciseS(splashed);
    assert.ok(
      Math.abs(splashedS - (2 + SPLASH_DURATION_S)) < 0.25,
      `splash prepends ${SPLASH_DURATION_S}s (got ${splashedS.toFixed(3)}s)`
    );

    // The FOLDED pass: credit + watermark, one re-encode, cue shifted by splash.
    const branded = join(dir, "branded.mp4");
    await overlayCreditsAndWatermark({
      input: splashed,
      output: branded,
      width: W,
      height: H,
      fontPath,
      credit: { title: "Neon Night Drive", artist: "BXP", producer: "AfroHits Studio" },
      creditOffsetS: SPLASH_DURATION_S,
    });
    const brandedS = await probeMediaDurationPreciseS(branded);
    assert.ok(
      Math.abs(brandedS - splashedS) < 0.2,
      `the drawtext fold never changes the runtime (${brandedS.toFixed(3)} vs ${splashedS.toFixed(3)})`
    );

    // Region probes on the BLACK cut (overlays are the only non-black pixels).
    const brRegion = { w: 160, h: 70, x: W - 170, y: H - 80 }; // bottom-right: persistent watermark
    const creditRegion = { w: 260, h: 46, x: 24, y: 248 };     // lower-left band: credit lines only
    const centerRegion = { w: 240, h: 130, x: 200, y: 115 };   // frame center: the splash logo

    // Splash FIRST: the logo lives ONLY in the front 1.8s (center lit during
    // splash, dark once the black base plays).
    const centerSplash = await frameMeanRgb(branded, 0.4, centerRegion);
    const centerBase = await frameMeanRgb(branded, 2.8, centerRegion);
    assert.ok(centerSplash.luma > 3, `logo splash is lit at 0.4s (luma ${centerSplash.luma.toFixed(2)})`);
    assert.ok(
      centerBase.luma < centerSplash.luma * 0.5,
      `the splash is FIRST only: center dark at 2.8s (${centerBase.luma.toFixed(2)} << ${centerSplash.luma.toFixed(2)})`
    );

    // WATERMARK rides 0s->end: bottom-right lit during the splash AND near end.
    const wmSplash = await frameMeanRgb(branded, 0.4, brRegion);
    const wmEnd = await frameMeanRgb(branded, brandedS - 0.3, brRegion);
    assert.ok(wmSplash.luma > 1.5, `watermark rides the splash (luma ${wmSplash.luma.toFixed(2)} at 0.4s)`);
    assert.ok(wmEnd.luma > 1.5, `watermark rides to the end (luma ${wmEnd.luma.toFixed(2)} near end)`);

    // CREDIT cues 0.8s into the FIRST SCENE = 2.6s of the final (splash + 0.8):
    // OFF during the splash, ON inside the shifted window.
    const creditDuringSplash = await frameMeanRgb(branded, 0.9, creditRegion);
    const creditInWindow = await frameMeanRgb(branded, SPLASH_DURATION_S + 1.0, creditRegion);
    assert.ok(
      creditDuringSplash.luma < 1.0,
      `credit is OFF during the splash (luma ${creditDuringSplash.luma.toFixed(2)} at 0.9s)`
    );
    assert.ok(
      creditInWindow.luma > 1.5,
      `credit is ON 0.8s into the first scene (luma ${creditInWindow.luma.toFixed(2)} at ${(SPLASH_DURATION_S + 1.0).toFixed(1)}s)`
    );
    console.log(
      `[fix2] folded pass proven on pixels: splash first, watermark 0s->end, ` +
        `credit shifted onto the first scene — one re-encode`
    );

    // WATERMARK-ONLY fallback (no bound song): credit skipped, mark still burns.
    const wmOnly = join(dir, "wmonly.mp4");
    await overlayCreditsAndWatermark({
      input: splashed,
      output: wmOnly,
      width: W,
      height: H,
      fontPath,
      credit: null,
      creditOffsetS: SPLASH_DURATION_S,
    });
    const wmOnlyMark = await frameMeanRgb(wmOnly, SPLASH_DURATION_S + 1.0, brRegion);
    const wmOnlyCredit = await frameMeanRgb(wmOnly, SPLASH_DURATION_S + 1.0, creditRegion);
    assert.ok(wmOnlyMark.luma > 1.5, "credit=null still burns the watermark");
    assert.ok(wmOnlyCredit.luma < 1.0, "credit=null draws NO credit text");

    // FAIL-SOFT: the pass itself THROWS on bad input, so the caller's try/catch
    // (proven by source-scan above) ships the prior-stage cut untouched.
    await assert.rejects(
      overlayCreditsAndWatermark({
        input: join(dir, "does-not-exist.mp4"),
        output: join(dir, "nope.mp4"),
        width: W,
        height: H,
        fontPath,
        credit: null,
        creditOffsetS: 0,
      }),
      "a broken folded pass throws (caller degrades gracefully)"
    );

    assert.equal(WATERMARK_TEXT, "afro", 'the wordmark still reads "afro"');
    console.log("[fix2] watermark-only fallback + fail-soft throw proven");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("test-video-assembly-speed: PASS");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
