import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type Redis from 'ioredis';
import {
  MAX_PRESIGNED_UPLOAD_BYTES,
  presignUploadSchema,
} from '@afrohit/shared';
import { requestRedisOptions } from '../src/lib/queue';
import {
  enforceDistributedUploadRate,
  reconcileUploadReservations,
  UploadPolicyError,
  uploadPolicyFromEnv,
  type UploadPolicy,
  type UploadReservation,
} from '../src/routes/uploads';

const MiB = 1024 * 1024;
const workspaceId = 'workspace-platform-test';
const now = new Date('2026-07-16T12:00:00.000Z');
const policy: UploadPolicy = {
  workspaceQuotaBytes: 1024 * MiB,
  maxPerWindow: 24,
  windowSeconds: 10 * 60,
  reservationTtlSeconds: 24 * 60 * 60,
  expiredRetentionSeconds: 7 * 24 * 60 * 60,
};

function reservationRow(
  reservationId: string,
  input: Partial<UploadReservation> &
    Pick<UploadReservation, 'status' | 'assetRef' | 'sizeBytes'>
): { key: string; value: string } {
  const reservation: UploadReservation = {
    version: 1,
    reservationId,
    workspaceId,
    objectKey: workspaceId + '/uploads/' + reservationId + '.wav',
    assetRef: input.assetRef,
    kind: 'beat',
    sizeBytes: input.sizeBytes,
    status: input.status,
    issuedAt: input.issuedAt ?? '2026-07-15T10:00:00.000Z',
    expiresAt: input.expiresAt ?? '2026-07-16T10:00:00.000Z',
    cleanupJobId: 'cleanup-' + reservationId,
    ...(input.committedAt ? { committedAt: input.committedAt } : {}),
    ...(input.expiredAt ? { expiredAt: input.expiredAt } : {}),
  };
  return {
    key: 'upload-reservation:v1:' + workspaceId + ':' + reservationId,
    value: JSON.stringify(reservation),
  };
}

async function expectPolicyError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number
): Promise<UploadPolicyError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof UploadPolicyError);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return error;
  }
  assert.fail('expected upload policy error');
}

class FakeRedis {
  constructor(
    private readonly result: unknown,
    private readonly failure?: Error
  ) {}

  async eval(): Promise<unknown> {
    if (this.failure) throw this.failure;
    return this.result;
  }
}

function asRedis(redis: FakeRedis): Redis {
  return redis as unknown as Redis;
}

