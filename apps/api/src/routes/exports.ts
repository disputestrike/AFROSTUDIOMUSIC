import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

const exportSchema = z.object({
  songId: z.string().cuid(),
});

export default async function exportsRoute(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.export.findMany({
      where: { project: { id: req.params.projectId, workspaceId } },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: exportSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { songId } = exportSchema.parse(req.body);

      const song = await prisma.song.findFirstOrThrow({
        where: { id: songId, workspaceId, projectId: req.params.projectId },
      });
      const receipt = await prisma.rightsReceipt.findFirst({
        where: { songId },
        orderBy: { createdAt: 'desc' },
      });
      if (!receipt) {
        return reply.code(412).send({ error: 'no_rights_receipt', hint: 'run /rights/check first' });
      }
      // Inspect the receipt VERDICT, not just its existence (audit DANGEROUS): a
      // 'not clear' rights review must block export, and the song must have passed
      // the green-light gate.
      const verdict = (receipt.prompts ?? {}) as { rightsCheck?: { okToExport?: boolean; overallRisk?: string } };
      if (verdict.rightsCheck && (verdict.rightsCheck.okToExport === false || verdict.rightsCheck.overallRisk === 'high')) {
        return reply.code(409).send({ error: 'rights_not_clear', hint: 'the rights review flagged this song — resolve the issues before exporting' });
      }
      if (!song.releaseReady) {
        return reply.code(409).send({ error: 'not_release_ready', hint: 'pass the green-light gate (/release/check) before exporting' });
      }

      const charge = await app.chargeCredits({ workspaceId, key: 'release_export', refTable: 'Song', refId: song.id });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId, projectId: song.projectId, kind: 'export',
          provider: 'internal', status: 'QUEUED', inputJson: { songId, receiptId: receipt.id } as never,
        },
      });
      await enqueue({
        queue: app.queues.export,
        name: 'export-release',
        payload: { jobId: job.id, workspaceId, projectId: song.projectId, songId, receiptId: receipt.id },
      });
      reply.code(202);
      return { jobId: job.id };
    }
  );
}
