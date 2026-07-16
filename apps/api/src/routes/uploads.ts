import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import { Prisma, prisma } from '@afrohit/db';
import {
  MAX_PRESIGNED_UPLOAD_BYTES,
  presignUploadSchema,
  importUrlSchema,
  audioUploadSchema,
} from '@afrohit/shared';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth';
import {
  presignAssetRef,
  presignUpload,
  publicUrlFor,
  putBytes,
  sniffAudioFormat,
} from '../lib/storage';
import { assertSafeUrl, safeFetch } from '../lib/url-guard';
import { enqueueHarvest, enqueueLearn } from '../lib/harvest';
import { registerVocalForInspection } from '../lib/vocal-ingest';
import { registerBeatForInspection } from '../lib/beat-ingest';
import { createQueuedProviderJob, scopedRequestKey } from '../lib/queued-job';
import { arReadAfterRender } from '../lib/ar-read';

/**
 * Bring-your-own-audio uploads + legal URL import.
 *
 * Presign: the browser gets a short-lived PUT url and uploads the artist's OWN
 * beat/instrumental/vocal/song straight to object storage.
 *
 * Import: pull audio from a URL the artist has the RIGHTS to — their own files,
 * direct audio links, royalty-free / Creative-Commons sources. This is NOT a
 * streaming-platform ripper: YouTube/Spotify/etc. hosts are refused, because
 * re-using their catalog is uncleared copyright infringement.
 */

const MAX_IMPORT_BYTES = 80 * 1024 * 1024; // 80 MB
const IMPORT_TIMEOUT_MS = 30_000;

const UPLOAD_RESERVATION_PREFIX = 'upload-reservation:v1:';
const DEFAULT_WORKSPACE_UPLOAD_QUOTA_BYTES = 1024 * 1024 * 1024;
const DEFAULT_UPLOAD_RATE_MAX = 24;
const DEFAULT_UPLOAD_RATE_WINDOW_SECONDS = 10 * 60;
const DEFAULT_UPLOAD_RESERVATION_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_EXPIRED_RESERVATION_RETENTION_SECONDS = 7 * 24 * 60 * 60;

export type UploadPolicy = {
  workspaceQuotaBytes: number;
  maxPerWindow: number;
  windowSeconds: number;
  reservationTtlSeconds: number;
  expiredRetentionSeconds: number;
};

type UploadReservationStatus = 'pending' | 'committed' | 'expired';

export type UploadReservation = {
  version: 1;
  reservationId: string;
  workspaceId: string;
  objectKey: string;
  assetRef: string;
  kind: string;
  sizeBytes: number;
  status: UploadReservationStatus;
  issuedAt: string;
  expiresAt: string;
  cleanupJobId: string;
  committedAt?: string;
  expiredAt?: string;
};

type ReservationMutation = {
  key: string;
  value: string | null;
};

export class UploadPolicyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, number | string>,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'UploadPolicyError';
  }
}

function configuredInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new UploadPolicyError(
      503,
      'upload_policy_misconfigured',
      name + ' must be an integer between ' + min + ' and ' + max
    );
  }
  return parsed;
}

export function uploadPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): UploadPolicy {
  return {
    workspaceQuotaBytes: configuredInteger(
      env,
      'UPLOAD_WORKSPACE_QUOTA_BYTES',
      DEFAULT_WORKSPACE_UPLOAD_QUOTA_BYTES,
      MAX_PRESIGNED_UPLOAD_BYTES,
      100 * 1024 * 1024 * 1024
    ),
    maxPerWindow: configuredInteger(
      env,
      'UPLOAD_RATE_MAX',
      DEFAULT_UPLOAD_RATE_MAX,
      1,
      100
    ),
    windowSeconds: configuredInteger(
      env,
      'UPLOAD_RATE_WINDOW_SECONDS',
      DEFAULT_UPLOAD_RATE_WINDOW_SECONDS,
      60,
      60 * 60
    ),
    reservationTtlSeconds: configuredInteger(
      env,
      'UPLOAD_RESERVATION_TTL_SECONDS',
      DEFAULT_UPLOAD_RESERVATION_TTL_SECONDS,
      10 * 60,
      7 * 24 * 60 * 60
    ),
    expiredRetentionSeconds: configuredInteger(
      env,
      'UPLOAD_RESERVATION_RETENTION_SECONDS',
      DEFAULT_EXPIRED_RESERVATION_RETENTION_SECONDS,
      24 * 60 * 60,
      30 * 24 * 60 * 60
    ),
  };
}

