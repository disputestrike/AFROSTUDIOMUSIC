-- RELEASE KIT (owner, 2026-07-21): "the hashtags don't show until I click
-- Generate — we did not see it." The Release Kit now generates ITSELF the moment
-- a song finishes rendering, so the tab opens already populated. socialsJson
-- (added in 20260720180000_song_socials) now holds the fuller kit shape; this
-- migration adds only the lifecycle column the UI needs to distinguish
-- "building your kit…" (pending) from a ready kit (ready) from a bulk-brain
-- outage (unavailable). Nullable — legacy songs simply have no status yet.

ALTER TABLE "Song" ADD COLUMN "releaseKitStatus" TEXT;
