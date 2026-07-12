import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { voiceConsentInputSchema, voiceProfileInputSchema, voiceTrainInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { publicUrlFor } from '../lib/storage';
import { voiceTrainerConfig, startVoiceTraining, getVoiceTraining } from '../lib/voice-training';

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
      // Verify the artist is in THIS workspace too — never attach a voice profile
      // (and its future renders) to another workspace's Artist id.
      await prisma.artist.findFirstOrThrow({ where: { id: input.artistId, workspaceId } });

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

  /**
   * OWN-VOICE TRAINING kickoff. The artist trains a singing model on HIS OWN
   * recordings via Replicate's trainings API — weights land in HIS Replicate
   * account (destination model; keep it private). Consent-gated like every
   * voice path. Trainer is operator config (VOICE_TRAINER_MODEL/VERSION);
   * unset → honest 501, same seam pattern as lib/distribution.ts.
   */
  app.post(
    '/train',
    { schema: { body: voiceTrainInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceTrainInputSchema.parse(req.body);

      const cfg = voiceTrainerConfig();
      if (!cfg) {
        return reply.code(501).send({
          error: 'voice_training_not_configured',
          note:
            'Own-voice training needs an operator-pinned Replicate trainer. Pick an RVC-family voice trainer on Replicate, then set VOICE_TRAINER_MODEL ("owner/name") + VOICE_TRAINER_VERSION (version hash); optionally VOICE_TRAINER_DATASET_KEY (default "dataset_zip"), VOICE_TRAINER_EXTRA_INPUT (JSON), and VOICE_TRAINER_DESTINATION ("user/model" in YOUR Replicate account, where the trained weights land).',
        });
      }

      // Destination = an existing/creatable "user/model" path in the ARTIST's
      // Replicate account. Never invented: body param or env, else 400.
      const destination = input.destination ?? process.env.VOICE_TRAINER_DESTINATION?.trim();
      if (!destination) {
        return reply.code(400).send({
          error: 'destination_required',
          note: 'Pass destination ("user/model" in your Replicate account) or set VOICE_TRAINER_DESTINATION. The trained weights land in that model — keep it private.',
        });
      }

      // Consent gate + workspace ownership (consent, artist both scoped here).
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: { id: input.consentId, workspaceId, revokedAt: null },
      });
      await prisma.artist.findFirstOrThrow({ where: { id: input.artistId, workspaceId } });

      // Dataset provenance: owned-storage URLs are verifiable; an external URL
      // is still allowed (his own hosting is legitimate) but recorded honestly.
      const ownedPrefix = publicUrlFor(`${workspaceId}/`);
      const externalDataset = !input.datasetZipUrl.startsWith(ownedPrefix);

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_clone_training',
        refTable: 'VoiceConsent',
        refId: consent.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      // Workspace-pasted Replicate key (Settings → Music engine) overrides env.
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { musicApiKey: true },
      });

      let training;
      try {
        training = await startVoiceTraining({
          datasetZipUrl: input.datasetZipUrl,
          destination,
          apiKey: ws?.musicApiKey ?? undefined,
        });
      } catch (err) {
        // Kickoff never happened — the charge must not stand.
        await app.refundCredits({ workspaceId, key: 'voice_clone_training', refTable: 'VoiceConsent', refId: consent.id });
        const e = err as Error & { statusCode?: number };
        return reply.code(e.statusCode ?? 502).send({ error: 'voice_training_start_failed', note: e.message });
      }

      const profile = await prisma.voiceProfile.create({
        data: {
          workspaceId,
          artistId: input.artistId,
          consentId: consent.id,
          name: input.name,
          provider: 'replicate',
          status: 'TRAINING',
          sampleUrls: [input.datasetZipUrl],
          trainingId: training.id,
          destinationModel: destination,
          trainingMeta: {
            datasetZipUrl: input.datasetZipUrl,
            trainer: `${cfg.model}@${cfg.version}`,
            at: new Date().toISOString(),
            ...(externalDataset ? { externalDataset: true } : {}),
          } as never,
        },
      });

      reply.code(202);
      return {
        profile,
        trainingId: training.id,
        trainingStatus: training.status,
        note: 'Training started. Poll GET /voices/:id/training — succeeded flips the profile to READY.',
      };
    }
  );

  /**
   * Poll the training run and sync the profile to its honest state:
   * succeeded → READY (+trainedVersion), failed/canceled → FAILED (+error).
   */
  app.get<{ Params: { voiceId: string } }>('/:voiceId/training', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const profile = await prisma.voiceProfile.findFirstOrThrow({
      where: { id: req.params.voiceId, workspaceId },
    });
    if (!profile.trainingId) {
      return reply.code(404).send({ error: 'no_training', note: 'This voice profile was not created via POST /voices/train.' });
    }

    // Terminal states are already synced — answer from the row, no re-poll.
    if (profile.status === 'READY' || profile.status === 'FAILED') {
      return {
        profileId: profile.id,
        status: profile.status,
        trainingId: profile.trainingId,
        destinationModel: profile.destinationModel,
        trainedVersion: profile.trainedVersion,
        meta: profile.trainingMeta,
      };
    }

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { musicApiKey: true },
    });
    const state = await getVoiceTraining(profile.trainingId, ws?.musicApiKey ?? undefined);
    const meta = (profile.trainingMeta ?? {}) as Record<string, unknown>;

    if (state.status === 'succeeded') {
      // Output shape varies by trainer — store the raw output and pull the most
      // plausible version identifier without inventing one (null if absent).
      const out = state.output as Record<string, unknown> | string | null;
      const trainedVersion =
        typeof out === 'string'
          ? out
          : out && typeof out === 'object'
            ? String((out.version ?? out.weights ?? out.model ?? '') || '') || null
            : null;
      const updated = await prisma.voiceProfile.update({
        where: { id: profile.id },
        data: {
          status: 'READY',
          trainedVersion,
          trainingMeta: { ...meta, output: state.output ?? null, finishedAt: new Date().toISOString() } as never,
        },
      });
      return {
        profileId: updated.id,
        status: updated.status,
        trainingId: updated.trainingId,
        destinationModel: updated.destinationModel,
        trainedVersion: updated.trainedVersion,
        meta: updated.trainingMeta,
      };
    }

    if (state.status === 'failed' || state.status === 'canceled') {
      const updated = await prisma.voiceProfile.update({
        where: { id: profile.id },
        data: {
          status: 'FAILED',
          trainingMeta: { ...meta, error: state.error ?? state.status, finishedAt: new Date().toISOString() } as never,
        },
      });
      return {
        profileId: updated.id,
        status: updated.status,
        trainingId: updated.trainingId,
        destinationModel: updated.destinationModel,
        trainedVersion: null,
        meta: updated.trainingMeta,
      };
    }

    // starting / processing — still in flight.
    return {
      profileId: profile.id,
      status: profile.status,
      trainingId: profile.trainingId,
      destinationModel: profile.destinationModel,
      trainedVersion: null,
      replicateStatus: state.status,
      meta: profile.trainingMeta,
    };
  });

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