async function main(): Promise<void> {
  const defaults = uploadPolicyFromEnv({});
  assert.equal(defaults.workspaceQuotaBytes, 1024 * MiB);
  assert.equal(defaults.maxPerWindow, 24);
  assert.equal(defaults.windowSeconds, 600);
  assert.equal(defaults.reservationTtlSeconds, 86_400);

  const redisOptions = requestRedisOptions({
    REDIS_REQUEST_TIMEOUT_MS: '8000',
  });
  assert.equal(redisOptions.maxRetriesPerRequest, 1);
  assert.equal(redisOptions.enableOfflineQueue, false);
  assert.equal(redisOptions.commandTimeout, 5_000);
  assert.equal(redisOptions.connectTimeout, 5_000);

  assert.doesNotThrow(() =>
    presignUploadSchema.parse({
      kind: 'beat',
      contentType: 'audio/wav',
      ext: 'wav',
      sizeBytes: MAX_PRESIGNED_UPLOAD_BYTES,
    })
  );
  assert.throws(() =>
    presignUploadSchema.parse({
      kind: 'beat',
      contentType: 'audio/wav',
      ext: 'wav',
      sizeBytes: MAX_PRESIGNED_UPLOAD_BYTES + 1,
    })
  );

  const activeRef = 's3://bucket/workspace/active.wav';
  const pendingProtectedRef = 's3://bucket/workspace/pending-protected.wav';
  const pendingOrphanRef = 's3://bucket/workspace/pending-orphan.wav';
  const committedProtectedRef = 's3://bucket/workspace/committed-protected.wav';
  const committedOrphanRef = 's3://bucket/workspace/committed-orphan.wav';
  const rows = [
    reservationRow('active', {
      status: 'pending',
      assetRef: activeRef,
      sizeBytes: 10 * MiB,
      issuedAt: '2026-07-16T11:55:00.000Z',
      expiresAt: '2026-07-17T11:55:00.000Z',
    }),
    reservationRow('pending-protected', {
      status: 'pending',
      assetRef: pendingProtectedRef,
      sizeBytes: 20 * MiB,
    }),
    reservationRow('pending-orphan', {
      status: 'pending',
      assetRef: pendingOrphanRef,
      sizeBytes: 30 * MiB,
    }),
    reservationRow('committed-protected', {
      status: 'committed',
      assetRef: committedProtectedRef,
      sizeBytes: 40 * MiB,
      committedAt: '2026-07-15T11:00:00.000Z',
    }),
    reservationRow('committed-orphan', {
      status: 'committed',
      assetRef: committedOrphanRef,
      sizeBytes: 50 * MiB,
      committedAt: '2026-07-15T11:00:00.000Z',
    }),
    reservationRow('expired-old', {
      status: 'expired',
      assetRef: 's3://bucket/workspace/expired-old.wav',
      sizeBytes: 60 * MiB,
      issuedAt: '2026-06-30T10:00:00.000Z',
      expiresAt: '2026-07-01T10:00:00.000Z',
      expiredAt: '2026-07-01T10:01:00.000Z',
    }),
  ];
  const state = reconcileUploadReservations(
    rows,
    workspaceId,
    new Set([pendingProtectedRef, committedProtectedRef]),
    now,
    policy
  );
  assert.equal(state.usedBytes, 70 * MiB);
  assert.equal(state.recentIssuedAt.length, 1);
  assert.equal(
    state.reservations.find(row => row.reservationId === 'pending-protected')
      ?.status,
    'committed'
  );
  assert.equal(
    state.reservations.find(row => row.reservationId === 'pending-orphan')
      ?.status,
    'expired'
  );
  assert.equal(
    state.reservations.find(row => row.reservationId === 'committed-orphan')
      ?.status,
    'expired'
  );
  assert.ok(
    state.mutations.some(
      row => row.key.endsWith(':expired-old') && row.value === null
    )
  );

  const corrupt = {
    ...rows[0]!,
    key: rows[0]!.key.replace(workspaceId, 'other-workspace'),
  };
  assert.throws(
    () =>
      reconcileUploadReservations(
        [corrupt],
        workspaceId,
        new Set(),
        now,
        policy
      ),
    (error: unknown) =>
      error instanceof UploadPolicyError &&
      error.code === 'upload_reservation_corrupt'
  );

  await enforceDistributedUploadRate(
    asRedis(new FakeRedis([24, 60_000])),
    workspaceId,
    policy
  );
  const limited = await expectPolicyError(
    enforceDistributedUploadRate(
      asRedis(new FakeRedis([25, 55_000])),
      workspaceId,
      policy
    ),
    'upload_rate_limited',
    429
  );
  assert.equal(limited.details?.retryAfterSec, 55);
  await expectPolicyError(
    enforceDistributedUploadRate(
      asRedis(new FakeRedis(null, new Error('redis unavailable'))),
      workspaceId,
      policy
    ),
    'upload_control_unavailable',
    503
  );

  const indexSource = readFileSync(
    new URL('../src/index.ts', import.meta.url),
    'utf8'
  );
  assert.match(indexSource, /redis: app\.rateLimitRedis/);
  assert.match(indexSource, /path\.startsWith\("\/health\/"\)/);
  assert.match(indexSource, /reply\.code\(systemOk \? 200 : 503\)/);
  const uploadsSource = readFileSync(
    new URL('../src/routes/uploads.ts', import.meta.url),
    'utf8'
  );
  assert.match(uploadsSource, /pg_advisory_xact_lock/);
  assert.match(uploadsSource, /systemSetting\.create/);
  assert.match(uploadsSource, /jobOutbox\.create/);
  assert.match(uploadsSource, /nextAttemptAt: expiresAt/);

  console.log('platform reliability tests passed');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
