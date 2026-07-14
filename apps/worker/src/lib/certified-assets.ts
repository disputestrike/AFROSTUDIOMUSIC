import { createHash } from 'node:crypto';
import { deleteObjectByUrl, uploadBytes } from './storage';
import { measureAudioQuality, type AudioQuality } from './ffmpeg';

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
  const url = await uploadBytes({
    workspaceId: options.workspaceId,
    kind: options.kind,
    bytes: options.bytes,
    contentType: options.contentType ?? 'audio/wav',
    ext: options.ext ?? 'wav',
  });
  try {
    const qc = await measureAudioQuality(url);
    if (qc.verdict !== 'pass') {
      throw new Error('audio_qc_failed: ' + (qc.flags.join(', ') || qc.verdict));
    }
    return {
      url,
      contentHash: createHash('sha256').update(options.bytes).digest('hex'),
      verifiedAt: new Date(),
      qualityState: 'passed',
      qc,
    };
  } catch (error) {
    await deleteObjectByUrl(url).catch(() => undefined);
    throw error;
  }
}
