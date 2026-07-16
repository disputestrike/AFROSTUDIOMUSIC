import type { FastifyInstance } from "fastify";
import { createHash, createHmac } from "node:crypto";
import { openSecret, prisma } from "@afrohit/db";
import {
  LIKENESS_CONSENT_TEXT,
  LIKENESS_CONSENT_VERSION,
  LIKENESS_RIGHTS_BASIS,
  MIN_LIKENESS_TRAINING_PHOTOS,
  likenessConsentInputSchema,
  likenessPhotoAttachSchema,
  likenessPhotoPresignSchema,
  likenessTrainInputSchema,
  likenessTrainingGate,
} from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";
import { createQueuedProviderJob, scopedRequestKey } from "../lib/queued-job";
import {
  presignAssetRef,
  presignUpload,
  verifyUploadedImage,
} from "../lib/storage";
import {
  enforceDistributedUploadRate,
  reserveUploadBytes,
  uploadPolicyErrorResponse,
  uploadPolicyFromEnv,
} from "./uploads";

/**
 * ARTIST LIKENESS — "my picture and my videos are what get created; I'm the
 * face of my brand." OWN-FACE-ONLY, mirroring the /voices consent law:
 *
 *   1. Sign the versioned likeness consent (verbatim text, hashed).
 *   2. Upload photos of YOURSELF (presign → PUT → attach; magic-byte checked,
 *      every byte hashed, workspace-scoped, soft-deletable).
 *   3. Train (gated: operator flag + >=10 photos + live consent + provider
 *      key). Flux LoRA on Replicate; the worker owns the honest status
 *      transitions. Charges `likeness_training` credits (~$2-5 provider cost).
 *
 * Every trained model and every render made with one carries
 * rightsBasis 'user-attested-likeness'. No cross-tenant likeness, ever —
 * every query in this file is workspace-scoped.
 */

function likenessTrainingEnabled(): boolean {
  return (process.env.LIKENESS_TRAINING_ENABLED ?? "0") === "1";
}

async function workspaceReplicateKey(
  workspaceId: string
): Promise<string | undefined> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { musicProvider: true, musicApiKey: true },
  });
  return ws?.musicProvider === "replicate"
    ? (openSecret(ws.musicApiKey) ?? undefined)
    : undefined;
}

function replicateConfigured(workspaceKey: string | undefined): boolean {
  return Boolean(
    workspaceKey || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN
  );
}

/** The token that summons this face in prompts — deterministic from the stage
 *  name (e.g. "BXP"), never user-supplied free text into a provider payload. */
export function likenessTriggerWord(stageName: string): string {
  const cleaned = stageName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  return cleaned || "AFROHITFACE";
}

type LikenessRow = {
  id: string;
  artistId: string;
  kind: string;
  url: string;
  contentHash: string | null;
  consentId: string;
  status: string;
  trainedModelRef: string | null;
  meta: unknown;
  createdAt: Date;
};

function metaObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function likeness(app: FastifyInstance) {
  app.addHook("preHandler", async req => {
    requireRole(req, ["OWNER", "ADMIN"]);
  });

  app.get("/consent-terms", async () => ({
    version: LIKENESS_CONSENT_VERSION,
    text: LIKENESS_CONSENT_TEXT,
  }));

  app.get("/consents", async req => {
    const { workspaceId } = requireAuth(req);
    return prisma.likenessConsent.findMany({
      where: { workspaceId },
      orderBy: { signedAt: "desc" },
      select: {
        id: true,
        artistId: true,
        legalName: true,
        email: true,
        consentVersion: true,
        signedAt: true,
        revokedAt: true,
      },
    });
  });

  app.post(
    "/consents",
    { schema: { body: likenessConsentInputSchema } },
    async (req, reply) => {
      const { userId, workspaceId } = requireAuth(req);
      const input = likenessConsentInputSchema.parse(req.body);
      await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
      });
      const consent = await prisma.likenessConsent.create({
        data: {
          workspaceId,
          artistId: input.artistId,
          signerUserId: userId,
          legalName: input.legalName,
          email: input.email.toLowerCase(),
          consentText: LIKENESS_CONSENT_TEXT,
          consentVersion: LIKENESS_CONSENT_VERSION,
          consentTextHash: createHash("sha256")
            .update(LIKENESS_CONSENT_TEXT)
            .digest("hex"),
          ipHash: createHmac(
            "sha256",
            process.env.IP_HASH_SECRET ||
              process.env.JWT_SECRET ||
              process.env.INTERNAL_API_SECRET ||
              "local-development-only"
          )
            .update(req.ip)
            .digest("hex"),
          userAgent: req.headers["user-agent"]?.slice(0, 240) ?? null,
        },
      });
      reply.code(201);
      return {
        id: consent.id,
        artistId: consent.artistId,
        legalName: consent.legalName,
        email: consent.email,
        consentVersion: consent.consentVersion,
        signedAt: consent.signedAt,
        revokedAt: consent.revokedAt,
      };
    }
  );

  /** Revoke = the likeness may no longer train or render. Photos stay soft. */
  app.post<{ Params: { consentId: string } }>(
    "/consents/:consentId/revoke",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const revoked = await prisma.likenessConsent.updateMany({
        where: { id: req.params.consentId, workspaceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        return reply.code(404).send({ error: "likeness_consent_not_found" });
      }
      return { id: req.params.consentId, revoked: true };
    }
  );

  /** Presigned browser→storage PUT for ONE own-face photo. */
  app.post(
    "/photos/presign",
    { schema: { body: likenessPhotoPresignSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = likenessPhotoPresignSchema.parse(req.body);
      try {
        const policy = uploadPolicyFromEnv();
        await enforceDistributedUploadRate(
          app.rateLimitRedis,
          workspaceId,
          policy
        );
        const signed = await presignUpload({
          workspaceId,
          kind: "likeness/photos",
          contentType: input.contentType,
          ext: input.ext,
          sizeBytes: input.sizeBytes,
        });
        const reservation = await reserveUploadBytes(
          workspaceId,
          {
            objectKey: signed.key,
            assetRef: signed.assetRef,
            kind: "likeness",
            sizeBytes: input.sizeBytes,
          },
          policy
        );
        return { ...signed, reservation };
      } catch (error) {
        return uploadPolicyErrorResponse(reply, error);
      }
    }
  );

  /** Attach the uploaded photo under a recorded consent — the bytes are
   *  sniffed (real PNG/JPEG/WebP) and fully hashed before a row exists. */
  app.post(
    "/photos/attach",
    { schema: { body: likenessPhotoAttachSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = likenessPhotoAttachSchema.parse(req.body);

      const consent = await prisma.likenessConsent.findFirst({
        where: {
          id: input.consentId,
          workspaceId,
          artistId: input.artistId,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!consent) {
        return reply.code(409).send({
          error: "likeness_consent_required",
          note: "Sign the likeness consent for this artist before attaching photos.",
        });
      }
      await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
      });

      const verified = await verifyUploadedImage(workspaceId, input.key);
      try {
        const photo = await prisma.artistLikeness.create({
          data: {
            workspaceId,
            artistId: input.artistId,
            kind: "photo",
            url: verified.assetRef,
            contentHash: verified.contentHash,
            consentId: consent.id,
            status: "pending",
            meta: {
              format: verified.format,
              sizeBytes: verified.sizeBytes,
              rightsBasis: LIKENESS_RIGHTS_BASIS,
            } as never,
          },
        });
        reply.code(201);
        return {
          id: photo.id,
          kind: photo.kind,
          status: photo.status,
          contentHash: photo.contentHash,
          createdAt: photo.createdAt,
        };
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          return reply.code(409).send({
            error: "duplicate_likeness_photo",
            note: "This exact photo is already in the likeness set.",
          });
        }
        throw error;
      }
    }
  );

  /** The panel read: photos + consent + trained model + the HONEST gate. */
  app.get("/", async req => {
    const { workspaceId } = requireAuth(req);
    const artistId =
      typeof (req.query as { artistId?: unknown }).artistId === "string"
        ? ((req.query as { artistId: string }).artistId)
        : undefined;

    const rows = (await prisma.artistLikeness.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(artistId ? { artistId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        artistId: true,
        kind: true,
        url: true,
        contentHash: true,
        consentId: true,
        status: true,
        trainedModelRef: true,
        meta: true,
        createdAt: true,
      },
    })) as LikenessRow[];

    const consent = await prisma.likenessConsent.findFirst({
      where: { workspaceId, ...(artistId ? { artistId } : {}) },
      orderBy: { signedAt: "desc" },
      select: { id: true, artistId: true, signedAt: true, revokedAt: true },
    });

    const photos = await Promise.all(
      rows
        .filter(row => row.kind === "photo")
        .map(async row => ({
          id: row.id,
          artistId: row.artistId,
          status: row.status,
          contentHash: row.contentHash,
          createdAt: row.createdAt,
          // Display link only — the stored URL is private storage.
          displayUrl: await presignAssetRef(row.url, 900),
        }))
    );

    // "A trained likeness exists" — a live trained row with a model ref under
    // an UNREVOKED consent (checked in SQL: consent relation filter).
    const trainedRow = (await prisma.artistLikeness.findFirst({
      where: {
        workspaceId,
        deletedAt: null,
        status: "trained",
        trainedModelRef: { not: null },
        consent: { revokedAt: null, workspaceId },
        ...(artistId ? { artistId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { trainedModelRef: true, meta: true, artistId: true },
    })) as
      | { trainedModelRef: string | null; meta: unknown; artistId: string }
      | null;
    const trainedMeta = metaObject(trainedRow?.meta);

    const workspaceKey = await workspaceReplicateKey(workspaceId);
    const eligiblePhotoCount = photos.length;
    const gate = likenessTrainingGate({
      trainingEnabled: likenessTrainingEnabled(),
      photoCount: eligiblePhotoCount,
      consentRecorded: !!consent,
      consentRevoked: !!consent?.revokedAt,
      replicateConfigured: replicateConfigured(workspaceKey),
    });

    return {
      photos,
      consent,
      trained: trainedRow?.trainedModelRef
        ? {
            artistId: trainedRow.artistId,
            trainedModelRef: trainedRow.trainedModelRef,
            triggerWord:
              typeof trainedMeta.triggerWord === "string"
                ? trainedMeta.triggerWord
                : null,
            trainedAt:
              typeof trainedMeta.trainedAt === "string"
                ? trainedMeta.trainedAt
                : null,
            rightsBasis: LIKENESS_RIGHTS_BASIS,
          }
        : null,
      gate,
      minPhotos: MIN_LIKENESS_TRAINING_PHOTOS,
      trainingEnabled: likenessTrainingEnabled(),
    };
  });

  /** Soft delete — provenance rows never vanish; the photo leaves the set. */
  app.delete<{ Params: { likenessId: string } }>(
    "/:likenessId",
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const deleted = await prisma.artistLikeness.updateMany({
        where: { id: req.params.likenessId, workspaceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (deleted.count !== 1) {
        return reply.code(404).send({ error: "likeness_not_found" });
      }
      reply.code(204);
    }
  );

  /**
   * TRAIN — kicks the worker job. The gate is enforced HERE and AGAIN in the
   * worker (defense in depth): operator flag, live consent, >=10 photos,
   * provider key. Charges likeness_training credits; refunds if the job can't
   * be created. Poll GET /jobs/:jobId; GET /likeness reflects row statuses.
   */
  app.post(
    "/train",
    { schema: { body: likenessTrainInputSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = likenessTrainInputSchema.parse(req.body);

      const consent = await prisma.likenessConsent.findFirst({
        where: {
          id: input.consentId,
          workspaceId,
          artistId: input.artistId,
          revokedAt: null,
        },
        select: { id: true },
      });
      const artist = await prisma.artist.findFirstOrThrow({
        where: { id: input.artistId, workspaceId },
        select: { id: true, stageName: true },
      });
      const photos = (await prisma.artistLikeness.findMany({
        where: {
          workspaceId,
          artistId: input.artistId,
          consentId: input.consentId,
          kind: "photo",
          deletedAt: null,
          status: { in: ["pending", "trained", "failed"] },
        },
        select: { id: true },
      })) as Array<{ id: string }>;

      const workspaceKey = await workspaceReplicateKey(workspaceId);
      const gate = likenessTrainingGate({
        trainingEnabled: likenessTrainingEnabled(),
        photoCount: photos.length,
        consentRecorded: !!consent,
        consentRevoked: false,
        replicateConfigured: replicateConfigured(workspaceKey),
      });
      if (!consent) {
        return reply.code(409).send({
          error: "likeness_consent_required",
          reasons: gate.reasons,
        });
      }
      if (!gate.ok) {
        return reply.code(likenessTrainingEnabled() ? 409 : 501).send({
          error: "likeness_training_gate_failed",
          reasons: gate.reasons,
        });
      }

      // Destination model for the trained weights (private, operator account).
      const destination =
        input.destination ??
        process.env.LIKENESS_LORA_DESTINATION?.trim() ??
        (process.env.REPLICATE_USERNAME?.trim()
          ? `${process.env.REPLICATE_USERNAME.trim()}/afrohit-likeness-${input.artistId.slice(-8).toLowerCase()}`
          : undefined);
      if (!destination) {
        return reply.code(400).send({
          error: "likeness_destination_required",
          note: 'Set LIKENESS_LORA_DESTINATION ("user/model" in the operator\'s Replicate account) or REPLICATE_USERNAME, or pass destination in the request. Trained weights land there — keep it private.',
        });
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        "likeness-train"
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: "likeness_training",
        refTable: "LikenessConsent",
        refId: consent.id,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: "insufficient_credits", ...charge });

      const triggerWord = likenessTriggerWord(artist.stageName);
      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.image,
        jobName: "likeness-train",
        workspaceId,
        kind: "likeness-train",
        provider: "replicate",
        inputJson: {
          artistId: input.artistId,
          consentId: consent.id,
          photoCount: photos.length,
          triggerWord,
          rightsBasis: LIKENESS_RIGHTS_BASIS,
        },
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          artistId: input.artistId,
          consentId: consent.id,
          likenessIds: photos.map(photo => photo.id),
          triggerWord,
          destination,
        }),
      });

      reply.code(202);
      return {
        jobId: job.jobId,
        replayed: job.replayed,
        photoCount: photos.length,
        note: "Training started. Poll GET /jobs/:jobId — photo rows flip to 'trained' with the model reference when the run truly succeeds.",
      };
    }
  );
}
