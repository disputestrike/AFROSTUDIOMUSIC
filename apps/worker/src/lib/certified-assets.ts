import { createHash, timingSafeEqual } from 'node:crypto';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from './storage';
import { measureAudioBufferQuality, NATIVE_AUDIO_LIMITS, type AudioQuality } from './ffmpeg';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUIRED_DECODED_METRICS = [
  'durationS',
  'integratedLufs',
  'loudnessRangeLra',
  'truePeakDb',
  'crestFactorDb',
  'flatFactor',
] as const satisfies ReadonlyArray<keyof AudioQuality>;

export function sha256Bytes(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertStoredContentHash(
  bytes: Buffer | Uint8Array,
  expectedHash: string | null | undefined,
  context: string,
): string {
  if (!SHA256_PATTERN.test(expectedHash ?? '')) {
    throw new Error(`${context}_content_hash_invalid`);
  }
  const actualHash = sha256Bytes(bytes);
  const matches = timingSafeEqual(
    Buffer.from(actualHash, 'hex'),
    Buffer.from(expectedHash!.toLowerCase(), 'hex'),
  );
  if (!matches) throw new Error(`${context}_content_hash_mismatch`);
  return actualHash;
}

export function assertCertifiableAudioQuality(qc: AudioQuality, context = 'audio'): void {
  const missing = REQUIRED_DECODED_METRICS.filter((metric) => {
    const value = qc[metric];
    return typeof value !== 'number' || !Number.isFinite(value) || (metric === 'durationS' && value <= 0);
  });
  if (missing.length) {
    throw new Error(`audio_qc_failed: ${context}: missing finite decoded metrics: ${missing.join(', ')}`);
  }
  if (qc.verdict !== 'pass') {
    throw new Error(`audio_qc_failed: ${context}: ${qc.flags.join(', ') || qc.verdict}`);
  }
}

export interface CertifiedAudio {
  url: string;
  contentHash: string;
  verifiedAt: Date;
  qualityState: 'passed';
  qc: AudioQuality;
}

export async function certifyAudioBytes(options: {
  workspaceId: string;
  kind: string;
  bytes: Buffer;
  contentType?: string;
  ext?: string;
}): Promise<CertifiedAudio> {
  const contentHash = sha256Bytes(options.bytes);
  const qc = await measureAudioBufferQuality(options.bytes);
  assertCertifiableAudioQuality(qc);
  const url = await uploadBytes({
    workspaceId: options.workspaceId,
    kind: options.kind,
    bytes: options.bytes,
    contentType: options.contentType ?? 'audio/wav',
    ext: options.ext ?? 'wav',
  });
  try {
    const storedBytes = await downloadToBuffer(url, {
      maxBytes: options.bytes.byteLength,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    assertStoredContentHash(storedBytes, contentHash, 'certified_audio_upload');
    return {
      url,
      contentHash,
      verifiedAt: new Date(),
      qualityState: 'passed',
      qc,
    };
  } catch (error) {
    await deleteObjectByUrl(url).catch(() => undefined);
    throw error;
  }
}
