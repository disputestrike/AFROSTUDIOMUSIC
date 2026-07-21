-- SOCIALS PACK (owner, 2026-07-20): "on every song … SOCIALS, like another tab
-- next to the lyrics — what I can copy right away for my social media."
--
-- Song.socialsJson holds the copy-paste promo pack written by the BULK brain
-- from the song's own materials: { story, captions[3], hashtags, hook,
-- language }. Nullable — a song without a pack simply has none yet; the tab
-- offers Generate. socialsUpdatedAt says how fresh the stored pack is.

ALTER TABLE "Song" ADD COLUMN "socialsJson" JSONB;
ALTER TABLE "Song" ADD COLUMN "socialsUpdatedAt" TIMESTAMPTZ(6);
