-- TRUE INSTRUMENTAL: finished-song-minus-voice artifacts on the Song itself
-- (mp3 for the player; provenance meta), cleared whenever a new master lands.
ALTER TABLE "Song" ADD COLUMN "instrumentalUrl" TEXT;
ALTER TABLE "Song" ADD COLUMN "acapellaUrl" TEXT;
ALTER TABLE "Song" ADD COLUMN "instrumentalMeta" JSONB;
