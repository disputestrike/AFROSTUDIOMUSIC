import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { voiceConsentInputSchema, voiceDatasetInputSchema, voiceProfileInputSchema, voiceSingInputSchema, voiceTrainInputSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { enqueue } from '../lib/queue';
import { publicUrlFor } from '../lib/storage';
import { voiceTrainerConfig, startVoiceTraining, getVoiceTraining } from '../lib/voice-training';

/**
 * The usable TRAINED MODEL FILE URL for a READY voice profile, read defensively:
 * the default trainer (replicate/train-rvc-model) is a PREDICTION whose output
 * is the model-file URL — the training poll stored it on trainedVersion (string
 * output) and verbatim on trainingMeta.output. Destination-based trainers store
 * a version hash instead (no downloadable file) → null, and /sing says so
 * honestly rather than passing a non-URL to the conversion engine.
 */
function trainedModelUrl(profile: { trainedVersion: string | null; trainingMeta: unknown }): string | null {
  const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
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

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          kind: 'voice_dataset',
          provider: 'internal',
          status: 'QUEUED',
          inputJson: { name: input.name, samples: input.sampleUrls.length } as never,
        },
      });
      await enqueue({
        queue: app.queues.lake,
        name: 'voice-dataset',
        payload: { jobId: job.id, workspaceId, name: input.name, sampleUrls: input.sampleUrls },
      });

      reply.code(202);
      return {
        jobId: job.id,
        note: '10-20 minutes of clean solo vocals make the best voice; poll the job for datasetZipUrl, then POST /voices/train with it.',
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
          destinationModel: destination ?? null,
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
      // DURABILITY (audit 2026-07-13): the trained model file arrives as an
      // EPHEMERAL replicate.delivery URL — re-host it to OWNED storage so the
      // voice can still /sing after the provider link expires. Fire on the worker
      // (streams a 100-500MB weights file; never blocks this poll).
      if (typeof trainedVersion === 'string' && /replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(trainedVersion)) {
        await enqueue({
          queue: app.queues.voice,
          name: 'rehost-voice-model',
          payload: { workspaceId, voiceProfileId: profile.id, modelUrl: trainedVersion },
        }).catch(() => {});
      }
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
    if (!/replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(url)) {
      return reply.code(200).send({ ok: true, alreadyDurable: true, note: 'Model is already on owned storage — nothing to re-host.' });
    }
    await enqueue({ queue: app.queues.voice, name: 'rehost-voice-model', payload: { workspaceId, voiceProfileId: profile.id, modelUrl: url } });
    reply.code(202);
    return { ok: true, note: 'Re-hosting the trained model to durable storage — poll GET /voices to watch trainedVersion flip to an owned URL.' };
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

      const charge = await app.chargeCredits({
        workspaceId,
        key: 'voice_sing_render',
        refTable: 'VoiceProfile',
        refId: voice.id,
      });
      if (!charge.ok) return reply.code(402).send({ error: 'insufficient_credits', ...charge });

      const job = await prisma.providerJob.create({
        data: {
          workspaceId,
          ...(song ? { projectId: song.projectId } : {}),
          kind: 'voice',
          provider: 'replicate',
          status: 'QUEUED',
          // _charge lets the worker REFUND on failure (charge-before-enqueue).
          inputJson: {
            sing: true,
            voiceProfileId: voice.id,
            songId: song?.id,
            songInputUrl,
            pitchChange: input.pitchChange,
            tuning: input.tuning,
            _charge: { key: 'voice_sing_render', multiplier: 1 },
          } as never,
        },
      });
      await enqueue({
        queue: app.queues.voice,
        name: 'sing-convert',
        payload: {
          jobId: job.id,
          workspaceId,
          voiceProfileId: voice.id,
          modelUrl,
          songInputUrl,
          pitchChange: input.pitchChange,
          tuning: input.tuning,
          songId: song?.id,
          projectId: song?.projectId,
        },
      });

      reply.code(202);
      return {
        jobId: job.id,
        note: 'Converting — the trained voice sings whatever the input sings (melody + timing come from the input vocal). Takes a few minutes; poll GET /jobs/:jobId for the result URL.',
      };
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
