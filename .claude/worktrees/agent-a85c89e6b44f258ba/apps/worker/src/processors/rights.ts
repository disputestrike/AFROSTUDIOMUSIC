import {
  canonicalReceiptHash,
  recognizeSong,
  runRightsCheck,
} from '@afrohit/ai';
import {
  loadReleaseCertification,
  prisma,
  releaseEvidenceHash,
  releaseMixSourceClaim,
} from '@afrohit/db';
import { assertStoredContentHash } from '../lib/certified-assets';
import {
  extractClip,
  NATIVE_AUDIO_LIMITS,
  probeAudioBufferDurationS,
} from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { downloadToBuffer } from '../lib/storage';

interface RightsPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  audioRightsAttestation?: {
    confirmed: true;
    basis: 'owner' | 'licensed' | 'public_domain';
    note?: string;
  };
}

type AudioRecognitionEvidence = {
  status: 'clear' | 'matched_cleared' | 'matched_unconfirmed' | 'unavailable';
  provider: 'audd';
  match: unknown;
  attestation: RightsPayload['audioRightsAttestation'] | null;
  error?: string;
};

type MaterialUsageEvidence = {
  id: string;
  role: string;
  sections: unknown;
  material: { id: string; rightsBasis: string; contentHash: string | null };
};

type ReferenceUsageEvidence = {
  id: string;
  position: number;
  pinned: boolean;
  influence: unknown;
  reference: unknown;
};

type JsonRecord = Record<string, unknown>;

type CertifiedBeatLineage = {
  id: string;
  url: string;
  provider: string;
  assetKind: string;
  contentHash: string;
};

type CertifiedVocalLineage = {
  id: string;
  role: string;
  performanceSource: string;
  assetKind: string;
  voiceProfileId: string | null;
  contentHash: string;
};

type CertifiedMaterialLineage = {
  usageId: string;
  providerJobId: string;
  materialId: string;
  contentHash: string;
};

type CertifiedReferenceLineage = {
  usageId: string;
  providerJobId: string;
  referenceId: string;
  contentHash: string;
};

type CertifiedReleaseLineageBase = {
  audio: { kind: 'master' | 'mix'; id: string; contentHash: string };
  master: { id: string; contentHash: string; mixId: string } | null;
  mix: { id: string; contentHash: string };
  derivation: {
    type: 'beat' | 'mix' | 'master' | 'external';
    id: string;
    sourceContentHash: string;
    claimHash: string;
    parentBeatId: string | null;
    parentBeatContentHash: string | null;
    parentVocalRenderIds: string[];
    parentVocalRenderContentHashes: string[];
  } | null;
};

type CertifiedDerivedReleaseLineage = CertifiedReleaseLineageBase & {
  originKind: 'derived_mix';
  directUpload: null;
  beat: CertifiedBeatLineage;
  vocals: CertifiedVocalLineage[];
  materials: CertifiedMaterialLineage[];
  learnedReferences: CertifiedReferenceLineage[];
};

type CertifiedDirectUploadReleaseLineage = CertifiedReleaseLineageBase & {
  originKind: 'direct_owned_upload';
  directUpload: {
    sourceKind: 'workspace_upload' | 'url_import' | 'owned_derivative';
    sourceContentHash: string;
    parentSourceContentHash: string | null;
    parentClaimHash: string | null;
    rightsConfirmationVersion: 1;
    rightsConfirmed: true;
    recordedAt: string;
    certifiedAt: string;
  };
  beat: null;
  vocals: [];
  materials: [];
  learnedReferences: [];
};

export type CertifiedReleaseLineage =
  | CertifiedDerivedReleaseLineage
  | CertifiedDirectUploadReleaseLineage;

export type ParsedReleaseMixLineage =
  | {
      kind: 'derived_mix';
      beatId: string;
      beatContentHash: string;
      vocalRenderIds: string[];
      vocalRenderContentHashes: string[];
      derivation: CertifiedReleaseLineageBase['derivation'];
    }
  | {
      kind: 'direct_owned_upload';
      sourceKind: 'workspace_upload' | 'url_import' | 'owned_derivative';
      sourceContentHash: string;
      parentSourceContentHash: string | null;
      parentClaimHash: string | null;
      rightsConfirmationVersion: 1;
      rightsConfirmed: true;
      recordedAt: string;
      certifiedAt: string;
      derivation: CertifiedReleaseLineageBase['derivation'];
    };

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function certifiedHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('release_lineage_uncertified_' + field);
  }
  return value.toLowerCase();
}

function strictIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error('release_lineage_invalid_' + field);
  const ids = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('release_lineage_invalid_' + field + '_' + index);
    }
    return entry.trim();
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('release_lineage_duplicate_' + field);
  return ids;
}

function strictHashes(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error('release_lineage_invalid_' + field);
  return value.map((entry, index) => certifiedHash(entry, field + '_' + index));
}

function certifiedTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('release_lineage_invalid_' + field);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error('release_lineage_invalid_' + field);
  return new Date(timestamp).toISOString();
}