function reservationSettingKey(
  workspaceId: string,
  reservationId: string
): string {
  return UPLOAD_RESERVATION_PREFIX + workspaceId + ':' + reservationId;
}

function corruptReservation(message: string): never {
  throw new UploadPolicyError(503, 'upload_reservation_corrupt', message);
}

export function parseUploadReservation(
  settingKey: string,
  value: string
): UploadReservation {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return corruptReservation('Stored upload reservation is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return corruptReservation('Stored upload reservation is not an object');
  }
  const record = raw as Partial<UploadReservation>;
  const validStatus =
    record.status === 'pending' ||
    record.status === 'committed' ||
    record.status === 'expired';
  const requiredStrings = [
    record.reservationId,
    record.workspaceId,
    record.objectKey,
    record.assetRef,
    record.kind,
    record.issuedAt,
    record.expiresAt,
    record.cleanupJobId,
  ];
  if (
    record.version !== 1 ||
    !validStatus ||
    requiredStrings.some(item => typeof item !== 'string' || !item) ||
    !Number.isSafeInteger(record.sizeBytes) ||
    Number(record.sizeBytes) < 1_000 ||
    Number(record.sizeBytes) > MAX_PRESIGNED_UPLOAD_BYTES ||
    !record.assetRef?.startsWith('s3://')
  ) {
    return corruptReservation('Stored upload reservation has invalid fields');
  }
  const issuedAt = Date.parse(record.issuedAt!);
  const expiresAt = Date.parse(record.expiresAt!);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    settingKey !==
      reservationSettingKey(record.workspaceId!, record.reservationId!)
  ) {
    return corruptReservation(
      'Stored upload reservation has invalid lifecycle metadata'
    );
  }
  return record as UploadReservation;
}

export function reconcileUploadReservations(
  rows: Array<{ key: string; value: string }>,
  workspaceId: string,
  protectedRefs: ReadonlySet<string>,
  now: Date,
  policy: UploadPolicy
): {
  mutations: ReservationMutation[];
  usedBytes: number;
  recentIssuedAt: number[];
  reservations: UploadReservation[];
} {
  const nowMs = now.getTime();
  const rateCutoff = nowMs - policy.windowSeconds * 1_000;
  const retentionCutoff = nowMs - policy.expiredRetentionSeconds * 1_000;
  const mutations: ReservationMutation[] = [];
  const reservations: UploadReservation[] = [];

  for (const row of rows) {
    const current = parseUploadReservation(row.key, row.value);
    if (current.workspaceId !== workspaceId) {
      return corruptReservation(
        'Upload reservation workspace does not match its key'
      );
    }
    let next = current;
    const expired = Date.parse(current.expiresAt) <= nowMs;
    if (current.status === 'pending' && expired) {
      next = protectedRefs.has(current.assetRef)
        ? {
            ...current,
            status: 'committed',
            committedAt: now.toISOString(),
          }
        : {
            ...current,
            status: 'expired',
            expiredAt: now.toISOString(),
          };
    } else if (
      current.status === 'committed' &&
      !protectedRefs.has(current.assetRef)
    ) {
      next = {
        ...current,
        status: 'expired',
        expiredAt: now.toISOString(),
      };
    } else if (current.status === 'expired' && !current.expiredAt) {
      next = { ...current, expiredAt: now.toISOString() };
    }

    if (
      next.status === 'expired' &&
      Date.parse(next.expiredAt ?? next.expiresAt) <= retentionCutoff
    ) {
      mutations.push({ key: row.key, value: null });
      continue;
    }
    const serialized = JSON.stringify(next);
    if (serialized !== row.value) {
      mutations.push({ key: row.key, value: serialized });
    }
    reservations.push(next);
  }

  return {
    mutations,
    usedBytes: reservations
      .filter(record => record.status !== 'expired')
      .reduce((total, record) => total + record.sizeBytes, 0),
    recentIssuedAt: reservations
      .map(record => Date.parse(record.issuedAt))
      .filter(issuedAt => issuedAt > rateCutoff),
    reservations,
  };
}

