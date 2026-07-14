ALTER TABLE "CreditLedger"
  ADD COLUMN IF NOT EXISTS "creditKey" TEXT,
  ADD COLUMN IF NOT EXISTS "units" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "planUnits" INTEGER NOT NULL DEFAULT 1;

UPDATE "CreditLedger"
SET "creditKey" = CASE
  WHEN "reason" LIKE 'hooks_batch_20%' THEN 'hooks_batch_20'
  WHEN "reason" LIKE 'lyrics_full%' THEN 'lyrics_full'
  WHEN "reason" LIKE 'taste_score_batch_50%' THEN 'taste_score_batch_50'
  WHEN "reason" LIKE 'brief_polish%' THEN 'brief_polish'
  WHEN "reason" LIKE 'cover_art_low%' THEN 'cover_art_low'
  WHEN "reason" LIKE 'cover_art_high%' THEN 'cover_art_high'
  WHEN "reason" LIKE 'beat_idea_short_30s%' THEN 'beat_idea_short_30s'
  WHEN "reason" LIKE 'full_song_demo%' THEN 'full_song_demo'
  WHEN "reason" LIKE 'stems_export%' THEN 'stems_export'
  WHEN "reason" LIKE 'analyze_audio%' THEN 'analyze_audio'
  WHEN "reason" LIKE 'hit_predict%' THEN 'hit_predict'
  WHEN "reason" LIKE 'voice_render_30s%' THEN 'voice_render_30s'
  WHEN "reason" LIKE 'voice_render_full%' THEN 'voice_render_full'
  WHEN "reason" LIKE 'voice_profile_setup%' THEN 'voice_profile_setup'
  WHEN "reason" LIKE 'voice_clone_training%' THEN 'voice_clone_training'
  WHEN "reason" LIKE 'voice_sing_render%' THEN 'voice_sing_render'
  WHEN "reason" LIKE 'mix_preset%' THEN 'mix_preset'
  WHEN "reason" LIKE 'master_preset%' THEN 'master_preset'
  WHEN "reason" LIKE 'video_8s%' THEN 'video_8s'
  WHEN "reason" LIKE 'video_20s%' THEN 'video_20s'
  WHEN "reason" LIKE 'release_export%' THEN 'release_export'
  ELSE "creditKey"
END
WHERE "creditKey" IS NULL AND "delta" < 0;

UPDATE "CreditLedger"
SET "units" = CASE "creditKey"
  WHEN 'hooks_batch_20' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 1500)::integer)
  WHEN 'lyrics_full' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
  WHEN 'taste_score_batch_50' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 2000)::integer)
  WHEN 'brief_polish' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 500)::integer)
  WHEN 'cover_art_low' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
  WHEN 'cover_art_high' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 25000)::integer)
  WHEN 'beat_idea_short_30s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 25000)::integer)
  WHEN 'full_song_demo' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 75000)::integer)
  WHEN 'stems_export' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 50000)::integer)
  WHEN 'analyze_audio' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 5000)::integer)
  WHEN 'hit_predict' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 3000)::integer)
  WHEN 'voice_render_30s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 30000)::integer)
  WHEN 'voice_render_full' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 80000)::integer)
  WHEN 'voice_profile_setup' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 200000)::integer)
  WHEN 'voice_clone_training' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 50000)::integer)
  WHEN 'voice_sing_render' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 15000)::integer)
  WHEN 'mix_preset' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 10000)::integer)
  WHEN 'master_preset' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 15000)::integer)
  WHEN 'video_8s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 100000)::integer)
  WHEN 'video_20s' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 250000)::integer)
  WHEN 'release_export' THEN GREATEST(1, CEIL(ABS("delta")::numeric / 5000)::integer)
  ELSE "units"
END
WHERE "delta" < 0;

UPDATE "CreditLedger"
SET "planUnits" = CASE
  WHEN "creditKey" = 'video_8s' THEN "units" * 8
  WHEN "creditKey" = 'video_20s' THEN "units" * 20
  ELSE "units"
END
WHERE "delta" < 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CreditLedger_units_check'
  ) THEN
    ALTER TABLE "CreditLedger"
      ADD CONSTRAINT "CreditLedger_units_check" CHECK ("units" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CreditLedger_planUnits_check'
  ) THEN
    ALTER TABLE "CreditLedger"
      ADD CONSTRAINT "CreditLedger_planUnits_check" CHECK ("planUnits" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CreditLedger_workspaceId_createdAt_idx"
  ON "CreditLedger"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditLedger_workspaceId_creditKey_createdAt_idx"
  ON "CreditLedger"("workspaceId", "creditKey", "createdAt");
