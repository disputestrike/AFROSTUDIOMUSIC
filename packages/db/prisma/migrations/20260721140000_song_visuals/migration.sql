-- AUTO-VISUALS (Phase 3, owner 2026-07-21): on SONG completion (audio + lyrics +
-- cover are enough — NO video needed) the studio auto-generates a lyric video, an
-- audio-reactive visualizer, and 3-5 thumbnails, ALL by cheap ffmpeg/image EDITS
-- off the master audio + lyrics + cover. "Generate once, repurpose many" — no new
-- song/video render, no paid model, users charged $0.
--
-- Song.visualsStatus is the lifecycle the tab reads to show "creating visuals…"
-- (creating) then the finished players + thumbnail grid (ready), or an outage
-- (unavailable). Nullable — legacy songs simply have no status yet.
ALTER TABLE "Song" ADD COLUMN "visualsStatus" TEXT;

-- Each SongVisual is one auto-generated asset tied to the song. Unlike SongClip
-- it is NOT cut from a music video: it needs only audio+lyrics+cover, so it
-- exists the moment the song is mastered (long before any video). kind is one of
-- 'lyric_video' | 'visualizer' | 'thumbnail'. Cascade from both the song and the
-- workspace — a visual is meaningless once either is gone.
CREATE TABLE "SongVisual" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongVisual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SongVisual_songId_createdAt_idx" ON "SongVisual"("songId", "createdAt" DESC);
CREATE INDEX "SongVisual_songId_kind_idx" ON "SongVisual"("songId", "kind");
CREATE INDEX "SongVisual_workspaceId_idx" ON "SongVisual"("workspaceId");

ALTER TABLE "SongVisual" ADD CONSTRAINT "SongVisual_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SongVisual" ADD CONSTRAINT "SongVisual_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
