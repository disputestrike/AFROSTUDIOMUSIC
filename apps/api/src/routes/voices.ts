import type { FastifyInstance } from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { openSecret, prisma } from '@afrohit/db';
import { isStorageUri, parseStorageUri, VOICE_CONSENT_TEXT, VOICE_CONSENT_VERSION, voiceConsentInputSchema, voiceDatasetInputSchema, voiceProfileInputSchema, voiceSingInputSchema, voiceTrainInputSchema } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { assertWorkspaceAsset, deleteAssetRef, presignAssetRef } from '../lib/storage';
import { assertSafeUrl } from '../lib/url-guard';
import {
  cancelVoiceTraining,
  deleteVoiceModelVersion,
  getVoiceTraining,
  startVoiceTraining,
  voiceTrainerConfig,
  type VoiceTrainerConfig,
} from '../lib/voice-training';

/**
 * The usable TRAINED MODEL FILE URL for a READY voice profile, read defensively:
 * the default trainer (replicate/train-rvc-model) is a PREDICTION whose output
 * is the model-file URL — the training poll stored it on trainedVersion (string
 * output) and verbatim on trainingMeta.output. Destination-based trainers store
 * a version hash instead (no downloadable file) → null, and /sing says so
 * honestly rather than passing a non-URL to the conversion engine.
 */
function trainedModelUrl(profile: { trainedVersion: string | null; trainingMeta: unknown }): string | null {
  const isUrl = (v: unknown): v is string => typeof v === 'string' && (/^https?:\/\//i.test(v) || isStorageUri(v));
  if (isUrl(profile.trainedVersion)) return profile.trainedVersion;
  const out = (profile.trainingMeta as Record<string, unknown> | null)?.output;
  if (isUrl(out)) return out;
  if (Array.isArray(out)) {
    for (let i = out.length - 1; i >= 0; i--) if (isUrl(out[i])) return out[i] as string;
  }
  if (out && typeof out === 'object') {
    for (const k of ['weights', 'model', 'url', 'version']) {
      const v = (out as Record<string, unknown>)[k];
      if (isUrl(v)) return v;
    }
  }
  return null;
}

function collectOwnedVoiceRefs(value: unknown, refs = new Set<string>(), depth = 0): Set<string> {
  if (depth > 4 || value == null) return refs;
  if (typeof value === 'string') {
    if (isStorageUri(value)) refs.add(value);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectOwnedVoiceRefs(item, refs, depth + 1);
    return refs;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectOwnedVoiceRefs(item, refs, depth + 1);
    }
  }
  return refs;
}

async function queueVoiceRehost(app: FastifyInstance, workspaceId: string, voiceProfileId: string, modelUrl: string) {
  const fingerprint = createHash('sha256').update(modelUrl).digest('hex').slice(0, 20);
  return createQueuedProviderJob({
    app,
    queue: app.queues.voice,
    jobName: 'rehost-voice-model',
    workspaceId,
    kind: 'voice-rehost',
    provider: 'internal',
    inputJson: { voiceProfileId, fingerprint },
    idempotencyKey: `voice-rehost:${voiceProfileId}:${fingerprint}`,
    payload: (jobId) => ({ jobId, workspaceId, voiceProfileId, modelUrl }),
  });
}

