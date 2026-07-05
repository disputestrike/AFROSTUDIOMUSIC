import { prisma } from '@afrohit/db';
import { separateStems } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile } from '../lib/storage';

interface StemsPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  beatId?: string;
  mode?: 'instrumental' | 'full';
}

/**
 * Split a rendered song into an instrumental + stems (Demucs). Re-hosts each
 * output to our bucket and attaches them as Stem rows on the song's beat, so
 * the catalog download offers the instrumental and the mixer can remix.
 */
export async function processStems(p: StemsPayload) {
  await markRunning(p.jobId);
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicApiKey: true } });
    const beat = p.beatId
      ? await prisma.beatAsset.findFirstOrThrow({ where: { id: p.beatId } })
      : await prisma.beatAsset.findFirstOrThrow({ where: { songId: p.songId }, orderBy: { createdAt: 'desc' } });

    const result = await separateStems({ audioUrl: beat.url, apiKey: ws?.musicApiKey ?? undefined, mode: p.mode ?? 'instrumental' });
    if (!result.stems.length) throw new Error('stem separation returned no audio');

    // Re-host to our bucket (parallel), then persist as Stem rows.
    const ingested = await Promise.all(
      result.stems.map(async (s) => ({
        role: s.role,
        url: await ingestRemoteFile({ workspaceId: p.workspaceId, url: s.url, kind: 'stems', ext: 'mp3', contentType: 'audio/mpeg' }),
      }))
    );
    // If the user asked for an instrumental, don't silently "succeed" without one.
    const roles = ingested.map((s) => s.role);
    if ((p.mode ?? 'instrumental') === 'instrumental' && !roles.includes('instrumental')) {
      throw new Error(`stem separation did not return an instrumental (got: ${roles.join(', ') || 'nothing'})`);
    }
    // Replace any prior separated stems of the same roles so re-runs don't pile up.
    await prisma.stem.deleteMany({ where: { beatId: beat.id, role: { in: roles } } });
    await prisma.$transaction(ingested.map((s) => prisma.stem.create({ data: { beatId: beat.id, role: s.role, url: s.url, format: 'mp3' } })));

    await markSucceeded(p.jobId, {
      beatId: beat.id,
      stems: ingested.length,
      instrumental: ingested.some((s) => s.role === 'instrumental'),
      roles,
    });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
