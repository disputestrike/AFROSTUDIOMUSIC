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
  /for \(const kind of \["full", "teaser"\] as const\) \{\s*const artifact = assemblies\[kind\];\s*if \(artifact\) artifact\.url = await presignAssetRef\(artifact\.url, 3600\);/,
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

console.log("video cards: presence law, presigned cuts, card player, and no-hidden-render chip all hold");
