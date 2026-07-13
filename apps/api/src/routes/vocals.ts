import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { renderVocalInputSchema, attachVocalUploadSchema } from '@afrohit/shared';
import { prompts, responsesJson } from '@afrohit/ai';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { publicUrlFor, verifyUploadedAudio } from '../lib/storage';

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
      const song = await prisma.song.findFirstOrThrow({
        where: { id: input.songId, projectId: project.id, workspaceId },
        select: { id: true },
      });

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

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'vocal-render');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_render_full',
        refTable: 'Lyric',
        refId: lyric.id,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: 'render-vocal',
        workspaceId,
        projectId: project.id,
        kind: 'voice',
        provider: voice.provider,
        inputJson: input,
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          projectId: project.id,
          songId: song.id,
          voiceProfileId: voice.id,
          providerVoiceId: voice.providerVoiceId,
          lyricBody: lyric.cleanVersion ?? lyric.body,
          melody,
          role: input.role,
          pitchCorrection: input.pitchCorrection,
          effects: input.effects,
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, status: 'queued', replayed: job.replayed, melodyGenerated: !lyric.melody };
    }
  );

  // Bring your own vocal. The artist records/uploads their real performance —
  // stored as-is, auto-approved, and mixed verbatim. No cloning, no synthesis.
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

      // Bind to a song so the mix picks this vocal up (mix reads the latest
      // approved lead vocal for the song).
      const requestedSong = input.songId
        ? await prisma.song.findFirstOrThrow({
            where: { id: input.songId, projectId: project.id, workspaceId },
            select: { id: true },
          })
        : null;
      const songId =
        requestedSong?.id ??
        (
          await prisma.song.findFirst({
            where: { projectId: project.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        )?.id ??
        (
          await prisma.song.create({
            data: {
              workspaceId,
              projectId: project.id,
              title: `${project.title} — recording`,
              status: 'SKETCH',
            },
            select: { id: true },
          })
        ).id;

      const vocal = await prisma.vocalRender.create({
        data: {
          projectId: project.id,
          songId,
          role: input.role,
          url: publicUrlFor(uploaded.key),
          duration: input.durationS ?? null,
          language: input.language ?? null,
          approved: true, // the artist's own performance is authentic — auto-approved
          meta: { uploaded: true, source: 'artist_recording' },
        },
      });

      reply.code(201);
      return { ...vocal, songId };
    }
  );
}
