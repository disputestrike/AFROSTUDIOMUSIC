import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { analyzeAudioSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { assertSafeUrl } from '../lib/url-guard';
import { assertWorkspaceAsset } from '../lib/storage';

/**
 * "Play a song and it listens." Queues an audio-understanding job (reuses the
 * music queue, name=analyze-audio). Poll /jobs/:id → outputJson.profile holds
 * BPM/key/genre/mood/energy/instruments + a suggested prompt to create a FRESH
 * original in that vibe (never a copy).
 */
export default async function analyze(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: analyzeAudioSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = analyzeAudioSchema.parse(req.body);
      const { url, purgeAfter, factsOnly } = input;
      const rightsBasis = factsOnly ? 'facts-only' : 'user-attested';
      const source = factsOnly ? 'external-reference-facts' : 'rights-confirmed-reference';
      const rightsConfirmation = factsOnly
        ? undefined
        : {
            schemaVersion: input.rightsConfirmation.version,
            confirmed: true as const,
            rightsBasis,
          };

      // Same bright-line + SSRF guard as /import: no streaming-catalog hosts,
      // no private/metadata targets. Full learning is rights-attested; the
      // separate facts-only path retains numbers and purges the supplied audio.
      if (!assertWorkspaceAsset(workspaceId, url)) {
        const chk = await assertSafeUrl(url);
        if (!chk.ok) return reply.code(chk.code).send({ error: chk.error, message: chk.message });
      }

      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      // Paid Replicate inference → subject to the daily cap like every other
      // generation path (was previously the one uncapped entry point).
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'analyze-audio');
      const charge = await app.chargeCredits({ workspaceId, key: 'analyze_audio', refTable: 'Project', refId: project.id, idempotencyKey });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.music,
        jobName: 'analyze-audio',
        workspaceId,
        projectId: project.id,
        kind: 'analyze',
        provider: 'replicate',
        inputJson: {
          url,
          factsOnly: !!factsOnly,
          source,
          rightsBasis,
          ...(rightsConfirmation ? { rightsConfirmation } : {}),
        },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: project.id,
          url,
          purgeAfter: factsOnly ? true : purgeAfter,
          factsOnly,
          source,
          rightsBasis,
          ...(rightsConfirmation ? { rightsConfirmation } : {}),
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, status: 'queued', replayed: job.replayed };
    }
  );
}
