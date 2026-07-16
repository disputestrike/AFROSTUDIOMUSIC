import { createHash } from 'node:crypto';
import type { VocalQualityState } from '@afrohit/shared';
import { measureAudioQuality, measureVocalActivity, type AudioQuality } from './ffmpeg';

export interface VocalInspection {
  contentHash: string;
  qualityState: VocalQualityState;
  durationS: number | null;
  activeRatio: number | null;
  reasons: string[];
  qc: AudioQuality | null;
  verifiedAt: Date | null;
}

export async function inspectIsolatedVocal(opts: {
  bytes: Buffer;
  url: string;
  isolationConfirmed: boolean;
}): Promise<VocalInspection> {
  const contentHash = createHash('sha256').update(opts.bytes).digest('hex');
  const [qc, activity] = await Promise.all([
    measureAudioQuality(opts.url).catch(() => null),
    measureVocalActivity(opts.url).catch(() => null),
  ]);
  const durationS = activity?.durationS ?? qc?.durationS ?? null;
  const reasons: string[] = [];
  if (!opts.isolationConfirmed) reasons.push('isolation-not-confirmed');
  if (!qc || !activity) reasons.push('technical-qc-unavailable');
  if (durationS == null || durationS <= 0) reasons.push('undecodable');
  else {
    if (durationS < 1) reasons.push('too-short');
    if (durationS > 1_200) reasons.push('too-long');
  }
  if (qc?.integratedLufs != null && qc.integratedLufs < -40) reasons.push('near-silent');
  if (qc?.flags.includes('clipping')) reasons.push('clipping');
  if (activity && activity.activeRatio < 0.08) reasons.push('mostly-silent');

  const unavailableOnly = reasons.length > 0 && reasons.every((reason) => reason === 'technical-qc-unavailable');
  const qualityState: VocalQualityState = reasons.length === 0
    ? 'passed'
    : unavailableOnly
      ? 'unmeasured'
      : 'failed';
  return {
    contentHash,
    qualityState,
    durationS,
    activeRatio: activity?.activeRatio ?? null,
    reasons,
    qc,
    verifiedAt: qualityState === 'passed' ? new Date() : null,
  };
}
