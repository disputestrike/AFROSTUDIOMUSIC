import type { FastifyInstance } from "fastify";
import { createHash, createHmac } from "node:crypto";
import { openSecret, prisma } from "@afrohit/db";
import {
  isStorageUri,
  parseStorageUri,
  VOICE_CONSENT_TEXT,
  VOICE_CONSENT_VERSION,
  voiceConsentInputSchema,
  voiceDatasetInputSchema,
  voiceProfileInputSchema,
  voiceSingInputSchema,
  voiceTrainInputSchema,
  type CreditKey,
} from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";
import {
  assertWorkspaceAsset,
  deleteAssetRef,
  presignAssetRef,
} from "../lib/storage";
import { assertSafeUrl } from "../lib/url-guard";
import {
  cancelVoiceTraining,
  deleteVoiceModelVersion,
  getVoiceTraining,
  startVoiceTraining,
  voiceTrainerConfig,
  type VoiceTrainerConfig,
} from "../lib/voice-training";
import { currentPlayableAsset } from "../lib/current-playable-asset";

/**
 * The usable TRAINED MODEL FILE URL for a READY voice profile, read defensively:
 * the default trainer (replicate/train-rvc-model) is a PREDICTION whose output
 * is the model-file URL — the training poll stored it on trainedVersion (string
 * output) and verbatim on trainingMeta.output. Destination-based trainers store
 * a version hash instead (no downloadable file) → null, and /sing says so
 * honestly rather than passing a non-URL to the conversion engine.
 */
type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function isModelUrl(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || isStorageUri(value))
  );
}

function artifactCandidates(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(artifactCandidates).reverse();
  if (!value || typeof value !== "object") return [];
  const object = objectValue(value);
  return [
    "weights",
    "artifact",
    "artifact_url",
    "model",
    "url",
    "version",
    "model_version",
  ].flatMap(key => artifactCandidates(object[key]));
}

/** A READY training profile must point at a concrete file or immutable provider version. */
export function trainedArtifactIdentifier(value: unknown): string | null {
  for (const raw of artifactCandidates(value)) {
    const candidate = raw.trim();
    if (isModelUrl(candidate)) return candidate;
    if (/^[a-zA-Z0-9_-]{20,160}$/.test(candidate)) return candidate;
    if (
      /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+[@:][a-zA-Z0-9_-]{20,160}$/.test(
        candidate
      )
    )
      return candidate;
  }
  return null;
}

function trainedModelUrl(profile: {
  trainedVersion: string | null;
  trainingMeta: unknown;
}): string | null {
  for (const candidate of [
    profile.trainedVersion,
    objectValue(profile.trainingMeta).output,
  ]) {
    const url = artifactCandidates(candidate).find(isModelUrl);
    if (url) return url;
  }
  return null;
}

type VoiceLineage = {
  id: string;
  workspaceId: string;
  artistId: string;
  consentId: string;
  status: string;
  trainingId: string | null;
  destinationModel: string | null;
  trainedVersion: string | null;
  trainingMeta: unknown;
  voiceDatasetId: string | null;
  consent: {
    id: string;
    workspaceId: string;
    artistId: string | null;
    revokedAt: Date | null;
  };
  voiceDataset: { id: string; workspaceId: string; contentHash: string } | null;
};

type CreatedVoiceProfile = {
  id: string;
  artistId: string;
  consentId: string;
  name: string;
  provider: string;
  status: string;
  language: string | null;
  createdAt: Date;
};

type RevocationProfile = {
  id: string;
  artistId: string;
  consentId: string;
  provider: string;
  providerVoiceId: string | null;
  status: string;
  sampleUrls: string[];
  trainingId: string | null;
  destinationModel: string | null;
  trainedVersion: string | null;
  voiceDatasetId: string | null;
  trainingMeta: unknown;
  voiceDataset: { id: string; url: string } | null;
};

type ActiveRevocationProfile = {
  sampleUrls: string[];
  trainedVersion: string | null;
  trainingMeta: unknown;
  voiceDatasetId: string | null;
  voiceDataset: { url: string } | null;
};

type CancelableVoiceJob = {
  id: string;
  kind: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  inputJson: unknown;
  chargeLedgerId: string | null;
  outbox: { payload: unknown } | null;
};

type CanceledVoiceJob = {
  id: string;
  kind: string;
  inputJson: unknown;
  chargeLedgerId: string | null;
};

type VoiceProviderCleanup = {
  provider: string;
  providerVoiceId: string | null;
  trainingId: string | null;
  trainerKind: VoiceTrainerConfig["kind"];
  destinationModel: string | null;
  providerVersion: string | null;
  datasetIds: string[];
  canceled: boolean;
  versionDeleted: boolean;
  providerVoiceDeleted: boolean;
};

export function voiceLineageFailure(
  profile: VoiceLineage,
  workspaceId: string
): string | null {
  if (
    profile.workspaceId !== workspaceId ||
    profile.consent.workspaceId !== workspaceId
  )
    return "voice_workspace_mismatch";
  if (profile.consentId !== profile.consent.id) return "voice_consent_mismatch";
  if (profile.consent.revokedAt) return "voice_consent_revoked";
  if (
    !profile.consent.artistId ||
    profile.artistId !== profile.consent.artistId
  )
    return "voice_artist_mismatch";
  if (
    profile.voiceDatasetId !== profile.voiceDataset?.id &&
    (profile.voiceDatasetId || profile.voiceDataset)
  ) {
    return "voice_dataset_relation_mismatch";
  }
  if (profile.voiceDataset && profile.voiceDataset.workspaceId !== workspaceId)
    return "voice_dataset_workspace_mismatch";

  const meta = objectValue(profile.trainingMeta);
  const hasTrainingLineage =
    profile.trainedVersion !== null ||
    profile.voiceDatasetId !== null ||
    Object.keys(meta).length > 0;
  if (hasTrainingLineage && meta.artistId !== profile.artistId)
    return "voice_training_artist_mismatch";
  if (hasTrainingLineage && meta.consentId !== profile.consentId)
    return "voice_training_consent_mismatch";
  if (profile.voiceDataset) {
    if (meta.datasetId !== profile.voiceDataset.id)
      return "voice_training_dataset_mismatch";
    if (meta.datasetContentHash !== profile.voiceDataset.contentHash) {
      return "voice_training_dataset_hash_mismatch";
    }
  } else if (
    typeof meta.datasetId === "string" ||
    typeof meta.datasetContentHash === "string"
  ) {
    return "voice_training_dataset_relation_mismatch";
  }
  return null;
}

async function loadVoiceLineage(
  workspaceId: string,
  voiceProfileId: string
): Promise<VoiceLineage | null> {
  return prisma.voiceProfile.findFirst({
    where: { id: voiceProfileId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      artistId: true,
      consentId: true,
      status: true,
      trainingId: true,
      destinationModel: true,
      trainedVersion: true,
      trainingMeta: true,
      voiceDatasetId: true,
      consent: {
        select: {
          id: true,
          workspaceId: true,
          artistId: true,
          revokedAt: true,
        },
      },
      voiceDataset: {
        select: { id: true, workspaceId: true, contentHash: true },
      },
    },
  });
}

export function jobReferencesVoiceLineage(
  job: { inputJson: unknown; outbox?: { payload: unknown } | null },
  profileIds: ReadonlySet<string>,
  consentId: string
): boolean {
  return [job.inputJson, job.outbox?.payload].some(value => {
    const lineage = objectValue(value);
    return (
      (typeof lineage.voiceProfileId === "string" &&
        profileIds.has(lineage.voiceProfileId)) ||
      lineage.consentId === consentId
    );
  });
}

function voiceJobCreditKey(kind: string, inputJson: unknown): CreditKey | null {
  const input = objectValue(inputJson);
  if (kind === "voice_profile") return "voice_profile_setup";
  if (kind === "voice-training-start") return "voice_clone_training";
  if (kind !== "voice") return null;
  if (input.sing === true) return "voice_sing_render";
  if (input.test === true) return "voice_render_30s";
  return null;
}

function collectOwnedVoiceRefs(
  value: unknown,
  refs = new Set<string>(),
  depth = 0
): Set<string> {
  if (depth > 4 || value == null) return refs;
  if (typeof value === "string") {
    if (isStorageUri(value)) refs.add(value);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectOwnedVoiceRefs(item, refs, depth + 1);
    return refs;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectOwnedVoiceRefs(item, refs, depth + 1);
    }
  }
  return refs;
}

function providerVersionFromArtifact(artifact: string | null): string | null {
  if (!artifact || isModelUrl(artifact)) return null;
  return artifact.split(/[@:]/).at(-1) ?? artifact;
}

