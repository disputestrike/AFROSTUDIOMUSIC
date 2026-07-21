/**
 * AUTO-CLIP PROOFS (Phase 2, 2026-07-21) — the master music video is auto-cut
 * into ~10 hook-first vertical shorts by ffmpeg EDIT (crop/trim/drawtext), NEVER
 * a re-render. This proves the recipe, the hook-first placement (and its HONEST
 * heuristic fallback), the single-pass-per-clip construction, the burned caption
 * + watermark on real pixels, the fail-soft batch, and the auto-trigger wiring.
 *
 * Offline by design (mirrors test-video-assembly-speed.ts): the CONSTRUCTION +
 * PLANNER + SOURCE-SCAN laws always run; the ffmpeg render legs run only when the
 * binary answers, and the drawtext leg additionally needs the cached Anton font —
 * each skip is announced honestly, never a fake pass.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildClipArgs,
  buildClipCropScale,
  cutClips,
  ensureDisplayFont,
  ffmpegAvailable,
  probeMediaDurationPreciseS,
  renderClip,
  runFfmpeg,
  CLIP_HEIGHT,
  CLIP_WIDTH,
  type CutClipRequest,
} from "../src/lib/ffmpeg";
import {
  clipKindFor,
  DEFAULT_CLIP_COUNTS,
  extractSongSections,
  parseClipCounts,
  planClips,
  wrapCaption,
} from "../src/lib/clip-plan";

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

/** ffprobe the first video stream's exact width x height. */
async function probeWH(path: string): Promise<{ w: number; h: number }> {
  const { code, stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0", path,
  ]);
  assert.equal(code, 0, "ffprobe stream dims must succeed");
  const [w, h] = stdout.toString("utf8").trim().split(",").map(n => Number(n));
  return { w: w ?? 0, h: h ?? 0 };
}

