import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  ownedAudioRightsConfirmationSchema,
  type OwnedAudioRightsConfirmation,
} from '@afrohit/shared';
import { createQueuedProviderJob } from './queued-job';

const OWNED_AUDIO_RIGHTS_BASIS = 'user-attested' as const;

export function ownedRightsEvidence(confirmation: OwnedAudioRightsConfirmation) {
  return {
    schemaVersion: confirmation.version,
    confirmed: true as const,
    rightsBasis: OWNED_AUDIO_RIGHTS_BASIS,
  };
}

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
 * record has no beat row, so pass songId instead of beatId. Mode stays 'stems'
 * (the four-way split); the processor files only the NON-VOCAL stems as material.
 * This helper validates the versioned confirmation before deriving the internal
 * owned flag; Zap and preview URLs never enter this path.
 */
export async function enqueueHarvest(
  app: FastifyInstance,
  p: {
    workspaceId: string;
    projectId: string;
    beatId?: string;
    songId?: string;
    sourceUrl?: string;
    rightsConfirmation: OwnedAudioRightsConfirmation;
  },
): Promise<void> {
  const rightsConfirmation = ownedAudioRightsConfirmationSchema.parse(p.rightsConfirmation);
  const rightsEvidence = ownedRightsEvidence(rightsConfirmation);
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
      inputJson: {
        beatId: p.beatId,
        songId: p.songId,
        mode: 'stems',
        sourceUrl: p.sourceUrl,
        owned: true,
        harvest: true,
        rightsConfirmation: rightsEvidence,
      },
      idempotencyKey,
      payload: (jobId) => ({
        jobId,
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        beatId: p.beatId,
        songId: p.songId,
        mode: 'stems',
        sourceUrl: p.sourceUrl,
        owned: true,
        rightsConfirmation: rightsEvidence,
      }),
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
  p: {
    workspaceId: string;
    projectId: string;
    url: string;
    source: string;
    rightsConfirmation: OwnedAudioRightsConfirmation;
    idempotencyKey?: string;
    refTable?: string;
    refId?: string;
  },
): Promise<void> {
  const rightsConfirmation = ownedAudioRightsConfirmationSchema.parse(p.rightsConfirmation);
  const rightsEvidence = ownedRightsEvidence(rightsConfirmation);
  try {
    const idempotencyKey = p.idempotencyKey ?? harvestKey('owned-learn', [p.projectId, p.url]);
    const charge = await app.chargeCredits({
      workspaceId: p.workspaceId,
      key: 'analyze_audio',
      refTable: p.refTable ?? 'Project',
      refId: p.refId ?? p.projectId,
      idempotencyKey,
    });
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
      inputJson: {
        url: p.url,
        source: p.source,
        rightsBasis: OWNED_AUDIO_RIGHTS_BASIS,
        rightsConfirmation: rightsEvidence,
      },
      charge,
      idempotencyKey,
      payload: (jobId) => ({
        jobId,
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        url: p.url,
        source: p.source,
        rightsBasis: OWNED_AUDIO_RIGHTS_BASIS,
        rightsConfirmation: rightsEvidence,
      }),
    });
    app.log.info({ workspaceId: p.workspaceId, source: p.source }, '[learn] owned upload → analyze-audio queued');
  } catch (e) {
    app.log.warn({ source: p.source, err: (e as Error)?.message }, '[learn] enqueue failed (non-fatal)');
  }
}
