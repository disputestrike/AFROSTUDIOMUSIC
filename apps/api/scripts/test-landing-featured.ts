/**
 * LANDING FEATURED WALL — proof (2026-07-16, owner ask: "let them play it
 * right there").
 *
 * Laws under test: featured records lead the wall in CURATED order; a song
 * pinned then deleted/quarantined falls out silently (no ghost cards); a
 * featured song never double-appears in the trending tail; and the route
 * wiring keeps the honesty gates — house-only curation, no card that cannot
 * play, public wall reads through the SAME playable-asset law the catalog
 * plays by.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orderFeaturedFirst } from "../src/lib/landing-featured";

function testOrderingLaw(): void {
  const featuredIds = ["b", "a", "z"]; // curated order, z no longer exists
  const featured = [{ id: "a" }, { id: "b" }];
  const trending = [{ id: "c" }, { id: "a" }, { id: "d" }];
  const wall = orderFeaturedFirst(featuredIds, featured, trending);
  assert.deepEqual(
    wall.map(s => s.id),
    ["b", "a", "c", "d"],
    "curated order leads; ghosts drop; featured never re-appears in the tail"
  );

  assert.deepEqual(
    orderFeaturedFirst([], [], trending).map(s => s.id),
    ["c", "a", "d"],
    "no pins → the wall is exactly the trending list"
  );
}

function testWiring(): void {
  const publicRoutes = readFileSync(
    join(process.cwd(), "src/routes/public.ts"),
    "utf8"
  );
  assert.match(publicRoutes, /readFeaturedSongIds\(\)/, "trending must read the pins");
  assert.match(publicRoutes, /orderFeaturedFirst\(featuredIds, featured, trending\)/);
  assert.match(
    publicRoutes,
    /const current = currentPlayableAsset\(song\);[\s\S]{0,700}if \(!streamRef\) return null;/,
    "wall audio must come from the catalog's own playable-asset law, and unplayable cards must drop"
  );

  const songs = readFileSync(join(process.cwd(), "src/routes/songs.ts"), "utf8");
  const featureAt = songs.indexOf("'/:id/feature'");
  assert.ok(featureAt >= 0, "the feature toggle endpoint must exist");
  const slice = songs.slice(featureAt, featureAt + 3000);
  const notFoundAt = slice.indexOf("'not_found'");
  const gateAt = slice.indexOf("!operator && !firstParty");
  const quarantineAt = slice.indexOf("'not_featureable'");
  const playableAt = slice.indexOf("'no_playable_audio'");
  const writeAt = slice.indexOf("writeFeaturedSongIds([song.id");
  assert.ok(
    notFoundAt >= 0 &&
      notFoundAt < gateAt &&
      gateAt < quarantineAt &&
      quarantineAt < playableAt &&
      playableAt < writeAt,
    "feature order: scope 404 → house-only gate → public-safety gate → can-play gate → write"
  );
  assert.match(songs, /featuredOnLanding: featuredOnLanding\.has\(s\.id\)/, "catalog rows must carry the pin state");
}

testOrderingLaw();
testWiring();
console.log("landing featured: curated order, ghost-drop, house gate, and can-play law all hold");
