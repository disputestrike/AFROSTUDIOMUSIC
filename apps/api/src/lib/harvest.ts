import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { enqueue } from './queue';

/**
 * AUTO-HARVEST (audit PARTIAL → REAL): turn an OWNED beat/instrumental the artist
 * just uploaded or imported into reusable role loops. Enqueues a stem-separation
 * job whose processor (processStems) splits the audio into drums/bass/other and
 * files each as a MaterialAsset (source 'artist_stem'), so the artist's real
 * sounds become material the owned engine can assemble — instead of just sitting
 * in the catalog. Best-effort: never blocks the upload response.
 */
export async function enqueueHarvest(
  app: FastifyInstance,
  p: { workspaceId: string; projectId: string; beatId: string; sourceUrl?: string },
): Promise<void> {
  try {
    const job = await prisma.providerJob.create({
      data: {
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        kind: 'stems',
        provider: 'replicate',
        status: 'QUEUED',
        inputJson: { beatId: p.beatId, mode: 'stems', sourceUrl: p.sourceUrl, harvest: true } as never,
      },
    });
    await enqueue({
      queue: app.queues.music,
      name: 'stems',
      payload: { jobId: job.id, workspaceId: p.workspaceId, projectId: p.projectId, beatId: p.beatId, mode: 'stems', sourceUrl: p.sourceUrl },
    });
    app.log.info({ beatId: p.beatId, workspaceId: p.workspaceId }, '[harvest] owned upload → stem harvest queued');
  } catch (e) {
    app.log.warn({ beatId: p.beatId, err: (e as Error)?.message }, '[harvest] enqueue failed (non-fatal)');
  }
}