function parseDerivation(
  metadata: JsonRecord | null
): CertifiedReleaseLineageBase['derivation'] {
  const raw = record(metadata?.derivedFrom);
  if (!raw) return null;
  if (
    raw.type !== 'beat' &&
    raw.type !== 'mix' &&
    raw.type !== 'master' &&
    raw.type !== 'external'
  ) {
    throw new Error('release_lineage_derivation_type_invalid');
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('release_lineage_derivation_id_invalid');
  }
  const claim = record(raw.claim);
  const claimHash = certifiedHash(raw.claimHash, 'derivation_claim_hash');
  if (!claim || releaseEvidenceHash(claim) !== claimHash) {
    throw new Error('release_lineage_derivation_claim_mismatch');
  }
  const parentBeatId =
    claim.kind === 'derived_mix' &&
    typeof claim.beatId === 'string' &&
    claim.beatId.trim()
      ? claim.beatId.trim()
      : null;
  const parentBeatContentHash = parentBeatId
    ? certifiedHash(claim.beatContentHash, 'derivation_parent_beat_hash')
    : null;
  const parentVocalRenderIds = parentBeatId
    ? strictIds(claim.vocalRenderIds, 'derivation_parent_vocal_ids')
    : [];
  const parentVocalRenderContentHashes = parentBeatId
    ? strictHashes(
        claim.vocalRenderContentHashes,
        'derivation_parent_vocal_hashes'
      )
    : [];
  if (parentVocalRenderIds.length !== parentVocalRenderContentHashes.length) {
    throw new Error('release_lineage_derivation_parent_vocal_set_mismatch');
  }
  return {
    type: raw.type,
    id: raw.id.trim(),
    sourceContentHash: certifiedHash(raw.contentHash, 'derivation_source_hash'),
    claimHash,
    parentBeatId,
    parentBeatContentHash,
    parentVocalRenderIds,
    parentVocalRenderContentHashes,
  };
}

