import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { prisma } from '@afrohit/db';
import { predictHit, researchTrends, type HitPrediction } from '@afrohit/ai';
import { laneDnaBrief } from './lane-pipeline';
import { createQueuedProviderJob, type SuccessfulCharge } from './queued-job';
import { runIdempotentOperation } from './idempotent-operation';

/**
 * THE A&R READ — one shared brain for scoring a song and PERSISTING the read.
 *
 * Doctrine (Benjamin): no song is "done" until the Will-it-hit engine has read
 * it. Every produced song gets scored automatically (drop pipeline calls this
 * after the render lands) and the read is STORED on the song, so the catalog
 * shows it without clicking and "Make it bigger" can implement the notes.
 * Best-effort by design: a scoring hiccup never breaks production.
 */
export async function arReadSong(
  app: FastifyInstance,
  workspaceId: string,
  songId: string,
  operationKey?: string
): Promise<HitPrediction | null> {
  let charge: SuccessfulCharge | undefined;
  try {
    const song = await prisma.song.findFirst({
      where: { id: songId, workspaceId },
      include: {
        project: { select: { genre: true, bpm: true, artist: { select: { languages: true } } } },
        lyric: true,
        masters: { orderBy: { createdAt: 'desc' }, take: 1 },
        hooks: { where: { approved: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!song) return null;
    const charged = await app.chargeCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: songId, idempotencyKey: operationKey });
    if (!charged.ok) return null;
    charge = charged;
    if (charge.replayed && song.hitRead) return song.hitRead as unknown as HitPrediction;
    const operation = await runIdempotentOperation({
      workspaceId,
      projectId: song.projectId,
      kind: 'ar-read',
      provider: 'text',
      idempotencyKey: operationKey,
      chargeLedgerId: charge.chargeId,
      inputJson: { songId, operationKey },
      execute: async () => {
        const genre = song.project.genre;
        const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
        const prediction = await predictHit({
          title: song.lyric?.title || song.title,
          genre,
          bpm: song.project.bpm ?? undefined,
          hook: song.hooks[0]?.text ?? undefined,
          lyrics: song.lyric?.body ?? undefined,
          soundDna: laneDnaBrief(genre),
          trends,
          hasMaster: song.masters.length > 0,
          languages: song.project.artist.languages,
        });
        if (!prediction) {
          await app.refundCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: songId, chargeId: charge!.chargeId });
          return null;
        }
        await prisma.song.update({
          where: { id: songId },
          data: { hitScore: prediction.hitScore, viralScore: prediction.viralScore, hitRead: prediction as never },
        });
        return prediction;
      },
    });
    return operation.state === 'completed' ? operation.value : null;
  } catch (err) {
    if (charge) {
      await app.refundCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: songId, chargeId: charge.chargeId }).catch(() => undefined);
    }
    app.log.warn({ err, songId }, 'A&R read failed (song still usable)');
    return null;
  }
}

/**
 * Persist a follow-up that scores rendered songs after their music jobs land.
 * The orchestration worker owns the polling, so API restarts cannot lose it.
 */
export async function arReadAfterRender(
  app: FastifyInstance,
  workspaceId: string,
  items: Array<{ songId?: string; jobId?: string }>
): Promise<{ jobId: string; replayed: boolean } | null> {
  const valid = items.filter((item): item is { songId: string; jobId: string } => !!item.songId && !!item.jobId);
  if (!valid.length) return null;
  const fingerprint = createHash('sha256').update(JSON.stringify(valid)).digest('hex').slice(0, 24);
  const job = await createQueuedProviderJob({
    app,
    queue: app.queues.orchestration,
    jobName: 'ar-read-after-render',
    workspaceId,
    kind: 'ar-orchestration',
    provider: 'internal',
    inputJson: { items: valid },
    idempotencyKey: `ar-after-render:${fingerprint}`,
    payload: (jobId) => ({ jobId, workspaceId, items: valid }),
  });
  return job;
}

export async function runArReadAfterRender(
  app: FastifyInstance,
  workspaceId: string,
  orchestrationJobId: string,
  items: Array<{ songId: string; jobId: string }>
): Promise<{ scored: string[]; skipped: string[] }> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const scored: string[] = [];
  const skipped: string[] = [];
  await Promise.all(
    items.map(async (item) => {
        for (let t = 0; t < 90; t++) {
          await sleep(10_000);
          const job = await prisma.providerJob.findFirst({ where: { id: item.jobId, workspaceId }, select: { status: true } });
          if (!job || job.status === 'FAILED' || job.status === 'CANCELED') {
            skipped.push(item.songId);
            return;
          }
          if (job.status === 'SUCCEEDED') {
            const read = await arReadSong(app, workspaceId, item.songId, `ar-read:${orchestrationJobId}:${item.songId}`);
            (read ? scored : skipped).push(item.songId);
            return;
          }
        }
        skipped.push(item.songId);
      })
  );
  return { scored, skipped };
}
