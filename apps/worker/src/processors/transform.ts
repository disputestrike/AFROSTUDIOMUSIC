/**
 * TRANSFORM — change a finished song's SPEED and/or KEY without regenerating a
 * note. Pitch-preserving tempo (0.5–1.5x) and ±6-semitone shifts; the result is
 * appended as a new Master take, so it shows in Compare Versions as the current
 * version with one-tap revert. Zero model spend — pure ffmpeg.
 */
import { prisma } from '@afrohit/db';
import { transformAudio } from '../lib/ffmpeg';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { markSucceeded, markFailed } from '../lib/jobs';

export interface TransformPayload {
  jobId: string; workspaceId: string; projectId: string; songId: string;
  sourceUrl: string; tempo?: number; semitones?: number;
}

export async function processTransform(p: TransformPayload): Promise<void> {
  try {
    const src = await downloadToBuffer(p.sourceUrl);
    const out = await transformAudio(src, { tempo: p.tempo, semitones: p.semitones });
    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: out, contentType: 'audio/wav', ext: 'wav' });
    const label = [
      p.tempo && Math.abs(p.tempo - 1) > 0.001 ? `${p.tempo}x` : null,
      p.semitones ? `${p.semitones > 0 ? '+' : ''}${p.semitones}st` : null,
    ].filter(Boolean).join(' ') || 'copy';
    await prisma.master.create({
      data: { projectId: p.projectId, songId: p.songId, preset: `transform ${label}`, url, approved: true },
    });
    await markSucceeded(p.jobId, { url, label });
    console.log(`[transform] song ${p.songId}: ${label}`);
  } catch (err) {
    await markFailed(p.jobId, (err as Error)?.message ?? 'transform failed').catch(() => undefined);
    console.warn('[transform] failed:', (err as Error)?.message);
  }
}
