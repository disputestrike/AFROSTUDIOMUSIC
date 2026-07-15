import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { attachVocalUploadSchema, renderVocalInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { publicUrlFor, verifyUploadedAudio } from '../lib/storage';
import { registerVocalForInspection } from '../lib/vocal-ingest';

export default async function vocals(app: FastifyInstance) {
  // Kept as an explicit compatibility response instead of silently routing text
  // through TTS. TTS is spoken audio, not a score-driven sung performance.
  app.post<{ Params: { projectId: string } }>(
    '/render',
    { schema: { body: renderVocalInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = renderVocalInputSchema.omit({ projectId: true }).parse(req.body);
      await prisma.project.findFirstOrThrow({ where: { id: req.params.projectId, workspaceId } });
      await prisma.voiceProfile.findFirstOrThrow({
        where: { id: input.voiceProfileId, workspaceId, status: 'READY' },
      });
      await prisma.lyricDraft.findFirstOrThrow({
        where: { id: input.lyricId, projectId: req.params.projectId, approved: true },
      });
      if (input.songId) {
        await prisma.song.findFirstOrThrow({
          where: { id: input.songId, projectId: req.params.projectId, workspaceId },
        });
      }
      return reply.code(409).send({
        error: 'performance_source_required',
        note: 'Text-to-speech is not singing and is no longer filed as a vocal. Render a full song with vocals, upload or record an isolated performance, or use POST /voices/:voiceId/sing to convert an existing sung performance into the trained voice.',
      });
    },
  );

  // Bring your own isolated vocal. The row remains pending until the worker has
  // decoded, measured, hashed, and certified the actual audio.
  app.post<{ Params: { projectId: string } }>(
    '/upload',
    { schema: { body: attachVocalUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = attachVocalUploadSchema.parse(req.body);
      const uploaded = await verifyUploadedAudio(workspaceId, input.key);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

      const requestedSong = input.songId
        ? await prisma.song.findFirstOrThrow({
            where: { id: input.songId, projectId: project.id, workspaceId },
            select: { id: true },
          })
        : null;
      const songId = requestedSong?.id
        ?? (await prisma.song.findFirst({
          where: { projectId: project.id, workspaceId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        }))?.id
        ?? (await prisma.song.create({
          data: {
            workspaceId,
            projectId: project.id,
            title: `${project.title} - recording`,
            status: 'SKETCH',
          },
          select: { id: true },
        })).id;

      const { vocal, job } = await registerVocalForInspection({
        app,
        workspaceId,
        projectId: project.id,
        songId,
        role: input.role,
        url: publicUrlFor(uploaded.key),
        source: 'artist_upload',
        language: input.language,
        claimedDurationS: input.durationS,
        sourceMeta: { uploaded: true, source: 'artist_recording' },
      });

      reply.code(202);
      return {
        vocal,
        songId,
        jobId: job.jobId,
        replayed: job.replayed,
        qualityState: 'pending',
      };
    },
  );
}
