import { prisma } from '@afrohit/db';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { ffmpegAvailable, mixdown } from '../lib/ffmpeg';

interface MixPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  preset: string;
}

/**
 * Real mixdown: latest approved beat + latest approved lead vocal → FFmpeg
 * preset chain → WAV in object storage → Mix row.
 */
export async function processMix(p: MixPayload) {
  await markRunning(p.jobId);
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host — install ffmpeg (Railway nixpacks includes it)');
    }
    const song = await prisma.song.findFirstOrThrow({ where: { id: p.songId } });
    const beat = await prisma.beatAsset.findFirst({
      where: { songId: p.songId, approved: true },
      orderBy: { createdAt: 'desc' },
    });
    const vocal = await prisma.vocalRender.findFirst({
      where: { songId: p.songId, role: 'lead', approved: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!beat) throw new Error('mix requires an approved beat (approve one in the project first)');
    if (!vocal) throw new Error('mix requires an approved lead vocal');

    const [beatBytes, vocalBytes] = await Promise.all([
      downloadToBuffer(beat.url),
      downloadToBuffer(vocal.url),
    ]);
    const mixed = await mixdown({ beat: beatBytes, vocal: vocalBytes, preset: p.preset });
    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: 'mixes',
      bytes: mixed,
      contentType: 'audio/wav',
      ext: 'wav',
    });

    const mix = await prisma.mix.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        preset: p.preset,
        url,
        notes: `FFmpeg mixdown — beat ${beat.id.slice(-6)}, vocal ${vocal.id.slice(-6)}. Song: ${song.title}`,
      },
    });
    await prisma.song.update({ where: { id: p.songId }, data: { status: 'MIXED' } });
    await markSucceeded(p.jobId, { mixId: mix.id, url });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
