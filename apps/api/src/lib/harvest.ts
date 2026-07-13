import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createQueuedProviderJob } from './queued-job';

function harvestKey(prefix: string, parts: Array<string | undefined>): string {
  return `${prefix}:${createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24)}`;
}

/**
 * AUTO-HARVEST (audit PARTIAL → REAL): turn an OWNED beat/instrumental the artist
 * just uploaded or imported into reusable role loops. Enqueues a stem-separation
 * job whose processor (processStems) splits the audio into drums/bass/other and
 * files each as a MaterialAsset (source 'artist_stem'), so the artist's real
 * sounds become material the owned engine can assemble — instead of just sitting
 * in the catalog. Best-effort: never blocks the upload response.
 *
 * FINISHED SONGS too (audit: the mixes /upload bridge harvested nothing): a full
 * record has no beat row — pass songId + owned:true instead of beatId. Mode stays
 * 'stems' (the four-way split); the processor files only the NON-VOCAL stems as
 * material and, with no beat to attach Stem rows to, skips those. `owned` is the
 * provenance the route vouches for (upload/import routes are owned-audio by
 * definition — this is NEVER set for Zap/preview URLs).
 */
export async function enqueueHarvest(
  app: FastifyInstance,
  p: { workspaceId: string; projectId: string; beatId?: string; songId?: string; sourceUrl?: string; owned?: boolean },
): Promise<void> {
  try {
    if (!p.beatId && !p.songId && !p.sourceUrl) throw new Error('harvest needs an owned source');
    const idempotencyKey = harvestKey('owned-harvest', [p.projectId, p.beatId, p.songId, p.sourceUrl]);
    await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'stems',
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      kind: 'stems',
      provider: 'replicate',
      inputJson: { beatId: p.beatId, songId: p.songId, mode: 'stems', sourceUrl: p.sourceUrl, owned: p.owned, harvest: true },
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId: p.workspaceId, projectId: p.projectId, beatId: p.beatId, songId: p.songId, mode: 'stems', sourceUrl: p.sourceUrl, owned: p.owned }),
    });
    app.log.info({ beatId: p.beatId, songId: p.songId, workspaceId: p.workspaceId }, '[harvest] owned upload → stem harvest queued');
  } catch (e) {
    app.log.warn({ beatId: p.beatId, songId: p.songId, err: (e as Error)?.message }, '[harvest] enqueue failed (non-fatal)');
  }
}

/**
 * AUTO-LEARN (audit: uploads were collected but never learned): every OWNED
 * upload/import also joins the learned lake — the exact analyze-audio job the
 * Listen flow runs (the processor reads the PROJECT'S GENRE as the hint, which
 * is why projectId rides along). Charged like every analyze (engine credit is
 * real money): a failed charge skips the learn with a log line and the queued
 * job fails honestly if the engine is down — no fake success, and the upload
 * response itself is never blocked. Owned audio only — never Zap/preview URLs.
 */
export async function enqueueLearn(
  app: FastifyInstance,
  p: { workspaceId: string; projectId: string; url: string; source: string },
): Promise<void> {
  try {
    const idempotencyKey = harvestKey('owned-learn', [p.projectId, p.url]);
    const charge = await app.chargeCredits({ workspaceId: p.workspaceId, key: 'analyze_audio', refTable: 'Project', refId: p.projectId, idempotencyKey });
    if (!charge.ok) {
      app.log.warn({ workspaceId: p.workspaceId, source: p.source }, '[learn] analyze charge refused (insufficient credits) — owned upload NOT learned');
      return;
    }
    await createQueuedProviderJob({
      app,
      queue: app.queues.music,
      jobName: 'analyze-audio',
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      kind: 'analyze',
      provider: 'replicate',
      inputJson: { url: p.url, source: p.source },
      charge,
      idempotencyKey,
      payload: (jobId) => ({ jobId, workspaceId: p.workspaceId, projectId: p.projectId, url: p.url }),
    });
    app.log.info({ workspaceId: p.workspaceId, source: p.source }, '[learn] owned upload → analyze-audio queued');
  } catch (e) {
    app.log.warn({ source: p.source, err: (e as Error)?.message }, '[learn] enqueue failed (non-fatal)');
  }
}
