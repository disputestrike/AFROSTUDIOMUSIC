ALTER TABLE "TasteScore" ADD COLUMN "lyricId" TEXT;

CREATE INDEX "TasteScore_songId_idx" ON "TasteScore"("songId");
CREATE INDEX "TasteScore_hookId_idx" ON "TasteScore"("hookId");
CREATE INDEX "TasteScore_lyricId_idx" ON "TasteScore"("lyricId");

ALTER TABLE "TasteScore"
  ADD CONSTRAINT "TasteScore_lyricId_fkey"
  FOREIGN KEY ("lyricId") REFERENCES "LyricDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
