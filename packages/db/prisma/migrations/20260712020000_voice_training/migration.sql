-- OWN-VOICE TRAINING: Replicate trainings lifecycle on VoiceProfile
-- (trainingId to poll, destination model in the ARTIST's account, trained version, raw meta)
ALTER TABLE "VoiceProfile" ADD COLUMN "trainingId" TEXT;
ALTER TABLE "VoiceProfile" ADD COLUMN "destinationModel" TEXT;
ALTER TABLE "VoiceProfile" ADD COLUMN "trainedVersion" TEXT;
ALTER TABLE "VoiceProfile" ADD COLUMN "trainingMeta" JSONB;
