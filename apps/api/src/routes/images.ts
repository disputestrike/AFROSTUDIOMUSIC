import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { generateCoverArtInputSchema } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { presignAssetRef } from '../lib/storage';

export default async function images(app: FastifyInstance) {
  app.post(
    '/cover-art',
    { schema: { body: generateCoverArtInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = generateCoverArtInputSchema.parse(req.body);
      await prisma.project.findFirstOrThrow({ where: { id: input.projectId, workspaceId } });
      if (input.brandKitId) {
        await prisma.brandKit.findFirstOrThrow({ where: { id: input.brandKitId, workspaceId } });
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'cover-art');
      const charge = await app.chargeCredits({
        workspaceId,
        key: input.quality === 'high' ? 'cover_art_high' : 'cover_art_low',
        refTable: 'Project',
        refId: input.projectId,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.image,
        jobName: 'generate-image',
        workspaceId,
        projectId: input.projectId,
        kind: 'image',
        provider: process.env.IMAGE_PROVIDER ?? 'openai',
        inputJson: input,
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: input.projectId,
          brandKitId: input.brandKitId,
          prompt: input.prompt,
          size: input.size,
          quality: input.quality,
          kind: 'cover',
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { schema: { body: z.object({ approved: z.boolean() }) } },
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ['OWNER', 'ADMIN']);
      const input = z.object({ approved: z.boolean() }).parse(req.body);
      const image = await prisma.imageAsset.findFirst({
        where: { id: req.params.id, project: { workspaceId } },
      });
      if (!image) return reply.code(404).send({ error: 'image_not_found' });
      if (input.approved && (
        image.qualityState !== 'passed'
        || !image.contentHash
        || !image.verifiedAt
        || (image.kind === 'cover' && (image.width !== image.height || Number(image.width ?? 0) < 1000))
      )) {
        return reply.code(409).send({
          error: 'image_not_certified',
          message: 'Only a decoded, hashed, QC-passed square cover can be approved.',
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (input.approved && image.kind === 'cover' && image.projectId) {
          await tx.imageAsset.updateMany({
            where: { projectId: image.projectId, kind: 'cover', id: { not: image.id } },
            data: { approved: false },
          });
        }
        const row = await tx.imageAsset.update({
          where: { id: image.id },
          data: { approved: input.approved },
        });
        if (image.projectId) {
          await tx.song.updateMany({
            where: { projectId: image.projectId, workspaceId },
            data: { releaseReady: false },
          });
        }
        return row;
      });
      return {
        image: {
          id: updated.id,
          kind: updated.kind,
          width: updated.width,
          height: updated.height,
          approved: updated.approved,
          qualityState: updated.qualityState,
          contentHash: updated.contentHash,
          playbackUrl: await presignAssetRef(updated.url, 900),
        },
      };
    },
  );
}
