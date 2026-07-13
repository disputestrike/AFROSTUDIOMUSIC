import { createHash } from 'node:crypto';
import { familyOf, isMaterialRole, type MeasuredAnalysis } from '@afrohit/shared';
import { measureAudioQuality, type AudioQuality } from './ffmpeg';
import { dspAvailable, measureAudio } from './dsp';

export interface MaterialInspection {
  contentHash: string;
  readiness: 'ready' | 'pending' | 'rejected';
  qualityState: 'passed' | 'unmeasured' | 'failed';
  roleEvidence: string;
  reasons: string[];
  qc: AudioQuality | null;
  measured: MeasuredAnalysis | null;
  detectedBpm: number | null;
  detectedKey: string | null;
  verifiedAt: Date | null;
}

function valueOf<T>(field: { value?: T | null; source?: string } | undefined): T | null {
  return field?.source !== 'unknown' && field?.value != null ? field.value : null;
}

function promptedEvidence(role: string, measured: MeasuredAnalysis | null): string {
  if (!measured?.engineOk) return 'provider-prompted-unconfirmed';
  const low = valueOf(measured.lowEndProfile)?.ratio ?? 0;
  const rhythm = Math.max(
    valueOf(measured.kickDensity) ?? 0,
    valueOf(measured.shakerContinuity) ?? 0,
    valueOf(measured.clapBackbeat) ?? 0,
  );
  const harmonic = valueOf(measured.harmonicRichness) ?? 0;
  if (role === 'log_drum' && (valueOf(measured.logDrumLikelihood) ?? 0) >= 0.25) return 'provider-prompted-dsp-consistent';
  if (!isMaterialRole(role)) {
    if (role === 'bass' && low >= 0.08) return 'provider-prompted-dsp-consistent';
    if ((role === 'drums' || role === 'percussion') && rhythm >= 0.15) return 'provider-prompted-dsp-consistent';
    if (role === 'chords' && harmonic >= 0.1) return 'provider-prompted-dsp-consistent';
    return 'provider-prompted-unconfirmed';
  }
  const family = familyOf(role);
  if (family === 'bass' && low >= 0.08) return 'provider-prompted-dsp-consistent';
  if ((family === 'drumkit' || family === 'african_perc' || family === 'global_perc') && rhythm >= 0.15) {
    return 'provider-prompted-dsp-consistent';
  }
  if ((family === 'harmony' || family === 'melody' || family === 'mallets') && harmonic >= 0.1) {
    return 'provider-prompted-dsp-consistent';
  }
  if (family === 'fx' || family === 'vocals') return 'provider-prompted-technical-only';
  return 'provider-prompted-unconfirmed';
}

/** Technical audio gate plus honest role evidence. This never calls a prompted
 * role "verified" when the available DSP can only establish a broad family. */
export async function inspectMaterialAudio(opts: {
  bytes: Buffer;
  url: string;
  role: string;
  roleEvidence: string;
  deep?: boolean;
}): Promise<MaterialInspection> {
  const contentHash = createHash('sha256').update(opts.bytes).digest('hex');
  const qc = await measureAudioQuality(opts.url).catch(() => null);
  const reasons: string[] = [];
  if (!qc) reasons.push('technical-qc-unavailable');
  if (qc?.integratedLufs != null && qc.integratedLufs < -38) reasons.push('near-silent');
  if ((qc?.flags ?? []).includes('clipping')) reasons.push('clipping');
  if (qc && qc.durationS < (opts.role === 'fill' ? 0.4 : 0.75)) reasons.push('too-short');
  const failed = reasons.some((reason) => reason !== 'technical-qc-unavailable');

  let measured: MeasuredAnalysis | null = null;
  if (opts.deep && await dspAvailable().catch(() => false)) {
    measured = await measureAudio(opts.bytes).catch(() => null);
    if (measured && !measured.engineOk) measured = null;
  }
  const detectedBpm = measured ? valueOf(measured.tempoBpm) : null;
  const key = measured ? valueOf(measured.key) : null;
  const mode = measured ? valueOf(measured.mode) : null;
  const detectedKey = key ? `${key}${mode ? ` ${mode}` : ''}` : null;
  const roleEvidence = opts.roleEvidence.startsWith('provider-prompted')
    ? promptedEvidence(opts.role, measured)
    : opts.roleEvidence;

  return {
    contentHash,
    readiness: failed ? 'rejected' : qc ? 'ready' : 'pending',
    qualityState: failed ? 'failed' : qc ? 'passed' : 'unmeasured',
    roleEvidence,
    reasons,
    qc,
    measured,
    detectedBpm,
    detectedKey,
    verifiedAt: qc ? new Date() : null,
  };
}
