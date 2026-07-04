import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { voiceConsentInputSchema, voiceProfileInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';

export default async function voices(app: FastifyInstance) {
  app.get('/consents', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.voiceConsent.findMany({
      where: { workspaceId },
      orderBy: { signedAt: 'desc' },
    });
  });

  app.post(
    '/consents',
    { schema: { body: voiceConsentInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceConsentInputSchema.parse(req.body);
      const consent = await prisma.voiceConsent.create({
        data: {
          workspaceId,
          ...input,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
        },
      });
      reply.code(201);
      return consent;
    }
  );

  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.voiceProfile.findMany({
      where: { workspaceId },
      include: { artist: { select: { id: true, stageName: true } } },
    });
  });

  app.post(
    '/',
    { schema: { body: voiceProfileInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceProfileInputSchema.parse(req.body);

      // Verify consent exists, is in workspace, not revoked.
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: { id: input.consentId, workspaceId, revokedAt: null },
      });

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_profile_setup',
        refTable: 'VoiceConsent',
        refId: consent.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const profile = await prisma.voiceProfile.create({
        data: {
          workspaceId,
          artistId: input.artistId,
          consentId: consent.id,
          name: input.name,
          provider: process.env.VOICE_PROVIDER ?? 'stub',
          status: 'PENDING',
          sampleUrls: input.sampleUrls,
          language: input.language,
        },
      });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          kind: 'voice_profile',
          provider: profile.provider,
          status: 'QUEUED',
          inputJson: { voiceProfileId: profile.id, ...input } as never,
        },
      });

      await enqueue({
        queue: app.queues.voice,
        name: 'setup-voice-profile',
        payload: {
          jobId: job.id,
          workspaceId,
          voiceProfileId: profile.id,
          name: input.name,
          sampleUrls: input.sampleUrls,
          language: input.language,
          consentRecordingUrl: consent.consentAudioUrl ?? undefined,
        },
      });

      reply.code(202);
      return { profile, jobId: job.id };
    }
  );

  app.post<{ Params: { voiceId: string }; Body: { text: string } }>(
    '/:voiceId/test',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const voice = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: req.params.voiceId, workspaceId, status: 'READY' },
      });
      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          kind: 'voice',
          provider: voice.provider,
          status: 'QUEUED',
          inputJson: { test: true, text: req.body.text } as never,
        },
      });
      await enqueue({
        queue: app.queues.voice,
        name: 'render-vocal',
        payload: {
          jobId: job.id,
          workspaceId,
          voiceProfileId: voice.id,
          providerVoiceId: voice.providerVoiceId,
          lyricBody: req.body.text.slice(0, 1_000),
          role: 'lead',
        },
      });
      return { jobId: job.id };
    }
  );
}
