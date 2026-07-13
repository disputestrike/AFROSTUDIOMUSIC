/** Blueprint loaders — measured skeleton for a pinned reference or a song's own
 *  latest take. Returns null honestly when nothing was ever measured. */
import { prisma } from '@afrohit/db';
import { blueprintFromMeasured, type SongBlueprint, type MeasuredAnalysis } from '@afrohit/shared';

export async function blueprintForReference(workspaceId: string, referenceId: string): Promise<SongBlueprint | null> {
  const ref = await prisma.soundReference.findFirst({
    where: {
      id: referenceId,
      workspaceId,
      active: true,
      analysisState: 'measured',
      rightsBasis: { not: 'unknown' },
    },
    select: { recipe: true },
  });
  const rec = (ref?.recipe ?? {}) as { measured?: MeasuredAnalysis };
  return blueprintFromMeasured(rec.measured);
}

export async function blueprintForSong(workspaceId: string, songId: string): Promise<SongBlueprint | null> {
  const beat = await prisma.beatAsset.findFirst({
    where: { songId, song: { workspaceId } },
    orderBy: { createdAt: 'desc' },
    select: { meta: true },
  });
  const meta = (beat?.meta ?? {}) as { measured?: MeasuredAnalysis };
  return blueprintFromMeasured(meta.measured);
}
