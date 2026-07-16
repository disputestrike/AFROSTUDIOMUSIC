import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import {
  createMasterInputSchema,
  createMixInputSchema,
  attachSongUploadSchema,
} from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { enqueueHarvest, enqueueLearn } from '../lib/harvest';
import { fingerprintUploadedAudio, publicUrlFor } from '../lib/storage';
import { arReadAfterRender } from '../lib/ar-read';

type JsonRecord = Record<string, unknown>;

type DirectUploadMix = {
  preset: string;
  url: string;
  approved: boolean;
  qualityState: string;
  contentHash: string | null;
  verifiedAt: Date | null;
  meta: unknown;
};

type DirectUploadMixCandidate = DirectUploadMix & { id: string };

type DirectUploadReattachment = {
  meta: JsonRecord;
  preservesSourceCertification: boolean;
  preservesReleaseReceipt: boolean;
};

type EvaluatedDirectUploadCandidate = {
  candidate: DirectUploadMixCandidate;
  reattachment: DirectUploadReattachment;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function certifiedContentHash(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function certifiedTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function hasCertifiedMixRow(mix: DirectUploadMix): boolean {
  return (
    mix.approved &&
    mix.qualityState === 'passed' &&
    !!certifiedContentHash(mix.contentHash) &&
    mix.verifiedAt instanceof Date &&
    Number.isFinite(mix.verifiedAt.getTime())
  );
}

export function hasImmutableDirectUploadContentMismatch(options: {
  existingMix: DirectUploadMix;
  objectKey: string;
  uploadUrl: string;
  uploadedContentHash: string;
}): boolean {
  const directUpload = record(
    record(options.existingMix.meta)?.directOwnedUpload
  );
  const existingHash = certifiedContentHash(options.existingMix.contentHash);
  const uploadedHash = certifiedContentHash(options.uploadedContentHash);
  const sameAttachedObject =
    directUpload?.objectKey === options.objectKey ||
    options.existingMix.url === options.uploadUrl;

  return (
    options.existingMix.preset === 'uploaded' &&
    hasCertifiedMixRow(options.existingMix) &&
    sameAttachedObject &&
    !!existingHash &&
    !!uploadedHash &&
    existingHash !== uploadedHash
  );
}

export function buildDirectUploadReattachmentMeta(options: {
  existingMix: DirectUploadMix | null;
  objectKey: string;
  uploadedContentHash: string;
  rightsConfirmation: { version: 1; confirmed: true };
  recordedAt: string;
}): DirectUploadReattachment {
  const existingMeta = record(options.existingMix?.meta) ?? {};
  const existingDirectUpload = record(existingMeta.directOwnedUpload);
  const existingRights = record(existingDirectUpload?.rightsConfirmation);
  const mixHash = certifiedContentHash(options.existingMix?.contentHash);
  const uploadedHash = certifiedContentHash(options.uploadedContentHash);
  const sourceHash = certifiedContentHash(
    existingDirectUpload?.sourceContentHash
  );
  const sourceRecordedAt = certifiedTimestamp(existingDirectUpload?.recordedAt);
  const sourceCertifiedAt = certifiedTimestamp(
    existingDirectUpload?.certifiedAt
  );
  const verifiedAtMs =
    options.existingMix?.verifiedAt instanceof Date
      ? options.existingMix.verifiedAt.getTime()
      : Number.NaN;

  const preservesSourceCertification = !!(
    options.existingMix &&
    options.existingMix.preset === 'uploaded' &&
    hasCertifiedMixRow(options.existingMix) &&
    existingDirectUpload?.schemaVersion === 1 &&
    existingDirectUpload.sourceKind === 'workspace_upload' &&
    existingDirectUpload.objectKey === options.objectKey &&
    existingRights?.version === 1 &&
    existingRights.confirmed === true &&
    mixHash &&
    uploadedHash === mixHash &&
    sourceHash === mixHash &&
    sourceRecordedAt &&
    sourceCertifiedAt &&
    Date.parse(sourceRecordedAt) <= verifiedAtMs &&
    Date.parse(sourceCertifiedAt) === verifiedAtMs
  );

  const receipt = record(existingMeta.releaseLineageReceipt);
  const receiptId =
    typeof receipt?.receiptId === 'string' && receipt.receiptId.trim()
      ? receipt.receiptId
      : null;
  const receiptHash = certifiedContentHash(receipt?.receiptHash);
  const receiptSourceHash = certifiedContentHash(receipt?.sourceContentHash);
  const receiptCertifiedAt = certifiedTimestamp(receipt?.certifiedAt);
  const preservesReleaseReceipt = !!(
    preservesSourceCertification &&
    existingMeta.releaseLineageCertified === true &&
    receipt?.schemaVersion === 1 &&
    receiptId &&
    receiptHash &&
    receiptSourceHash === mixHash &&
    receiptCertifiedAt &&
    Date.parse(receiptCertifiedAt) >= verifiedAtMs
  );

  const meta = { ...existingMeta };
  delete meta.directOwnedUpload;
  delete meta.releaseLineageCertified;
  delete meta.releaseLineageReceipt;
  meta.directOwnedUpload = {
    schemaVersion: 1,
    sourceKind: 'workspace_upload',
    rightsConfirmation: {
      version: options.rightsConfirmation.version,
      confirmed: options.rightsConfirmation.confirmed,
    },
    recordedAt: preservesSourceCertification
      ? sourceRecordedAt
      : options.recordedAt,
    objectKey: options.objectKey,
    ...(preservesSourceCertification
      ? {
          sourceContentHash: existingDirectUpload!.sourceContentHash,
          certifiedAt: sourceCertifiedAt,
        }
      : {}),
  };
  meta.releaseLineageCertified = preservesReleaseReceipt;
  if (preservesReleaseReceipt) {
    meta.releaseLineageReceipt = {
      schemaVersion: 1,
      receiptId,
      receiptHash: receipt!.receiptHash,
      sourceContentHash: receipt!.sourceContentHash,
      certifiedAt: receiptCertifiedAt,
    };
  }

  return { meta, preservesSourceCertification, preservesReleaseReceipt };
}

export default async function mixes(app: FastifyInstance) {
  app.post<{ Params: { projectId: string } }>(
    '/',
    { schema: { body: createMixInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMixInputSchema
        .omit({ projectId: true })
        .parse(req.body);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });
      // The song must belong to this workspace — never mix another tenant's song.
      const song = await prisma.song.findFirstOrThrow({
        where: { id: input.songId, workspaceId, projectId: project.id },
        include: {
          masters: { orderBy: { createdAt: 'desc' }, take: 1 },
          mixes: { orderBy: { createdAt: 'desc' }, take: 1 },
          beats: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      // DEFINITIONAL FIX — 'instrumental'/'acapella' as MIX presets bounced the
      // beat/vocal channels of the pre-vocal session, NOT the finished record
      // ("instrumental" of a mastered song came out as the raw beat). The preset
      // names stay (removing enum members breaks clients); the request reroutes
      // to true stem separation of the freshest audio the user actually hears.
      if (input.preset === 'instrumental' || input.preset === 'acapella') {
        const beat = song.beats[0];
        if (!beat)
          return reply.code(400).send({ error: 'no_audio_to_separate' });
        const cands = [song.masters[0], song.mixes[0], song.beats[0]].filter(
          Boolean
        ) as Array<{ url: string; createdAt: Date }>;
        cands.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const sourceUrl = cands[0]!.url;
        const idempotencyKey = scopedRequestKey(
          req.headers as Record<string, unknown>,
          `mix-separate:${input.preset}`
        );
        const sepCharge = await app.chargeCredits({
          workspaceId,
          key: 'beat_idea_short_30s',
          refTable: 'Song',
          refId: input.songId,
          idempotencyKey,
        });
        if (!sepCharge.ok)
          return reply
            .code(402)
            .send({ error: 'insufficient_credits', ...sepCharge });
        const sepJob = await createQueuedProviderJob({
          app,
          queue: app.queues.music,
          jobName: 'stems',
          workspaceId,
          projectId: project.id,
          kind: 'stems',
          provider: 'replicate',
          inputJson: {
            songId: input.songId,
            beatId: beat.id,
            mode: input.preset,
            sourceUrl,
          },
          charge: sepCharge,
          idempotencyKey,
          payload: jobId => ({
            jobId,
            workspaceId,
            projectId: project.id,
            songId: input.songId,
            beatId: beat.id,
            mode: input.preset,
            sourceUrl,
          }),
        });
        reply.code(202);
        return {
          jobId: sepJob.jobId,
          replayed: sepJob.replayed,
          note: `${input.preset === 'instrumental' ? 'Instrumental' : 'Acapella'} is separated from the finished song (voice ${input.preset === 'instrumental' ? 'removed' : 'isolated'}, everything else kept, loudness-matched) — not a beat-only bounce. It lands on the song in a few minutes.`,
        };
      }

      const [approvedBeat, verifiedLead] = await Promise.all([
        prisma.beatAsset.findFirst({
          where: {
            songId: input.songId,
            projectId: project.id,
            approved: true,
            assetKind: 'instrumental',
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          select: { id: true },
        }),
        prisma.vocalRender.findFirst({
          where: {
            songId: input.songId,
            projectId: project.id,
            role: 'lead',
            approved: true,
            assetKind: 'isolated_vocal',
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          select: { id: true },
        }),
      ]);
      if (!approvedBeat)
        return reply.code(409).send({ error: 'approved_beat_required' });
      if (!verifiedLead) {
        return reply.code(409).send({
          error: 'verified_isolated_lead_required',
          note: 'Upload or record an isolated lead vocal and wait for its QC job to pass before mixing.',
        });
      }

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        `mix:${input.preset}`
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'mix_preset',
        refTable: 'Song',
        refId: input.songId,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.mix,
        jobName: 'create-mix',
        workspaceId,
        projectId: project.id,
        kind: 'mix',
        provider: 'internal',
        inputJson: input,
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: project.id,
          songId: input.songId,
          preset: input.preset,
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );

  app.post<{
    Params: { projectId: string };
    Body: { songId: string; preset: string; mixId?: string };
  }>(
    '/master',
    { schema: { body: createMasterInputSchema.omit({ projectId: true }) } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = createMasterInputSchema
        .omit({ projectId: true })
        .parse(req.body);
      // Verify both the project and the song are in this workspace before charging.
      await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });
      await prisma.song.findFirstOrThrow({
        where: {
          id: input.songId,
          workspaceId,
          projectId: req.params.projectId,
        },
      });

      const idempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        `master:${input.preset}`
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'master_preset',
        refTable: 'Song',
        refId: input.songId,
        idempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.master,
        jobName: 'create-master',
        workspaceId,
        projectId: req.params.projectId,
        kind: 'master',
        provider: 'internal',
        inputJson: input,
        charge,
        idempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: req.params.projectId,
          ...input,
        }),
      });

      reply.code(202);
      return { jobId: job.jobId, replayed: job.replayed };
    }
  );

  // Upload a FINISHED song / full mix and (by default) master it immediately.
  // Stored as a Mix so the existing mastering chain runs on it verbatim.
  app.post<{ Params: { projectId: string } }>(
    '/upload',
    { schema: { body: attachSongUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = attachSongUploadSchema.parse(req.body);
      const uploaded = await fingerprintUploadedAudio(workspaceId, input.key);
      const project = await prisma.project.findFirstOrThrow({
        where: { id: req.params.projectId, workspaceId },
      });

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
              title: input.title ?? `${project.title} — uploaded song`,
              status: 'SKETCH',
            },
            select: { id: true },
          })
        ).id;

      const uploadUrl = publicUrlFor(uploaded.key);
      const recordedAt = new Date().toISOString();
      const candidates = await prisma.mix.findMany({
        where: {
          projectId: project.id,
          songId,
          preset: 'uploaded',
          OR: [
            { url: uploadUrl },
            {
              meta: {
                path: ['directOwnedUpload', 'objectKey'],
                equals: uploaded.key,
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      const immutableContentMismatch = candidates.some(
        (candidate: DirectUploadMixCandidate) =>
          hasImmutableDirectUploadContentMismatch({
            existingMix: candidate,
            objectKey: uploaded.key,
            uploadUrl,
            uploadedContentHash: uploaded.contentHash,
          })
      );
      if (immutableContentMismatch) {
        return reply
          .code(409)
          .send({ error: 'immutable_upload_content_mismatch' });
      }
      const evaluatedCandidates: EvaluatedDirectUploadCandidate[] =
        candidates.map(
          (
            candidate: DirectUploadMixCandidate
          ): EvaluatedDirectUploadCandidate => ({
            candidate,
            reattachment: buildDirectUploadReattachmentMeta({
              existingMix: candidate,
              objectKey: uploaded.key,
              uploadedContentHash: uploaded.contentHash,
              rightsConfirmation: input.rightsConfirmation,
              recordedAt,
            }),
          })
        );
      const existingAttachment =
        evaluatedCandidates.find(
          (entry: EvaluatedDirectUploadCandidate) =>
            entry.reattachment.preservesSourceCertification
        ) ??
        evaluatedCandidates.find(
          (entry: EvaluatedDirectUploadCandidate) =>
            entry.candidate.url === uploadUrl &&
            !hasCertifiedMixRow(entry.candidate)
        );
      const freshMeta = buildDirectUploadReattachmentMeta({
        existingMix: null,
        objectKey: uploaded.key,
        uploadedContentHash: uploaded.contentHash,
        rightsConfirmation: input.rightsConfirmation,
        recordedAt,
      }).meta;
      const mix = existingAttachment
        ? await prisma.mix.update({
            where: { id: existingAttachment.candidate.id },
            data: {
              meta: existingAttachment.reattachment.meta as never,
            },
          })
        : await prisma.mix.create({
            data: {
              projectId: project.id,
              songId,
              preset: 'uploaded',
              url: uploadUrl,
              notes:
                'Uploaded finished song' +
                (input.title ? ' - ' + input.title : '') +
                ' (artist master source)',
              qualityState: 'unmeasured',
              approved: false,
              meta: freshMeta as never,
            },
          });
      // LEARN from every finished song the artist brings back (Suno bridge or
      // any upload): the artist chose to push this sound into the studio, so it
      // must feed the lake like a /listen — otherwise "I pushed my Suno songs
      // and it learned nothing". Best-effort: a failed charge or enqueue never
      // blocks the upload itself.
      await enqueueLearn(app, {
        workspaceId,
        projectId: project.id,
        url: mix.url,
        source: 'finished-upload',
        rightsConfirmation: input.rightsConfirmation,
        idempotencyKey: scopedRequestKey(
          req.headers as Record<string, unknown>,
          'finished-upload-learn'
        ),
        refTable: 'Song',
        refId: songId,
      });

      // HARVEST too (audit: finished uploads fed the lake but never the material
      // shelf): stem-split the record and file its NON-VOCAL stems as owned
      // material. Song-scoped — a finished upload has no beat row — and owned by
      // definition (this route only accepts the artist's own key). Best-effort.
      await enqueueHarvest(app, {
        workspaceId,
        projectId: project.id,
        songId,
        sourceUrl: mix.url,
        rightsConfirmation: input.rightsConfirmation,
      });

      if (!input.autoMaster) {
        reply.code(201);
        return { mix, songId, mastered: false };
      }

      const masterIdempotencyKey = scopedRequestKey(
        req.headers as Record<string, unknown>,
        'finished-upload-master'
      );
      const charge = await app.chargeCredits({
        workspaceId,
        key: 'master_preset',
        refTable: 'Song',
        refId: songId,
        idempotencyKey: masterIdempotencyKey,
      });
      if (!charge.ok)
        return reply
          .code(402)
          .send({ error: 'insufficient_credits', ...charge });

      const job = await createQueuedProviderJob({
        app,
        queue: app.queues.master,
        jobName: 'create-master',
        workspaceId,
        projectId: project.id,
        kind: 'master',
        provider: 'internal',
        inputJson: { songId, mixId: mix.id, preset: input.masterPreset },
        charge,
        idempotencyKey: masterIdempotencyKey,
        payload: jobId => ({
          jobId,
          workspaceId,
          projectId: project.id,
          songId,
          mixId: mix.id,
          preset: input.masterPreset,
          finished: true,
        }),
      });

      // Finish the pipeline: once the master lands, run Will-it-hit so an uploaded
      // Suno song gets scored just like a generated one (catalog shows it; the
      // release gate can act on it).
      await arReadAfterRender(app, workspaceId, [{ songId, jobId: job.jobId }]);

      reply.code(202);
      return {
        mix,
        songId,
        mastered: true,
        jobId: job.jobId,
        replayed: job.replayed,
      };
    }
  );
}
