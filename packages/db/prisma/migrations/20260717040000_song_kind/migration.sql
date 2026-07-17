-- CATALOG TYPE (owner ask): song | instrumental | film_sound. Purely
-- additive; every existing row is correctly a 'song'.
ALTER TABLE "Song" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'song';
