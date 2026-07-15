import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { briefSchema } from '@afrohit/shared';
import { generateJson } from '@afrohit/ai';
import { prompts } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { scopedRequestKey } from '../lib/queued-job';
import { operationErrorBody, runIdempotentOperation } from '../lib/idempotent-operation';

export default async function briefs(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: briefSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });
      const body = briefSchema.parse(req.body);
      const brief = await prisma.songBrief.create({
        data: { projectId: project.id, ...body },
      });
      reply.code(201);
      return brief;
    }
  );

  const polishSchema = z.object({ rawIdea: z.string().min(1).max(2000) });
  app.post<{ Params: { projectId: string } }>(
    '/polish',
    { schema: { body: polishSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { rawIdea } = polishSchema.parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        select: { id: true },
      });
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, `brief-polish:${project.id}`);
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'brief_polish',
        refTable: 'Project',
        refId: project.id,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const operation = await runIdempotentOperation({
        workspaceId,
        projectId: project.id,
        kind: 'brief-polish',
        provider: 'text',
        idempotencyKey,
        chargeLedgerId: charge.chargeId,
        inputJson: { projectId: project.id, rawIdea },
        execute: async () => {
          try {
            const polished = await generateJson<{
              mood: string;
              topic: string;
              language: string[];
              audience: string;
              bpm: number;
              references: Array<{ name: string; lane: string }>;
              notes: string;
            }>({
              tier: 'bulk',
              task: 'brief-polish',
              system: prompts.BRIEF_POLISH_SYSTEM,
              user: JSON.stringify({ rawIdea }),
              temperature: 0.4,
            });

            const brief = await prisma.songBrief.create({
              data: {
                projectId: project.id,
                mood: polished.mood,
                topic: polished.topic,
                language: polished.language ?? [],
                audience: polished.audience,
                bpm: polished.bpm,
                references: polished.references ?? [],
                notes: polished.notes,
              },
            });
            return { statusCode: 201, body: { brief, polished } };
          } catch (error) {
            await app.refundCredits({
              workspaceId,
              key: 'brief_polish',
              refTable: 'Project',
              refId: project.id,
              chargeId: charge.chargeId,
            });
            throw error;
          }
        },
      });
      if (operation.state !== 'completed') {
        const failure = operationErrorBody(operation);
        return reply.code(failure.statusCode).send(failure.body);
      }
      return reply.code(operation.value.statusCode).send(operation.value.body);
    }
  );
}