async function queueVoiceRehost(
  app: FastifyInstance,
  workspaceId: string,
  voiceProfileId: string,
  modelUrl: string
) {
  const fingerprint = createHash("sha256")
    .update(modelUrl)
    .digest("hex")
    .slice(0, 20);
  return createQueuedProviderJob({
    app,
    queue: app.queues.voice,
    jobName: "rehost-voice-model",
    workspaceId,
    kind: "voice-rehost",
    provider: "internal",
    inputJson: { voiceProfileId, fingerprint },
    idempotencyKey: `voice-rehost:${voiceProfileId}:${fingerprint}`,
    payload: jobId => ({ jobId, workspaceId, voiceProfileId, modelUrl }),
  });
}

async function deleteHostedVoice(
  provider: string,
  providerVoiceId: string | null
): Promise<boolean> {
  if (!providerVoiceId || provider === "stub") return true;
  if (provider !== "eleven" || !/^[a-zA-Z0-9_-]{6,128}$/.test(providerVoiceId))
    return false;
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_API_KEY;
  if (!key) return false;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(providerVoiceId)}`,
    {
      method: "DELETE",
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(30_000),
    }
  );
  return response.ok || response.status === 404;
}

export default async function voices(app: FastifyInstance) {
  app.addHook("preHandler", async req => {
    requireRole(req, ["OWNER", "ADMIN"]);
  });

  app.get("/consent-terms", async () => ({
    version: VOICE_CONSENT_VERSION,
    text: VOICE_CONSENT_TEXT,
  }));

  app.get("/consents", async req => {
    const { workspaceId } = requireAuth(req);
    return prisma.voiceConsent.findMany({
      where: { workspaceId },
      orderBy: { signedAt: "desc" },
      select: {
        id: true,
        legalName: true,
        email: true,
        signedAt: true,
        revokedAt: true,
      },
    });
  });

  app.post(
    "/consents",
    { schema: { body: voiceConsentInputSchema } },
    async (req, reply) => {
      const { userId, workspaceId } = requireAuth(req);
      const input = voiceConsentInputSchema.parse(req.body);
      await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
      });
      if (input.signatureUrl)
        assertWorkspaceAsset(workspaceId, input.signatureUrl);
      if (
        input.consentAudioUrl &&
        !assertWorkspaceAsset(workspaceId, input.consentAudioUrl)
      ) {
        return reply.code(400).send({ error: "owned_consent_audio_required" });
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
          consentTextHash: createHash("sha256")
            .update(VOICE_CONSENT_TEXT)
            .digest("hex"),
          signatureUrl: input.signatureUrl,
          consentAudioUrl: input.consentAudioUrl,
          ipHash: createHmac(
            "sha256",
            process.env.IP_HASH_SECRET ||
              process.env.JWT_SECRET ||
              process.env.INTERNAL_API_SECRET ||
              "local-development-only"
          )
            .update(req.ip)
            .digest("hex"),
          ipAddress: null,
          userAgent: req.headers["user-agent"]?.slice(0, 240) ?? null,
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

  app.get("/", async req => {
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
    return (profiles as VoiceListRow[]).map(
      ({ providerVoiceId, trainedVersion, trainingMeta, ...profile }) => ({
        ...profile,
        capabilities: {
          speechPreview: profile.provider === "eleven" && !!providerVoiceId,
          singingConversion: !!trainedModelUrl({
            trainedVersion,
            trainingMeta,
          }),
          scoreSinging: false,
        },
      })
    );
  });

  app.post(
    "/",
    { schema: { body: voiceProfileInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceProfileInputSchema.parse(req.body);
      const setupProvider = (
        process.env.VOICE_PROVIDER ??
        (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY
          ? "eleven"
          : "")
      ).toLowerCase();
      const developmentStub =
        setupProvider === "stub" &&
        process.env.NODE_ENV !== "production" &&
        process.env.ALLOW_STUB_AUDIO === "1";
      if (setupProvider !== "eleven" && !developmentStub) {
        return reply.code(501).send({
          error: "speech_voice_provider_not_configured",
          note: "This endpoint creates a speech preview voice. Configure VOICE_PROVIDER=eleven and an ElevenLabs key, or use /voices/train for an RVC singing-conversion voice.",
        });
      }

      // Verify consent exists, is in workspace, not revoked.
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: {
          id: input.consentId,
          workspaceId,
          artistId: input.artistId,
          revokedAt: null,
        },
      });
      // Verify the artist is in THIS workspace too — never attach a voice profile
      // (and its future renders) to another workspace's Artist id.
      await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
      });
      for (const sampleUrl of input.sampleUrls) {
        if (!assertWorkspaceAsset(workspaceId, sampleUrl)) {
          return reply.code(400).send({ error: "owned_voice_sample_required" });
        }
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "voice-profile-setup"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "voice_profile_setup",
        refTable: "VoiceConsent",
        refId: consent.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      if (charge.replayed) {
        const prior = await prisma.providerJob.findUnique({
          where: { chargeLedgerId: charge.chargeId },
          select: { id: true, inputJson: true },
        });
        const voiceProfileId = (
          prior?.inputJson as { voiceProfileId?: string } | null
        )?.voiceProfileId;
        if (prior && voiceProfileId) {
          const existingProfile = await prisma.voiceProfile.findFirst({
            where: {
              id: voiceProfileId,
              workspaceId,
              artistId: input.artistId,
              consentId: input.consentId,
              status: { not: "REVOKED" },
              consent: {
                workspaceId,
                artistId: input.artistId,
                revokedAt: null,
              },
            },
          });
          if (existingProfile) {
            reply.code(202);
            return {
              profile: existingProfile,
              jobId: prior.id,
              replayed: true,
            };
          }
        }
      }

      let profile: CreatedVoiceProfile;
      try {
        profile = await prisma.$transaction(async tx => {
          // Lock the authorization root while creating its child. Revocation uses
          // the same row, so a profile cannot commit outside the revoke snapshot.
          const activeConsent = await tx.voiceConsent.updateMany({
            where: {
              id: consent.id,
              workspaceId,
              artistId: input.artistId,
              revokedAt: null,
            },
            data: { revokedAt: null },
          });
          if (activeConsent.count !== 1)
            throw new Error("voice_consent_revoked_before_profile_persistence");
          return tx.voiceProfile.create({
            data: {
              workspaceId,
              artistId: input.artistId,
              consentId: consent.id,
              name: input.name,
              provider: setupProvider,
              status: "PENDING",
              sampleUrls: input.sampleUrls,
              language: input.language,
              meta: {
                workspaceId,
                artistId: input.artistId,
                consentId: consent.id,
              } as never,
            },
          });
        });
      } catch (error) {
        await app.refundCredits({
          workspaceId,
          key: "voice_profile_setup",
          refTable: "VoiceConsent",
          refId: consent.id,
          chargeId: charge.chargeId,
        });
        if (
          error instanceof Error &&
          error.message === "voice_consent_revoked_before_profile_persistence"
        ) {
          return reply.code(409).send({ error: "voice_consent_revoked" });
        }
        throw error;
      }

      let job;
      try {
        const invocationProfile = await loadVoiceLineage(
          workspaceId,
          profile.id
        );
        const invocationFailure = invocationProfile
          ? voiceLineageFailure(invocationProfile, workspaceId)
          : "voice_profile_not_found";
        if (invocationFailure || invocationProfile?.status !== "PENDING") {
          await prisma.voiceProfile.updateMany({
            where: { id: profile.id, workspaceId, status: "PENDING" },
            data: {
              status:
                invocationFailure === "voice_consent_revoked"
                  ? "REVOKED"
                  : "FAILED",
            },
          });
          await app.refundCredits({
            workspaceId,
            key: "voice_profile_setup",
            refTable: "VoiceConsent",
            refId: consent.id,
            chargeId: charge.chargeId,
          });
          return reply.code(409).send({
            error: invocationFailure ?? "voice_profile_state_changed",
          });
        }
        job = await createQueuedProviderJob({
          app,
          queue: app.queues.voice,
          jobName: "setup-voice-profile",
          workspaceId,
          kind: "voice_profile",
          provider: profile.provider,
          inputJson: {
            voiceProfileId: profile.id,
            workspaceId,
            artistId: profile.artistId,
            consentId: profile.consentId,
            sampleCount: input.sampleUrls.length,
          },
          charge,
          idempotencyKey,
          payload: jobId => ({
            jobId,
            workspaceId,
            voiceProfileId: profile.id,
            artistId: profile.artistId,
            consentId: profile.consentId,
            provider: profile.provider,
            name: input.name,
            sampleUrls: input.sampleUrls,
            language: input.language,
            consentRecordingUrl: consent.consentAudioUrl ?? undefined,
          }),
        });
      } catch (error) {
        await prisma.voiceProfile
          .delete({ where: { id: profile.id } })
          .catch(() => undefined);
        throw error;
      }

      const persistedProfile = await loadVoiceLineage(workspaceId, profile.id);
      const persistenceFailure = persistedProfile
        ? voiceLineageFailure(persistedProfile, workspaceId)
        : "voice_profile_not_found";
      if (persistenceFailure || persistedProfile?.status !== "PENDING") {
        await Promise.allSettled([
          prisma.providerJob.updateMany({
            where: { id: job.jobId, workspaceId, status: "QUEUED" },
            data: {
              status: "CANCELED",
              finishedAt: new Date(),
              errorJson: {
                message: persistenceFailure ?? "voice profile state changed",
              } as never,
            },
          }),
          app.queues.voice.remove(`provider-${job.jobId}`),
          app.refundCredits({
            workspaceId,
            key: "voice_profile_setup",
            refTable: "ProviderJob",
            refId: job.jobId,
            chargeId: charge.chargeId,
          }),
        ]);
        return reply
          .code(409)
          .send({ error: persistenceFailure ?? "voice_profile_state_changed" });
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
    "/dataset",
    { schema: { body: voiceDatasetInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceDatasetInputSchema.parse(req.body);
      for (const sampleUrl of input.sampleUrls) {
        if (!assertWorkspaceAsset(workspaceId, sampleUrl)) {
          return reply.code(400).send({ error: "owned_voice_sample_required" });
        }
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "voice-dataset"
      );
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.lake,
        jobName: "voice-dataset",
        workspaceId,
        kind: "voice_dataset",
        provider: "internal",
        inputJson: {
          name: input.name,
          samples: input.sampleUrls.length,
          isolationConfirmed: true,
          purgeSourceSamples: input.purgeSourceSamples,
        },
        idempotencyKey,
        payload: jobId => ({
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
        note: "At least 2 minutes of clean solo vocals are required; 10-20 minutes is ideal. Poll the job for datasetZipUrl, then POST /voices/train with it.",
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
    "/train",
    { schema: { body: voiceTrainInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceTrainInputSchema.parse(req.body);

      const cfg = voiceTrainerConfig();
      if (!cfg) {
        return reply.code(501).send({
          error: "voice_training_not_configured",
          note: 'Own-voice training needs an operator-pinned Replicate trainer. Pick an RVC-family voice trainer on Replicate, then set VOICE_TRAINER_MODEL ("owner/name") + VOICE_TRAINER_VERSION (version hash); optionally VOICE_TRAINER_DATASET_KEY (default "dataset_zip"), VOICE_TRAINER_EXTRA_INPUT (JSON), and VOICE_TRAINER_DESTINATION ("user/model" in YOUR Replicate account, where the trained weights land).',
        });
      }

      // Destination is only a concept for destination-based trainers (KIND=
      // training). The default trainer (replicate/train-rvc-model) is a
      // PREDICTION: the trained model file arrives as its output URL — no
      // Replicate destination model exists or is needed.
      const destination =
        input.destination ?? process.env.VOICE_TRAINER_DESTINATION?.trim();
      if (cfg.kind === "training" && !destination) {
        return reply.code(400).send({
          error: "destination_required",
          note: 'This trainer is destination-based: pass destination ("user/model" in your Replicate account) or set VOICE_TRAINER_DESTINATION. The trained weights land in that model — keep it private.',
        });
      }

      // Consent gate + workspace ownership (consent, artist both scoped here).
      const consent = await prisma.voiceConsent.findFirstOrThrow({
        where: {
          id: input.consentId,
          workspaceId,
          artistId: input.artistId,
          revokedAt: null,
        },
      });
      await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
      });

      // Dataset provenance: owned-storage URLs are verifiable; an external URL
      // is still allowed (his own hosting is legitimate) but recorded honestly.
      const externalDataset = !assertWorkspaceAsset(
        workspaceId,
        input.datasetZipUrl
      );
      if (externalDataset && process.env.ALLOW_EXTERNAL_VOICE_DATASET !== "1") {
        return reply.code(400).send({
          error: "owned_dataset_required",
          note: "Upload the voice dataset through this workspace. External model-training URLs are disabled by default.",
        });
      }
      let datasetReceipt: {
        id: string;
        contentHash: string;
        totalSeconds: number;
        voiceProfiles: Array<{ artistId: string; consentId: string }>;
      } | null = null;
      if (!externalDataset) {
        const dataset = parseStorageUri(input.datasetZipUrl);
        if (
          !dataset?.key.startsWith(`${workspaceId}/voice/`) ||
          !dataset.key.endsWith(".zip")
        ) {
          return reply
            .code(400)
            .send({ error: "trainer_dataset_zip_required" });
        }
        datasetReceipt = await prisma.voiceDataset.findFirst({
          where: {
            workspaceId,
            url: input.datasetZipUrl,
            qualityState: "passed",
          },
          select: {
            id: true,
            contentHash: true,
            totalSeconds: true,
            voiceProfiles: { select: { artistId: true, consentId: true } },
          },
        });
        if (!datasetReceipt) {
          return reply.code(409).send({
            error: "verified_voice_dataset_required",
            note: "Build the dataset through POST /voices/dataset and wait for its QC job to pass before training.",
          });
        }
        if (
          datasetReceipt.voiceProfiles.some(
            profile =>
              profile.artistId !== input.artistId ||
              profile.consentId !== input.consentId
          )
        ) {
          return reply.code(409).send({
            error: "voice_dataset_lineage_conflict",
            note: "This verified dataset is already bound to another artist or consent. Build a new dataset for this consent.",
          });
        }
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "voice-training"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "voice_clone_training",
        refTable: "VoiceConsent",
        refId: consent.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      if (charge.replayed) {
        const prior = await prisma.providerJob.findUnique({
          where: { chargeLedgerId: charge.chargeId },
          select: { status: true, outputJson: true },
        });
        if (prior?.status === "SUCCEEDED" && prior.outputJson)
          return prior.outputJson;
        if (prior?.status === "RUNNING" || prior?.status === "QUEUED")
          return reply
            .code(409)
            .send({ error: "voice_training_start_in_progress" });
        if (prior?.status === "FAILED")
          return reply.code(503).send({
            error: "voice_training_start_failed",
            note: "Start a new request to retry.",
          });
      }

      let auditJob: { id: string };
      try {
        auditJob = await prisma.providerJob.create({
          data: {
            workspaceId,
            kind: "voice-training-start",
            provider: "replicate",
            status: "RUNNING",
            inputJson: {
              artistId: input.artistId,
              consentId: consent.id,
              datasetId: datasetReceipt?.id ?? null,
              datasetContentHash: datasetReceipt?.contentHash ?? null,
              datasetFingerprint: createHash("sha256")
                .update(input.datasetZipUrl)
                .digest("hex"),
              trainer: `${cfg.model}@${cfg.version}`,
              trainerKind: cfg.kind,
            } as never,
            chargeLedgerId: charge.chargeId,
            idempotencyKey,
            startedAt: new Date(),
          },
          select: { id: true },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002")
          return reply
            .code(409)
            .send({ error: "voice_training_start_in_progress" });
        await app.refundCredits({
          workspaceId,
          key: "voice_clone_training",
          refTable: "VoiceConsent",
          refId: consent.id,
          chargeId: charge.chargeId,
        });
        throw error;
      }

      let profile: CreatedVoiceProfile;
      try {
        profile = await prisma.$transaction(async tx => {
          const activeConsent = await tx.voiceConsent.updateMany({
            where: {
              id: consent.id,
              workspaceId,
              artistId: input.artistId,
              revokedAt: null,
            },
            data: { revokedAt: null },
          });
          if (activeConsent.count !== 1)
            throw new Error("voice_consent_revoked_before_profile_persistence");
          return tx.voiceProfile.create({
            data: {
              workspaceId,
              artistId: input.artistId,
              consentId: consent.id,
              name: input.name,
              provider: "replicate",
              status: "TRAINING",
              sampleUrls: [input.datasetZipUrl],
              voiceDatasetId: datasetReceipt?.id ?? null,
              destinationModel: destination ?? null,
              trainingMeta: {
                workspaceId,
                artistId: input.artistId,
                consentId: consent.id,
                datasetZipUrl: input.datasetZipUrl,
                datasetId: datasetReceipt?.id ?? null,
                datasetContentHash: datasetReceipt?.contentHash ?? null,
                datasetSeconds: datasetReceipt?.totalSeconds ?? null,
                trainer: `${cfg.model}@${cfg.version}`,
                trainerKind: cfg.kind,
                kickoff: "pending",
                at: new Date().toISOString(),
                ...(externalDataset ? { externalDataset: true } : {}),
              } as never,
            },
          });
        });
      } catch (error) {
        const consentChanged =
          error instanceof Error &&
          error.message === "voice_consent_revoked_before_profile_persistence";
        await Promise.all([
          prisma.providerJob.updateMany({
            where: { id: auditJob.id, status: "RUNNING" },
            data: {
              status: consentChanged ? "CANCELED" : "FAILED",
              finishedAt: new Date(),
              errorJson: {
                message: consentChanged
                  ? "voice consent revoked before profile persistence"
                  : "voice profile persistence failed",
              } as never,
            },
          }),
          app.refundCredits({
            workspaceId,
            key: "voice_clone_training",
            refTable: "VoiceConsent",
            refId: consent.id,
            chargeId: charge.chargeId,
          }),
        ]);
        if (consentChanged)
          return reply.code(409).send({ error: "voice_consent_revoked" });
        throw error;
      }

      await prisma.providerJob.update({
        where: { id: auditJob.id },
        data: {
          inputJson: {
            voiceProfileId: profile.id,
            artistId: profile.artistId,
            consentId: profile.consentId,
            datasetId: datasetReceipt?.id ?? null,
            datasetContentHash: datasetReceipt?.contentHash ?? null,
            datasetFingerprint: createHash("sha256")
              .update(input.datasetZipUrl)
              .digest("hex"),
            trainer: `${cfg.model}@${cfg.version}`,
            trainerKind: cfg.kind,
          } as never,
        },
      });

      // Workspace-pasted Replicate key (Settings → Music engine) overrides env.
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      const replicateApiKey =
        ws?.musicProvider === "replicate"
          ? openSecret(ws.musicApiKey)
          : undefined;

      const providerDatasetUrl = await presignAssetRef(
        input.datasetZipUrl,
        3600
      );
      const invocationProfile = await loadVoiceLineage(workspaceId, profile.id);
      const invocationFailure = invocationProfile
        ? voiceLineageFailure(invocationProfile, workspaceId)
        : "voice_profile_not_found";
      if (invocationFailure || invocationProfile?.status !== "TRAINING") {
        await Promise.all([
          app.refundCredits({
            workspaceId,
            key: "voice_clone_training",
            refTable: "VoiceConsent",
            refId: consent.id,
            chargeId: charge.chargeId,
          }),
          prisma.providerJob.updateMany({
            where: { id: auditJob.id, status: "RUNNING" },
            data: {
              status: "CANCELED",
              finishedAt: new Date(),
              errorJson: {
                message: invocationFailure ?? "voice_profile_not_training",
              } as never,
            },
          }),
        ]);
        return reply
          .code(409)
          .send({ error: invocationFailure ?? "voice_profile_not_training" });
      }

      let training;
      try {
        training = await startVoiceTraining({
          datasetZipUrl: providerDatasetUrl,
          destination,
          apiKey: replicateApiKey,
        });
      } catch (err) {
        // Kickoff never happened — the charge must not stand.
        await Promise.all([
          app.refundCredits({
            workspaceId,
            key: "voice_clone_training",
            refTable: "VoiceConsent",
            refId: consent.id,
            chargeId: charge.chargeId,
          }),
          prisma.providerJob.updateMany({
            where: { id: auditJob.id, status: "RUNNING" },
            data: {
              status: "FAILED",
              finishedAt: new Date(),
              errorJson: {
                message: "voice training provider rejected kickoff",
              } as never,
            },
          }),
          prisma.voiceProfile.updateMany({
            where: { id: profile.id, workspaceId, status: { not: "REVOKED" } },
            data: {
              status: "FAILED",
              trainingMeta: {
                kickoff: "failed",
                failedAt: new Date().toISOString(),
              } as never,
            },
          }),
        ]);
        const e = err as Error & { statusCode?: number };
        req.log.warn({ err: e, workspaceId }, "voice training kickoff failed");
        return reply.code(e.statusCode ?? 502).send({
          error: "voice_training_start_failed",
          note: "The voice-training provider did not accept the request. Check its configuration and try again.",
        });
      }

      const persistedTraining = await prisma.$transaction(async tx => {
        const activeConsent = await tx.voiceConsent.updateMany({
          where: {
            id: profile.consentId,
            workspaceId,
            artistId: profile.artistId,
            revokedAt: null,
          },
          data: { revokedAt: null },
        });
        if (activeConsent.count !== 1) return { count: 0 };
        return tx.voiceProfile.updateMany({
          where: {
            id: profile.id,
            workspaceId,
            artistId: profile.artistId,
            consentId: profile.consentId,
            status: "TRAINING",
            consent: {
              workspaceId,
              artistId: profile.artistId,
              revokedAt: null,
            },
          },
          data: {
            trainingId: training.id,
            trainingMeta: {
              workspaceId,
              artistId: profile.artistId,
              consentId: profile.consentId,
              datasetZipUrl: input.datasetZipUrl,
              datasetId: datasetReceipt?.id ?? null,
              datasetContentHash: datasetReceipt?.contentHash ?? null,
              datasetSeconds: datasetReceipt?.totalSeconds ?? null,
              trainer: `${training.model}@${training.version}`,
              trainerKind: training.kind,
              kickoff: "accepted",
              at: new Date().toISOString(),
              ...(externalDataset ? { externalDataset: true } : {}),
            } as never,
          },
        });
      });
      if (persistedTraining.count !== 1) {
        const canceled = await cancelVoiceTraining(
          training.id,
          training.kind,
          replicateApiKey
        ).catch(() => false);
        if (!canceled) {
          const stale = await prisma.voiceProfile.findFirst({
            where: { id: profile.id, workspaceId },
            select: { trainingMeta: true },
          });
          if (stale) {
            const staleMeta = objectValue(stale.trainingMeta);
            await prisma.voiceProfile.update({
              where: { id: profile.id },
              data: {
                trainingMeta: {
                  ...staleMeta,
                  providerCleanup: {
                    ...objectValue(staleMeta.providerCleanup),
                    status: "retry_required",
                    trainingId: training.id,
                    trainerKind: training.kind,
                    canceled: false,
                  },
                } as never,
              },
            });
            await createQueuedProviderJob({
              app,
              queue: app.queues.voice,
              jobName: "voice-cleanup",
              workspaceId,
              kind: "voice_cleanup",
              provider: "internal",
              inputJson: {
                voiceProfileId: profile.id,
                reason: "consent_changed_during_training_kickoff",
              },
              idempotencyKey: `voice-cleanup:${profile.id}:training-${training.id}`,
              payload: jobId => ({
                jobId,
                workspaceId,
                voiceProfileId: profile.id,
              }),
              delayMs: 30_000,
            }).catch(error => {
              req.log.warn(
                { err: error, voiceProfileId: profile.id },
                "voice training cleanup enqueue failed"
              );
            });
          }
        }
        await Promise.all([
          app.refundCredits({
            workspaceId,
            key: "voice_clone_training",
            refTable: "VoiceConsent",
            refId: consent.id,
            chargeId: charge.chargeId,
          }),
          prisma.providerJob.updateMany({
            where: { id: auditJob.id, status: "RUNNING" },
            data: {
              status: "CANCELED",
              finishedAt: new Date(),
              errorJson: {
                message: "voice consent changed before training persistence",
              } as never,
            },
          }),
        ]);
        return reply
          .code(409)
          .send({ error: "voice_consent_changed", providerCanceled: canceled });
      }
      profile = await prisma.voiceProfile.findUniqueOrThrow({
        where: { id: profile.id },
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
        note: "Training started. Poll GET /voices/:id/training — succeeded flips the profile to READY.",
      };
      const completedAudit = await prisma.providerJob.updateMany({
        where: { id: auditJob.id, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          externalId: training.id,
          outputJson: result as never,
        },
      });
      if (completedAudit.count !== 1)
        return reply.code(409).send({ error: "voice_training_canceled" });
      return result;
    }
  );

  /**
   * Poll the training run and sync the profile to its honest state:
   * succeeded → READY (+trainedVersion), failed/canceled → FAILED (+error).
   */
  app.get<{ Params: { voiceId: string } }>(
    "/:voiceId/training",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const profile = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: req.params.voiceId, workspaceId },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      if (profile.status === "REVOKED") {
        return reply.code(410).send({ error: "voice_revoked" });
      }
      const lineageFailure = voiceLineageFailure(profile, workspaceId);
      if (lineageFailure)
        return reply.code(409).send({ error: lineageFailure });
      if (!profile.trainingId) {
        return reply.code(404).send({
          error: "no_training",
          note: "This voice profile was not created via POST /voices/train.",
        });
      }

      // Terminal states are already synced — answer from the row, no re-poll.
      if (profile.status === "READY" || profile.status === "FAILED") {
        if (
          profile.status === "READY" &&
          !trainedArtifactIdentifier([
            profile.trainedVersion,
            objectValue(profile.trainingMeta).output,
          ])
        ) {
          await prisma.voiceProfile.updateMany({
            where: {
              id: profile.id,
              workspaceId,
              status: "READY",
              consent: {
                workspaceId,
                artistId: profile.artistId,
                revokedAt: null,
              },
            },
            data: {
              status: "FAILED",
              trainedVersion: null,
              trainingMeta: {
                ...objectValue(profile.trainingMeta),
                error: "trained_model_artifact_missing",
                finishedAt: new Date().toISOString(),
              } as never,
            },
          });
          return {
            profileId: profile.id,
            status: "FAILED",
            trainingId: profile.trainingId,
            error: "trained_model_artifact_missing",
          };
        }
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
      const replicateApiKey =
        ws?.musicProvider === "replicate"
          ? openSecret(ws.musicApiKey)
          : undefined;
      // This reload is intentionally the final operation before the provider poll.
      const invocationProfile = await prisma.voiceProfile.findFirst({
        where: { id: profile.id, workspaceId },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      const invocationFailure = invocationProfile
        ? voiceLineageFailure(invocationProfile, workspaceId)
        : "voice_profile_not_found";
      if (
        invocationFailure ||
        !invocationProfile?.trainingId ||
        invocationProfile.status === "REVOKED"
      ) {
        return reply
          .code(
            invocationFailure === "voice_consent_revoked" ||
              invocationProfile?.status === "REVOKED"
              ? 410
              : 409
          )
          .send({ error: invocationFailure ?? "voice_revoked" });
      }
      const invocationMeta = objectValue(invocationProfile.trainingMeta);
      const trainerKind: VoiceTrainerConfig["kind"] =
        invocationMeta.trainerKind === "training" ? "training" : "prediction";
      const state = await getVoiceTraining(
        invocationProfile.trainingId,
        replicateApiKey,
        trainerKind
      );

      const completedArtifact =
        state.status === "succeeded"
          ? trainedArtifactIdentifier(state.output)
          : null;
      const deleteUnpersistedVersion = async () => {
        const providerVersion = providerVersionFromArtifact(completedArtifact);
        if (!providerVersion || !invocationProfile.destinationModel) return;
        const deleted = await deleteVoiceModelVersion(
          invocationProfile.destinationModel,
          providerVersion,
          replicateApiKey
        ).catch(() => false);
        if (!deleted) {
          req.log.warn(
            {
              voiceProfileId: invocationProfile.id,
              destinationModel: invocationProfile.destinationModel,
              providerVersion,
            },
            "unpersisted voice model version cleanup failed"
          );
        }
      };

      // This is the first awaited operation after the provider response and the
      // final profile/consent read before any state from that response is stored.
      const persistenceProfile = await loadVoiceLineage(
        workspaceId,
        invocationProfile.id
      );
      const persistenceFailure = persistenceProfile
        ? voiceLineageFailure(persistenceProfile, workspaceId)
        : "voice_profile_not_found";
      const persistenceChanged =
        !persistenceProfile ||
        persistenceProfile.trainingId !== invocationProfile.trainingId ||
        !["PENDING", "TRAINING"].includes(persistenceProfile.status);
      if (persistenceFailure || persistenceChanged) {
        if (persistenceProfile?.status !== "READY") {
          await deleteUnpersistedVersion();
        }
        return reply
          .code(
            persistenceFailure === "voice_consent_revoked" ||
              persistenceProfile?.status === "REVOKED"
              ? 410
              : 409
          )
          .send({
            error:
              persistenceFailure ?? "voice_training_changed_before_persistence",
          });
      }
      const persistenceMeta = objectValue(persistenceProfile.trainingMeta);

      if (state.status === "succeeded") {
        const trainedVersion = completedArtifact;
        if (!trainedVersion) {
          const persistedFailure = await prisma.$transaction(async tx => {
            const activeConsent = await tx.voiceConsent.updateMany({
              where: {
                id: persistenceProfile.consentId,
                workspaceId,
                artistId: persistenceProfile.artistId,
                revokedAt: null,
              },
              data: { revokedAt: null },
            });
            if (activeConsent.count !== 1) return { count: 0 };
            return tx.voiceProfile.updateMany({
              where: {
                id: persistenceProfile.id,
                workspaceId,
                artistId: persistenceProfile.artistId,
                consentId: persistenceProfile.consentId,
                trainingId: persistenceProfile.trainingId,
                status: { in: ["PENDING", "TRAINING"] },
                consent: {
                  workspaceId,
                  artistId: persistenceProfile.artistId,
                  revokedAt: null,
                },
              },
              data: {
                status: "FAILED",
                trainedVersion: null,
                trainingMeta: {
                  ...persistenceMeta,
                  output: state.output ?? null,
                  error: "trained_model_artifact_missing",
                  finishedAt: new Date().toISOString(),
                } as never,
              },
            });
          });
          if (persistedFailure.count !== 1)
            return reply
              .code(409)
              .send({ error: "voice_profile_state_changed" });
          return {
            profileId: persistenceProfile.id,
            status: "FAILED",
            trainingId: persistenceProfile.trainingId,
            error: "trained_model_artifact_missing",
          };
        }
        const persisted = await prisma.$transaction(async tx => {
          const activeConsent = await tx.voiceConsent.updateMany({
            where: {
              id: persistenceProfile.consentId,
              workspaceId,
              artistId: persistenceProfile.artistId,
              revokedAt: null,
            },
            data: { revokedAt: null },
          });
          if (activeConsent.count !== 1) return { count: 0 };
          return tx.voiceProfile.updateMany({
            where: {
              id: persistenceProfile.id,
              workspaceId,
              artistId: persistenceProfile.artistId,
              consentId: persistenceProfile.consentId,
              trainingId: persistenceProfile.trainingId,
              status: { in: ["PENDING", "TRAINING"] },
              consent: {
                workspaceId,
                artistId: persistenceProfile.artistId,
                revokedAt: null,
              },
            },
            data: {
              status: "READY",
              trainedVersion,
              trainingMeta: {
                ...persistenceMeta,
                output: state.output ?? null,
                finishedAt: new Date().toISOString(),
              } as never,
            },
          });
        });
        if (persisted.count !== 1) {
          const latest = await loadVoiceLineage(
            workspaceId,
            persistenceProfile.id
          );
          const failure = latest
            ? voiceLineageFailure(latest, workspaceId)
            : "voice_profile_not_found";
          if (latest?.status !== "READY") await deleteUnpersistedVersion();
          return reply
            .code(
              failure === "voice_consent_revoked" ||
                latest?.status === "REVOKED"
                ? 410
                : 409
            )
            .send({ error: failure ?? "voice_profile_state_changed" });
        }
        const updated = await prisma.voiceProfile.findUniqueOrThrow({
          where: { id: persistenceProfile.id },
        });
        // DURABILITY (audit 2026-07-13): the trained model file arrives as an
        // EPHEMERAL replicate.delivery URL — re-host it to OWNED storage so the
        // voice can still /sing after the provider link expires. Fire on the worker
        // (streams a 100-500MB weights file; never blocks this poll).
        const modelUrl = trainedModelUrl({
          trainedVersion,
          trainingMeta: { output: state.output },
        });
        if (
          modelUrl &&
          /replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(modelUrl)
        ) {
          await queueVoiceRehost(
            app,
            workspaceId,
            persistenceProfile.id,
            modelUrl
          ).catch(error => {
            req.log.warn(
              { err: error, voiceProfileId: persistenceProfile.id },
              "voice model rehost enqueue failed"
            );
          });
        }
        return {
          profileId: updated.id,
          status: updated.status,
          trainingId: updated.trainingId,
        };
      }

      if (state.status === "failed" || state.status === "canceled") {
        const persisted = await prisma.$transaction(async tx => {
          const activeConsent = await tx.voiceConsent.updateMany({
            where: {
              id: persistenceProfile.consentId,
              workspaceId,
              artistId: persistenceProfile.artistId,
              revokedAt: null,
            },
            data: { revokedAt: null },
          });
          if (activeConsent.count !== 1) return { count: 0 };
          return tx.voiceProfile.updateMany({
            where: {
              id: persistenceProfile.id,
              workspaceId,
              artistId: persistenceProfile.artistId,
              consentId: persistenceProfile.consentId,
              trainingId: persistenceProfile.trainingId,
              status: { in: ["PENDING", "TRAINING"] },
              consent: {
                workspaceId,
                artistId: persistenceProfile.artistId,
                revokedAt: null,
              },
            },
            data: {
              status: "FAILED",
              trainingMeta: {
                ...persistenceMeta,
                error: state.error ?? state.status,
                finishedAt: new Date().toISOString(),
              } as never,
            },
          });
        });
        if (persisted.count !== 1)
          return reply.code(409).send({ error: "voice_profile_state_changed" });
        const updated = await prisma.voiceProfile.findUniqueOrThrow({
          where: { id: persistenceProfile.id },
        });
        return {
          profileId: updated.id,
          status: updated.status,
          trainingId: updated.trainingId,
        };
      }

      // starting / processing — still in flight.
      return {
        profileId: persistenceProfile.id,
        status: persistenceProfile.status,
        trainingId: persistenceProfile.trainingId,
        replicateStatus: state.status,
      };
    }
  );

  /**
   * RE-HOST the trained model to durable storage (durability audit 2026-07-13).
   * Backfill for voices trained before the fix, whose trainedVersion is still an
   * ephemeral provider URL — without this they stop being able to /sing once the
   * link expires. Idempotent; the worker streams the weights and repoints
   * trainedVersion at the owned URL. Workspace-scoped — your own models only.
   */
  app.post<{ Params: { voiceId: string } }>(
    "/:voiceId/rehost",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const profile = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: req.params.voiceId, workspaceId },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      const lineageFailure = voiceLineageFailure(profile, workspaceId);
      if (lineageFailure || profile.status === "REVOKED") {
        return reply
          .code(
            lineageFailure === "voice_consent_revoked" ||
              profile.status === "REVOKED"
              ? 410
              : 409
          )
          .send({ error: lineageFailure ?? "voice_revoked" });
      }
      const url = trainedModelUrl(profile);
      if (!url)
        return reply.code(400).send({
          error: "no_model_url",
          note: "This profile has no downloadable trained-model URL to re-host.",
        });
      if (
        isStorageUri(url) ||
        !/replicate\.delivery|\.blob\.core\.windows|fal\.media/i.test(url)
      ) {
        return reply.code(200).send({
          ok: true,
          alreadyDurable: true,
          note: "Model is already on owned storage — nothing to re-host.",
        });
      }
      const job = await queueVoiceRehost(app, workspaceId, profile.id, url);
      reply.code(202);
      return {
        ok: true,
        jobId: job.jobId,
        replayed: job.replayed,
        note: "Re-hosting the trained model to durable storage — poll GET /voices to watch trainedVersion flip to an owned URL.",
      };
    }
  );

  app.delete<{ Params: { voiceId: string } }>(
    "/:voiceId",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const target = await prisma.voiceProfile.findFirst({
        where: { id: req.params.voiceId, workspaceId },
        select: { id: true, consentId: true },
      });
      if (!target) return reply.code(404).send({ error: "voice_not_found" });

      // Consent is the authorization root. Revoking any child profile must revoke
      // every sibling profile. Profile creation locks this same row, so once this
      // update commits the following snapshot contains every committed child and
      // no new authorized child can be created.
      const revokedAt = new Date();
      const revokedAtIso = revokedAt.toISOString();
      const revokedConsent = await prisma.voiceConsent.updateMany({
        where: { id: target.consentId, workspaceId },
        data: { revokedAt },
      });
      if (revokedConsent.count !== 1)
        return reply.code(409).send({ error: "voice_consent_not_found" });

      const profiles: RevocationProfile[] = await prisma.voiceProfile.findMany({
        where: { workspaceId, consentId: target.consentId },
        include: { voiceDataset: { select: { id: true, url: true } } },
      });
      const profileIds = new Set<string>(profiles.map(profile => profile.id));

      const activeProfiles: ActiveRevocationProfile[] =
        await prisma.voiceProfile.findMany({
          where: {
            workspaceId,
            consentId: { not: target.consentId },
            status: { not: "REVOKED" },
          },
          select: {
            sampleUrls: true,
            trainedVersion: true,
            trainingMeta: true,
            voiceDatasetId: true,
            voiceDataset: { select: { url: true } },
          },
        });
      const activeRefs = new Set<string>();
      for (const active of activeProfiles) {
        collectOwnedVoiceRefs(active, activeRefs);
        if (active.voiceDataset?.url) activeRefs.add(active.voiceDataset.url);
      }
      const candidateRefsByProfile = new Map<string, Set<string>>();
      const candidateRefs = new Set<string>();
      for (const profile of profiles) {
        const refs = collectOwnedVoiceRefs({
          sampleUrls: profile.sampleUrls,
          trainedVersion: profile.trainedVersion,
          trainingMeta: profile.trainingMeta,
        });
        if (profile.voiceDataset?.url) refs.add(profile.voiceDataset.url);
        candidateRefsByProfile.set(profile.id, refs);
        for (const ref of refs) candidateRefs.add(ref);
      }
      const refs = new Set(
        [...candidateRefs].filter(ref => !activeRefs.has(ref))
      );
      const retainedSharedObjects = candidateRefs.size - refs.size;

      const activeDatasetIds = new Set(
        activeProfiles
          .map(profile => profile.voiceDatasetId)
          .filter((id): id is string => !!id)
      );
      const datasetIds = [
        ...new Set(
          profiles
            .map(profile => profile.voiceDatasetId)
            .filter((id): id is string => !!id && !activeDatasetIds.has(id))
        ),
      ];
      const datasetOwner = new Map<string, string>();
      for (const datasetId of datasetIds) {
        const owner = profiles.find(
          profile => profile.voiceDatasetId === datasetId
        );
        if (owner) datasetOwner.set(datasetId, owner.id);
      }

      const cleanupByProfile = new Map<string, VoiceProviderCleanup>(
        profiles.map((profile): [string, VoiceProviderCleanup] => {
          const meta = objectValue(profile.trainingMeta);
          const previous = objectValue(meta.providerCleanup);
          const artifact = trainedArtifactIdentifier([
            profile.trainedVersion,
            meta.output,
          ]);
          const providerVersion = providerVersionFromArtifact(artifact);
          const trainerKind: VoiceTrainerConfig["kind"] =
            previous.trainerKind === "training" ||
            meta.trainerKind === "training"
              ? "training"
              : "prediction";
          return [
            profile.id,
            {
              provider:
                typeof previous.provider === "string"
                  ? previous.provider
                  : profile.provider,
              providerVoiceId:
                typeof previous.providerVoiceId === "string"
                  ? previous.providerVoiceId
                  : profile.providerVoiceId,
              trainingId:
                typeof previous.trainingId === "string"
                  ? previous.trainingId
                  : profile.trainingId,
              trainerKind,
              destinationModel:
                typeof previous.destinationModel === "string"
                  ? previous.destinationModel
                  : profile.destinationModel,
              providerVersion:
                typeof previous.providerVersion === "string"
                  ? previous.providerVersion
                  : providerVersion,
              datasetIds: datasetIds.filter(
                id => datasetOwner.get(id) === profile.id
              ),
              canceled: previous.canceled === true,
              versionDeleted: previous.versionDeleted === true,
              providerVoiceDeleted: previous.providerVoiceDeleted === true,
            },
          ];
        })
      );

      const jobCandidates: CancelableVoiceJob[] = (
        await prisma.providerJob.findMany({
          where: {
            workspaceId,
            OR: [
              {
                status: "QUEUED",
                kind: { in: ["voice", "voice_profile", "voice-rehost"] },
              },
              { status: "RUNNING", kind: "voice-training-start" },
            ],
          },
          select: {
            id: true,
            kind: true,
            status: true,
            inputJson: true,
            chargeLedgerId: true,
            outbox: { select: { payload: true } },
          },
        })
      ).filter((job: CancelableVoiceJob) =>
        jobReferencesVoiceLineage(job, profileIds, target.consentId)
      );

      await prisma.$transaction([
        ...profiles.map(profile =>
          prisma.voiceProfile.updateMany({
            where: {
              id: profile.id,
              workspaceId,
              consentId: target.consentId,
            },
            data: {
              status: "REVOKED",
              providerVoiceId: null,
              trainedVersion: null,
              sampleUrls: [],
              destinationModel: null,
              voiceDatasetId: null,
              trainingId: null,
              trainingMeta: {
                ...objectValue(profile.trainingMeta),
                revokedAt: revokedAtIso,
                providerCleanup: {
                  ...(cleanupByProfile.get(profile.id) ?? {}),
                  status: "pending",
                },
              } as never,
            },
          })
        ),
        ...jobCandidates.map(job =>
          prisma.providerJob.updateMany({
            where: { id: job.id, status: job.status },
            data: {
              status: "CANCELED",
              finishedAt: revokedAt,
              errorJson: {
                message: "voice consent revoked before execution",
              } as never,
            },
          })
        ),
      ]);

      const canceledJobs: CanceledVoiceJob[] = jobCandidates.length
        ? await prisma.providerJob.findMany({
            where: {
              id: { in: jobCandidates.map(job => job.id) },
              status: "CANCELED",
            },
            select: {
              id: true,
              kind: true,
              inputJson: true,
              chargeLedgerId: true,
            },
          })
        : [];
      const queuedCandidateIds = new Set(
        jobCandidates.filter(job => job.status === "QUEUED").map(job => job.id)
      );
      const queueRemovals = await Promise.allSettled(
        canceledJobs
          .filter(job => queuedCandidateIds.has(job.id))
          .map(job => app.queues.voice.remove(`provider-${job.id}`))
      );
      const removedQueuedJobs = queueRemovals.reduce(
        (sum, result) =>
          result.status === "fulfilled" ? sum + result.value : sum,
        0
      );
      const queueRemovalFailures = queueRemovals.filter(
        result => result.status === "rejected"
      ).length;
      const refunds = await Promise.allSettled(
        canceledJobs.map(async job => {
          const key = voiceJobCreditKey(job.kind, job.inputJson);
          if (!key || !job.chargeLedgerId) return false;
          const refund = await app.refundCredits({
            workspaceId,
            key,
            refTable: "ProviderJob",
            refId: job.id,
            chargeId: job.chargeLedgerId,
          });
          return refund.refunded;
        })
      );
      const refundedJobs = refunds.filter(
        result => result.status === "fulfilled" && result.value
      ).length;

      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      const apiKey =
        ws?.musicProvider === "replicate"
          ? openSecret(ws.musicApiKey)
          : undefined;
      const providerResults = await Promise.all(
        profiles.map(async profile => {
          const cleanup = cleanupByProfile.get(profile.id);
          if (!cleanup) throw new Error("voice_cleanup_lineage_missing");
          let canceled = cleanup.canceled || !cleanup.trainingId;
          let versionDeleted =
            cleanup.versionDeleted ||
            !cleanup.destinationModel ||
            !cleanup.providerVersion;
          let providerVoiceDeleted =
            cleanup.providerVoiceDeleted ||
            !cleanup.providerVoiceId ||
            cleanup.provider === "stub";
          try {
            if (!providerVoiceDeleted && cleanup.providerVoiceId) {
              providerVoiceDeleted = await deleteHostedVoice(
                cleanup.provider,
                cleanup.providerVoiceId
              );
            }
            if (!canceled && cleanup.trainingId) {
              canceled = await cancelVoiceTraining(
                cleanup.trainingId,
                cleanup.trainerKind,
                apiKey
              );
            }
            if (
              !versionDeleted &&
              cleanup.destinationModel &&
              cleanup.providerVersion
            ) {
              versionDeleted = await deleteVoiceModelVersion(
                cleanup.destinationModel,
                cleanup.providerVersion,
                apiKey
              );
            }
          } catch (error) {
            req.log.warn(
              { error, voiceProfileId: profile.id },
              "voice provider cleanup failed"
            );
            canceled = false;
            versionDeleted = false;
            providerVoiceDeleted = false;
          }
          return {
            profileId: profile.id,
            canceled,
            versionDeleted,
            providerVoiceDeleted,
          };
        })
      );

      const refList = [...refs];
      const deleted = await Promise.allSettled(refList.map(deleteAssetRef));
      const deletionFailures = deleted.filter(
        result => result.status === "rejected"
      ).length;
      const failedStorageRefs = refList.filter(
        (_ref, index) => deleted[index]?.status === "rejected"
      );
      let datasetReceiptFailures = 0;
      const failedStorageSet = new Set(failedStorageRefs);
      const safeDatasetIds = datasetIds.filter(id => {
        const profile = profiles.find(
          candidate => candidate.voiceDatasetId === id
        );
        return (
          !profile?.voiceDataset?.url ||
          !failedStorageSet.has(profile.voiceDataset.url)
        );
      });
      if (safeDatasetIds.length) {
        try {
          await prisma.voiceDataset.deleteMany({
            where: { id: { in: safeDatasetIds }, workspaceId },
          });
        } catch {
          datasetReceiptFailures = safeDatasetIds.length;
        }
      }

      const failedRefOwner = new Map<string, string>();
      for (const ref of failedStorageRefs) {
        const owner = profiles.find(profile =>
          candidateRefsByProfile.get(profile.id)?.has(ref)
        );
        if (owner) failedRefOwner.set(ref, owner.id);
      }
      const cleanupJobIds: string[] = [];
      let providerCleanupFailures = 0;
      for (const profile of profiles) {
        const cleanup = cleanupByProfile.get(profile.id);
        if (!cleanup) throw new Error("voice_cleanup_lineage_missing");
        const providerResult = providerResults.find(
          result => result.profileId === profile.id
        )!;
        const profileFailedRefs = failedStorageRefs.filter(
          ref => failedRefOwner.get(ref) === profile.id
        );
        const profileDatasetFailures = cleanup.datasetIds.filter(
          id => !safeDatasetIds.includes(id) || datasetReceiptFailures > 0
        ).length;
        const profileProviderFailures =
          Number(!providerResult.canceled) +
          Number(!providerResult.versionDeleted) +
          Number(!providerResult.providerVoiceDeleted);
        providerCleanupFailures += profileProviderFailures;
        let cleanupJobId: string | null = null;
        if (
          profileProviderFailures ||
          profileFailedRefs.length ||
          profileDatasetFailures
        ) {
          const cleanupFingerprint = createHash("sha256")
            .update(JSON.stringify({ cleanup, profileFailedRefs }))
            .digest("hex")
            .slice(0, 20);
          const cleanupJob = await createQueuedProviderJob({
            app,
            queue: app.queues.voice,
            jobName: "voice-cleanup",
            workspaceId,
            kind: "voice_cleanup",
            provider: "internal",
            inputJson: {
              voiceProfileId: profile.id,
              artistId: profile.artistId,
              consentId: profile.consentId,
              cleanupFingerprint,
            },
            idempotencyKey: `voice-cleanup:${profile.id}:${cleanupFingerprint}`,
            payload: jobId => ({
              jobId,
              workspaceId,
              voiceProfileId: profile.id,
            }),
            delayMs: 30_000,
          });
          cleanupJobId = cleanupJob.jobId;
          cleanupJobIds.push(cleanupJob.jobId);
        }
        await prisma.voiceProfile.update({
          where: { id: profile.id },
          data: {
            trainingMeta: {
              workspaceId,
              artistId: profile.artistId,
              consentId: profile.consentId,
              revokedAt: revokedAtIso,
              providerCleanup: {
                ...cleanup,
                status:
                  profileProviderFailures ||
                  profileFailedRefs.length ||
                  profileDatasetFailures
                    ? "retry_required"
                    : "complete",
                ...providerResult,
                failedStorageRefs: profileFailedRefs,
                datasetReceiptsDeleted: profileDatasetFailures === 0,
                cleanupJobId,
              },
            } as never,
          },
        });
      }
      reply.code(200);
      return {
        revoked: true,
        revokedProfiles: profiles.length,
        canceledJobs: canceledJobs.length,
        removedQueuedJobs,
        queueRemovalFailures,
        refundedJobs,
        deletedObjects: refs.size - deletionFailures,
        deletionFailures,
        providerCleanupFailures,
        datasetReceiptFailures,
        retainedSharedObjects,
        cleanupQueued: cleanupJobIds.length,
      };
    }
  );

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
    "/:voiceId/sing",
    { schema: { body: voiceSingInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = voiceSingInputSchema.parse(req.body);
      if (!input.songId && !input.songUrl) {
        return reply.code(400).send({
          error: "source_required",
          note: "Pass songId (catalog song) or songUrl (any hosted track/vocal).",
        });
      }

      const voice = await prisma.voiceProfile.findFirst({
        where: { id: req.params.voiceId, workspaceId },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      if (!voice) return reply.code(404).send({ error: "voice_not_found" });
      const lineageFailure = voiceLineageFailure(voice, workspaceId);
      if (lineageFailure) {
        return reply
          .code(lineageFailure === "voice_consent_revoked" ? 410 : 409)
          .send({ error: lineageFailure });
      }
      if (voice.status !== "READY") {
        return reply.code(409).send({
          error: "voice_not_ready",
          status: voice.status,
          note: "Train the voice first (POST /voices/train), then poll GET /voices/:id/training until READY.",
        });
      }
      const modelUrl = trainedModelUrl(voice);
      const modelArtifactId = trainedArtifactIdentifier([
        voice.trainedVersion,
        objectValue(voice.trainingMeta).output,
      ]);
      if (!modelUrl || !modelArtifactId) {
        return reply.code(409).send({
          error: "no_trained_model_file",
          note: "This profile has no downloadable trained-model URL. The default prediction trainer (replicate/train-rvc-model) outputs one; destination-based trainers do not — retrain with the default trainer to use /sing.",
        });
      }

      // Resolve the performance to convert: explicit URL, or the song's
      // freshest playable audio (master → mix → beat by createdAt).
      let songInputUrl = input.songUrl ?? null;
      if (songInputUrl) {
        if (input.rightsConfirmed !== true) {
          return reply.code(422).send({
            error: "performance_rights_confirmation_required",
            note: "Confirm you own or are licensed to convert this external performance.",
          });
        }
        const owned = assertWorkspaceAsset(workspaceId, songInputUrl);
        if (!owned) {
          const check = await assertSafeUrl(songInputUrl);
          if (!check.ok)
            return reply
              .code(check.code)
              .send({ error: check.error, message: check.message });
        }
      }
      let song: { id: string; projectId: string } | null = null;
      if (!songInputUrl && input.songId) {
        const s = await prisma.song.findFirst({
          where: { id: input.songId, workspaceId },
          include: {
            masters: { orderBy: { createdAt: "desc" }, take: 1 },
            mixes: { orderBy: { createdAt: "desc" }, take: 1 },
            beats: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        });
        if (!s) return reply.code(404).send({ error: "song_not_found" });
        const current = currentPlayableAsset(s);
        songInputUrl = current?.url ?? null;
        if (!songInputUrl) {
          return reply.code(400).send({
            error: "song_has_no_audio",
            note: "Render the song first — /sing converts an existing performance, it cannot invent one.",
          });
        }
        song = { id: s.id, projectId: s.projectId };
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "voice-sing"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "voice_sing_render",
        refTable: "VoiceProfile",
        refId: voice.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      // Re-read after source resolution and charging; this is the final action
      // before persisting the provider job.
      const invocationVoice = await prisma.voiceProfile.findFirst({
        where: { id: voice.id, workspaceId },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      const invocationFailure = invocationVoice
        ? voiceLineageFailure(invocationVoice, workspaceId)
        : "voice_profile_not_found";
      const invocationModelUrl = invocationVoice
        ? trainedModelUrl(invocationVoice)
        : null;
      const invocationArtifactId = invocationVoice
        ? trainedArtifactIdentifier([
            invocationVoice.trainedVersion,
            objectValue(invocationVoice.trainingMeta).output,
          ])
        : null;
      if (
        invocationFailure ||
        invocationVoice?.status !== "READY" ||
        !invocationModelUrl ||
        !invocationArtifactId
      ) {
        await app.refundCredits({
          workspaceId,
          key: "voice_sing_render",
          refTable: "VoiceProfile",
          refId: voice.id,
          chargeId: charge.chargeId,
        });
        return reply
          .code(invocationFailure === "voice_consent_revoked" ? 410 : 409)
          .send({
            error:
              invocationFailure ??
              (invocationVoice?.status !== "READY"
                ? "voice_not_ready"
                : "no_trained_model_file"),
          });
      }
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: "sing-convert",
        workspaceId,
        projectId: song?.projectId,
        kind: "voice",
        provider: "replicate",
        inputJson: {
          sing: true,
          voiceProfileId: invocationVoice.id,
          artistId: invocationVoice.artistId,
          consentId: invocationVoice.consentId,
          voiceDatasetId: invocationVoice.voiceDatasetId,
          datasetContentHash: invocationVoice.voiceDataset?.contentHash ?? null,
          modelArtifactId: invocationArtifactId,
          songId: song?.id,
          songInputUrl,
          pitchChange: input.pitchChange,
          tuning: input.tuning,
        },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          voiceProfileId: invocationVoice.id,
          artistId: invocationVoice.artistId,
          consentId: invocationVoice.consentId,
          modelUrl: invocationModelUrl,
          songInputUrl,
          pitchChange: input.pitchChange,
          tuning: input.tuning,
          songId: song?.id,
          projectId: song?.projectId,
        }),
      });

      const persistedVoice = await loadVoiceLineage(
        workspaceId,
        invocationVoice.id
      );
      const persistenceFailure = persistedVoice
        ? voiceLineageFailure(persistedVoice, workspaceId)
        : "voice_profile_not_found";
      if (persistenceFailure || persistedVoice?.status !== "READY") {
        await Promise.allSettled([
          prisma.providerJob.updateMany({
            where: { id: job.jobId, workspaceId, status: "QUEUED" },
            data: {
              status: "CANCELED",
              finishedAt: new Date(),
              errorJson: {
                message: persistenceFailure ?? "voice profile state changed",
              } as never,
            },
          }),
          app.queues.voice.remove(`provider-${job.jobId}`),
          app.refundCredits({
            workspaceId,
            key: "voice_sing_render",
            refTable: "ProviderJob",
            refId: job.jobId,
            chargeId: charge.chargeId,
          }),
        ]);
        return reply
          .code(persistenceFailure === "voice_consent_revoked" ? 410 : 409)
          .send({ error: persistenceFailure ?? "voice_profile_state_changed" });
      }

      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        note: "Converting — the trained voice sings whatever the input sings (melody + timing come from the input vocal). Takes a few minutes; poll GET /jobs/:jobId for the result URL.",
      };
    }
  );

  app.post<{ Params: { voiceId: string }; Body: { text: string } }>(
    "/:voiceId/test",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const voice = await prisma.voiceProfile.findFirstOrThrow({
        where: { id: req.params.voiceId, workspaceId, status: "READY" },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      const lineageFailure = voiceLineageFailure(voice, workspaceId);
      if (lineageFailure) {
        return reply
          .code(lineageFailure === "voice_consent_revoked" ? 410 : 409)
          .send({ error: lineageFailure });
      }
      if (
        voice.provider !== "eleven" ||
        !voice.providerVoiceId ||
        !/^[a-zA-Z0-9_-]{6,128}$/.test(voice.providerVoiceId)
      ) {
        return reply.code(409).send({
          error: "speech_preview_unavailable",
          note: "This is a singing-conversion voice, not a text-to-speech profile. Use POST /voices/:voiceId/sing with an existing sung performance.",
        });
      }
      const text =
        typeof req.body?.text === "string"
          ? req.body.text.trim().slice(0, 1_000)
          : "";
      if (!text) return reply.code(400).send({ error: "text_required" });
      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "voice-test"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "voice_render_30s",
        refTable: "VoiceProfile",
        refId: voice.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });
      const invocationVoice = await prisma.voiceProfile.findFirst({
        where: { id: voice.id, workspaceId, status: "READY" },
        include: {
          consent: {
            select: {
              id: true,
              workspaceId: true,
              artistId: true,
              revokedAt: true,
            },
          },
          voiceDataset: {
            select: { id: true, workspaceId: true, contentHash: true },
          },
        },
      });
      const invocationFailure = invocationVoice
        ? voiceLineageFailure(invocationVoice, workspaceId)
        : "voice_profile_not_found";
      if (
        invocationFailure ||
        invocationVoice?.provider !== "eleven" ||
        !invocationVoice.providerVoiceId ||
        !/^[a-zA-Z0-9_-]{6,128}$/.test(invocationVoice.providerVoiceId)
      ) {
        await app.refundCredits({
          workspaceId,
          key: "voice_render_30s",
          refTable: "VoiceProfile",
          refId: voice.id,
          chargeId: charge.chargeId,
        });
        return reply
          .code(invocationFailure === "voice_consent_revoked" ? 410 : 409)
          .send({ error: invocationFailure ?? "speech_preview_unavailable" });
      }
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.voice,
        jobName: "render-vocal",
        workspaceId,
        kind: "voice",
        provider: invocationVoice.provider,
        inputJson: {
          test: true,
          text,
          voiceProfileId: invocationVoice.id,
          artistId: invocationVoice.artistId,
          consentId: invocationVoice.consentId,
        },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          voiceProfileId: invocationVoice.id,
          artistId: invocationVoice.artistId,
          consentId: invocationVoice.consentId,
          provider: invocationVoice.provider,
          providerVoiceId: invocationVoice.providerVoiceId,
          lyricBody: text,
          role: "lead",
        }),
      });
      const persistedVoice = await loadVoiceLineage(
        workspaceId,
        invocationVoice.id
      );
      const persistenceFailure = persistedVoice
        ? voiceLineageFailure(persistedVoice, workspaceId)
        : "voice_profile_not_found";
      if (persistenceFailure || persistedVoice?.status !== "READY") {
        await Promise.allSettled([
          prisma.providerJob.updateMany({
            where: { id: job.jobId, workspaceId, status: "QUEUED" },
            data: {
              status: "CANCELED",
              finishedAt: new Date(),
              errorJson: {
                message: persistenceFailure ?? "voice profile state changed",
              } as never,
            },
          }),
          app.queues.voice.remove(`provider-${job.jobId}`),
          app.refundCredits({
            workspaceId,
            key: "voice_render_30s",
            refTable: "ProviderJob",
            refId: job.jobId,
            chargeId: charge.chargeId,
          }),
        ]);
        return reply
          .code(persistenceFailure === "voice_consent_revoked" ? 410 : 409)
          .send({ error: persistenceFailure ?? "voice_profile_state_changed" });
      }
      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );
}
