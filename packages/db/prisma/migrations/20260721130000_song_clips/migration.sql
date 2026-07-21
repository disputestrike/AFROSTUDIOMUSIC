-- AUTO-CLIP (Phase 2, owner 2026-07-21): when the music video finishes, the ONE
-- assembled master is auto-cut (ffmpeg EDITS, never a re-render) into ~10
-- vertical shorts for TikTok / Reels / Shorts. "Generate once, repurpose many."
--
-- Song.clipsStatus is the lifecycle the tab reads to show "cutting clips…"
-- (cutting) then the finished grid (ready), or an outage (unavailable). Nullable
-- — legacy songs simply have no status yet.
ALTER TABLE "Song" ADD COLUMN "clipsStatus" TEXT;

-- Each SongClip is one 9:16 slice of the master, tied to the exact VideoRender
-- (sourceVideoId) it was cut from, so a fresh master can recut without disturbing
-- the old set. Cascade from both the song and the workspace — a clip is
-- meaningless once either is gone.
CREATE TABLE "SongClip" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION NOT NULL,
    "startS" DOUBLE PRECISION NOT NULL,
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "kind" TEXT NOT NULL,
    "captionText" TEXT,
    "sectionLabel" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongClip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SongClip_songId_createdAt_idx" ON "SongClip"("songId", "createdAt" DESC);
CREATE INDEX "SongClip_sourceVideoId_idx" ON "SongClip"("sourceVideoId");
CREATE INDEX "SongClip_workspaceId_idx" ON "SongClip"("workspaceId");

ALTER TABLE "SongClip" ADD CONSTRAINT "SongClip_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SongClip" ADD CONSTRAINT "SongClip_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
