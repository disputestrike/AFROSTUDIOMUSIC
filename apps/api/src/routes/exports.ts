import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadReleaseCertification, prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { presignAssetRef } from '../lib/storage';
import { BLOW_TARGET } from '../lib/will-it-blow';

const exportSchema = z.object({ songId: z.string().cuid() });

type ExportListRow = {
  id: string;
  songId: string;
  qualityState: string;
  contentHash: string | null;
  sourceFingerprint: string | null;
  sizeBytes: number | null;
  receiptId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  bundle: unknown;
};

export default async function exportsRoute(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const rows = await prisma.export.findMany({
      where: { project: { id: req.params.projectId, workspaceId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        songId: true,
        qualityState: true,
        contentHash: true,
        sourceFingerprint: true,
        sizeBytes: true,
        receiptId: true,
        verifiedAt: true,
        createdAt: true,
        bundle: true,
      },
    });
    return rows.map((row: ExportListRow) => ({
      id: row.id,
      songId: row.songId,
      qualityState: row.qualityState,
      contentHash: row.contentHash,
      sourceFingerprint: row.sourceFingerprint,
      sizeBytes: row.sizeBytes,
      receiptId: row.receiptId,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
      bundle: row.bundle,
      downloadPath: row.qualityState === 'ready'
        ? '/projects/' + req.params.projectId + '/exports/' + row.id + '/download'
        : null,
    }));
  });

  app.get<{ Params: { projectId: string; exportId: string } }>(
    '/:exportId/download',
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const releaseExport = await prisma.export.findFirst({
        where: {
          id: req.params.exportId,
          projectId: req.params.projectId,
          project: { workspaceId },
          qualityState: 'ready',
          archiveUrl: { not: null },
          contentHash: { not: null },
          verifiedAt: { not: null },
        },
      });
      if (!releaseExport?.archiveUrl) {
        return reply.code(404).send({ error: 'release_package_not_found' });
      }
      const url = await presignAssetRef(releaseExport.archiveUrl, 120);
      return reply.redirect(url);
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: exportSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = exportSchema.parse(req.body);
      const certification = await loadReleaseCertification(prisma, {
        workspaceId,
        projectId: req.params.projectId,
        songId: input.songId,
        hitTarget: BLOW_TARGET,
      });
      if (!certification.readiness.ready || !certification.rightsReceipt) {
        return reply.code(409).send({
          error: 'not_release_ready',
          checks: certification.readiness.checks,
        });
      }

      const requestKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        'release-export',
      );
      const idempotencyKey = requestKey
        ? requestKey + ':' + certification.artifactFingerprint.slice(0, 16)
        : undefined;
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'release_export',
        refTable: 'Song',
        refId: certification.song.id,
        idempotencyKey,
      });
      if (!charge.ok) {
        return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      }

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.export,
        jobName: 'export-release',
        workspaceId,
        projectId: certification.song.projectId,
        kind: 'export',
        provider: 'internal',
        inputJson: {
          songId: certification.song.id,
          receiptId: certification.rightsReceipt.id,
          artifactFingerprint: certification.artifactFingerprint,
        },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: certification.song.projectId,
          songId: certification.song.id,
          receiptId: certification.rightsReceipt!.id,
        }),
      });
      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        artifactFingerprint: certification.artifactFingerprint,
      };
    },
  );
}
