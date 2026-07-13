import { prisma } from '@afrohit/db';

type Tx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

function stringsIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith('s3://') || /^https?:\/\//i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) stringsIn(item, out);
  }
}

export function uniqueAssetRefs(values: unknown[]): string[] {
  const refs: string[] = [];
  for (const value of values) stringsIn(value, refs);
  return [...new Set(refs)];
}

export async function queueAssetDeletion(
  tx: Tx,
  opts: { workspaceId: string; refs: string[]; reason: string }
): Promise<string | null> {
  if (!opts.refs.length) return null;
  const job = await tx.providerJob.create({
    data: {
      workspaceId: opts.workspaceId,
      kind: 'cleanup',
      provider: 'storage',
      status: 'QUEUED',
      inputJson: { reason: opts.reason, objectCount: opts.refs.length } as never,
    },
    select: { id: true },
  });
  await tx.jobOutbox.create({
    data: {
      workspaceId: opts.workspaceId,
      providerJobId: job.id,
      queueName: 'cleanup',
      jobName: 'delete-assets',
      payload: { jobId: job.id, workspaceId: opts.workspaceId, refs: opts.refs, reason: opts.reason } as never,
    },
  });
  return job.id;
}

export function songAssetRefs(song: {
  instrumentalUrl?: string | null;
  acapellaUrl?: string | null;
  beats?: Array<{ url: string; stems: Array<{ url: string }> }>;
  vocalRenders?: Array<{ url: string }>;
  mixes?: Array<{ url: string }>;
  masters?: Array<{ url: string }>;
  exports?: Array<{ bundle: unknown }>;
}): string[] {
  return uniqueAssetRefs([
    song.instrumentalUrl,
    song.acapellaUrl,
    ...(song.beats ?? []).flatMap((beat) => [beat.url, ...beat.stems.map((stem) => stem.url)]),
    ...(song.vocalRenders ?? []).map((asset) => asset.url),
    ...(song.mixes ?? []).map((asset) => asset.url),
    ...(song.masters ?? []).map((asset) => asset.url),
    ...(song.exports ?? []).map((asset) => asset.bundle),
  ]);
}
