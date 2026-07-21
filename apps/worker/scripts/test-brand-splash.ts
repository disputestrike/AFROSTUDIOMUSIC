/**
 * BRAND WAVE PROOFS (2026-07-20) — the owner's four orders have receipts:
 *   1. BXP, not BENXP — seed + writer defaults carry the corrected stage name
 *      and the data migration renames existing rows idempotently.
 *   2. AfroHits, not AfroHit — the burned video credit and the download-name
 *      fallbacks say the corrected brand.
 *   3. LOGO SPLASH — buildLogoSplashArgs constructs the exact prepend command
 *      (dark frame, centered logo, fade in/out, silent A/V-sync audio, the
 *      pipeline's own encode settings), and when ffmpeg is present the splash
 *      is probe-verified on a tiny synthetic mp4.
 *   4. "afro" WATERMARK (VEVO reference) — persistent bottom-right drawtext
 *      with NO enable window + the first-3s bottom-left thumbnail mark, both
 *      riding the credit's font/textfile mechanism.
 *
 * Offline by design: the ffmpeg render legs run only when the binary answers,
 * and the watermark encode leg additionally needs the cached display font —
 * each skip is announced honestly; the command-construction laws always run.
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildBrandWatermarkFilters,
  buildLogoSplashArgs,
  ensureDisplayFont,
  ffmpegAvailable,
  prependLogoSplash,
  overlayBrandWatermark,
  probeMediaDurationPreciseS,
  resolveBrandLogoPath,
  runFfmpeg,
  ASSEMBLY_FPS,
  SPLASH_DURATION_S,
  SPLASH_FADE_IN_S,
  SPLASH_FADE_OUT_S,
  WATERMARK_HEIGHT_RATIO,
  WATERMARK_MARGIN_RATIO,
  WATERMARK_OPACITY,
  WATERMARK_TEXT,
  WATERMARK_THUMB_HEIGHT_RATIO,
  WATERMARK_THUMB_WINDOW_S,
} from "../src/lib/ffmpeg";

async function main() {
  // ---- 1) BXP, not BENXP -------------------------------------------------
  {
    const seed = await readFile("../../packages/db/src/seed.ts", "utf8");
    assert.ok(!seed.includes("BENXP"), "seed.ts must not carry BENXP");
    assert.ok(seed.includes("'BXP'"), "seed.ts seeds the BXP stage name");

    const writerAb = await readFile("../api/src/lib/writer-ab.ts", "utf8");
    assert.ok(!writerAb.includes("BENXP"), "writer-ab.ts must not carry BENXP");
    assert.ok(writerAb.includes("'BXP'"), "writer-ab.ts defaults to BXP");

    const migration = await readFile(
      "../../packages/db/prisma/migrations/20260720170000_rename_benxp_to_bxp/migration.sql",
      "utf8"
    );
    assert.ok(
      migration.includes(
        `UPDATE "Artist" SET "stageName" = 'BXP' WHERE "stageName" = 'BENXP';`
      ),
      "migration renames Artist.stageName"
    );
    assert.ok(
      migration.includes(
        `UPDATE "Song" SET "displayArtist" = 'BXP' WHERE "displayArtist" = 'BENXP';`
      ),
      "migration renames Song.displayArtist"
    );
    // PURE DML LAW: a data-only migration may never smuggle in schema drift.
    assert.ok(
      !/\b(ALTER|CREATE|DROP)\b/i.test(migration),
      "migration is pure DML (no ALTER/CREATE/DROP)"
    );
    console.log("[brand] BXP rename: seed + writer + idempotent migration OK");
  }

  // ---- 2) The burned credit says AfroHits --------------------------------
  {
    const processor = await readFile(
      "src/processors/assemble-video.ts",
      "utf8"
    );
    assert.ok(
      processor.includes(`|| "AfroHits Artist"`),
      "credit artist fallback says AfroHits Artist"
    );
    assert.ok(
      processor.includes(`producer: "AfroHits Studio"`),
      "credit producer says AfroHits Studio"
    );
    assert.ok(
      !/"AfroHit (Artist|Studio|Video)"/.test(processor),
      "no stale AfroHit credit strings in the assembler"
    );

    const videosRoute = await readFile("../api/src/routes/videos.ts", "utf8");
    assert.ok(
      videosRoute.includes(`|| "AfroHits Artist"`) &&
        videosRoute.includes(`"AfroHits Video"`),
      "download-name fallbacks say AfroHits"
    );
    assert.ok(
      !/"AfroHit (Artist|Studio|Video)"/.test(videosRoute),
      "no stale AfroHit display strings in the videos route"
    );
    console.log("[brand] credit + download-name strings say AfroHits");
  }

  // ---- 3) Splash command construction (pure, always runs) ----------------
  const logoPath = resolveBrandLogoPath();
  assert.ok(logoPath, "the official logo asset resolves (apps/worker/assets)");
  {
    const args = buildLogoSplashArgs({
      input: "in.mp4",
      output: "out.mp4",
      logoPath: logoPath!,
      width: 1920,
      height: 1080,
    });
    const joined = args.join(" ");
    assert.ok(
      joined.includes(
        `color=c=black:s=1920x1080:r=${ASSEMBLY_FPS}:d=${SPLASH_DURATION_S.toFixed(2)}`
      ),
      "dark splash frame matches the cut's geometry/fps/duration"
    );
    assert.ok(args.includes(logoPath!), "logo rides as a real input");
    assert.ok(
      joined.includes("anullsrc=r=44100:cl=stereo"),
      "silent audio keeps A/V concat in sync"
    );
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    // Logo centered at ~35% frame height: 1080 * 0.35 → 378 (already even).
    assert.ok(filter.includes("scale=-2:378"), "logo scaled to 35% of height");
    assert.ok(filter.includes("overlay=(W-w)/2:(H-h)/2"), "logo centered");
    assert.ok(
      filter.includes(`fade=t=in:st=0:d=${SPLASH_FADE_IN_S.toFixed(2)}`),
      "0.25s fade-in"
    );
    assert.ok(
      filter.includes(
        `fade=t=out:st=${(SPLASH_DURATION_S - SPLASH_FADE_OUT_S).toFixed(2)}:d=${SPLASH_FADE_OUT_S.toFixed(2)}`
      ),
      "0.35s fade-out ending at the splash boundary"
    );
    assert.ok(
      filter.includes("concat=n=2:v=1:a=1"),
      "splash + cut concat with audio"
    );
    // The pipeline's own encode settings — never a divergent codec profile.
    for (const expected of ["libx264", "veryfast", "19", "yuv420p", "aac", "192k"]) {
      assert.ok(args.includes(expected), `encode setting present: ${expected}`);
    }
    console.log("[splash] command construction obeys the splash law");
  }

  // ---- 4) Watermark filter construction (pure, always runs) --------------
  {
    const filters = buildBrandWatermarkFilters({
      fontPath: "C:/fonts/anton.ttf",
      textPath: "C:/tmp/wordmark.txt",
      width: 1920,
      height: 1080,
    });
    assert.equal(filters.length, 2, "two drawtext passes: persistent + thumb");
    const margin = Math.round(1920 * WATERMARK_MARGIN_RATIO); // 48
    const smallSize = Math.round(1080 * WATERMARK_HEIGHT_RATIO); // 49
    const thumbSize = Math.round(1080 * WATERMARK_THUMB_HEIGHT_RATIO); // 92
    const [persistent, thumb] = filters as [string, string];
    // Persistent mark: bottom-RIGHT, translucent white, NO enable window —
    // it rides every frame from 0s to the end, splash and credit included.
    assert.ok(persistent.includes(`fontcolor=white@${WATERMARK_OPACITY}`));
    assert.ok(persistent.includes(`fontsize=${smallSize}`));
    assert.ok(persistent.includes(`x=W-text_w-${margin}`), "right-edge margin");
    assert.ok(persistent.includes(`y=H-text_h-${margin}`), "bottom-edge margin");
    assert.ok(!persistent.includes("enable="), "persists the full runtime");
    // Thumbnail mark: bottom-LEFT, opaque, bigger, first 3 seconds only.
    assert.ok(thumb.includes("fontcolor=white:"), "thumb mark is opaque white");
    assert.ok(thumb.includes(`fontsize=${thumbSize}`));
    assert.ok(thumb.includes(`x=${margin}:`), "left-edge margin");
    assert.ok(
      thumb.includes(`enable='between(t,0,${WATERMARK_THUMB_WINDOW_S})'`),
      "thumb mark rides the first 3 seconds"
    );
    // Escaping law inherited from the credit: fontfile/textfile, colons escaped.
    assert.ok(persistent.includes("fontfile='C\\:/fonts/anton.ttf'"));
    assert.ok(persistent.includes("textfile='C\\:/tmp/wordmark.txt'"));
    assert.equal(WATERMARK_TEXT, "afro", 'the wordmark reads exactly "afro"');
    console.log("[watermark] filter construction obeys the VEVO watermark law");
  }

  // ---- 5) Probe-verified render on a tiny synthetic mp4 (needs ffmpeg) ---
  if (!(await ffmpegAvailable())) {
    console.log(
      "[splash] SKIP render leg honestly: ffmpeg not on this host " +
        "(runs in the worker image; command construction proven above)"
    );
    console.log("test-brand-splash: PASS (construction-only)");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "brand-splash-"));
  try {
    // A 2s synthetic cut with a real (silent) audio track — the same shape a
    // muxed assembly has, at a size small enough to encode in moments.
    const baseCut = join(dir, "cut.mp4");
    await runFfmpeg([
      "-f", "lavfi", "-i", `color=c=gray:s=320x240:r=${ASSEMBLY_FPS}:d=2`,
      "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=44100:cl=stereo",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      baseCut,
    ]);
    const baseDurationS = await probeMediaDurationPreciseS(baseCut);
    assert.ok(baseDurationS > 1.5, "synthetic cut rendered");

    const splashed = join(dir, "splashed.mp4");
    await prependLogoSplash({
      input: baseCut,
      output: splashed,
      logoPath: logoPath!,
      width: 320,
      height: 240,
    });
    const splashedDurationS = await probeMediaDurationPreciseS(splashed);
    assert.ok(
      Math.abs(splashedDurationS - (baseDurationS + SPLASH_DURATION_S)) < 0.25,
      `splash prepends ~${SPLASH_DURATION_S}s (got ${splashedDurationS.toFixed(3)}s over ${baseDurationS.toFixed(3)}s)`
    );
    console.log(
      `[splash] probe-verified: ${baseDurationS.toFixed(2)}s cut -> ` +
        `${splashedDurationS.toFixed(2)}s with the logo splash`
    );

    // Watermark render leg needs the display font; the fetch is fail-soft so
    // an offline host skips this leg honestly rather than failing the suite.
    const fontPath = await ensureDisplayFont();
    if (fontPath) {
      const watermarked = join(dir, "watermarked.mp4");
      await overlayBrandWatermark({
        input: splashed,
        output: watermarked,
        fontPath,
        width: 320,
        height: 240,
      });
      const stats = await stat(watermarked);
      assert.ok(stats.size > 1000, "watermarked file rendered");
      const watermarkedDurationS = await probeMediaDurationPreciseS(watermarked);
      assert.ok(
        Math.abs(watermarkedDurationS - splashedDurationS) < 0.2,
        "watermark pass never changes the runtime"
      );
      console.log("[watermark] probe-verified on the synthetic cut");
    } else {
      console.log(
        "[watermark] SKIP render leg honestly: display font unavailable " +
          "offline (filter construction proven above)"
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("test-brand-splash: PASS");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
