/**
 * VIDEOS LIVE ON THE CARDS — proof (2026-07-16, owner: "Where are the videos?
 * You've already made the videos. Where are they?").
 *
 * Laws pinned: the catalog list carries per-song video presence (assembled
 * cut presigned for direct playback + scene coverage counted by the SAME
 * perShotRenders law the assembly gate uses); the assembly endpoint presigns
 * finished cuts (a private-storage ref must never reach a <video> tag); the
 * card plays the finished video in the artwork slot and the scenes-ready chip
 * OPENS the video panel — it never triggers a render.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const songs = readFileSync(join(process.cwd(), "src/routes/songs.ts"), "utf8");
const videos = readFileSync(join(process.cwd(), "src/routes/videos.ts"), "utf8");
const grid = readFileSync(
  join(process.cwd(), "../web/components/CatalogGrid.tsx"),
  "utf8"
);

// --- API list: presence block wired in the right order, one law for scenes.
const conceptsAt = songs.indexOf("prisma.videoConcept.findMany");
const scenesLawAt = songs.indexOf("perShotRenders(rendersFor).size", conceptsAt);
const presignAt = songs.indexOf(
  "videoBySong.set(songId, { ...v, url: await presignAssetRef(v.url",
  scenesLawAt
);
const fieldAt = songs.indexOf("video: videoBySong.get(s.id) ?? null", presignAt);
const scenesFieldAt = songs.indexOf(
  "videoScenesReady: videoScenesBySong.get(s.id) ?? 0",
  presignAt
);
assert.ok(
  conceptsAt >= 0 && scenesLawAt > conceptsAt && presignAt > scenesLawAt && fieldAt > presignAt && scenesFieldAt > presignAt,
  "songs list must resolve concepts → count scenes by the shared law → presign → expose both fields"
);
assert.match(
  songs,
  /const kind = assembly\.kind === 'teaser' \? \('teaser' as const\) : \('full' as const\);[\s\S]{0,120}if \(best\?\.kind === 'full' && kind === 'teaser'\) continue;/,
  "a full cut must always outrank a teaser on the card"
);

// --- Assembly endpoint: finished cuts leave presigned, both kinds.
assert.match(
  videos,
  /const storedRef = artifact\.url;\s*artifact\.url = await presignAssetRef\(storedRef, 3600\);/,
  "the assembly endpoint must presign finished cuts before they reach the client"
);

// --- Card: video plays in the artwork slot; the chip opens the panel, never renders.
assert.match(
  grid,
  /\{s\.video \? \([\s\S]{0,700}<video[\s\S]{0,400}src=\{s\.video\.url\}/,
  "the card must play the finished video in the artwork slot"
);
const chipAt = grid.indexOf("(s.videoScenesReady ?? 0) > 0 ? (");
assert.ok(chipAt >= 0, "scenes-ready chip exists");
const chip = grid.slice(chipAt, chipAt + 900);
assert.match(chip, /setVideoOpen\(s\)/, "the chip opens the Video panel");
assert.doesNotMatch(
  chip,
  /renderScene|\/videos\/renders|render-all/,
  "the chip must never trigger a render — surfacing paid work only"
);

// --- VIDEO NAMING LAW ("name the video — name and producer" — owner).
const assemble = readFileSync(
  join(process.cwd(), "../worker/src/processors/assemble-video.ts"),
  "utf8"
);
const assembleAt = assemble.indexOf("assembleMusicVideoTimeline({");
const overlayAt = assemble.indexOf("overlayVideoCredits({", assembleAt);
const inspectAt = assemble.indexOf("inspectVideoBytes(", overlayAt);
const uploadAt = assemble.indexOf("uploadBytes(", inspectAt);
assert.ok(
  assembleAt >= 0 && overlayAt > assembleAt && inspectAt > overlayAt && uploadAt > inspectAt,
  "credits burn AFTER assembly and BEFORE certification/upload"
);
assert.match(assemble, /credits overlay skipped/, "credits are best-effort — paid work never fails for a font");
assert.match(assemble, /\n\s+credits,\r?\n/, "assembly meta must carry the credit provenance");
const ffmpegLib = readFileSync(
  join(process.cwd(), "../worker/src/lib/ffmpeg.ts"),
  "utf8"
);
assert.match(ffmpegLib, /export async function overlayVideoCredits/, "overlay helper exists");
assert.match(ffmpegLib, /textfile='/, "credit text rides textfiles (quote/colon-proof)");
assert.match(ffmpegLib, /enable='between\(t,0\.8,5\.2\)'/, "opening-credit window pinned");
assert.match(
  videos,
  /downloadUrl = await presignAssetRef\(\s*storedRef,\s*3600,\s*`\$\{displayName\}\.mp4`\s*\)/,
  "downloads are disposition-named after the record"
);
assert.match(videos, /Official Video/, "the full cut is named like a release");
assert.match(
  grid,
  /href=\{artifact\.downloadUrl \?\? artifact\.url\}/,
  "the modal download uses the named URL"
);

console.log("video cards: presence law, presigned cuts, card player, no-hidden-render chip, and naming law all hold");

// PACKAGE B wiring — SAME FACES ALL VIDEO (2026-07-17).
{
  const videosB = readFileSync(join(process.cwd(), "src/routes/videos.ts"), "utf8");
  const workerB = readFileSync(
    join(process.cwd(), "../worker/src/processors/video.ts"),
    "utf8"
  );
  assert.equal(
    (videosB.match(/decorateTreatmentShotsForRender\(/g) ?? []).length,
    2, // both render payload sites (the import carries no paren)
    "both render payloads carry continuity + fronting-lead decoration"
  );
  // The full-song treatment (and the concept it writes) moved to the worker so
  // its multi-minute LLM chain can't 502 at the edge — the roster + criticReport
  // ride the concept THERE now.
  const treatmentB = readFileSync(
    join(process.cwd(), "../worker/src/processors/video-treatment.ts"),
    "utf8"
  );
  assert.match(treatmentB, /meta: \{ performers[,}]/, "the roster rides the concept for the sheet generator (Package C also folds in criticReport)");
  const sheetsAt = workerB.indexOf("async function ensureCharacterSheets");
  const claimAt = workerB.indexOf("characterSheetsClaim", sheetsAt);
  const generateAt = workerB.indexOf("adapter.generate(", sheetsAt);
  assert.ok(
    sheetsAt >= 0 && claimAt > sheetsAt && claimAt < generateAt,
    "exactly one job claims BEFORE generating (parallel scenes cannot mint duplicate sheets)"
  );
  assert.match(
    workerB,
    /!p\.recoverOnly && !p\.likeness && adapter\.capabilities\?\.imageToVideo === true/,
    "sheets never run on recovery (no new spend) or the likeness path"
  );
  assert.match(
    workerB,
    /if \(!input\.keyframeUrl && shot\.lead && characterSheets\.has\(shot\.lead\)\)/,
    "keyframe order: likeness wins, then the lead's sheet, else honest t2v"
  );
  assert.match(workerB, /character sheets skipped:/, "sheet failure never fails a paid render");
  console.log("package B wiring: decoration, roster hand-off, claim law, and keyframe order hold");
}
