-- SONG-SCOPED LYRICS — backfill for the project-scoped fallback defect.
--
-- THE DEFECT (now removed from the API): every lyric read in routes/songs.ts and
-- services/chat-tools.ts fell back to `findFirst({ where: { projectId }, orderBy:
-- { createdAt: 'desc' } })` when a song had no lyric bound via LyricDraft.songId.
-- A project holds MANY songs — reuse-beat and reuse-instrumental each mint a
-- sibling song with no lyric — so that fallback:
--   * DISPLAYED another song's words on this song,
--   * OVERWROTE that sibling's row in place on PATCH (silent cross-song
--     corruption: editing song B rewrote song A's lyric), and
--   * SANG the wrong words on re-sing, making that render the song's audio.
-- Because it ordered by createdAt DESC, which song's words leaked also CHANGED
-- over time as new drafts were written anywhere in the project.
--
-- THE BACKFILL: with the fallback gone, any song reachable only through it would
-- suddenly read as "no lyrics" — indistinguishable from data loss. This migration
-- makes every song OWN the words it currently displays, so the catalog looks
-- identical after the fix while the cross-song corruption stops for good.
--
-- Nothing is deleted and nothing is overwritten. Step 1 only binds drafts that
-- belong to no song at all; step 2 only inserts for songs that have no draft.
-- Both steps are idempotent and are a no-op on a clean database.

-- ---------------------------------------------------------------------------
-- STEP 1 — Adopt, don't copy: bind an ORPHAN draft (songId IS NULL) to the only
-- song in its project, when that song has no draft of its own. This covers the
-- common one-project-one-song case with zero duplication.
-- Only the NEWEST orphan per project is bound: LyricDraft.songId is @unique, so
-- a project holding several orphans must not try to bind them to one song.
-- ---------------------------------------------------------------------------
WITH single_song_project AS (
  SELECT "projectId", MIN("id") AS song_id
  FROM "Song"
  GROUP BY "projectId"
  HAVING COUNT(*) = 1
),
adoptable AS (
  SELECT
    ssp.song_id,
    (
      SELECT ld."id"
      FROM "LyricDraft" ld
      WHERE ld."projectId" = ssp."projectId"
        AND ld."songId" IS NULL
      ORDER BY ld."createdAt" DESC
      LIMIT 1
    ) AS lyric_id
  FROM single_song_project ssp
  WHERE NOT EXISTS (
    SELECT 1 FROM "LyricDraft" bound WHERE bound."songId" = ssp.song_id
  )
)
UPDATE "LyricDraft" ld
SET "songId" = a.song_id
FROM adoptable a
WHERE ld."id" = a.lyric_id
  AND a.lyric_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- STEP 2 — Give every remaining unbound song its OWN copy of exactly the draft
-- the old fallback served it (its project's newest), so the words on screen do
-- not change, but each song now owns them independently.
--
-- `versions` is copied deliberately. Where the PATCH defect already overwrote a
-- real lyric in place, the pre-overwrite text survives only in that snapshot
-- history (routes/songs.ts snapshots before every overwrite) — so the history IS
-- the recovery route for words this bug already clobbered. Duplicating it is
-- cheap; dropping it would destroy the only copy of some originals.
--
-- `approved` is deliberately NOT copied: an approval belongs to the draft that
-- earned it, and a copy has not been reviewed on this song.
-- ---------------------------------------------------------------------------
INSERT INTO "LyricDraft" (
  "id", "projectId", "songId", "title", "body", "structure", "cleanVersion",
  "explicit", "artistAuthored", "languageMix", "melody", "translation",
  "craftJson", "versions", "approved", "approvalNotes", "createdAt"
)
SELECT
  CONCAT('c', TRANSLATE(gen_random_uuid()::text, '-', '')),
  s."projectId",
  s."id",
  src."title",
  src."body",
  src."structure",
  src."cleanVersion",
  src."explicit",
  src."artistAuthored",
  src."languageMix",
  src."melody",
  src."translation",
  src."craftJson",
  src."versions",
  FALSE,
  src."approvalNotes",
  NOW()
FROM "Song" s
CROSS JOIN LATERAL (
  SELECT ld.*
  FROM "LyricDraft" ld
  WHERE ld."projectId" = s."projectId"
  ORDER BY ld."createdAt" DESC
  LIMIT 1
) src
WHERE NOT EXISTS (
  SELECT 1 FROM "LyricDraft" bound WHERE bound."songId" = s."id"
);

-- ---------------------------------------------------------------------------
-- STEP 3 — Song.lyricId is a DEAD column and this realigns it with the truth.
-- The SongPrimaryLyric relation defines its foreign key on LyricDraft.songId, so
-- that is the ONLY binding any read traverses (`include: { lyric: true }`).
-- Song.lyricId is an orphan scalar that five code paths write believing it links
-- the lyric, and that no read has ever consulted — meaning it can silently
-- disagree with LyricDraft.songId. Point it at the real binding so the two
-- cannot contradict each other for anyone who trusts it.
-- ---------------------------------------------------------------------------
UPDATE "Song" s
SET "lyricId" = ld."id"
FROM "LyricDraft" ld
WHERE ld."songId" = s."id"
  AND (s."lyricId" IS DISTINCT FROM ld."id");