function referencesNeedingReconciliation(
  rows: Array<{ key: string; value: string }>,
  now: Date
): UploadReservation[] {
  const nowMs = now.getTime();
  return rows
    .map(row => parseUploadReservation(row.key, row.value))
    .filter(
      record =>
        record.status === 'committed' ||
        (record.status === 'pending' && Date.parse(record.expiresAt) <= nowMs)
    );
}

async function referencedUploadRefs(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  candidates: string[]
): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const values = Prisma.join(candidates.map(ref => Prisma.sql`(${ref})`));
  const rows = (await tx.$queryRaw(Prisma.sql`
    WITH candidates("ref") AS (VALUES ${values}),
    referenced("ref") AS (
      SELECT song."instrumentalUrl" FROM "Song" song
        WHERE song."workspaceId" = ${workspaceId}
      UNION ALL SELECT song."acapellaUrl" FROM "Song" song
        WHERE song."workspaceId" = ${workspaceId}
      UNION ALL SELECT beat."url" FROM "BeatAsset" beat
        JOIN "Project" project ON project."id" = beat."projectId"
        WHERE project."workspaceId" = ${workspaceId}
      UNION ALL SELECT stem."url" FROM "Stem" stem
        JOIN "BeatAsset" beat ON beat."id" = stem."beatId"
        JOIN "Project" project ON project."id" = beat."projectId"
        WHERE project."workspaceId" = ${workspaceId}
      UNION ALL SELECT vocal."url" FROM "VocalRender" vocal
        JOIN "Project" project ON project."id" = vocal."projectId"
        WHERE project."workspaceId" = ${workspaceId}
      UNION ALL SELECT mix."url" FROM "Mix" mix
        JOIN "Project" project ON project."id" = mix."projectId"
        WHERE project."workspaceId" = ${workspaceId}
      UNION ALL SELECT master."url" FROM "Master" master
        JOIN "Project" project ON project."id" = master."projectId"
        WHERE project."workspaceId" = ${workspaceId}
      UNION ALL SELECT material."url" FROM "MaterialAsset" material
        WHERE material."workspaceId" = ${workspaceId}
      UNION ALL SELECT reference."sourceUrl" FROM "SoundReference" reference
        WHERE reference."workspaceId" = ${workspaceId}
      UNION ALL SELECT dataset."url" FROM "VoiceDataset" dataset
        WHERE dataset."workspaceId" = ${workspaceId}
      UNION ALL
        SELECT sample."ref" FROM "VoiceProfile" profile
        CROSS JOIN LATERAL unnest(profile."sampleUrls") AS sample("ref")
        WHERE profile."workspaceId" = ${workspaceId}
      UNION ALL SELECT consent."consentAudioUrl" FROM "VoiceConsent" consent
        WHERE consent."workspaceId" = ${workspaceId}
      UNION ALL SELECT consent."signatureUrl" FROM "VoiceConsent" consent
        WHERE consent."workspaceId" = ${workspaceId}
      UNION ALL SELECT rating."audioUrl" FROM "BenchmarkRating" rating
        WHERE rating."workspaceId" = ${workspaceId}
      UNION ALL SELECT pair."afrohitAssetRef" FROM "BenchmarkPair" pair
        WHERE pair."workspaceId" = ${workspaceId}
      UNION ALL SELECT pair."referenceAssetRef" FROM "BenchmarkPair" pair
        WHERE pair."workspaceId" = ${workspaceId}
      UNION ALL SELECT memory."sourceUrl" FROM "ArtistMemoryChunk" memory
        WHERE memory."workspaceId" = ${workspaceId}
      UNION ALL SELECT release."audioUrl" FROM "Release" release
        WHERE release."workspaceId" = ${workspaceId}
      UNION ALL SELECT release."coverUrl" FROM "Release" release
        WHERE release."workspaceId" = ${workspaceId}
      UNION ALL SELECT release."archiveUrl" FROM "Release" release
        WHERE release."workspaceId" = ${workspaceId}
    )
    SELECT DISTINCT candidates."ref"
    FROM candidates
    JOIN referenced ON referenced."ref" = candidates."ref"
  `)) as Array<{ ref: string }>;
  return new Set(rows.map(row => row.ref));
}

