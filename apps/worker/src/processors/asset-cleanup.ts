import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { deleteObjectByUrl } from '../lib/storage';

type AssetCleanupPayload = {
  jobId: string;
  workspaceId: string;
  refs: string[];
  reason: string;
};

export async function processAssetCleanup(payload: AssetCleanupPayload): Promise<void> {
  await markRunning(payload.jobId);
  try {
    const refs = [...new Set(payload.refs)].slice(0, 10_000);
    for (const ref of refs) await deleteObjectByUrl(ref);
    await markSucceeded(payload.jobId, { deleted: refs.length, reason: payload.reason });
  } catch (error) {
    await markFailed(payload.jobId, error);
    throw error;
  }
}
