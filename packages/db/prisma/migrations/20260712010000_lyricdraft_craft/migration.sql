-- WRITING BRAIN craft object for the downstream Singing Brain:
-- {premise, hookCell, anchors: string[], sectionPurposes}
ALTER TABLE "LyricDraft" ADD COLUMN "craftJson" JSONB;
