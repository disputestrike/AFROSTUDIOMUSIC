import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { briefSchema } from '@afrohit/shared';
import { responsesJson } from '@afrohit/ai';
import { prompts } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';

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

  app.post<{ Params: { projectId: string }; Body: { rawIdea: string } }>(
    '/polish',
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'brief_polish',
        refTable: 'Project',
        refId: req.params.projectId,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const polished = await responsesJson<{
        mood: string;
        topic: string;
        language: string[];
        audience: string;
        bpm: number;
        references: Array<{ name: string; lane: string }>;
        notes: string;
      }>({
        system: prompts.BRIEF_POLISH_SYSTEM,
        user: JSON.stringify({ rawIdea: req.body.rawIdea }),
        temperature: 0.4,
      });

      const brief = await prisma.songBrief.create({
        data: {
          projectId: req.params.projectId,
          mood: polished.mood,
          topic: polished.topic,
          language: polished.language ?? [],
          audience: polished.audience,
          bpm: polished.bpm,
          references: polished.references ?? [],
          notes: polished.notes,
        },
      });
      reply.code(201);
      return { brief, polished };
    }
  );
}
