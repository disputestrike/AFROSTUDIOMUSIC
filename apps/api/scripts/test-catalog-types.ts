/**
 * CATALOG TYPES + EVERY-CREATION-HAS-A-HOME — proof (2026-07-17).
 *
 * Owner's pains: "I made a film sound… would that be my catalog? I can't
 * see anything" (doors 2/3 minted NO Song row — finished audio was invisible
 * and undownloadable) and "everything is in my catalog" (no type split).
 * Laws pinned here: the generate route mints a TYPED Song before queueing
 * and both job payloads carry it; the doors stamp their kind; the list
 * serves `kind`; the grid filters by it and Recreate lives on audio-less
 * cards; the chat gains feature_on_landing + get_download_links with the
 * same guards as the routes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const beats = readFileSync(join(process.cwd(), "src/routes/beats.ts"), "utf8");
const songs = readFileSync(join(process.cwd(), "src/routes/songs.ts"), "utf8");
const schemas = readFileSync(
  join(process.cwd(), "../../packages/shared/src/schemas.ts"),
  "utf8"
);
const create = readFileSync(
  join(process.cwd(), "../web/app/(app)/create/page.tsx"),
  "utf8"
);
const grid = readFileSync(
  join(process.cwd(), "../web/components/CatalogGrid.tsx"),
  "utf8"
);
const chatTools = readFileSync(
  join(process.cwd(), "src/services/chat-tools.ts"),
  "utf8"
);
const chatSchemas = readFileSync(
  join(process.cwd(), "../../packages/ai/src/prompts/studio-chat.ts"),
  "utf8"
);

// --- Every creation has a catalog home.
const mintAt = beats.indexOf("const effectiveSongId");
const ownPayloadAt = beats.indexOf("songId: effectiveSongId");
assert.ok(mintAt >= 0, "generate must mint a Song when none was given");
assert.ok(
  ownPayloadAt > mintAt,
  "job payloads must carry the minted song id"
);
assert.equal(
  (beats.match(/songId: effectiveSongId/g) ?? []).length,
  2,
  "BOTH render paths (own + provider) bind the minted song"
);
assert.match(
  beats,
  /kind:\s*\r?\n?\s*input\.creationKind \?\?\s*\r?\n?\s*\(input\.withVocals \? 'song' : 'instrumental'\)/,
  "the minted Song is TYPED"
);
assert.match(schemas, /creationKind: z\.enum\(\['instrumental', 'film_sound'\]\)\.optional\(\)/);
assert.match(create, /creationKind: 'instrumental'/, "door 2 stamps its kind");
assert.match(create, /creationKind: 'film_sound'/, "door 3 stamps its kind");
assert.match(songs, /kind: \(s as \{ kind\?: string \}\)\.kind \?\? 'song'/, "the list serves the type");

// --- Catalog splits by type; Recreate lives where audio is missing.
assert.match(grid, /"song" \| "instrumental" \| "film_sound" \| "with_video"/, "type filter state exists");
assert.match(grid, /songs\.filter\(s => \(s\.kind \?\? "song"\) === typeFilter\)/, "kind chips filter by the served type");
assert.match(grid, /s\.video \|\| \(s\.videoScenesReady \?\? 0\) > 0/, "the with-videos chip uses real video presence");
assert.match(grid, /\{visibleSongs\.map\(s => \(/, "the grid renders the filtered set");
assert.match(grid, /visibleSongs\.filter\(x => x\.audioUrl\)/, "Play all respects the active filter");
const recreateAt = grid.indexOf("async function recreate(");
assert.ok(recreateAt >= 0, "recreate exists");
assert.match(grid, /regenerate-beat`, \{\}\);\s*\r?\n\s*flash\("Recreating from your saved words/, "recreate re-runs from saved words — no retyping");
assert.match(grid, /no_lyrics/, "recreate says honestly when there are no saved words");

// --- Chat parity: same guards as the routes, registered end to end.
assert.match(chatSchemas, /name: 'feature_on_landing'/);
assert.match(chatSchemas, /name: 'get_download_links'/);
assert.match(chatTools, /case "feature_on_landing":/);
assert.match(chatTools, /case "get_download_links":/);
const toolAt = chatTools.indexOf("async function featureOnLandingTool");
const gateAt = chatTools.indexOf("isFirstPartyBilling(ctx.workspaceId)", toolAt);
const quarantineAt = chatTools.indexOf('"not_featureable"', toolAt);
const playableAt = chatTools.indexOf('"no_playable_audio"', toolAt);
const writeAt = chatTools.indexOf("writeFeaturedSongIds([song.id", toolAt);
assert.ok(
  toolAt >= 0 && gateAt > toolAt && quarantineAt > gateAt && playableAt > quarantineAt && writeAt > playableAt,
  "chat feature tool keeps the route's guard order: house gate → public-safety → can-play → write"
);

console.log("catalog types: every creation has a home, typed chips filter, recreate law, and chat parity all hold");
