import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { predictHit, researchTrends, soundBrief, type HitPrediction } from '@afrohit/ai';

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
  songId: string
): Promise<HitPrediction | null> {
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
    const charge = await app.chargeCredits({ workspaceId, key: 'hit_predict', refTable: 'Song', refId: songId });
    if (!charge.ok) return null;
    const genre = song.project.genre;
    const trends = (await researchTrends({ genre }).catch(() => null))?.digest;
    const prediction = await predictHit({
      title: song.lyric?.title || song.title,
      genre,
      bpm: song.project.bpm ?? undefined,
      hook: song.hooks[0]?.text ?? undefined,
      lyrics: song.lyric?.body ?? undefined,
      soundDna: soundBrief(genre).brief,
      trends,
      hasMaster: song.masters.length > 0,
      languages: song.project.artist.languages,
    });
    if (!prediction) return null;
    await prisma.song.update({
      where: { id: songId },
      data: { hitScore: prediction.hitScore, viralScore: prediction.viralScore, hitRead: prediction as never },
    });
    return prediction;
  } catch (err) {
    app.log.warn({ err, songId }, 'A&R read failed (song still usable)');
    return null;
  }
}

/**
 * Score every rendered song of a drop once its music job lands. Detached: polls
 * the render jobs (they take 1-4 min), then reads each song. Never throws.
 */
export async function arReadAfterRender(
  app: FastifyInstance,
  workspaceId: string,
  items: Array<{ songId?: string; jobId?: string }>
): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await Promise.allSettled(
    items
      .filter((d) => d.songId && d.jobId)
      .map(async (d) => {
        for (let t = 0; t < 90; t++) {
          await sleep(10_000);
          const job = await prisma.providerJob.findUnique({ where: { id: d.jobId! }, select: { status: true } });
          if (!job || job.status === 'FAILED') return;
          if (job.status === 'SUCCEEDED') {
            await arReadSong(app, workspaceId, d.songId!);
            return;
          }
        }
      })
  );
}
