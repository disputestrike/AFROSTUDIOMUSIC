import { prisma } from '@afrohit/db';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { ffmpegAvailable, master as ffmpegMaster, MASTER_TARGETS } from '../lib/ffmpeg';

interface MasterPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  mixId?: string;
  preset: string;
}

/**
 * Real mastering: loudnorm to preset LUFS target, upload WAV + 320k MP3.
 */
export async function processMaster(p: MasterPayload) {
  await markRunning(p.jobId);
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host — install ffmpeg (Railway nixpacks includes it)');
    }
    // Re-scope by the payload workspace — treat the job payload as untrusted
    // (defense-in-depth; never master a mix from another workspace).
    const mix = p.mixId
      ? await prisma.mix.findFirstOrThrow({ where: { id: p.mixId, project: { workspaceId: p.workspaceId } } })
      : await prisma.mix.findFirstOrThrow({
          where: { songId: p.songId, project: { workspaceId: p.workspaceId } },
          orderBy: { createdAt: 'desc' },
        });

    const mixBytes = await downloadToBuffer(mix.url);
    const { wav, mp3 } = await ffmpegMaster({ mix: mixBytes, preset: p.preset });

    const [wavUrl, mp3Url] = await Promise.all([
      uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: wav, contentType: 'audio/wav', ext: 'wav' }),
      uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: mp3, contentType: 'audio/mpeg', ext: 'mp3' }),
    ]);

    const target = MASTER_TARGETS[p.preset] ?? MASTER_TARGETS['streaming_lufs_-14']!;
    const masterRow = await prisma.master.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        mixId: mix.id,
        preset: p.preset,
        url: wavUrl,
        loudness: target.lufs,
        // Rendered by an explicit user action → usable immediately (same rule as
        // uploads). Without this the export bundle + catalog download see null.
        approved: true,
      },
    });
    await prisma.song.update({ where: { id: p.songId }, data: { status: 'MASTERED' } });
    await markSucceeded(p.jobId, { masterId: masterRow.id, wavUrl, mp3Url, targetLufs: target.lufs });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
