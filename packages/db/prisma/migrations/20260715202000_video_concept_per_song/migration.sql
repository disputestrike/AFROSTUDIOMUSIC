-- EVERY SONG GETS A VIDEO RECOMMENDATION — bind VideoConcept to the song.
--
-- The storyboard generator was already built, hardened and billed, but
-- VideoConcept carried projectId ONLY. A project holds many songs, so a concept
-- could not say which record it was for — and the generator read the artist lane
-- and the project brief without ever reading the song or its lyrics. The result
-- was one generic treatment per project, belonging to none of its songs.
--
-- Nullable on purpose: concepts written before songs could be named keep working
-- (they simply aren't bound to one), and a project-level concept remains a
-- legitimate thing to have. Purely additive — no existing row changes meaning.

ALTER TABLE "VideoConcept" ADD COLUMN IF NOT EXISTS "songId" TEXT;

-- ON DELETE CASCADE matches the SongVideoConcept relation in schema.prisma: a
-- song's video treatment is part of the song and has no meaning without it.
-- Guarded so re-running is safe.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VideoConcept_songId_fkey'
  ) THEN
    ALTER TABLE "VideoConcept"
      ADD CONSTRAINT "VideoConcept_songId_fkey"
      FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The hot read is "newest concept for this song" — the panel beside its lyrics.
CREATE INDEX IF NOT EXISTS "VideoConcept_songId_createdAt_idx"
  ON "VideoConcept" ("songId", "createdAt" DESC);