export function parseReleaseMixLineage(meta: unknown): ParsedReleaseMixLineage {
  const metadata = record(meta);
  const derivation = parseDerivation(metadata);
  const source = record(metadata?.source);
  const direct = record(metadata?.directOwnedUpload);
  if (source && direct) throw new Error('release_lineage_mix_source_ambiguous');

  if (direct) {
    const rights = record(direct.rightsConfirmation);
    if (direct.schemaVersion !== 1) {
      throw new Error('release_lineage_direct_upload_schema_invalid');
    }
    if (
      direct.sourceKind !== 'workspace_upload' &&
      direct.sourceKind !== 'url_import' &&
      direct.sourceKind !== 'owned_derivative'
    ) {
      throw new Error('release_lineage_direct_upload_source_invalid');
    }
    if (rights?.version !== 1 || rights.confirmed !== true) {
      throw new Error('release_lineage_direct_upload_rights_unconfirmed');
    }
    const sourceContentHash = certifiedHash(
      direct.sourceContentHash,
      'direct_upload_source_hash'
    );
    const recordedAt = certifiedTimestamp(
      direct.recordedAt,
      'direct_upload_recorded_at'
    );
    const certifiedAt = certifiedTimestamp(
      direct.certifiedAt,
      'direct_upload_certified_at'
    );
    if (Date.parse(certifiedAt) < Date.parse(recordedAt)) {
      throw new Error('release_lineage_direct_upload_timestamps_invalid');
    }
    const parentSourceContentHash =
      direct.sourceKind === 'owned_derivative'
        ? certifiedHash(
            direct.parentSourceContentHash,
            'direct_upload_parent_source_hash'
          )
        : null;
    const parentClaimHash =
      direct.sourceKind === 'owned_derivative'
        ? certifiedHash(
            direct.parentClaimHash,
            'direct_upload_parent_claim_hash'
          )
        : null;
    const isOwnedDerivative = direct.sourceKind === 'owned_derivative';
    if (isOwnedDerivative !== !!derivation) {
      throw new Error('release_lineage_direct_upload_derivation_mismatch');
    }
    if (
      isOwnedDerivative &&
      (parentSourceContentHash !== derivation?.sourceContentHash ||
        parentClaimHash !== derivation?.claimHash ||
        record(record(metadata?.derivedFrom)?.claim)?.kind !==
          'direct_owned_upload')
    ) {
      throw new Error('release_lineage_direct_upload_parent_mismatch');
    }
    const canonical = releaseMixSourceClaim(meta);
    if (!canonical || canonical.kind !== 'direct_owned_upload') {
      throw new Error('release_lineage_source_claim_invalid');
    }
    return {
      kind: 'direct_owned_upload',
      sourceKind: direct.sourceKind,
      sourceContentHash,
      parentSourceContentHash,
      parentClaimHash,
      rightsConfirmationVersion: 1,
      rightsConfirmed: true,
      recordedAt,
      certifiedAt,
      derivation,
    };
  }

  if (!source) throw new Error('release_lineage_mix_source_missing');
  const beatId =
    typeof source.beatId === 'string' && source.beatId.trim()
      ? source.beatId.trim()
      : null;
  const beatIds = strictIds(source.beatIds, 'beat_ids');
  const exactBeatIds = [...new Set([...(beatId ? [beatId] : []), ...beatIds])];
  if (exactBeatIds.length !== 1)
    throw new Error('release_lineage_requires_exactly_one_beat');
  const vocalRenderIds = strictIds(source.vocalRenderIds, 'vocal_render_ids');
  const vocalRenderContentHashes = strictHashes(
    source.vocalRenderContentHashes,
    'vocal_render_hashes'
  );
  if (vocalRenderIds.length !== vocalRenderContentHashes.length) {
    throw new Error('release_lineage_vocal_hash_set_mismatch');
  }
  const vocals = vocalRenderIds
    .map((id, index) => ({ id, contentHash: vocalRenderContentHashes[index]! }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const canonical = releaseMixSourceClaim(meta);
  if (!canonical || canonical.kind !== 'derived_mix') {
    throw new Error('release_lineage_source_claim_invalid');
  }
  return {
    kind: 'derived_mix',
    beatId: exactBeatIds[0]!,
    beatContentHash: certifiedHash(source.beatContentHash, 'beat_source_hash'),
    vocalRenderIds: vocals.map(vocal => vocal.id),
    vocalRenderContentHashes: vocals.map(vocal => vocal.contentHash),
    derivation,
  };
}

export function releaseLineageEvidence(
  lineage: CertifiedReleaseLineage
): JsonRecord {
  if (lineage.originKind === 'direct_owned_upload') {
    return {
      schemaVersion: 2,
      audio: lineage.audio,
      master: lineage.master,
      mix: lineage.mix,
      source: {
        kind: lineage.originKind,
        sourceKind: lineage.directUpload.sourceKind,
        sourceContentHash: lineage.directUpload.sourceContentHash,
        parentSourceContentHash: lineage.directUpload.parentSourceContentHash,
        parentClaimHash: lineage.directUpload.parentClaimHash,
        rightsConfirmationVersion:
          lineage.directUpload.rightsConfirmationVersion,
        rightsConfirmed: lineage.directUpload.rightsConfirmed,
      },
      beat: null,
      vocals: [],
      materials: [],
      learnedReferences: [],
      ...(lineage.derivation ? { derivedFrom: lineage.derivation } : {}),
    };
  }
  return {
    schemaVersion: 1,
    audio: lineage.audio,
    master: lineage.master,
    mix: lineage.mix,
    beat: { id: lineage.beat.id, contentHash: lineage.beat.contentHash },
    vocals: lineage.vocals
      .map(vocal => ({ id: vocal.id, contentHash: vocal.contentHash }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    materials: [...lineage.materials].sort((left, right) =>
      left.usageId.localeCompare(right.usageId)
    ),
    learnedReferences: [...lineage.learnedReferences].sort((left, right) =>
      left.usageId.localeCompare(right.usageId)
    ),
    ...(lineage.derivation ? { derivedFrom: lineage.derivation } : {}),
  };
}

async function assertCertifiedDerivationParent(
  options: { workspaceId: string; projectId: string; songId: string },
  derivation: NonNullable<CertifiedReleaseLineageBase['derivation']>,
  visited = new Set<string>(),
  depth = 0
): Promise<void> {
  if (depth >= 16) throw new Error('release_lineage_parent_depth_exceeded');
  if (derivation.type === 'external') {
    throw new Error('release_lineage_external_parent_not_durable');
  }
  const visitKey = `${derivation.type}:${derivation.id}`;
  if (visited.has(visitKey)) throw new Error('release_lineage_parent_cycle');
  const nextVisited = new Set(visited).add(visitKey);
  const verifyBytes = async (url: string, context: string) => {
    const bytes = await downloadToBuffer(url, {
      maxBytes: 256 * 1024 * 1024,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    assertStoredContentHash(bytes, derivation.sourceContentHash, context);
  };

  if (derivation.type === 'beat') {
    const parent = await prisma.beatAsset.findFirst({
      where: {
        id: derivation.id,
        projectId: options.projectId,
        songId: options.songId,
        project: { workspaceId: options.workspaceId },
        assetKind: 'instrumental',
        approved: true,
        qualityState: 'passed',
        contentHash: derivation.sourceContentHash,
        verifiedAt: { not: null },
      },
      select: { id: true, url: true, contentHash: true },
    });
    if (!parent?.contentHash)
      throw new Error('release_lineage_parent_beat_not_certified');
    const claim = {
      schemaVersion: 1,
      kind: 'derived_mix',
      beatId: parent.id,
      beatContentHash: certifiedHash(parent.contentHash, 'parent_beat_hash'),
      vocalRenderIds: [],
      vocalRenderContentHashes: [],
    };
    if (releaseEvidenceHash(claim) !== derivation.claimHash) {
      throw new Error('release_lineage_parent_claim_mismatch');
    }
    await verifyBytes(parent.url, 'release_parent_beat');
    return;
  }

  if (derivation.type === 'mix') {
    const parent = await prisma.mix.findFirst({
      where: {
        id: derivation.id,
        projectId: options.projectId,
        songId: options.songId,
        project: { workspaceId: options.workspaceId },
        approved: true,
        qualityState: 'passed',
        contentHash: derivation.sourceContentHash,
        verifiedAt: { not: null },
      },
      select: { url: true, meta: true },
    });
    if (!parent) throw new Error('release_lineage_parent_mix_not_certified');
    const parentClaim = releaseMixSourceClaim(parent.meta);
    if (
      !parentClaim ||
      releaseEvidenceHash(parentClaim) !== derivation.claimHash
    ) {
      throw new Error('release_lineage_parent_claim_mismatch');
    }
    await verifyBytes(parent.url, 'release_parent_mix');
    const parentDerivation = parseReleaseMixLineage(parent.meta).derivation;
    if (parentDerivation) {
      await assertCertifiedDerivationParent(
        options,
        parentDerivation,
        nextVisited,
        depth + 1
      );
    }
    return;
  }

  const parent = await prisma.master.findFirst({
    where: {
      id: derivation.id,
      projectId: options.projectId,
      songId: options.songId,
      project: { workspaceId: options.workspaceId },
      approved: true,
      qualityState: 'passed',
      contentHash: derivation.sourceContentHash,
      verifiedAt: { not: null },
    },
    select: {
      url: true,
      mixId: true,
      meta: true,
      mix: {
        select: {
          id: true,
          url: true,
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
  const parentMeta = record(parent?.meta);
  if (
    !parent?.mix ||
    parent.mixId !== parent.mix.id ||
    parent.mix.projectId !== options.projectId ||
    parent.mix.songId !== options.songId ||
    !parent.mix.approved ||
    parent.mix.qualityState !== 'passed' ||
    !parent.mix.verifiedAt ||
    parentMeta?.sourceMixId !== parent.mix.id ||
    certifiedHash(
      parentMeta?.sourceContentHash,
      'parent_master_source_hash'
    ) !== certifiedHash(parent.mix.contentHash, 'parent_master_mix_hash')
  ) {
    throw new Error('release_lineage_parent_master_not_certified');
  }
  const parentClaim = releaseMixSourceClaim(parent.mix.meta);
  if (
    !parentClaim ||
    releaseEvidenceHash(parentClaim) !== derivation.claimHash
  ) {
    throw new Error('release_lineage_parent_claim_mismatch');
  }
  await verifyBytes(parent.url, 'release_parent_master');
  const parentMixBytes = await downloadToBuffer(parent.mix.url, {
    maxBytes: 256 * 1024 * 1024,
    timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
  });
  assertStoredContentHash(
    parentMixBytes,
    parent.mix.contentHash,
    'release_parent_master_source_mix'
  );
  const parentDerivation = parseReleaseMixLineage(parent.mix.meta).derivation;
  if (parentDerivation) {
    await assertCertifiedDerivationParent(
      options,
      parentDerivation,
      nextVisited,
      depth + 1
    );
  }
}

export async function resolveCertifiedReleaseLineage(options: {
  workspaceId: string;
  projectId: string;
  songId: string;
  audio: {
    kind: 'master' | 'mix';
    id: string;
    contentHash: string | null;
    source: { kind: 'mix'; id: string; contentHash: string } | null;
  };
}): Promise<CertifiedReleaseLineage> {
  const audioHash = certifiedHash(options.audio.contentHash, 'audio_hash');
  let master: CertifiedReleaseLineage['master'] = null;
  let mixId = options.audio.id;
  let expectedMixHash = audioHash;

  if (options.audio.kind === 'master') {
    const row = await prisma.master.findFirst({
      where: {
        id: options.audio.id,
        projectId: options.projectId,
        songId: options.songId,
        project: { workspaceId: options.workspaceId },
        approved: true,
        qualityState: 'passed',
        contentHash: audioHash,
        verifiedAt: { not: null },
      },
      select: { id: true, mixId: true, contentHash: true, meta: true },
    });
    if (!row?.mixId) throw new Error('release_lineage_master_mix_missing');
    if (!options.audio.source || options.audio.source.id !== row.mixId) {
      throw new Error('release_lineage_master_mix_mismatch');
    }
    mixId = row.mixId;
    expectedMixHash = certifiedHash(
      options.audio.source.contentHash,
      'source_mix_hash'
    );
    const masterMeta = record(row.meta);
    if (
      masterMeta?.sourceMixId !== mixId ||
      certifiedHash(masterMeta?.sourceContentHash, 'master_source_mix_hash') !==
        expectedMixHash
    ) {
      throw new Error('release_lineage_master_source_receipt_mismatch');
    }
    master = {
      id: row.id,
      contentHash: certifiedHash(row.contentHash, 'master_hash'),
      mixId,
    };
  }

  const mix = await prisma.mix.findFirst({
    where: {
      id: mixId,
      projectId: options.projectId,
      songId: options.songId,
      project: { workspaceId: options.workspaceId },
      approved: true,
      qualityState: 'passed',
      contentHash: expectedMixHash,
      verifiedAt: { not: null },
    },
    select: { id: true, contentHash: true, meta: true },
  });
  if (!mix) throw new Error('release_lineage_source_mix_not_certified');
  const source = parseReleaseMixLineage(mix.meta);
  const mixHash = certifiedHash(mix.contentHash, 'mix_hash');
  if (source.derivation) {
    await assertCertifiedDerivationParent(options, source.derivation);
  }

  if (source.kind === 'direct_owned_upload') {
    if (source.sourceContentHash !== mixHash) {
      throw new Error('release_lineage_direct_upload_hash_mismatch');
    }
    return {
      audio: {
        kind: options.audio.kind,
        id: options.audio.id,
        contentHash: audioHash,
      },
      master,
      mix: { id: mix.id, contentHash: mixHash },
      derivation: source.derivation,
      originKind: source.kind,
      directUpload: {
        sourceKind: source.sourceKind,
        sourceContentHash: source.sourceContentHash,
        parentSourceContentHash: source.parentSourceContentHash,
        parentClaimHash: source.parentClaimHash,
        rightsConfirmationVersion: source.rightsConfirmationVersion,
        rightsConfirmed: source.rightsConfirmed,
        recordedAt: source.recordedAt,
        certifiedAt: source.certifiedAt,
      },
      beat: null,
      vocals: [],
      materials: [],
      learnedReferences: [],
    };
  }

  const lineageBeatIds = [
    ...new Set([
      source.beatId,
      ...(source.derivation?.parentBeatId
        ? [source.derivation.parentBeatId]
        : []),
    ]),
  ];
  const allVocalIds = [
    ...new Set([
      ...source.vocalRenderIds,
      ...(source.derivation?.parentVocalRenderIds ?? []),
    ]),
  ].sort();
  const [beat, inheritedBeat, vocals, materialUsages, referenceUsages] =
    await Promise.all([
      prisma.beatAsset.findFirst({
        where: {
          id: source.beatId,
          projectId: options.projectId,
          songId: options.songId,
          project: { workspaceId: options.workspaceId },
          assetKind: 'instrumental',
          approved: true,
          qualityState: 'passed',
          contentHash: source.beatContentHash,
          verifiedAt: { not: null },
        },
        select: {
          id: true,
          url: true,
          provider: true,
          assetKind: true,
          contentHash: true,
        },
      }),
      source.derivation?.parentBeatId &&
      source.derivation.parentBeatId !== source.beatId
        ? prisma.beatAsset.findFirst({
            where: {
              id: source.derivation.parentBeatId,
              projectId: options.projectId,
              songId: options.songId,
              project: { workspaceId: options.workspaceId },
              assetKind: 'instrumental',
              approved: true,
              qualityState: 'passed',
              contentHash: source.derivation.parentBeatContentHash,
              verifiedAt: { not: null },
            },
            select: { id: true, url: true, contentHash: true },
          })
        : Promise.resolve(null),
      allVocalIds.length
        ? prisma.vocalRender.findMany({
            where: {
              id: { in: allVocalIds },
              projectId: options.projectId,
              songId: options.songId,
              project: { workspaceId: options.workspaceId },
              assetKind: 'isolated_vocal',
              approved: true,
              qualityState: 'passed',
              contentHash: { not: null },
              verifiedAt: { not: null },
            },
            select: {
              id: true,
              url: true,
              role: true,
              performanceSource: true,
              assetKind: true,
              voiceProfileId: true,
              contentHash: true,
            },
          })
        : Promise.resolve([]),
      prisma.materialUsage.findMany({
        where: {
          workspaceId: options.workspaceId,
          songId: options.songId,
          beatId: { in: lineageBeatIds },
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          providerJobId: true,
          material: {
            select: {
              id: true,
              url: true,
              contentHash: true,
              rightsBasis: true,
              readiness: true,
              qualityState: true,
              verifiedAt: true,
            },
          },
        },
      }),
      prisma.referenceUsage.findMany({
        where: {
          workspaceId: options.workspaceId,
          songId: options.songId,
          beatId: { in: lineageBeatIds },
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          providerJobId: true,
          reference: {
            select: {
              id: true,
              sourceUrl: true,
              contentHash: true,
              rightsBasis: true,
              analysisState: true,
            },
          },
        },
      }),
    ]);

  if (!beat) throw new Error('release_lineage_beat_not_certified');
  if (
    source.derivation?.parentBeatId &&
    source.derivation.parentBeatId !== source.beatId &&
    !inheritedBeat
  ) {
    throw new Error('release_lineage_parent_beat_not_certified');
  }
  type VocalRow = {
    id: string;
    url: string;
    role: string;
    performanceSource: string;
    assetKind: string;
    voiceProfileId: string | null;
    contentHash: string | null;
  };
  type MaterialUsageRow = {
    id: string;
    providerJobId: string;
    material: {
      id: string;
      url: string;
      contentHash: string | null;
      rightsBasis: string;
      readiness: string;
      qualityState: string;
      verifiedAt: Date | null;
    };
  };
  type ReferenceUsageRow = {
    id: string;
    providerJobId: string;
    reference: {
      id: string;
      sourceUrl: string;
      contentHash: string | null;
      rightsBasis: string;
      analysisState: string;
    };
  };
  const vocalRows = vocals as VocalRow[];
  const materialRows = materialUsages as MaterialUsageRow[];
  const referenceRows = referenceUsages as ReferenceUsageRow[];
  const vocalById = new Map(vocalRows.map(vocal => [vocal.id, vocal]));
  if (allVocalIds.some(id => !vocalById.has(id))) {
    throw new Error('release_lineage_vocal_set_not_certified');
  }
  const expectedVocalHashes = new Map<string, string>();
  source.vocalRenderIds.forEach((id, index) => {
    expectedVocalHashes.set(id, source.vocalRenderContentHashes[index]!);
  });
  source.derivation?.parentVocalRenderIds.forEach((id, index) => {
    const hash = source.derivation!.parentVocalRenderContentHashes[index]!;
    const existing = expectedVocalHashes.get(id);
    if (existing && existing !== hash)
      throw new Error('release_lineage_vocal_hash_conflict:' + id);
    expectedVocalHashes.set(id, hash);
  });
  const certifiedVocals = allVocalIds.map(id => {
    const vocal = vocalById.get(id)!;
    const contentHash = certifiedHash(vocal.contentHash, 'vocal_hash_' + id);
    if (contentHash !== expectedVocalHashes.get(id)) {
      throw new Error('release_lineage_vocal_hash_mismatch:' + id);
    }
    return { ...vocal, contentHash };
  });
  const materials = materialRows.map(usage => {
    if (
      usage.material.rightsBasis === 'unknown' ||
      usage.material.readiness !== 'ready' ||
      usage.material.qualityState !== 'passed' ||
      !usage.material.verifiedAt
    ) {
      throw new Error(
        'release_lineage_material_not_certified:' + usage.material.id
      );
    }
    return {
      usageId: usage.id,
      providerJobId: usage.providerJobId,
      materialId: usage.material.id,
      contentHash: certifiedHash(
        usage.material.contentHash,
        'material_hash_' + usage.material.id
      ),
    };
  });
  const learnedReferences = referenceRows.map(usage => {
    if (
      usage.reference.rightsBasis === 'unknown' ||
      usage.reference.analysisState === 'failed'
    ) {
      throw new Error(
        'release_lineage_reference_not_certified:' + usage.reference.id
      );
    }
    return {
      usageId: usage.id,
      providerJobId: usage.providerJobId,
      referenceId: usage.reference.id,
      contentHash: certifiedHash(
        usage.reference.contentHash,
        'reference_hash_' + usage.reference.id
      ),
    };
  });

  const componentArtifacts = new Map<
    string,
    {
      url: string;
      contentHash: string;
      context: string;
    }
  >();
  const addComponentArtifact = (
    url: string,
    contentHash: string,
    context: string
  ) => {
    componentArtifacts.set(`${url}:${contentHash}`, {
      url,
      contentHash,
      context,
    });
  };
  addComponentArtifact(
    beat.url,
    certifiedHash(beat.contentHash, 'release_beat_hash'),
    'release_source_beat'
  );
  if (inheritedBeat) {
    addComponentArtifact(
      inheritedBeat.url,
      certifiedHash(inheritedBeat.contentHash, 'release_parent_beat_hash'),
      'release_source_parent_beat'
    );
  }
  for (const vocal of certifiedVocals) {
    addComponentArtifact(
      vocal.url,
      vocal.contentHash,
      `release_source_vocal_${vocal.id}`
    );
  }
  materialRows.forEach((usage, index) => {
    addComponentArtifact(
      usage.material.url,
      materials[index]!.contentHash,
      `release_source_material_${usage.material.id}`
    );
  });
  referenceRows.forEach((usage, index) => {
    addComponentArtifact(
      usage.reference.sourceUrl,
      learnedReferences[index]!.contentHash,
      `release_source_reference_${usage.reference.id}`
    );
  });
  // Bound memory while proving every contributor; a song can reference many
  // large source files and parallel 256 MB downloads would make rights checks
  // vulnerable to self-inflicted worker OOMs.
  for (const artifact of componentArtifacts.values()) {
    const bytes = await downloadToBuffer(artifact.url, {
      maxBytes: 256 * 1024 * 1024,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    assertStoredContentHash(bytes, artifact.contentHash, artifact.context);
  }

  return {
    audio: {
      kind: options.audio.kind,
      id: options.audio.id,
      contentHash: audioHash,
    },
    master,
    mix: { id: mix.id, contentHash: mixHash },
    derivation: source.derivation,
    originKind: 'derived_mix',
    directUpload: null,
    beat: {
      ...beat,
      contentHash: certifiedHash(beat.contentHash, 'beat_hash'),
    },
    vocals: certifiedVocals,
    materials,
    learnedReferences,
  };
}

export async function processRights(payload: RightsPayload): Promise<void> {
  await markRunning(payload.jobId);
  let persistedFailure = false;
  try {
    const certification = await loadReleaseCertification(prisma, {
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
    });
    if (!certification.audio)
      throw new Error('rights_check_requires_certified_audio');
    if (!certification.cover)
      throw new Error('rights_check_requires_an_approved_certified_cover');
    if (!certification.lyric?.approved)
      throw new Error('rights_check_requires_approved_lyrics');

    const lineage = await resolveCertifiedReleaseLineage({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      audio: certification.audio,
    });
    const beatIds = lineage.beat
      ? [
          ...new Set([
            lineage.beat.id,
            ...(lineage.derivation?.parentBeatId
              ? [lineage.derivation.parentBeatId]
              : []),
          ]),
        ]
      : [];
    const [hook, approvals, materialUsages, referenceUsages] =
      await Promise.all([
        prisma.hookCandidate.findFirst({
          where: { songId: payload.songId, approved: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.approval.findMany({
          where: { projectId: payload.projectId, decision: 'approved' },
          select: {
            id: true,
            gate: true,
            decision: true,
            userId: true,
            createdAt: true,
          },
        }),
        beatIds.length
          ? prisma.materialUsage.findMany({
              where: {
                workspaceId: payload.workspaceId,
                songId: payload.songId,
                beatId: { in: beatIds },
              },
              orderBy: { createdAt: 'asc' },
              include: {
                material: {
                  select: {
                    id: true,
                    role: true,
                    source: true,
                    rightsBasis: true,
                    contentHash: true,
                    roleEvidence: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
        beatIds.length
          ? prisma.referenceUsage.findMany({
              where: {
                workspaceId: payload.workspaceId,
                songId: payload.songId,
                beatId: { in: beatIds },
              },
              orderBy: { position: 'asc' },
              include: {
                reference: {
                  select: {
                    id: true,
                    title: true,
                    genre: true,
                    rightsBasis: true,
                    analysisState: true,
                    contentHash: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);
    const beat = lineage.beat;
    const vocal =
      lineage.vocals.find(entry => entry.role === 'lead') ??
      lineage.vocals[0] ??
      null;
    const audioBytes = await downloadToBuffer(certification.audio.url, {
      maxBytes: 256 * 1024 * 1024,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    assertStoredContentHash(
      audioBytes,
      certification.audio.contentHash,
      'rights_source_audio'
    );
    const duration = await probeAudioBufferDurationS(audioBytes);
    const clipStart = Math.max(
      0,
      Math.min(Math.floor(duration / 3), Math.max(0, duration - 12))
    );
    const clip = await extractClip(
      audioBytes,
      clipStart,
      Math.min(12, Math.max(1, duration || 12))
    );
    const recognition = await recognizeSong({
      audio: clip,
      filename: 'rights-check.mp3',
    });
    const audioRecognition: AudioRecognitionEvidence = !recognition.ok
      ? {
          status: 'unavailable',
          provider: 'audd',
          match: null,
          attestation: payload.audioRightsAttestation ?? null,
          error: recognition.error,
        }
      : recognition.match
        ? {
            status: payload.audioRightsAttestation
              ? 'matched_cleared'
              : 'matched_unconfirmed',
            provider: 'audd',
            match: recognition.match,
            attestation: payload.audioRightsAttestation ?? null,
          }
        : {
            status: 'clear',
            provider: 'audd',
            match: null,
            attestation: null,
          };

    const rightsCheck = await runRightsCheck({
      lyricBody: certification.lyric.body,
      hookText: hook?.text,
      references: certification.song.project.artist.references as Array<{
        name: string;
        lane: string;
      }>,
    });
    const audioClear =
      audioRecognition.status === 'clear' ||
      audioRecognition.status === 'matched_cleared';
    const okToExport = rightsCheck.okToExport && audioClear;
    const providers = [
      beat
        ? {
            kind: 'music',
            provider: beat.provider,
            assetId: beat.id,
            assetKind: beat.assetKind,
          }
        : {
            kind: 'music',
            provider:
              lineage.directUpload.sourceKind === 'workspace_upload'
                ? 'artist_upload'
                : lineage.directUpload.sourceKind === 'url_import'
                  ? 'artist_import'
                  : 'artist_owned_derivative',
            assetId: lineage.mix.id,
            assetKind: 'finished_mix',
          },
      ...lineage.vocals.map(entry => ({
        kind: 'vocal',
        provider: entry.performanceSource,
        assetId: entry.id,
        assetKind: entry.assetKind,
      })),
      ...(lineage.derivation
        ? [
            {
              kind: 'source_derivation',
              provider: 'certified_parent',
              assetId: lineage.derivation.id,
              assetKind: lineage.derivation.type,
            },
          ]
        : []),
      { kind: 'audio_recognition', provider: 'audd' },
    ];
    const provenance =
      lineage.originKind === 'direct_owned_upload'
        ? {
            source: {
              kind: lineage.originKind,
              mixId: lineage.mix.id,
              mixContentHash: lineage.mix.contentHash,
              sourceKind: lineage.directUpload.sourceKind,
              sourceContentHash: lineage.directUpload.sourceContentHash,
              parentSourceContentHash:
                lineage.directUpload.parentSourceContentHash,
              parentClaimHash: lineage.directUpload.parentClaimHash,
              rightsConfirmationVersion:
                lineage.directUpload.rightsConfirmationVersion,
              rightsConfirmed: lineage.directUpload.rightsConfirmed,
            },
            beat: null,
            vocals: [],
            materials: [],
            learnedReferences: [],
            derivedFrom: lineage.derivation,
          }
        : {
            source: {
              kind: lineage.originKind,
              derivedFrom: lineage.derivation,
            },
            beat,
            vocals: lineage.vocals,
            materials: materialUsages.map((usage: MaterialUsageEvidence) => ({
              usageId: usage.id,
              role: usage.role,
              material: usage.material,
              sections: usage.sections,
            })),
            learnedReferences: referenceUsages.map(
              (usage: ReferenceUsageEvidence) => ({
                usageId: usage.id,
                position: usage.position,
                pinned: usage.pinned,
                influence: usage.influence,
                reference: usage.reference,
              })
            ),
          };
    const aiDisclosure =
      lineage.originKind === 'direct_owned_upload'
        ? {
            distroDisclosure:
              'Artist-supplied finished recording; production origin not inferred by AfroHit',
            credits: {
              lyrics: 'AI-assisted, human-edited',
              production: 'Artist-supplied finished recording',
              vocals: 'artist-supplied finished recording',
            },
          }
        : {
            distroDisclosure: 'GenAI-assisted, human-directed and edited',
            credits: {
              lyrics: 'AI-assisted, human-edited',
              production: 'AI-assisted',
              vocals: vocal?.performanceSource ?? 'not_recorded',
            },
          };
    const canonicalPayload = {
      schemaVersion: 1,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      artifactFingerprint: certification.artifactFingerprint,
      artifacts: certification.artifactSnapshot,
      lineage: releaseLineageEvidence(lineage),
      audioRecognition,
      rightsCheck: { ...rightsCheck, okToExport },
      approvals,
      providers,
      provenance,
      samples: materialUsages.map((usage: MaterialUsageEvidence) => ({
        materialId: usage.material.id,
        rightsBasis: usage.material.rightsBasis,
        contentHash: usage.material.contentHash,
      })),
      aiDisclosure,
      createdAt: new Date().toISOString(),
    };
    const hash = await canonicalReceiptHash(canonicalPayload);
    const receipt = await prisma.rightsReceipt.create({
      data: {
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        songId: payload.songId,
        providers: canonicalPayload.providers as never,
        prompts: { rightsCheck: canonicalPayload.rightsCheck } as never,
        canonicalPayload: canonicalPayload as never,
        samples: canonicalPayload.samples as never,
        approvals: approvals as never,
        humanContribution:
          payload.audioRightsAttestation?.note ??
          (lineage.originKind === 'direct_owned_upload'
            ? 'Artist confirmed ownership of the supplied finished recording'
            : null),
        aiDisclosure: canonicalPayload.aiDisclosure as never,
        hash,
      },
    });

    if (!okToExport) {
      persistedFailure = true;
      const reason =
        audioRecognition.status === 'unavailable'
          ? 'rights_audio_recognition_unavailable'
          : audioRecognition.status === 'matched_unconfirmed'
            ? 'rights_audio_match_requires_clearance_attestation'
            : 'rights_review_not_clear';
      await markFailed(payload.jobId, reason);
      return;
    }

    await prisma.$transaction(async tx => {
      if (lineage.originKind === 'direct_owned_upload') {
        const sourceMix = await tx.mix.findFirst({
          where: {
            id: lineage.mix.id,
            projectId: payload.projectId,
            songId: payload.songId,
            project: { workspaceId: payload.workspaceId },
            approved: true,
            qualityState: 'passed',
            contentHash: lineage.mix.contentHash,
            verifiedAt: { not: null },
          },
          select: { id: true, meta: true },
        });
        if (!sourceMix) throw new Error('release_lineage_source_mix_changed');
        await tx.mix.update({
          where: { id: sourceMix.id },
          data: {
            meta: {
              ...(record(sourceMix.meta) ?? {}),
              releaseLineageCertified: true,
              releaseLineageReceipt: {
                schemaVersion: 1,
                receiptId: receipt.id,
                receiptHash: receipt.hash,
                sourceContentHash: lineage.directUpload.sourceContentHash,
                certifiedAt: new Date().toISOString(),
              },
            } as never,
          },
        });
      }
      await tx.song.update({
        where: { id: payload.songId },
        data: { releaseReady: false },
      });
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            receiptId: receipt.id,
            receiptHash: receipt.hash,
            artifactFingerprint: certification.artifactFingerprint,
            rightsCheck: canonicalPayload.rightsCheck,
            audioRecognition,
          } as never,
        },
      });
    });
  } catch (error) {
    if (!persistedFailure) await markFailed(payload.jobId, error);
  }
}
