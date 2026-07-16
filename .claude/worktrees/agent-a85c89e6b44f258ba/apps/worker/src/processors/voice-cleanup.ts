import { elevenKey, replicateToken } from '@afrohit/ai';
import { openSecret, prisma } from '@afrohit/db';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { deleteObjectByUrl } from '../lib/storage';

interface VoiceCleanupPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
}

interface ProviderCleanup {
  status?: string;
  provider?: string | null;
  providerVoiceId?: string | null;
  trainingId?: string | null;
  trainerKind?: 'prediction' | 'training';
  destinationModel?: string | null;
  providerVersion?: string | null;
  canceled?: boolean;
  versionDeleted?: boolean;
  providerVoiceDeleted?: boolean;
  failedStorageRefs?: unknown;
  datasetIds?: unknown;
  datasetReceiptsDeleted?: boolean;
}

const RETRY_DELAYS_MS = [5_000, 15_000] as const;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupFrom(meta: unknown): ProviderCleanup {
  if (!meta || typeof meta !== 'object') return {};
  const cleanup = (meta as Record<string, unknown>).providerCleanup;
  return cleanup && typeof cleanup === 'object' ? cleanup as ProviderCleanup : {};
}

function storageRefs(cleanup: ProviderCleanup): string[] {
  if (!Array.isArray(cleanup.failedStorageRefs)) return [];
  return cleanup.failedStorageRefs.filter((value): value is string => typeof value === 'string');
}

function datasetIds(cleanup: ProviderCleanup): string[] {
  if (!Array.isArray(cleanup.datasetIds)) return [];
  return cleanup.datasetIds.filter((value): value is string => typeof value === 'string');
}

async function cancelTraining(
  id: string,
  kind: ProviderCleanup['trainerKind'],
  token: string | undefined,
): Promise<boolean> {
  if (!token || !/^[a-zA-Z0-9_-]{6,160}$/.test(id)) return false;
  const endpoint = kind === 'training' ? 'trainings' : 'predictions';
  const response = await fetch(`https://api.replicate.com/v1/${endpoint}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok || response.status === 409;
}

async function deleteModelVersion(
  destination: string,
  version: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token || !/^[a-zA-Z0-9]{20,128}$/.test(version)) return false;
  const [owner, model, extra] = destination.split('/');
  if (extra || !owner || !model || !/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(model)) {
    return false;
  }
  const response = await fetch(
    `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(model)}/versions/${encodeURIComponent(version)}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  return response.ok || response.status === 404;
}

async function deleteHostedVoice(provider: string | null | undefined, id: string, key: string | undefined): Promise<boolean> {
  if (provider === 'stub') return true;
  if (provider !== 'eleven' || !key || !/^[a-zA-Z0-9_-]{6,128}$/.test(id)) return false;
  const response = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok || response.status === 404;
}

export async function processVoiceCleanup(payload: VoiceCleanupPayload): Promise<void> {
  await markRunning(payload.jobId);

  const profile = await prisma.voiceProfile.findFirst({
    where: { id: payload.voiceProfileId, workspaceId: payload.workspaceId },
    select: { id: true, status: true, trainingMeta: true },
  });
  if (!profile) {
    await markSucceeded(payload.jobId, { cleanup: 'profile_absent' });
    return;
  }
  if (profile.status !== 'REVOKED') {
    await markFailed(payload.jobId, new Error('voice_cleanup_refused_for_active_profile'));
    return;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: payload.workspaceId },
    select: { musicProvider: true, musicApiKey: true },
  });
  const workspaceToken = workspace?.musicProvider === 'replicate' ? openSecret(workspace.musicApiKey) : undefined;
  const token = workspaceToken || replicateToken();
  let cleanup = cleanupFrom(profile.trainingMeta);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let canceled = cleanup.canceled === true || !cleanup.trainingId;
    let versionDeleted = cleanup.versionDeleted === true || !cleanup.destinationModel || !cleanup.providerVersion;
    let providerVoiceDeleted = cleanup.providerVoiceDeleted === true || !cleanup.providerVoiceId;

    if (!providerVoiceDeleted && cleanup.providerVoiceId) {
      try {
        providerVoiceDeleted = await deleteHostedVoice(cleanup.provider, cleanup.providerVoiceId, elevenKey());
      } catch {
        providerVoiceDeleted = false;
      }
    }

    if (!canceled && cleanup.trainingId) {
      try {
        canceled = await cancelTraining(cleanup.trainingId, cleanup.trainerKind, token);
      } catch {
        canceled = false;
      }
    }
    if (!versionDeleted && cleanup.destinationModel && cleanup.providerVersion) {
      try {
        versionDeleted = await deleteModelVersion(cleanup.destinationModel, cleanup.providerVersion, token);
      } catch {
        versionDeleted = false;
      }
    }

    const refs = storageRefs(cleanup);
    const deletions = await Promise.allSettled(refs.map((ref) => deleteObjectByUrl(ref)));
    const failedStorageRefs = refs.filter((_ref, index) => deletions[index]?.status === 'rejected');
    let datasetReceiptsDeleted = cleanup.datasetReceiptsDeleted === true || datasetIds(cleanup).length === 0;
    if (!datasetReceiptsDeleted && failedStorageRefs.length === 0) {
      try {
        await prisma.voiceDataset.deleteMany({
          where: { id: { in: datasetIds(cleanup) }, workspaceId: payload.workspaceId },
        });
        datasetReceiptsDeleted = true;
      } catch {
        datasetReceiptsDeleted = false;
      }
    }
    const complete = canceled && versionDeleted && providerVoiceDeleted && datasetReceiptsDeleted && failedStorageRefs.length === 0;
    const now = new Date().toISOString();

    if (complete) {
      await prisma.voiceProfile.update({
        where: { id: profile.id },
        data: {
          trainingMeta: {
            revokedAt: (profile.trainingMeta as Record<string, unknown> | null)?.revokedAt ?? now,
            providerCleanup: { status: 'complete', completedAt: now },
          } as never,
        },
      });
      await markSucceeded(payload.jobId, { cleanup: 'complete', attempts: attempt });
      return;
    }

    cleanup = { ...cleanup, canceled, versionDeleted, providerVoiceDeleted, datasetReceiptsDeleted, failedStorageRefs };
    await prisma.voiceProfile.update({
      where: { id: profile.id },
      data: {
        trainingMeta: {
          revokedAt: (profile.trainingMeta as Record<string, unknown> | null)?.revokedAt ?? now,
          providerCleanup: {
            ...cleanup,
            status: attempt === 3 ? 'retry_required' : 'retrying',
            attempt,
            lastAttemptAt: now,
          },
        } as never,
      },
    });

    if (attempt < 3) await pause(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[0]);
  }

  await markFailed(payload.jobId, new Error('voice_cleanup_incomplete'));
}