/** A colored clip (optionally with a silent audio track). */
async function makeColorClip(
  path: string,
  color: string,
  seconds: number,
  w: number,
  h: number,
  fps: number,
  withAudio = false
) {
  await runFfmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}:r=${fps}:d=${seconds}`,
    ...(withAudio
      ? ["-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=44100:cl=stereo"]
      : []),
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    ...(withAudio ? ["-c:a", "aac", "-b:a", "128k", "-shortest"] : []),
    path,
  ]);
}

/** Concat colored segments into ONE master (red 0-2s, green 2-4s, blue 4-6s). */
async function makeSegmentedMaster(
  dir: string,
  w: number,
  h: number
): Promise<string> {
  const parts: string[] = [];
  const colors = ["red", "green", "blue"];
  for (let i = 0; i < colors.length; i++) {
    const p = join(dir, `seg-${i}.mp4`);
    await makeColorClip(p, colors[i]!, 2, w, h, 30, true);
    parts.push(p);
  }
  const listPath = join(dir, "list.txt");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(listPath, parts.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  const master = join(dir, "master.mp4");
  await runFfmpeg([
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    master,
  ]);
  return master;
}

async function main() {
  // =====================================================================
  // A) CONSTRUCTION + PLANNER LAWS (pure — always run, no ffmpeg needed)
  // =====================================================================

  // --- CLIP_COUNTS parsing: ship default + custom + malformed fallback ----
  {
    const total = DEFAULT_CLIP_COUNTS.reduce((n, c) => n + c.count, 0);
    assert.equal(total, 10, "ship default is ~10 clips");
    assert.deepEqual(
      DEFAULT_CLIP_COUNTS,
      [
        { durationS: 15, count: 4 },
        { durationS: 30, count: 3 },
        { durationS: 60, count: 3 },
      ],
      "ship default is 4×15 + 3×30 + 3×60"
    );
    assert.deepEqual(parseClipCounts(undefined), DEFAULT_CLIP_COUNTS, "no env → default");
    assert.deepEqual(parseClipCounts(""), DEFAULT_CLIP_COUNTS, "empty env → default");
    assert.deepEqual(
      parseClipCounts("20x2,45:3"),
      [{ durationS: 20, count: 2 }, { durationS: 45, count: 3 }],
      "custom CLIP_COUNTS parses both x and : separators"
    );
    assert.deepEqual(parseClipCounts("garbage,,x,"), DEFAULT_CLIP_COUNTS, "all-malformed → default");
    assert.equal(clipKindFor(15), "short");
    assert.equal(clipKindFor(30), "reel");
    assert.equal(clipKindFor(60), "tiktok");
    console.log("[plan] CLIP_COUNTS default 4×15/3×30/3×60=10, custom + fallback parse");
  }

  // --- HOOK-FIRST with a real section map: clips START on the hook ---------
  {
    const total = 180;
    const sections = [
      { name: "intro", startS: 0 },
      { name: "verse", startS: 12 },
      { name: "hook", startS: 30 },
      { name: "bridge", startS: 60 },
      { name: "chorus", startS: 90 },
    ];
    const plan = planClips({ totalDurationS: total, sections, leadInS: 1.8 });
    assert.equal(plan.length, 10, "10 clips from the default counts");
    const buckets = plan.reduce<Record<number, number>>((m, c) => {
      m[c.durationS] = (m[c.durationS] ?? 0) + 1;
      return m;
    }, {});
    assert.deepEqual(buckets, { 15: 4, 30: 3, 60: 3 }, "bucket counts preserved (4/3/3)");
    // HOOK-FIRST: the first (longest, highest-priority) clips take the hook
    // starts; the REST spread across distinct sections (2 hook sections here, so
    // exactly 2 clips open on a hook, the others on intro/verse/bridge).
    assert.ok(
      /hook|chorus/i.test(plan[0]!.sectionLabel) && /hook|chorus/i.test(plan[1]!.sectionLabel),
      `the first two clips open on the two hook/chorus sections (got ${plan[0]!.sectionLabel}, ${plan[1]!.sectionLabel})`
    );
    assert.equal(
      plan.filter(c => /hook|chorus/i.test(c.sectionLabel)).length,
      2,
      "exactly the two hook sections are used as hook starts; the rest spread across other sections"
    );
    assert.ok(
      plan.some(c => /intro|verse|bridge/i.test(c.sectionLabel)),
      "the remaining clips spread onto distinct non-hook sections (not hook duplicates)"
    );
    // Every clip fits inside the master and never opens on the splash lead-in.
    for (const c of plan) {
      assert.ok(c.startS >= 1.8 - 1e-6, `clip start ${c.startS} respects the splash lead-in`);
      assert.ok(c.startS + c.durationS <= total + 1e-6, `clip fits inside the master`);
    }
    // Distinct starts across sections — not 10 copies of the same moment.
    assert.ok(new Set(plan.map(c => c.startS)).size >= 4, "clips spread across distinct starts");
    console.log("[plan] section-map path: 60s clips start on hook/chorus, buckets 4/3/3, all in-bounds");
  }

  // --- HONEST FALLBACK: no section map → heuristic, flagged as such --------
  {
    const total = 200;
    const plan = planClips({ totalDurationS: total, sections: null, leadInS: 1.8 });
    assert.equal(plan.length, 10, "still 10 clips with no map");
    assert.ok(
      plan.every(c => c.sectionLabel.startsWith("heuristic:")),
      "with no section map EVERY start is tagged heuristic:* (never faked as a detected hook)"
    );
    // The first (longest) clip is the first-third hook guess.
    assert.equal(
      plan[0]!.sectionLabel,
      "heuristic:first-third",
      "the first clip is the first-third hook heuristic"
    );
    const firstThird = 1.8 + (total - 1.8) / 3;
    assert.ok(
      Math.abs(plan[0]!.startS - firstThird) < 1,
      `the first-third start (~${firstThird.toFixed(1)}s) lands near the first third`
    );
    for (const c of plan) {
      assert.ok(c.startS >= 1.8 - 1e-6 && c.startS + c.durationS <= total + 1e-6, "in bounds");
    }
    console.log("[plan] no-map path: heuristic first-third + even spread, every start honestly flagged");
  }

  // --- extractSongSections: explicit times parse; unknown shapes → null ----
  {
    const explicit = extractSongSections(
      { sections: [{ name: "intro", startS: 0 }, { name: "hook", startS: 24 }] },
      null
    );
    assert.ok(explicit && explicit.length === 2 && explicit[1]!.name === "hook", "explicit-time map parses");
    assert.equal(extractSongSections(null, null), null, "null storyboard → null (unknown is honorable)");
    assert.equal(extractSongSections({ shots: [] }, null), null, "a shot-list is not a section map → null");
    assert.equal(
      extractSongSections({ sections: [{ name: "hook" }] }, null),
      null,
      "names without any timing (and no bpm) → null, never guessed"
    );
    console.log("[plan] extractSongSections trusts explicit timings only, else honest null");
  }

  // --- wrapCaption wraps to lines for a clean burn ------------------------
  {
    const wrapped = wrapCaption("the first ten seconds and the whole room goes quiet", 20, 3);
    const lines = wrapped.split("\n");
    assert.ok(lines.length >= 2 && lines.length <= 3, "caption wraps to 2-3 lines");
    assert.ok(lines.every(l => l.length <= 22), "each line respects the width");
    assert.equal(wrapCaption("", 20, 3), "", "empty caption stays empty");
    console.log("[plan] wrapCaption hard-wraps the hook line for a legible burn");
  }

  // --- CROP recipe + single-pass argv construction ------------------------
  {
    const crop = buildClipCropScale();
    assert.ok(/crop=ih\*9\/16:ih/.test(crop), "9:16 center-crop from the master (spec recipe crop=ih*9/16:ih)");
    assert.ok(/scale=1080:1920/.test(crop), "scaled to 1080x1920");
    assert.ok(!crop.includes("min("), "crop stays comma-free so the filtergraph never mis-parses");

    const args = buildClipArgs({
      input: "/tmp/master.mp4",
      output: "/tmp/clip.mp4",
      fontPath: "C:/fonts/anton.ttf",
      captionTextPath: "C:/tmp/cap.txt",
      watermarkTextPath: "C:/tmp/afro.txt",
      spec: { startS: 30, durationS: 15 },
    });
    // Single-pass per clip: exactly ONE input, one re-encode, an EDIT not a render.
    assert.equal(args.filter(a => a === "-i").length, 1, "ONE input = single pass per clip");
    const ssIdx = args.indexOf("-ss");
    const iIdx = args.indexOf("-i");
    assert.ok(ssIdx >= 0 && ssIdx < iIdx, "-ss BEFORE -i (accurate fast seek when transcoding)");
    assert.equal(args[ssIdx + 1], "30.000", "seeks to the clip's start offset");
    assert.ok(args.includes("libx264") && args.includes("-crf") && args.includes("19"), "uses the ASSEMBLY_ENCODE preset");
    const vf = args[args.indexOf("-vf") + 1]!;
    assert.ok(/scale=1080:1920/.test(vf) && /crop=/.test(vf), "vf crops + scales to vertical");
    assert.ok(/boxcolor=black@0\.5/.test(vf), "caption drawtext (boxed) present in the ONE filtergraph");
    assert.ok(/x=W-text_w-/.test(vf), "the persistent bottom-right 'afro' watermark is in the SAME pass");
    assert.equal((vf.match(/drawtext=/g) ?? []).length, 3, "1 caption + 2 watermark drawtexts, one pass");
    assert.ok(args.includes("+faststart"), "faststart for instant social playback");
    console.log("[clip] buildClipArgs: single -i, accurate seek, crop→1080x1920, caption+watermark in ONE filtergraph");
  }

  // =====================================================================
  // B) SOURCE-SCAN LAWS — the auto-trigger + mirror + registration (pure)
  // =====================================================================
  {
    const asm = await readFile("src/processors/assemble-video.ts", "utf8");
    assert.ok(/enqueueGenerateClips\(/.test(asm), "the assembler fires the clip cut on video completion");
    assert.ok(/sourceVideoId:\s*row\.id/.test(asm), "the cut is tied to the assembled master row");
    assert.ok(
      /p\.kind === "full"[\s\S]{0,600}enqueueGenerateClips\(/.test(asm),
      "the clip cut fires only for the 'full' master (not the teaser)"
    );

    const clipsLib = await readFile("src/lib/clips.ts", "utf8");
    assert.ok(/await import\('\.\/enqueue'\)/.test(clipsLib), "clips.ts lazy-imports ./enqueue (no eager Redis handle), mirroring release-kit");
    assert.ok(/jobId:\s*`\$\{CLIPS_JOB\}-\$\{payload\.sourceVideoId\}/.test(clipsLib), "dedupes concurrent completions by the master id");
    assert.ok(/catch\s*\(err\)[\s\S]{0,160}render unaffected/.test(clipsLib), "enqueue is FAIL-SOFT — a clip problem never fails the render");
    assert.ok(/clipsStatus:\s*'cutting'/.test(clipsLib), "flips the song to 'cutting' so the tab can say so");

    const idx = await readFile("src/index.ts", "utf8");
    assert.ok(/makeWorker\("clips"/.test(idx), "index registers the dedicated 'clips' lane");
    assert.ok(/processGenerateClips\(/.test(idx), "the clips lane dispatches to processGenerateClips");

    const proc = await readFile("src/processors/generate-clips.ts", "utf8");
    assert.ok(/songClip\.count\(/.test(proc) && /!p\.force/.test(proc), "processor is idempotent (skips a master that already has clips unless forced)");
    assert.ok(/cutClips\(/.test(proc), "processor cuts via the fail-soft batch helper");
    assert.ok(/deleteMany\(\{\s*where:\s*\{\s*songId:\s*p\.songId,\s*sourceVideoId/.test(proc), "a forced recut replaces the old set for that master");
    assert.ok(/costUsd:\s*0/.test(proc), "clips are charged $0 (ffmpeg edits off an already-billed master)");
    assert.ok(/regenerated:\s*false/.test(proc), "meta states honestly this is an edit, not a regeneration");
    console.log("[wire] assembler→enqueueGenerateClips (full only), clips.ts mirrors release-kit, clips lane registered, processor idempotent + $0");
  }

  // =====================================================================
  // C) FFMPEG RENDER LEGS (need the binary; drawtext also needs the font)
  // =====================================================================
  if (!(await ffmpegAvailable())) {
    console.log(
      "[clip] SKIP render legs honestly: ffmpeg not on this host " +
        "(runs in the worker image; construction + planner + wiring proven above)"
    );
    console.log("test-clips: PASS (construction-only)");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "clips-"));
  try {
    // ---- C1) Cut real clips: 1080x1920, correct START, fail-soft batch ----
    const master = await makeSegmentedMaster(dir, 1280, 720); // red|green|blue, 2s each
    const masterS = await probeMediaDurationPreciseS(master);
    assert.ok(Math.abs(masterS - 6) < 0.4, `segmented master is ~6s (got ${masterS.toFixed(2)})`);

    const caption = wrapCaption("the whole room goes quiet", 18, 2);
    // A GREEN clip (index 0), a POISON malformed clip (index 1, ODD width 3 →
    // libx264/yuv420p rejects "not divisible by 2" → ffmpeg errors), a BLUE clip
    // (index 2). Fail-soft must return 0 and 2, drop 1.
    const requests: CutClipRequest[] = [
      { spec: { startS: 2.5, durationS: 1.5 }, caption }, // green segment
      { spec: { startS: 0.5, durationS: 1.5, width: 3 }, caption }, // malformed → fails
      { spec: { startS: 4.5, durationS: 1.5 }, caption }, // blue segment
    ];
    const { ok, failed } = await cutClips({ input: master, workDir: dir, fontPath: (await ensureDisplayFont()) ?? "", clips: requests });
    assert.equal(failed.length, 1, "the malformed clip failed");
    assert.equal(failed[0]!.index, 1, "the failure is the malformed clip (index 1)");
    assert.equal(ok.length, 2, "FAIL-SOFT: the batch still returns the other two clips");
    assert.deepEqual(ok.map(o => o.index), [0, 2], "the survivors keep their indices (green, blue)");

    for (const clip of ok) {
      const wh = await probeWH(clip.path);
      assert.deepEqual(wh, { w: CLIP_WIDTH, h: CLIP_HEIGHT }, `clip #${clip.index} is 1080x1920 (got ${wh.w}x${wh.h})`);
      // Top-center of the frame is pure source color (caption is bottom-third,
      // watermark is in the corners) — proves the clip STARTS on its offset.
      const top = await frameMeanRgb(clip.path, 0.6, { w: 400, h: 400, x: 340, y: 220 });
      if (clip.index === 0) {
        assert.ok(top.g > 110 && top.r < 100 && top.b < 100, `clip@2.5s starts on GREEN (R${top.r.toFixed(0)} G${top.g.toFixed(0)} B${top.b.toFixed(0)})`);
      } else {
        assert.ok(top.b > 140 && top.r < 100 && top.g < 100, `clip@4.5s starts on BLUE (R${top.r.toFixed(0)} G${top.g.toFixed(0)} B${top.b.toFixed(0)})`);
      }
    }
    console.log("[clip] cut 2/3 real clips (fail-soft dropped the malformed one): each 1080x1920, each starts on its offset color");

    // ---- C2) Caption + watermark burn, proven on BLACK pixels ------------
    const fontPath = await ensureDisplayFont();
    if (!fontPath) {
      console.log("[clip] SKIP caption/watermark pixel leg honestly: Anton font unavailable offline (construction proven above)");
      console.log("test-clips: PASS (cuts + dims + start proven, drawtext construction-only)");
      return;
    }
    const black = join(dir, "black.mp4");
    await makeColorClip(black, "black", 3, 640, 360, 30, true);
    const capClip = join(dir, "cap.mp4");
    await renderClip({ input: black, output: capClip, fontPath, caption: wrapCaption("Hook Line Here", 16, 2), spec: { startS: 0, durationS: 2 } });
    const wh = await probeWH(capClip);
    assert.deepEqual(wh, { w: CLIP_WIDTH, h: CLIP_HEIGHT }, "black clip is also 1080x1920");
    // Caption band (bottom third, centered) lit over pure black.
    const capBand = await frameMeanRgb(capClip, 1.0, { w: 700, h: 160, x: 190, y: 1210 });
    assert.ok(capBand.luma > 1.2, `the caption is burned in the bottom third (luma ${capBand.luma.toFixed(2)})`);
    // Persistent bottom-right "afro" watermark lit over pure black.
    const wmBand = await frameMeanRgb(capClip, 1.0, { w: 240, h: 110, x: 820, y: 1790 });
    assert.ok(wmBand.luma > 1.0, `the "afro" watermark is burned bottom-right (luma ${wmBand.luma.toFixed(2)})`);
    // The center stays black — the crop/scale didn't fill the frame with text.
    const center = await frameMeanRgb(capClip, 1.0, { w: 300, h: 300, x: 390, y: 700 });
    assert.ok(center.luma < 1.0, `the frame center stays clean (luma ${center.luma.toFixed(2)})`);
    const size = (await stat(capClip)).size;
    assert.ok(size > 1000, "the clip is a real non-empty mp4");
    console.log("[clip] caption + 'afro' watermark burned on real pixels (bottom-third caption, bottom-right mark), center clean");

    console.log("test-clips: PASS");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