const UPLOAD_RATE_SCRIPT = [
  'local current = redis.call("INCR", KEYS[1])',
  'if current == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
  'return { current, redis.call("PTTL", KEYS[1]) }',
].join('\n');

export async function enforceDistributedUploadRate(
  redis: Redis,
  workspaceId: string,
  policy: UploadPolicy
): Promise<void> {
  const digest = createHash('sha256').update(workspaceId).digest('hex');
  try {
    const result = await redis.eval(
      UPLOAD_RATE_SCRIPT,
      1,
      'upload-rate:v1:' + digest,
      String(policy.windowSeconds * 1_000)
    );
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('invalid upload rate response');
    }
    const current = Number(result[0]);
    const ttlMs = Math.max(1_000, Number(result[1]) || 1_000);
    if (!Number.isFinite(current)) {
      throw new Error('invalid upload rate count');
    }
    if (current > policy.maxPerWindow) {
      throw new UploadPolicyError(
        429,
        'upload_rate_limited',
        'Too many upload requests for this workspace',
        { retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1_000)) }
      );
    }
  } catch (error) {
    if (error instanceof UploadPolicyError) throw error;
    throw new UploadPolicyError(
      503,
      'upload_control_unavailable',
      'Upload controls are temporarily unavailable',
      undefined,
      { cause: error }
    );
  }
}

export async function reserveUploadBytes(
  workspaceId: string,
  input: {
    objectKey: string;
    assetRef: string;
    kind: string;
    sizeBytes: number;
  },
  policy: UploadPolicy
): Promise<{
  reservationId: string;
  expiresAt: string;
  reservedBytes: number;
  quotaBytes: number;
}> {
  const now = new Date();
  try {
    return await prisma.$transaction(
      async tx => {
        await tx.$queryRaw(Prisma.sql`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(
          hashtextextended(${'upload-reservations:' + workspaceId}, 0)
        )
      `);
        const prefix = UPLOAD_RESERVATION_PREFIX + workspaceId + ':';
        const rows = await tx.systemSetting.findMany({
          where: { key: { startsWith: prefix } },
          select: { key: true, value: true },
        });
        const reconcileCandidates = referencesNeedingReconciliation(rows, now);
        const protectedRefs = await referencedUploadRefs(
          tx,
          workspaceId,
          reconcileCandidates.map(record => record.assetRef)
        );
        const state = reconcileUploadReservations(
          rows,
          workspaceId,
          protectedRefs,
          now,
          policy
        );
        for (const mutation of state.mutations) {
          if (mutation.value === null) {
            await tx.systemSetting.delete({ where: { key: mutation.key } });
          } else {
            await tx.systemSetting.update({
              where: { key: mutation.key },
              data: { value: mutation.value },
            });
          }
        }

        if (state.recentIssuedAt.length >= policy.maxPerWindow) {
          const oldest = Math.min(...state.recentIssuedAt);
          const retryAfterSec = Math.max(
            1,
            Math.ceil(
              (oldest + policy.windowSeconds * 1_000 - now.getTime()) / 1_000
            )
          );
          throw new UploadPolicyError(
            429,
            'upload_rate_limited',
            'Too many upload requests for this workspace',
            { retryAfterSec }
          );
        }
        if (state.usedBytes + input.sizeBytes > policy.workspaceQuotaBytes) {
          throw new UploadPolicyError(
            413,
            'workspace_upload_quota_exceeded',
            'This upload would exceed the workspace storage quota',
            {
              quotaBytes: policy.workspaceQuotaBytes,
              reservedBytes: state.usedBytes,
              requestedBytes: input.sizeBytes,
            }
          );
        }

        const reservationId = nanoid();
        const expiresAt = new Date(
          now.getTime() + policy.reservationTtlSeconds * 1_000
        );
        const cleanupJob = await tx.providerJob.create({
          data: {
            workspaceId,
            kind: 'cleanup',
            provider: 'storage',
            status: 'QUEUED',
            inputJson: {
              reason: 'upload-reservation:' + reservationId,
              assetRef: input.assetRef,
              cleanupAfter: expiresAt.toISOString(),
            } as never,
          },
          select: { id: true },
        });
        await tx.jobOutbox.create({
          data: {
            workspaceId,
            providerJobId: cleanupJob.id,
            queueName: 'cleanup',
            jobName: 'delete-assets',
            nextAttemptAt: expiresAt,
            payload: {
              jobId: cleanupJob.id,
              workspaceId,
              refs: [input.assetRef],
              reason: 'upload-reservation:' + reservationId,
            } as never,
          },
        });
        const reservation: UploadReservation = {
          version: 1,
          reservationId,
          workspaceId,
          objectKey: input.objectKey,
          assetRef: input.assetRef,
          kind: input.kind,
          sizeBytes: input.sizeBytes,
          status: 'pending',
          issuedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          cleanupJobId: cleanupJob.id,
        };
        await tx.systemSetting.create({
          data: {
            key: reservationSettingKey(workspaceId, reservationId),
            value: JSON.stringify(reservation),
          },
        });
        return {
          reservationId,
          expiresAt: expiresAt.toISOString(),
          reservedBytes: state.usedBytes + input.sizeBytes,
          quotaBytes: policy.workspaceQuotaBytes,
        };
      },
      { timeout: 10_000 }
    );
  } catch (error) {
    if (error instanceof UploadPolicyError) throw error;
    throw new UploadPolicyError(
      503,
      'upload_control_unavailable',
      'Upload controls are temporarily unavailable',
      undefined,
      { cause: error }
    );
  }
}

