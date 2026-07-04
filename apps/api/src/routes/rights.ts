import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { rightsCheckInputSchema } from '@afrohit/shared';
import { canonicalReceiptHash, runRightsCheck } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';

export default async function rights(app: FastifyInstance) {
  /**
   * Runs a rights/similarity scan AND stamps a tamper-evident RightsReceipt.
   * No song can be exported as final without a successful receipt with
   * okToExport == true.
   */
  app.post(
    '/check',
    { schema: { body: rightsCheckInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { projectId, songId } = rightsCheckInputSchema.parse(req.body);

      const song = await prisma.song.findFirstOrThrow({
        where: { id: songId, workspaceId, projectId },
        include: {
          project: { include: { artist: true, briefs: { take: 1, orderBy: { createdAt: 'desc' } } } },
          lyric: true,
          mixes: { take: 1, where: { approved: true } },
        },
      });
      const hook = await prisma.hookCandidate.findFirst({
        where: { songId, approved: true },
      });

      const check = await runRightsCheck({
        lyricBody: song.lyric?.body,
        hookText: hook?.text,
        references: song.project.artist.references as never,
        producerNotes: song.project.briefs[0]?.notes ?? undefined,
      });

      const approvals = await prisma.approval.findMany({
        where: { projectId, decision: 'approved' },
      });

      const receiptCore = {
        workspaceId,
        projectId,
        songId,
        rightsCheck: check,
        approvals: approvals.map((a) => ({ id: a.id, gate: a.gate, decision: a.decision })),
        artistReferences: song.project.artist.references,
        timestamp: new Date().toISOString(),
      };
      const hash = await canonicalReceiptHash(receiptCore as never);

      const receipt = await prisma.rightsReceipt.create({
        data: {
          workspaceId,
          projectId,
          songId,
          providers: [],
          prompts: { rightsCheck: receiptCore.rightsCheck } as never,
          approvals: receiptCore.approvals as never,
          aiDisclosure: {
            distroDisclosure: 'GenAI-assisted, human-edited',
            credits: { lyrics: 'AI-assisted, human-edited', production: 'AI-assisted', vocals: 'cloned-with-consent' },
          },
          hash,
        },
      });

      return { receipt, check };
    }
  );
}
