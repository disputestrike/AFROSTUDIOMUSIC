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

    // MATERIAL HARVEST: the artist's own non-vocal stems join the material
    // library — real, owned audio the arranger can place into future beats.
    const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { genre: true } });
    // A stripped full INSTRUMENTAL is filed under its own 'instrumental' role (was
    // 'other', which orphaned it) so the Instrumental Library can find + reuse it.
    const ROLE_MAP: Record<string, string> = { drums: 'drums', bass: 'bass', other: 'chords', instrumental: 'instrumental' };
    await Promise.all(
      ingested
        .filter((s) => s.role !== 'vocals')
        .map((s) =>
          prisma.materialAsset
            .create({
              data: {
                workspaceId: p.workspaceId,
                kind: 'stem',
                role: ROLE_MAP[s.role] ?? 'other',
                genre: project?.genre ?? null,
                bpm: beat.bpm,
                keySignature: beat.keySignature,
                durationS: beat.duration,
                url: s.url,
                source: 'artist_stem',
                meta: { fromBeatId: beat.id, fromSongId: p.songId, stemRole: s.role } as never,
              },
            })
            .catch((err) => console.warn('[stems] material harvest failed:', (err as Error)?.message))
        )
    );

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
