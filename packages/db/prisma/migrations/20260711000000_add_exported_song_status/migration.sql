-- Add EXPORTED to SongStatus (a bundle was built + downloaded; NOT distributed).
-- RELEASED stays reserved for a confirmed distributor submission.
ALTER TYPE "SongStatus" ADD VALUE IF NOT EXISTS 'EXPORTED' BEFORE 'RELEASED';