export function uploadPolicyErrorResponse(reply: FastifyReply, error: unknown) {
  if (!(error instanceof UploadPolicyError)) throw error;
  if (error.cause) {
    reply.request.log.warn(
      { err: error.cause },
      'durable upload control unavailable'
    );
  }
  const retryAfterSec = Number(error.details?.retryAfterSec ?? 0);
  if (retryAfterSec > 0) {
    reply.header('retry-after', String(retryAfterSec));
  }
  return reply.code(error.statusCode).send({
    error: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

async function readWithLimit(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!response.body) throw new Error('source returned no body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('file_too_large');
      throw Object.assign(new Error('file_too_large'), { statusCode: 413 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function extFromContentType(ct: string, url: string): string {
  const map: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/aiff': 'aiff',
  };
  if (map[ct.split(';')[0]!.trim()]) return map[ct.split(';')[0]!.trim()]!;
  const urlExt = url.split('?')[0]!.split('.').pop()?.toLowerCase();
  return ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aiff'].includes(
    urlExt ?? ''
  )
    ? urlExt!
    : 'mp3';
}

function provenanceUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'invalid-source-url';
  }
}

async function ensureSong(
  workspaceId: string,
  projectId: string,
  title: string
): Promise<string> {
  const existing = await prisma.song.findFirst({
    where: { projectId, workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.song.create({
    data: { workspaceId, projectId, title, status: 'SKETCH' },
    select: { id: true },
  });
  return created.id;
}

export async function resolveAuthorizedImportTarget(
  workspaceId: string,
  projectId: string,
  songId?: string
) {
  const project = await prisma.project.findFirstOrThrow({
    where: { id: projectId, workspaceId },
  });
  const requestedSong = songId
    ? await prisma.song.findFirst({
        where: { id: songId, workspaceId, projectId: project.id },
        select: { id: true },
      })
    : null;
  if (songId && !requestedSong) {
    throw Object.assign(new Error('song_not_found'), { statusCode: 404 });
  }
  return { project, requestedSong };
}

export default async function uploads(app: FastifyInstance) {
  app.post(
    '/presign',
    { schema: { body: presignUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { kind, contentType, ext, sizeBytes } = presignUploadSchema.parse(
        req.body
      );
      try {
        const policy = uploadPolicyFromEnv();
        await enforceDistributedUploadRate(
          app.rateLimitRedis,
          workspaceId,
          policy
        );
        const signed = await presignUpload({
          workspaceId,
          kind: 'uploads/' + kind,
          contentType,
          ext,
          sizeBytes,
        });
        const reservation = await reserveUploadBytes(
          workspaceId,
          { objectKey: signed.key, assetRef: signed.assetRef, kind, sizeBytes },
          policy
        );
        return { ...signed, reservation };
      } catch (error) {
        return uploadPolicyErrorResponse(reply, error);
      }
    }
  );

  // Proxied upload: browser → our API → R2 (server-side S3 creds). Avoids the
  // browser→R2 cross-origin PUT entirely, so it works even when the R2 bucket
  // has no CORS policy. Used for small audio like the Shazam mic capture.
  app.post(
    '/audio',
    { bodyLimit: 43 * 1024 * 1024, schema: { body: audioUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { kind, contentType, ext, dataBase64 } = audioUploadSchema.parse(
        req.body
      );
      const b64 = dataBase64.includes(',')
        ? dataBase64.slice(dataBase64.indexOf(',') + 1)
        : dataBase64;
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length < 1000)
        return reply.code(400).send({ error: 'audio_too_small' });
      if (bytes.length > 30 * 1024 * 1024)
        return reply.code(413).send({ error: 'audio_too_large' });
      const detected = sniffAudioFormat(bytes.subarray(0, 64));
      if (!detected)
        return reply.code(415).send({ error: 'unsupported_or_invalid_audio' });
      const declaredFormat = ext;
      if (declaredFormat !== detected) {
        return reply.code(415).send({
          error: 'audio_type_mismatch',
          declared: declaredFormat,
          detected,
        });
      }
      const safeKind = /^[a-z0-9_-]{1,20}$/.test(kind) ? kind : 'reference';
      const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'webm';
      const key =
        workspaceId + '/uploads/' + safeKind + '/' + nanoid() + '.' + safeExt;
      try {
        const policy = uploadPolicyFromEnv();
        await enforceDistributedUploadRate(
          app.rateLimitRedis,
          workspaceId,
          policy
        );
        const assetRef = publicUrlFor(key);
        const reservation = await reserveUploadBytes(
          workspaceId,
          { objectKey: key, assetRef, kind: safeKind, sizeBytes: bytes.length },
          policy
        );
        const url = await putBytes(key, bytes, contentType || 'audio/webm');
        return {
          key,
          assetRef: url,
          publicUrl: url,
          playbackUrl: await presignAssetRef(url, 900),
          reservation,
        };
      } catch (error) {
        return uploadPolicyErrorResponse(reply, error);
      }
    }
  );

  app.post(
    '/import',
    { schema: { body: importUrlSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const input = importUrlSchema.parse(req.body);
      if (input.kind === 'vocal' && input.isolationConfirmed !== true) {
        return reply.code(422).send({
          error: 'isolated_vocal_confirmation_required',
          message:
            'Confirm this link is an isolated vocal, not a finished song or instrumental.',
        });
      }

      // Resolve every caller-supplied relation before DNS, remote fetch, or an
      // object-store write. A globally valid song ID from another workspace or
      // project is intentionally indistinguishable from a missing song.
      const { project, requestedSong } = await resolveAuthorizedImportTarget(
        workspaceId,
        input.projectId,
        input.songId
      );
      let importPolicy: UploadPolicy;
      try {
        importPolicy = uploadPolicyFromEnv();
        await enforceDistributedUploadRate(
          app.rateLimitRedis,
          workspaceId,
          importPolicy
        );
      } catch (error) {
        return uploadPolicyErrorResponse(reply, error);
      }

      // SSRF + copyright guard: resolves DNS, blocks private/metadata targets and
      // streaming hosts, and re-validates every redirect hop (see lib/url-guard).
      const chk = await assertSafeUrl(input.url);
      if (!chk.ok)
        return reply
          .code(chk.code)
          .send({ error: chk.error, message: chk.message });

      // Fetch the audio (rights-cleared source) with a timeout + size cap.
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
      let bytes: Buffer;
      let contentType: string;
      try {
        const res = await safeFetch(input.url, { signal: controller.signal });
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return reply
            .code(502)
            .send({ error: `source responded ${res.status}` });
        }
        contentType =
          res.headers.get('content-type') ?? 'application/octet-stream';
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared && declared > MAX_IMPORT_BYTES) {
          await res.body?.cancel().catch(() => undefined);
          return reply.code(413).send({ error: 'file too large (max 80MB)' });
        }
        bytes = await readWithLimit(res, MAX_IMPORT_BYTES);
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 413) {
          return reply.code(413).send({ error: 'file too large (max 80MB)' });
        }
        // A redirect that pointed at a blocked/private host is rejected mid-fetch.
        const uc = (
          err as {
            urlCheck?: { code: number; error: string; message?: string };
          }
        ).urlCheck;
        if (uc)
          return reply
            .code(uc.code)
            .send({ error: uc.error, message: uc.message });
        // Log the real cause; give the client a safe, actionable message (raw
        // fetch errors can leak internal hostnames/stack details).
        req.log.warn({ err }, 'import fetch failed');
        return reply.code(502).send({
          error: 'fetch_failed',
          message:
            'Could not fetch that URL — check it is a public, direct audio link and try again.',
        });
      } finally {
        clearTimeout(t);
      }

      // Always require audio — no exemption. (The old reference-kind bypass turned
      // /import into a fetch-any-content proxy that stored + read back non-audio.)
      if (!/^audio\//.test(contentType)) {
        return reply.code(415).send({
          error: 'not_audio',
          message: `Expected audio, got "${contentType}". Use a direct audio file link.`,
        });
      }

      const ext = extFromContentType(contentType, input.url);
      const detected = sniffAudioFormat(bytes.subarray(0, 64));
      if (!detected)
        return reply.code(415).send({ error: 'unsupported_or_invalid_audio' });
      if ((ext === 'm4a' ? 'm4a' : ext) !== detected) {
        return reply
          .code(415)
          .send({ error: 'audio_type_mismatch', declared: ext, detected });
      }
      const key =
        workspaceId +
        '/uploads/import-' +
        input.kind +
        '/' +
        nanoid() +
        '.' +
        ext;
      try {
        await reserveUploadBytes(
          workspaceId,
          {
            objectKey: key,
            assetRef: publicUrlFor(key),
            kind: input.kind,
            sizeBytes: bytes.length,
          },
          importPolicy
        );
      } catch (error) {
        return uploadPolicyErrorResponse(reply, error);
      }
      const url = await putBytes(key, bytes, contentType);

      // Register the imported asset just like an upload — authentic, approved.
      if (input.kind === 'vocal') {
        const songId =
          requestedSong?.id ??
          (await ensureSong(
            workspaceId,
            project.id,
            `${project.title} — import`
          ));
        const { vocal, job } = await registerVocalForInspection({
          app,
          workspaceId,
          projectId: project.id,
          songId,
          role: input.role ?? 'lead',
          url,
          source: 'artist_import',
          sourceMeta: { imported: true, sourceUrl: provenanceUrl(input.url) },
        });
        reply.code(202);
        return {
          kind: 'vocal',
          asset: vocal,
          songId,
          jobId: job.jobId,
          qualityState: 'pending',
        };
      }

      if (input.kind === 'song') {
        // TRAINING-ONLY door (the owner found his old catalog track sitting in the
        // studio catalog after a training import): learn + harvest WITHOUT filing
        // a catalog Song/Mix — the lake and the shelf get everything, the catalog
        // stays the artist's working space.
        if (input.trainingOnly) {
          await enqueueLearn(app, {
            workspaceId,
            projectId: project.id,
            url,
            source: 'song-import-training',
            rightsConfirmation: input.rightsConfirmation,
          });
          await enqueueHarvest(app, {
            workspaceId,
            projectId: project.id,
            sourceUrl: url,
            rightsConfirmation: input.rightsConfirmation,
          });
          reply.code(201);
          return {
            kind: 'song',
            trainingOnly: true,
            url,
            note: 'Learned + harvested for training — not added to the catalog.',
          };
        }
        const songId =
          requestedSong?.id ??
          (await ensureSong(
            workspaceId,
            project.id,
            input.title ?? `${project.title} — import`
          ));
        const directOwnedUpload = {
          schemaVersion: 1,
          sourceKind: 'url_import',
          rightsConfirmation: input.rightsConfirmation,
          recordedAt: new Date().toISOString(),
          sourceUrl: provenanceUrl(input.url),
        };
        const mix = await prisma.mix.create({
          data: {
            projectId: project.id,
            songId,
            preset: 'imported',
            url,
            notes: 'Imported song - ' + provenanceUrl(input.url),
            qualityState: 'unmeasured',
            approved: false,
            meta: { directOwnedUpload, releaseLineageCertified: false } as never,
          },
        });
        // Same law as the finished-upload bridge (mixes.ts /upload): an OWNED
        // imported song both LEARNS (SoundReference, genre hint = project genre)
        // and HARVESTS (non-vocal stems → owned material). Song-scoped — a
        // finished record has no beat row. Best-effort, never blocks the import.
        await enqueueLearn(app, {
          workspaceId,
          projectId: project.id,
          url,
          source: 'song-import',
          rightsConfirmation: input.rightsConfirmation,
        });
        await enqueueHarvest(app, {
          workspaceId,
          projectId: project.id,
          songId,
          sourceUrl: url,
          rightsConfirmation: input.rightsConfirmation,
        });
        if (!input.autoMaster) {
          reply.code(201);
          return { kind: 'song', asset: mix, songId, mastered: false };
        }

        const sourceFingerprint = createHash('sha256').update(bytes).digest('hex');
        const masterIdempotencyKey = scopedRequestKey(
          req.headers as Record<string, unknown>,
          'imported-song-master',
        ) ?? `imported-song-master:${songId}:${sourceFingerprint}`;
        const charge = await app.chargeCredits({
          workspaceId,
          key: 'master_preset',
          refTable: 'Song',
          refId: songId,
          idempotencyKey: masterIdempotencyKey,
        });
        if (!charge.ok) {
          reply.code(201);
          return {
            kind: 'song',
            asset: mix,
            songId,
            mastered: false,
            masterError: 'insufficient_credits',
          };
        }
        const job = await createQueuedProviderJob({
          app,
          queue: app.queues.master,
          jobName: 'create-master',
          workspaceId,
          projectId: project.id,
          kind: 'master',
          provider: 'internal',
          inputJson: {
            songId,
            mixId: mix.id,
            preset: input.masterPreset,
            finished: true,
          },
          charge,
          idempotencyKey: masterIdempotencyKey,
          payload: (jobId) => ({
            jobId,
            workspaceId,
            projectId: project.id,
            songId,
            mixId: mix.id,
            preset: input.masterPreset,
            finished: true,
          }),
        });
        await arReadAfterRender(app, workspaceId, [{ songId, jobId: job.jobId }]);
        reply.code(202);
        return {
          kind: 'song',
          asset: mix,
          songId,
          mastered: true,
          jobId: job.jobId,
          replayed: job.replayed,
        };
      }

      if (input.kind === 'reference') {
        reply.code(201);
        return {
          kind: 'reference',
          url,
          note: 'Stored for inspiration only — not added to the song.',
        };
      }

      // beat | instrumental
      const songId =
        requestedSong?.id ??
        (await ensureSong(
          workspaceId,
          project.id,
          `${project.title} — import`
        ));
      if (input.bpm || input.keySignature) {
        await prisma.project.update({
          where: { id: project.id },
          data: {
            ...(input.bpm ? { bpm: input.bpm } : {}),
            ...(input.keySignature ? { keySignature: input.keySignature } : {}),
          },
        });
      }
      const { beat, job } = await registerBeatForInspection({
        app,
        workspaceId,
        projectId: project.id,
        songId,
        url,
        format: ext,
        provider: 'import',
        bpm: input.bpm ?? null,
        keySignature: input.keySignature ?? null,
        sourceMeta: {
          imported: true,
          sourceUrl: provenanceUrl(input.url),
          instrumental: true,
          title: input.title ?? null,
          rightsBasis: 'user-attested',
          rightsConfirmationVersion: input.rightsConfirmation.version,
        },
      });
      // Auto-harvest the owned import into reusable role loops (drums/bass/other).
      await enqueueHarvest(app, {
        workspaceId,
        projectId: project.id,
        beatId: beat.id,
        sourceUrl: url,
        rightsConfirmation: input.rightsConfirmation,
      });
      // AUTO-LEARN too (audit: harvested but never learned): the owned import
      // joins the learned lake as a SoundReference. Charged; best-effort.
      await enqueueLearn(app, {
        workspaceId,
        projectId: project.id,
        url,
        source: 'beat-import',
        rightsConfirmation: input.rightsConfirmation,
      });
      reply.code(202);
      return {
        kind: input.kind,
        asset: beat,
        songId,
        jobId: job.jobId,
        qualityState: 'pending',
      };
    }
  );
}
