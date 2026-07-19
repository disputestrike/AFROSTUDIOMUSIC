/**
 * OWN MUSIC-MODEL TRAINING — moved to @afrohit/ai (music-trainer.ts) so the
 * WORKER's nightly flywheel can call the SAME kickoff/gates the API admin
 * endpoints use (P3, owner approval 2026-07-19). This file re-exports the
 * whole surface so every existing API import/test keeps working unchanged.
 */
export {
  musicTrainerEnabled,
  musicTrainerConfig,
  minCorpusSize,
  buildTrainerDataset,
  trainingDatasetHash,
  kickoffMusicTraining,
  pollMusicTraining,
  musicCandidateModelRef,
  evaluateAndPromote,
  emptyMusicModelRoute,
  parseMusicModelRoute,
  promoteMusicModelRoute,
  rollbackMusicModelRoute,
} from '@afrohit/ai';
export type {
  MusicTrainerConfig,
  TrainerDataset,
  TrainerDatasetFingerprint,
  KickoffResult,
  MusicTrainingProviderState,
  MusicTrainingProviderStatus,
  MusicModelRouteEntry,
  MusicModelRouteEvent,
  MusicModelRouteState,
} from '@afrohit/ai';