async function deleteHostedVoice(provider: string, providerVoiceId: string | null): Promise<boolean> {
  if (!providerVoiceId || provider === 'stub') return true;
  if (provider !== 'eleven' || !/^[a-zA-Z0-9_-]{6,128}$/.test(providerVoiceId)) return false;
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_API_KEY;
  if (!key) return false;
  const response = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(providerVoiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok || response.status === 404;
}

export default async function voices(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    requireRole(req, ['OWNER', 'ADMIN']);
  });

  app.get('/consent-terms', async () => ({
    version: VOICE_CONSENT_VERSION,
    text: VOICE_CONSENT_TEXT,
  }));

  app.get('/consents', async (req) => {
    const { workspaceId } = requireAuth(req);
    return prisma.voiceConsent.findMany({
      where: { workspaceId },
      orderBy: { signedAt: 'desc' },
      select: { id: true, legalName: true, email: true, signedAt: true, revokedAt: true },
    });
  });

  app.post(
    '/consents',
    { schema: { body: voiceConsentInputSchema } },
    async (req, reply) => {
      const { userId, workspaceId } = requireAuth(req);
      const input = voiceConsentInputSchema.parse(req.body);
      await prisma.artist.findFirstOrThrow({ where: { id: input.artistId, workspaceId } });
      if (input.signatureUrl) assertWorkspaceAsset(workspaceId, input.signatureUrl);
      if (input.consentAudioUrl && !assertWorkspaceAsset(workspaceId, input.consentAudioUrl)) {
        return reply.code(400).send({ error: 'owned_consent_audio_required' });
      }
      const consent = await prisma.voiceConsent.create({
        data: {
          workspaceId,
          artistId: input.artistId,
          signerUserId: userId,
          legalName: input.legalName,
          email: input.email.toLowerCase(),
          consentText: VOICE_CONSENT_TEXT,
          consentVersion: VOICE_CONSENT_VERSION,
          consentTextHash: createHash('sha256').update(VOICE_CONSENT_TEXT).digest('hex'),
          signatureUrl: input.signatureUrl,
          consentAudioUrl: input.consentAudioUrl,
          ipHash: createHmac(
            'sha256',
            process.env.IP_HASH_SECRET || process.env.JWT_SECRET || process.env.INTERNAL_API_SECRET || 'local-development-only',
          ).update(req.ip).digest('hex'),
          ipAddress: null,
          userAgent: req.headers['user-agent']?.slice(0, 240) ?? null,
        },
      });
      reply.code(201);
      return {
        id: consent.id,
        legalName: consent.legalName,
        email: consent.email,
        consentVersion: consent.consentVersion,
        signedAt: consent.signedAt,
        revokedAt: consent.revokedAt,
      };
    }
  );

  app.get('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const profiles = await prisma.voiceProfile.findMany({
      where: { workspaceId },
      select: {
        id: true,
        artistId: true,
        consentId: true,
        name: true,
        provider: true,
        status: true,
        language: true,
        createdAt: true,
        providerVoiceId: true,
        trainedVersion: true,
        trainingMeta: true,
        artist: { select: { id: true, stageName: true } },
      },
    });
    type VoiceListRow = {
      id: string;
      artistId: string;
      consentId: string;
      name: string;
      provider: string;
      status: string;
      language: string | null;
      createdAt: Date;
      providerVoiceId: string | null;
      trainedVersion: string | null;
      trainingMeta: unknown;
      artist: { id: string; stageName: string };
    };
    return (profiles as VoiceListRow[]).map(({ providerVoiceId, trainedVersion, trainingMeta, ...profile }) => ({
      ...profile,
      capabilities: {
        speechPreview: profile.provider === 'eleven' && !!providerVoiceId,
        singingConversion: !!trainedModelUrl({ trainedVersion, trainingMeta }),
        scoreSinging: false,
      },
    }));
  });

  app.post(
    '/',
    { schema: { body: voiceProfileInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceProfileInputSchema.parse(req.body);
      const setupProvider = (process.env.VOICE_PROVIDER
        ?? ((process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY) ? 'eleven' : '')).toLowerCase();
      const developmentStub = setupProvider === 'stub'
        && process.env.NODE_ENV !== 'production'
        && process.env.ALLOW_STUB_AUDIO === '1';
      if (setupProvider !== 'eleven' && !developmentStub) {
        return reply.code(501).send({
          error: 'speech_voice_provider_not_configured',
          note: 'This endpoint creates a speech preview voice. Configure VOICE_PROVIDER=eleven and an ElevenLabs key, or use /voices/train for an RVC singing-conversion voice.',
        });
      }

      // Verify consent exists, is in workspace, not revoked.
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: { id: input.consentId, workspaceId, artistId: input.artistId, revokedAt: null },
      });
      // Verify the artist is in THIS workspace too — never attach a voice profile
      // (and its future renders) to another workspace's Artist id.
      await prisma.artist.findFirstOrThrow({ where: { id: input.artistId, workspaceId } });
      for (const sampleUrl of input.sampleUrls) {
        if (!assertWorkspaceAsset(workspaceId, sampleUrl)) {
          return reply.code(400).send({ error: 'owned_voice_sample_required' });
        }
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'voice-profile-setup');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_profile_setup',
        refTable: 'VoiceConsent',
        refId: consent.id,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      if (charge.replayed) {
        const prior = await prisma.providerJob.findUnique({ where: { chargeLedgerId: charge.chargeId }, select: { id: true, inputJson: true } });
        const voiceProfileId = (prior?.inputJson as { voiceProfileId?: string } | null)?.voiceProfileId;
        if (prior && voiceProfileId) {
          const existingProfile = await prisma.voiceProfile.findFirst({ where: { id: voiceProfileId, workspaceId } });
          if (existingProfile) {
            reply.code(202);
            return { profile: existingProfile, jobId: prior.id, replayed: true };
          }
        }
      }

      const profile = await prisma.voiceProfile.create({
        data: {
          workspaceId,
          artistId: input.artistId,
          consentId: consent.id,
          name: input.name,
          provider: setupProvider,
          status: 'PENDING',
          sampleUrls: input.sampleUrls,
          language: input.language,
        },
      });

      let job;
      try {
        job = await createQueuedProviderJob({
          app,
          queue: app.queues.voice,
          jobName: 'setup-voice-profile',
          workspaceId,
          kind: 'voice_profile',
          provider: profile.provider,
          inputJson: { voiceProfileId: profile.id, ...input },
          charge,
          idempotencyKey,
          payload: (jobId) => ({
            jobId,
            workspaceId,
            voiceProfileId: profile.id,
            provider: profile.provider,
            name: input.name,
            sampleUrls: input.sampleUrls,
            language: input.language,
            consentRecordingUrl: consent.consentAudioUrl ?? undefined,
          }),
        });
      } catch (error) {
        await prisma.voiceProfile.delete({ where: { id: profile.id } }).catch(() => undefined);
        throw error;
      }

      reply.code(202);
      return {
        profile: {
          id: profile.id,
          artistId: profile.artistId,
          consentId: profile.consentId,
          name: profile.name,
          provider: profile.provider,
          status: profile.status,
          language: profile.language,
          createdAt: profile.createdAt,
        },
        jobId: job.jobId,
        replayed: job.replayed,
      };
    }
  );

  /**
   * DATASET BUILDER — one click from raw recordings to a trainer-ready zip.
   * Worker (lake lane: local ffmpeg, never blocks a render) downloads each
   * sample, converts to 48k mono wav, splits into ~10s segments and zips them
   * in the trainer layout `dataset/<name>/split_<i>.wav`. Poll the job for
   * { datasetZipUrl, segments, totalSeconds }, then POST /voices/train with it.
   * No credit charge: deterministic local work, no provider cost.
   */
  app.post(
    '/dataset',
    { schema: { body: voiceDatasetInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceDatasetInputSchema.parse(req.body);
      for (const sampleUrl of input.sampleUrls) {
        if (!assertWorkspaceAsset(workspaceId, sampleUrl)) {
          return reply.code(400).send({ error: 'owned_voice_sample_required' });
        }
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'voice-dataset');
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.lake,
        jobName: 'voice-dataset',
        workspaceId,
        kind: 'voice_dataset',
        provider: 'internal',
        inputJson: { name: input.name, samples: input.sampleUrls.length, isolationConfirmed: true, purgeSourceSamples: input.purgeSourceSamples },
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          name: input.name,
          sampleUrls: input.sampleUrls,
          isolationConfirmed: input.isolationConfirmed,
          purgeSourceSamples: input.purgeSourceSamples,
        }),
      });

      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        note: 'At least 2 minutes of clean solo vocals are required; 10-20 minutes is ideal. Poll the job for datasetZipUrl, then POST /voices/train with it.',
      };
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

      // Destination is only a concept for destination-based trainers (KIND=
      // training). The default trainer (replicate/train-rvc-model) is a
      // PREDICTION: the trained model file arrives as its output URL — no
      // Replicate destination model exists or is needed.
      const destination = input.destination ?? process.env.VOICE_TRAINER_DESTINATION?.trim();
      if (cfg.kind === 'training' && !destination) {
        return reply.code(400).send({
          error: 'destination_required',
          note: 'This trainer is destination-based: pass destination ("user/model" in your Replicate account) or set VOICE_TRAINER_DESTINATION. The trained weights land in that model — keep it private.',
        });
      }

      // Consent gate + workspace ownership (consent, artist both scoped here).
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: { id: input.consentId, workspaceId, artistId: input.artistId, revokedAt: null },
      });
      await prisma.artist.findFirstOrThrow({ where: { id: input.artistId, workspaceId } });

      // Dataset provenance: owned-storage URLs are verifiable; an external URL
      // is still allowed (his own hosting is legitimate) but recorded honestly.
      const externalDataset = !assertWorkspaceAsset(workspaceId, input.datasetZipUrl);
      if (externalDataset && process.env.ALLOW_EXTERNAL_VOICE_DATASET !== '1') {
        return reply.code(400).send({
          error: 'owned_dataset_required',
          note: 'Upload the voice dataset through this workspace. External model-training URLs are disabled by default.',
        });
      }
      let datasetReceipt: { id: string; contentHash: string; totalSeconds: number } | null = null;
      if (!externalDataset) {
        const dataset = parseStorageUri(input.datasetZipUrl);
        if (!dataset?.key.startsWith(`${workspaceId}/voice/`) || !dataset.key.endsWith('.zip')) {
          return reply.code(400).send({ error: 'trainer_dataset_zip_required' });
        }
        datasetReceipt = await prisma.voiceDataset.findFirst({
          where: { workspaceId, url: input.datasetZipUrl, qualityState: 'passed' },
          select: { id: true, contentHash: true, totalSeconds: true },
        });
        if (!datasetReceipt) {
          return reply.code(409).send({
            error: 'verified_voice_dataset_required',
            note: 'Build the dataset through POST /voices/dataset and wait for its QC job to pass before training.',
          });
        }
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'voice-training');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_clone_training',
        refTable: 'VoiceConsent',
        refId: consent.id,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      if (charge.replayed) {
        const prior = await prisma.providerJob.findUnique({ where: { chargeLedgerId: charge.chargeId }, select: { status: true, outputJson: true } });
        if (prior?.status === 'SUCCEEDED' && prior.outputJson) return prior.outputJson;
        if (prior?.status === 'RUNNING' || prior?.status === 'QUEUED') return reply.code(409).send({ error: 'voice_training_start_in_progress' });
        if (prior?.status === 'FAILED') return reply.code(503).send({ error: 'voice_training_start_failed', note: 'Start a new request to retry.' });
      }

      let auditJob: { id: string };
      try {
        auditJob = await prisma.providerJob.create({
          data: {
            workspaceId,
            kind: 'voice-training-start',
            provider: 'replicate',
            status: 'RUNNING',
            inputJson: {
              artistId: input.artistId,
              consentId: consent.id,
              datasetFingerprint: createHash('sha256').update(input.datasetZipUrl).digest('hex'),
            } as never,
            chargeLedgerId: charge.chargeId,
            idempotencyKey,
            startedAt: new Date(),
          },
          select: { id: true },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ error: 'voice_training_start_in_progress' });
        await app.refundCredits({ workspaceId, key: 'voice_clone_training', refTable: 'VoiceConsent', refId: consent.id, chargeId: charge.chargeId });
        throw error;
      }

      let profile;
      try {
        profile = await prisma.voiceProfile.create({
          data: {
            workspaceId,
            artistId: input.artistId,
            consentId: consent.id,
            name: input.name,
            provider: 'replicate',
            status: 'TRAINING',
            sampleUrls: [input.datasetZipUrl],
            voiceDatasetId: datasetReceipt?.id ?? null,
            destinationModel: destination ?? null,
            trainingMeta: {
              datasetZipUrl: input.datasetZipUrl,
              datasetId: datasetReceipt?.id ?? null,
              datasetContentHash: datasetReceipt?.contentHash ?? null,
              datasetSeconds: datasetReceipt?.totalSeconds ?? null,
              trainer: `${cfg.model}@${cfg.version}`,
              trainerKind: cfg.kind,
              kickoff: 'pending',
              at: new Date().toISOString(),
              ...(externalDataset ? { externalDataset: true } : {}),
            } as never,
          },
        });
      } catch (error) {
        await Promise.all([
          prisma.providerJob.update({ where: { id: auditJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: { message: 'voice profile persistence failed' } as never } }),
          app.refundCredits({ workspaceId, key: 'voice_clone_training', refTable: 'VoiceConsent', refId: consent.id, chargeId: charge.chargeId }),
        ]);
        throw error;
      }

      // Workspace-pasted Replicate key (Settings → Music engine) overrides env.
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      const replicateApiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;

      let training;
      try {
        training = await startVoiceTraining({
          datasetZipUrl: await presignAssetRef(input.datasetZipUrl, 3600),
          destination,
          apiKey: replicateApiKey,
        });
      } catch (err) {
        // Kickoff never happened — the charge must not stand.
        await Promise.all([
          app.refundCredits({ workspaceId, key: 'voice_clone_training', refTable: 'VoiceConsent', refId: consent.id, chargeId: charge.chargeId }),
          prisma.providerJob.update({ where: { id: auditJob.id }, data: { status: 'FAILED', finishedAt: new Date(), errorJson: { message: 'voice training provider rejected kickoff' } as never } }),
          prisma.voiceProfile.update({ where: { id: profile.id }, data: { status: 'FAILED', trainingMeta: { kickoff: 'failed', failedAt: new Date().toISOString() } as never } }),
        ]);
        const e = err as Error & { statusCode?: number };
        req.log.warn({ err: e, workspaceId }, 'voice training kickoff failed');
        return reply.code(e.statusCode ?? 502).send({
          error: 'voice_training_start_failed',
          note: 'The voice-training provider did not accept the request. Check its configuration and try again.',
        });
      }

      profile = await prisma.voiceProfile.update({
        where: { id: profile.id },
        data: {
          trainingId: training.id,
          trainingMeta: {
            datasetZipUrl: input.datasetZipUrl,
            datasetId: datasetReceipt?.id ?? null,
            datasetContentHash: datasetReceipt?.contentHash ?? null,
            datasetSeconds: datasetReceipt?.totalSeconds ?? null,
            trainer: `${training.model}@${training.version}`,
            trainerKind: training.kind,
            kickoff: 'accepted',
            at: new Date().toISOString(),
            ...(externalDataset ? { externalDataset: true } : {}),
          } as never,
        },
      });

      reply.code(202);
      const result = {
        profile: {
          id: profile.id,
          artistId: profile.artistId,
          consentId: profile.consentId,
          name: profile.name,
          provider: profile.provider,
          status: profile.status,
          language: profile.language,
          createdAt: profile.createdAt,
        },
        trainingId: training.id,
        trainingStatus: training.status,
        note: 'Training started. Poll GET /voices/:id/training — succeeded flips the profile to READY.',
      };
      await prisma.providerJob.update({
        where: { id: auditJob.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), externalId: training.id, outputJson: result as never },
      });
      return result;
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
    if (profile.status === 'REVOKED') {
      return reply.code(410).send({ error: 'voice_revoked' });
    }
    if (profile.status === 'READY' || profile.status === 'FAILED') {
      return {
        profileId: profile.id,
        status: profile.status,
        trainingId: profile.trainingId,
      };
    }

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;
    const meta = (profile.trainingMeta ?? {}) as Record<string, unknown>;
    const trainerKind: VoiceTrainerConfig['kind'] = meta.trainerKind === 'training' ? 'training' : 'prediction';
    const state = await getVoiceTraining(profile.trainingId, replicateApiKey, trainerKind);

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
      // DURABILITY (audit 2026-07-13): the trained model file arrives as an
      // EPHEMERAL replicate.delivery URL — re-host it to OWNED storage so the
      // voice can still /sing after the provider link expires. Fire on the worker
      // (streams a 100-500MB weights file; never blocks this poll).
      if (typeof trainedVersion === 'string' && /replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(trainedVersion)) {
        await queueVoiceRehost(app, workspaceId, profile.id, trainedVersion).catch((error) => {
          req.log.warn({ err: error, voiceProfileId: profile.id }, 'voice model rehost enqueue failed');
        });
      }
      return {
        profileId: updated.id,
        status: updated.status,
        trainingId: updated.trainingId,
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
      };
    }

    // starting / processing — still in flight.
    return {
      profileId: profile.id,
      status: profile.status,
      trainingId: profile.trainingId,
      replicateStatus: state.status,
    };
  });

  /**
   * RE-HOST the trained model to durable storage (durability audit 2026-07-13).
   * Backfill for voices trained before the fix, whose trainedVersion is still an
   * ephemeral provider URL — without this they stop being able to /sing once the
   * link expires. Idempotent; the worker streams the weights and repoints
   * trainedVersion at the owned URL. Workspace-scoped — your own models only.
   */
  app.post<{ Params: { voiceId: string } }>('/:voiceId/rehost', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const profile = await prisma.voiceProfile.findFirstOrThrow({ where: { id: req.params.voiceId, workspaceId } });
    const url = trainedModelUrl(profile);
    if (!url) return reply.code(400).send({ error: 'no_model_url', note: 'This profile has no downloadable trained-model URL to re-host.' });
    if (isStorageUri(url) || !/replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(url)) {
      return reply.code(200).send({ ok: true, alreadyDurable: true, note: 'Model is already on owned storage — nothing to re-host.' });
    }
    const job = await queueVoiceRehost(app, workspaceId, profile.id, url);
    reply.code(202);
    return { ok: true, jobId: job.jobId, replayed: job.replayed, note: 'Re-hosting the trained model to durable storage — poll GET /voices to watch trainedVersion flip to an owned URL.' };
  });

  app.delete<{ Params: { voiceId: string } }>('/:voiceId', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const profile = await prisma.voiceProfile.findFirst({
      where: { id: req.params.voiceId, workspaceId },
      include: { consent: true, voiceDataset: { select: { id: true, url: true } } },
    });
    if (!profile) return reply.code(404).send({ error: 'voice_not_found' });

    const trainingMeta = (profile.trainingMeta ?? {}) as Record<string, unknown>;
    const candidateRefs = collectOwnedVoiceRefs({
      sampleUrls: profile.sampleUrls,
      trainedVersion: profile.trainedVersion,
      trainingMeta,
    });
    const activeProfiles = await prisma.voiceProfile.findMany({
      where: { workspaceId, id: { not: profile.id }, status: { not: 'REVOKED' } },
      select: { sampleUrls: true, trainedVersion: true, trainingMeta: true, voiceDatasetId: true },
    });
    const activeRefs = new Set<string>();
    for (const active of activeProfiles) collectOwnedVoiceRefs(active, activeRefs);
    const refs = new Set([...candidateRefs].filter((ref) => !activeRefs.has(ref)));
    const retainedSharedObjects = candidateRefs.size - refs.size;
    const datasetShared = !!profile.voiceDatasetId
      && activeProfiles.some((active: { voiceDatasetId: string | null }) => active.voiceDatasetId === profile.voiceDatasetId);
    const datasetIds = profile.voiceDataset && !datasetShared ? [profile.voiceDataset.id] : [];

    const output = trainingMeta.output as Record<string, unknown> | string | null | undefined;
    const providerVersion =
      typeof profile.trainedVersion === 'string' && /^[a-zA-Z0-9]{20,128}$/.test(profile.trainedVersion)
        ? profile.trainedVersion
        : output && typeof output === 'object'
          ? [output.version, output.model_version, output.weights].find((value) => typeof value === 'string' && /^[a-zA-Z0-9]{20,128}$/.test(value)) as string | undefined
          : undefined;
    const trainerKind: VoiceTrainerConfig['kind'] = trainingMeta.trainerKind === 'training' ? 'training' : 'prediction';
    const cleanup = {
      provider: profile.provider,
      providerVoiceId: profile.providerVoiceId,
      trainingId: profile.trainingId,
      trainerKind,
      destinationModel: profile.destinationModel,
      providerVersion: providerVersion ?? null,
      datasetIds,
    };

    await prisma.$transaction([
      prisma.voiceProfile.update({
        where: { id: profile.id },
        data: {
          status: 'REVOKED',
          providerVoiceId: null,
          trainedVersion: null,
          sampleUrls: [],
          destinationModel: null,
          voiceDatasetId: null,
          trainingId: null,
          trainingMeta: { revokedAt: new Date().toISOString(), providerCleanup: { ...cleanup, status: 'pending' } } as never,
        },
      }),
      prisma.voiceConsent.update({ where: { id: profile.consentId }, data: { revokedAt: profile.consent.revokedAt ?? new Date() } }),
    ]);

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const apiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;
    let canceled = true;
    let versionDeleted = true;
    let providerVoiceDeleted = !cleanup.providerVoiceId || cleanup.provider === 'stub';
    try {
      if (!providerVoiceDeleted) {
        providerVoiceDeleted = await deleteHostedVoice(cleanup.provider, cleanup.providerVoiceId);
      }
      if (cleanup.trainingId && ['PENDING', 'TRAINING'].includes(profile.status)) {
        canceled = await cancelVoiceTraining(cleanup.trainingId, cleanup.trainerKind, apiKey);
      }
      if (cleanup.destinationModel && cleanup.providerVersion) {
        versionDeleted = await deleteVoiceModelVersion(cleanup.destinationModel, cleanup.providerVersion, apiKey);
      }
    } catch (error) {
      req.log.warn({ error, voiceProfileId: profile.id }, 'voice provider cleanup failed');
      canceled = false;
      versionDeleted = false;
      providerVoiceDeleted = false;
    }
    const refList = [...refs];
    const deleted = await Promise.allSettled(refList.map(deleteAssetRef));
    const deletionFailures = deleted.filter((result) => result.status === 'rejected').length;
    const failedStorageRefs = refList.filter((_ref, index) => deleted[index]?.status === 'rejected');
    let datasetReceiptFailures = 0;
    if (datasetIds.length && profile.voiceDataset && !failedStorageRefs.includes(profile.voiceDataset.url)) {
      try {
        await prisma.voiceDataset.deleteMany({ where: { id: { in: datasetIds }, workspaceId } });
      } catch {
        datasetReceiptFailures = datasetIds.length;
      }
    }
    const providerCleanupFailures = Number(!canceled) + Number(!versionDeleted) + Number(!providerVoiceDeleted);
    let cleanupJobId: string | null = null;
    if (providerCleanupFailures || failedStorageRefs.length || datasetReceiptFailures) {
      const cleanupFingerprint = createHash('sha256').update(JSON.stringify({ cleanup, failedStorageRefs })).digest('hex').slice(0, 20);
      const cleanupJob = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: 'voice-cleanup',
        workspaceId,
        kind: 'voice_cleanup',
        provider: 'internal',
        inputJson: { voiceProfileId: profile.id, cleanupFingerprint },
        idempotencyKey: `voice-cleanup:${profile.id}:${cleanupFingerprint}`,
        payload: (jobId) => ({ jobId, workspaceId, voiceProfileId: profile.id }),
        delayMs: 30_000,
      });
      cleanupJobId = cleanupJob.jobId;
    }
    await prisma.voiceProfile.update({
      where: { id: profile.id },
      data: {
        trainingMeta: {
          revokedAt: new Date().toISOString(),
          providerCleanup: {
            ...cleanup,
            status: providerCleanupFailures || failedStorageRefs.length || datasetReceiptFailures ? 'retry_required' : 'complete',
            canceled,
            versionDeleted,
            providerVoiceDeleted,
            failedStorageRefs,
            cleanupJobId,
          },
        } as never,
      },
    });
    reply.code(200);
    return {
      revoked: true,
      deletedObjects: refs.size - deletionFailures,
      deletionFailures,
      providerCleanupFailures,
      datasetReceiptFailures,
      retainedSharedObjects,
      cleanupQueued: !!cleanupJobId,
    };
  });

  /**
   * SING WITH MY VOICE — the trained voice performs an existing track.
   * Source: songUrl, or songId → the song's freshest playable audio (master →
   * mix → beat, mirrors songs.ts freshestAudioUrl). The conversion runs on the
   * voice queue (sing-convert → zsxkib/realistic-voice-cloning via @afrohit/ai
   * singWithVoice); the result is re-hosted, and when a songId was given it's
   * filed as a VocalRender + Mix so the sung version is playable/downloadable.
   *
   * HONEST: the voice sings whatever the INPUT sings — RVC converts a
   * performance, it does not invent one. The melody comes from the input vocal
   * (or the melody guide the artist hums over the beat).
   */
  app.post<{ Params: { voiceId: string } }>(
    '/:voiceId/sing',
    { schema: { body: voiceSingInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceSingInputSchema.parse(req.body);
      if (!input.songId && !input.songUrl) {
        return reply.code(400).send({ error: 'source_required', note: 'Pass songId (catalog song) or songUrl (any hosted track/vocal).' });
      }

      const voice = await prisma.voiceProfile.findFirst({
        where: { id: req.params.voiceId, workspaceId },
      });
      if (!voice) return reply.code(404).send({ error: 'voice_not_found' });
      if (voice.status !== 'READY') {
        return reply.code(409).send({
          error: 'voice_not_ready',
          status: voice.status,
          note: 'Train the voice first (POST /voices/train), then poll GET /voices/:id/training until READY.',
        });
      }
      const modelUrl = trainedModelUrl(voice);
      if (!modelUrl) {
        return reply.code(409).send({
          error: 'no_trained_model_file',
          note: 'This profile has no downloadable trained-model URL. The default prediction trainer (replicate/train-rvc-model) outputs one; destination-based trainers do not — retrain with the default trainer to use /sing.',
        });
      }

      // Resolve the performance to convert: explicit URL, or the song's
      // freshest playable audio (master → mix → beat by createdAt).
      let songInputUrl = input.songUrl ?? null;
      if (songInputUrl) {
        if (input.rightsConfirmed !== true) {
          return reply.code(422).send({
            error: 'performance_rights_confirmation_required',
            note: 'Confirm you own or are licensed to convert this external performance.',
          });
        }
        const owned = assertWorkspaceAsset(workspaceId, songInputUrl);
        if (!owned) {
          const check = await assertSafeUrl(songInputUrl);
          if (!check.ok) return reply.code(check.code).send({ error: check.error, message: check.message });
        }
      }
      let song: { id: string; projectId: string } | null = null;
      if (!songInputUrl && input.songId) {
        const s = await prisma.song.findFirst({
          where: { id: input.songId, workspaceId },
          include: {
            masters: { orderBy: { createdAt: 'desc' }, take: 1 },
            mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
            beats: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });
        if (!s) return reply.code(404).send({ error: 'song_not_found' });
        const cands = [s.masters[0], s.mixes[0], s.beats[0]].filter(Boolean) as Array<{ url: string; createdAt: Date }>;
        cands.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        songInputUrl = cands[0]?.url ?? null;
        if (!songInputUrl) {
          return reply.code(400).send({ error: 'song_has_no_audio', note: 'Render the song first — /sing converts an existing performance, it cannot invent one.' });
        }
        song = { id: s.id, projectId: s.projectId };
      }

      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'voice-sing');
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_sing_render',
        refTable: 'VoiceProfile',
        refId: voice.id,
        idempotencyKey,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: 'sing-convert',
        workspaceId,
        projectId: song?.projectId,
        kind: 'voice',
        provider: 'replicate',
        inputJson: {
          sing: true,
          voiceProfileId: voice.id,
          songId: song?.id,
          songInputUrl,
          pitchChange: input.pitchChange,
          tuning: input.tuning,
        },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          voiceProfileId: voice.id,
          modelUrl,
          songInputUrl,
          pitchChange: input.pitchChange,
          tuning: input.tuning,
          songId: song?.id,
          projectId: song?.projectId,
        }),
      });

      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        note: 'Converting — the trained voice sings whatever the input sings (melody + timing come from the input vocal). Takes a few minutes; poll GET /jobs/:jobId for the result URL.',
      };
    }
  );

  app.post<{ Params: { voiceId: string }; Body: { text: string } }>(
    '/:voiceId/test',
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const voice = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: req.params.voiceId, workspaceId, status: 'READY' },
      });
      if (voice.provider !== 'eleven' || !voice.providerVoiceId) {
        return reply.code(409).send({
          error: 'speech_preview_unavailable',
          note: 'This is a singing-conversion voice, not a text-to-speech profile. Use POST /voices/:voiceId/sing with an existing sung performance.',
        });
      }
      const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1_000) : '';
      if (!text) return reply.code(400).send({ error: 'text_required' });
      const idempotencyKey = scopedRequestKey(req.headers as Record<string, unknown>, 'voice-test');
      const charge = await app.chargeCredits({ workspaceId, key: 'voice_render_30s', refTable: 'VoiceProfile', refId: voice.id, idempotencyKey });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: 'render-vocal',
        workspaceId,
        kind: 'voice',
        provider: voice.provider,
        inputJson: { test: true, text },
        charge,
        idempotencyKey,
        payload: (jobId) => ({
          jobId,
          workspaceId,
          voiceProfileId: voice.id,
          provider: voice.provider,
          providerVoiceId: voice.providerVoiceId,
          lyricBody: text,
          role: 'lead',
        }),
      });
      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}
