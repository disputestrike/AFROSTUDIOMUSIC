import { releaseEvidenceHash, releaseMixSourceClaim, prisma } from '@afrohit/db';

type JsonRecord = Record<string, unknown>;

export type CertifiedSourceAssetRef = {
  type: 'beat' | 'mix' | 'master';
  id: string;
  url?: string;
  certification?: { contentHash?: string | null } | null;
};

export type ResolvedDerivedAudioSource = {
  type: CertifiedSourceAssetRef['type'];
  id: string;
  url: string;
  contentHash: string;
  claim: JsonRecord | null;
  claimHash: string | null;
};

const record = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const contentHash = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('derived_audio_uncertified_' + field);
  }
  return value.toLowerCase();
};

const optionalContentHash = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;

function assertRequestedSource(
  ref: CertifiedSourceAssetRef,
  row: { id: string; url: string; contentHash: string | null },
): string {
  if (ref.url && ref.url !== row.url) throw new Error('derived_audio_source_url_mismatch');
  const rowHash = contentHash(row.contentHash, 'source_hash');
  const requestedHash = ref.certification?.contentHash;
  if (requestedHash && contentHash(requestedHash, 'requested_hash') !== rowHash) {
    throw new Error('derived_audio_source_hash_mismatch');
  }
  return rowHash;
}

export async function resolveCertifiedDerivedAudioSource(options: {
  workspaceId: string;
  projectId: string;
  songId: string;
  source: CertifiedSourceAssetRef;
}): Promise<ResolvedDerivedAudioSource> {
  const where = {
    id: options.source.id,
    projectId: options.projectId,
    songId: options.songId,
    project: { workspaceId: options.workspaceId },
    approved: true,
    qualityState: 'passed',
    contentHash: { not: null },
    verifiedAt: { not: null },
  } as const;

  if (options.source.type === 'beat') {
    const beat = await prisma.beatAsset.findFirst({
      where: { ...where, assetKind: 'instrumental' },
      select: { id: true, url: true, contentHash: true },
    });
    if (!beat) throw new Error('derived_audio_source_beat_not_certified');
    const hash = assertRequestedSource(options.source, beat);
    const claim = {
      schemaVersion: 1,
      kind: 'derived_mix',
      beatId: beat.id,
      beatContentHash: hash,
      vocalRenderIds: [],
      vocalRenderContentHashes: [],
    };
    return {
      type: 'beat',
      id: beat.id,
      url: beat.url,
      contentHash: hash,
      claim,
      claimHash: releaseEvidenceHash(claim),
    };
  }

  if (options.source.type === 'mix') {
    const mix = await prisma.mix.findFirst({
      where,
      select: { id: true, url: true, contentHash: true, meta: true },
    });
    if (!mix) throw new Error('derived_audio_source_mix_not_certified');
    const hash = assertRequestedSource(options.source, mix);
    const claim = releaseMixSourceClaim(mix.meta);
    return {
      type: 'mix',
      id: mix.id,
      url: mix.url,
      contentHash: hash,
      claim,
      claimHash: claim ? releaseEvidenceHash(claim) : null,
    };
  }

  const master = await prisma.master.findFirst({
    where,
    select: {
      id: true,
      url: true,
      contentHash: true,
      mixId: true,
      meta: true,
      mix: {
        select: {
          id: true,
          projectId: true,
          songId: true,
          approved: true,
          qualityState: true,
          contentHash: true,
          verifiedAt: true,
          meta: true,
        },
      },
    },
  });
  if (!master) throw new Error('derived_audio_source_master_not_certified');
  const hash = assertRequestedSource(options.source, master);
  const masterMeta = record(master.meta);
  const sourceMixHash = optionalContentHash(master.mix?.contentHash);
  const receiptHash = optionalContentHash(masterMeta?.sourceContentHash);
  const sourceMixCertified = !!master.mix
    && !!sourceMixHash
    && master.mix.projectId === options.projectId
    && master.mix.songId === options.songId
    && master.mix.approved
    && master.mix.qualityState === 'passed'
    && !!master.mix.verifiedAt
    && master.mixId === master.mix.id
    && masterMeta?.sourceMixId === master.mix.id
    && receiptHash === sourceMixHash;
  const claim = sourceMixCertified ? releaseMixSourceClaim(master.mix!.meta) : null;
  return {
    type: 'master',
    id: master.id,
    url: master.url,
    contentHash: hash,
    claim,
    claimHash: claim ? releaseEvidenceHash(claim) : null,
  };
}

export function derivedMixLineageMeta(options: {
  source: ResolvedDerivedAudioSource;
  outputContentHash: string;
  derivedAt: Date;
  operation: unknown;
  preservesSourceContributors: boolean;
}): JsonRecord {
  const derivedFrom = {
    type: options.source.type,
    id: options.source.id,
    contentHash: options.source.contentHash,
    claimHash: options.source.claimHash,
    claim: options.source.claim,
    operation: options.operation,
  };
  if (!options.preservesSourceContributors || !options.source.claim) {
    return { derivedFrom, releaseLineageCertified: false };
  }

  const kind = options.source.claim.kind;
  if (kind === 'derived_mix') {
    return {
      source: {
        beatId: options.source.claim.beatId,
        beatContentHash: options.source.claim.beatContentHash,
        vocalRenderIds: options.source.claim.vocalRenderIds,
        vocalRenderContentHashes: options.source.claim.vocalRenderContentHashes,
      },
      derivedFrom,
    };
  }
  if (kind !== 'direct_owned_upload' || !options.source.claimHash) {
    return { derivedFrom, releaseLineageCertified: false };
  }
  const derivedAt = options.derivedAt.toISOString();
  return {
    directOwnedUpload: {
      schemaVersion: 1,
      sourceKind: 'owned_derivative',
      rightsConfirmation: { version: 1, confirmed: true },
      sourceContentHash: contentHash(options.outputContentHash, 'output_hash'),
      parentSourceContentHash: options.source.contentHash,
      parentClaimHash: options.source.claimHash,
      recordedAt: derivedAt,
      certifiedAt: derivedAt,
    },
    derivedFrom,
    releaseLineageCertified: false,
  };
}
