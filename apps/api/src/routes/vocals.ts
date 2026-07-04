import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { renderVocalInputSchema } from '@afrohit/shared';
import { prompts, responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

export default async function vocals(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/render',
    { schema: { body: renderVocalInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVocalInputSchema.omit({ projectId: true }).parse(req.body);

      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
        include: { artist: true },
      });
      const voice = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: input.voiceProfileId, workspaceId, status: 'READY' },
      });
      const lyric = await prisma.lyricDraft.findFirstOrThrow({
        where: { id: input.lyricId, projectId: project.id, approved: true },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_render_full',
        refTable: 'Lyric',
        refId: lyric.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      // A sung vocal needs a melody. Generate one on first render and persist
      // it on the lyric so re-renders (doubles, harmonies) reuse the same spec.
      let melody = lyric.melody as Record<string, unknown> | null;
      if (!melody) {
        melody = await responsesJson<Record<string, unknown>>({
          system: prompts.MELODY_SYSTEM,
          user: prompts.melodyUserPrompt({
            lyricBody: lyric.body,
            bpm: project.bpm,
            keySignature: project.keySignature,
            vocalRangeLow: project.artist.vocalRangeLow,
            vocalRangeHigh: project.artist.vocalRangeHigh,
            laneSummary: project.artist.laneSummary,
          }),
          temperature: 0.6,
          maxOutputTokens: 4_000,
        });
        await prisma.lyricDraft.update({
          where: { id: lyric.id },
          data: { melody: melody as never },
        });
      }

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          projectId: project.id,
          kind: 'voice',
          provider: voice.provider,
          status: 'QUEUED',
          inputJson: input as never,
        },
      });

      await enqueue({
        queue: app.queues.voice,
        name: 'render-vocal',
        payload: {
          jobId: job.id,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          voiceProfileId: voice.id,
          providerVoiceId: voice.providerVoiceId,
          lyricBody: lyric.cleanVersion ?? lyric.body,
          melody,
          role: input.role,
          pitchCorrection: input.pitchCorrection,
          effects: input.effects,
        },
      });

      reply.code(202);
      return { jobId: job.id, status: 'queued', melodyGenerated: !lyric.melody };
    }
  );
}
