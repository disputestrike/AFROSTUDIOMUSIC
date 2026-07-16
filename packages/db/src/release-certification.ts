import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalJson, evaluateReleaseReadiness, type ReleaseReadinessCheck } from '@afrohit/shared';

export const RELEASE_REVIEW_LANGUAGES = ['yo', 'ig', 'ha', 'zu', 'xh', 'st'] as const;

type SplitEntry = { name: string; role: string; share: number };
type JsonRecord = Record<string, unknown>;

export interface ReleaseArtifactSnapshot {
  audio: {
    kind: 'master' | 'mix';
    id: string;
    contentHash: string;
    source: { kind: 'mix'; id: string; contentHash: string } | null;
    sourceClaimHash: string | null;
  } | null;
  cover: { id: string; contentHash: string } | null;
  lyric: { id: string; contentHash: string } | null;
}

export interface ReleaseCertification {
  song: {
    id: string;
    workspaceId: string;
    projectId: string;
    title: string;
    isrc: string | null;
    upc: string | null;
    splitSheet: unknown;
    hitScore: number | null;
    viralScore: number | null;
    project: { genre: string; artist: { stageName: string; languages: string[]; references: unknown } };
  };
  audio: {
    kind: 'master' | 'mix';
    id: string;
    url: string;
    approved: boolean;
    qualityState: string;
    contentHash: string | null;
    verifiedAt: Date | null;
    meta: unknown;
    source: { kind: 'mix'; id: string; contentHash: string } | null;
  } | null;
  cover: {
    id: string;
    url: string;
    width: number | null;
    height: number | null;
    approved: boolean;
    qualityState: string;
    contentHash: string | null;
    verifiedAt: Date | null;
  } | null;
  lyric: {
    id: string;
    body: string;
    cleanVersion: string | null;
    explicit: boolean;
    approved: boolean;
    languageMix: unknown;
  } | null;
  artifactSnapshot: ReleaseArtifactSnapshot;
  artifactFingerprint: string;
  splitSheet: SplitEntry[];
  requiredNativeLanguages: string[];
  rightsReceipt: { id: string; hash: string; canonicalPayload: unknown; createdAt: Date } | null;
  splitAttestation: { id: string; hash: string; payload: unknown; attestedBy: string; createdAt: Date } | null;
  nativeAttestation: { id: string; hash: string; payload: unknown; attestedBy: string; createdAt: Date } | null;
  readiness: { ready: boolean; checks: ReleaseReadinessCheck[] };
  evidence: {
    receiptHashValid: boolean;
    receiptCurrent: boolean;
    splitAttested: boolean;
    nativeAttested: boolean;
    rightsRisk: string | null;
    rightsOk: boolean;
  };
}

export function releaseEvidenceHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function normalizeSplitSheet(value: unknown): SplitEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = (entry ?? {}) as JsonRecord;
      return {
        name: String(row.name ?? '').trim(),
        role: String(row.role ?? 'writer').trim().toLowerCase(),
        share: Number(row.share),
      };
    })
    .filter((entry) => entry.name && Number.isFinite(entry.share))
    .sort((a, b) => a.name.localeCompare(b.name) || a.role.localeCompare(b.role) || a.share - b.share);
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function hashMatches(payload: unknown, hash: string | null | undefined): boolean {
  return !!record(payload) && /^[a-f0-9]{64}$/i.test(hash ?? '') && releaseEvidenceHash(payload) === hash;
}

function normalizedLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((language) => String(language).trim().toLowerCase()).filter(Boolean))].sort();
}

function certifiedContentHash(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function strictStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  if (values.some((entry) => !entry) || new Set(values).size !== values.length) return null;
  return values;
}

export function releaseMixSourceClaim(meta: unknown): JsonRecord | null {
  const metadata = record(meta);
  const component = record(metadata?.source);
  const direct = record(metadata?.directOwnedUpload);
  if (!!component === !!direct) return null;
  const rawDerivation = record(metadata?.derivedFrom);
  let derivation: JsonRecord | null = null;
  if (rawDerivation) {
    const type = rawDerivation.type;
    const id = typeof rawDerivation.id === 'string' ? rawDerivation.id.trim() : '';
    const sourceContentHash = certifiedContentHash(rawDerivation.contentHash);
    const claimHash = certifiedContentHash(rawDerivation.claimHash);
    const claim = record(rawDerivation.claim);
    if (
      !['beat', 'mix', 'master', 'external'].includes(String(type))
      || !id
      || !sourceContentHash
      || !claimHash
      || !claim
      || releaseEvidenceHash(claim) !== claimHash
    ) {
      return null;
    }
    derivation = { type, id, sourceContentHash, claimHash };
  }

  if (direct) {
    const rights = record(direct.rightsConfirmation);
    const sourceContentHash = certifiedContentHash(direct.sourceContentHash);
    if (
      direct.schemaVersion !== 1
      || (
        direct.sourceKind !== 'workspace_upload'
        && direct.sourceKind !== 'url_import'
        && direct.sourceKind !== 'owned_derivative'
      )
      || rights?.version !== 1
      || rights.confirmed !== true
      || !sourceContentHash
    ) {
      return null;
    }
    const parentSourceContentHash = direct.sourceKind === 'owned_derivative'
      ? certifiedContentHash(direct.parentSourceContentHash)
      : null;
    const parentClaimHash = direct.sourceKind === 'owned_derivative'
      ? certifiedContentHash(direct.parentClaimHash)
      : null;
    if (direct.sourceKind === 'owned_derivative' && (!parentSourceContentHash || !parentClaimHash)) {
      return null;
    }
    return {
      schemaVersion: 1,
      kind: 'direct_owned_upload',
      sourceKind: direct.sourceKind,
      sourceContentHash,
      parentSourceContentHash,
      parentClaimHash,
      rightsConfirmationVersion: 1,
      rightsConfirmed: true,
      ...(derivation ? { derivedFrom: derivation } : {}),
    };
  }

  const beatId = typeof component?.beatId === 'string' && component.beatId.trim()
    ? component.beatId.trim()
    : null;
  const beatIds = component?.beatIds === undefined
    ? []
    : strictStringArray(component.beatIds);
  const exactBeatIds = beatIds
    ? [...new Set([...(beatId ? [beatId] : []), ...beatIds])]
    : [];
  const beatContentHash = certifiedContentHash(component?.beatContentHash);
  const vocalRenderIds = strictStringArray(component?.vocalRenderIds);
  const rawVocalHashes = Array.isArray(component?.vocalRenderContentHashes)
    ? component.vocalRenderContentHashes
    : null;
  const vocalRenderContentHashes = rawVocalHashes?.map(certifiedContentHash) ?? null;
  if (
    exactBeatIds.length !== 1
    || !beatContentHash
    || !vocalRenderIds
    || !vocalRenderContentHashes
    || vocalRenderIds.length !== vocalRenderContentHashes.length
    || vocalRenderContentHashes.some((hash) => !hash)
  ) {
    return null;
  }
  const vocals = vocalRenderIds
    .map((id, index) => ({ id, contentHash: vocalRenderContentHashes[index]! }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    kind: 'derived_mix',
    beatId: exactBeatIds[0]!,
    beatContentHash,
    vocalRenderIds: vocals.map((vocal) => vocal.id),
    vocalRenderContentHashes: vocals.map((vocal) => vocal.contentHash),
    ...(derivation ? { derivedFrom: derivation } : {}),
  };
}

export async function loadReleaseCertification(
  db: PrismaClient | Prisma.TransactionClient,
  options: {
    workspaceId: string;
    songId: string;
    projectId?: string;
    hitTarget?: number;
    coverAssetId?: string | null;
    audioAsset?: { kind: 'master' | 'mix'; id: string } | null;
  },
): Promise<ReleaseCertification> {
  const song = await db.song.findFirstOrThrow({
    where: {
      id: options.songId,
      workspaceId: options.workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
    include: {
      project: { include: { artist: { select: { stageName: true, languages: true, references: true } } } },
      lyric: true,
    },
  });

  const releaseHead = await db.release.findUnique({
    where: { songId: song.id },
    select: {
      status: true,
      coverAssetId: true,
      audioAssetId: true,
      audioAssetKind: true,
    },
  });
  const hasCoverSelection = Object.prototype.hasOwnProperty.call(options, 'coverAssetId');
  const selectedCoverId = hasCoverSelection
    ? options.coverAssetId
    : releaseHead
      ? releaseHead.coverAssetId
      : undefined;
  const releaseLocksAudio =
    !!releaseHead &&
    ['submitting', 'submitted', 'accepted', 'live'].includes(releaseHead.status);
  const lockedAudio = !releaseLocksAudio
    ? undefined
    : releaseHead.audioAssetId &&
        (releaseHead.audioAssetKind === 'master' ||
          releaseHead.audioAssetKind === 'mix')
      ? { kind: releaseHead.audioAssetKind, id: releaseHead.audioAssetId }
      : null;
  const selectedAudioRef = Object.prototype.hasOwnProperty.call(options, 'audioAsset')
    ? options.audioAsset
    : lockedAudio;

  const masterPromise = selectedAudioRef === null || selectedAudioRef?.kind === 'mix'
    ? Promise.resolve(null)
    : db.master.findFirst({
        where: {
          ...(selectedAudioRef?.kind === 'master' ? { id: selectedAudioRef.id } : {}),
          songId: song.id,
          projectId: song.projectId,
          approved: true,
          qualityState: 'passed',
          contentHash: { not: null },
          verifiedAt: { not: null },
        },
        include: {
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
        orderBy: selectedAudioRef ? undefined : { createdAt: 'desc' },
      });
  const mixPromise = selectedAudioRef === null || selectedAudioRef?.kind === 'master'
    ? Promise.resolve(null)
    : db.mix.findFirst({
        where: {
          ...(selectedAudioRef?.kind === 'mix' ? { id: selectedAudioRef.id } : {}),
          songId: song.id,
          projectId: song.projectId,
          approved: true,
          qualityState: 'passed',
          contentHash: { not: null },
          verifiedAt: { not: null },
        },
        orderBy: selectedAudioRef ? undefined : { createdAt: 'desc' },
      });
  const coverPromise = selectedCoverId === null
    ? Promise.resolve(null)
    : db.imageAsset.findFirst({
        where: {
          ...(selectedCoverId ? { id: selectedCoverId } : {}),
          projectId: song.projectId,
          kind: 'cover',
          approved: true,
          qualityState: 'passed',
          contentHash: { not: null },
          verifiedAt: { not: null },
        },
        orderBy: selectedCoverId ? undefined : { createdAt: 'desc' },
      });

  const [master, mix, cover, rightsReceipt, attestations] = await Promise.all([
    masterPromise,
    mixPromise,
    coverPromise,
    db.rightsReceipt.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
    db.releaseAttestation.findMany({
      where: { songId: song.id, kind: { in: ['split_sheet', 'native_language'] } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const masterMeta = record(master?.meta);
  const masterSourceReceiptMatches = !!master?.mix
    && masterMeta?.sourceMixId === master.mix.id
    && certifiedContentHash(masterMeta?.sourceContentHash) === master.mix.contentHash?.toLowerCase();
  const certifiedSourceMix = master?.mix
    && masterSourceReceiptMatches
    && master.mix.songId === song.id
    && master.mix.projectId === song.projectId
    && master.mix.approved
    && master.mix.qualityState === 'passed'
    && master.mix.contentHash
    && master.mix.verifiedAt
      ? { kind: 'mix' as const, id: master.mix.id, contentHash: master.mix.contentHash }
      : null;
  const canonicalAudio = master
    ? { kind: 'master' as const, ...master, source: certifiedSourceMix }
    : mix
      ? { kind: 'mix' as const, ...mix, source: null }
      : null;
  const sourceClaim = releaseMixSourceClaim(master?.mix?.meta ?? mix?.meta);
  const sourceClaimHash = sourceClaim ? releaseEvidenceHash(sourceClaim) : null;
  const lyric = song.lyric;
  const lyricHash = lyric
    ? releaseEvidenceHash({
        body: lyric.body,
        cleanVersion: lyric.cleanVersion,
        explicit: lyric.explicit,
        languageMix: lyric.languageMix,
      })
    : null;
  const artifactSnapshot: ReleaseArtifactSnapshot = {
    audio: canonicalAudio?.contentHash
      ? {
          kind: canonicalAudio.kind,
          id: canonicalAudio.id,
          contentHash: canonicalAudio.contentHash,
          source: canonicalAudio.source,
          sourceClaimHash,
        }
      : null,
    cover: cover?.contentHash ? { id: cover.id, contentHash: cover.contentHash } : null,
    lyric: lyric && lyricHash ? { id: lyric.id, contentHash: lyricHash } : null,
  };
  const artifactFingerprint = releaseEvidenceHash(artifactSnapshot);

  const receiptPayload = record(rightsReceipt?.canonicalPayload);
  const receiptHashValid = !!rightsReceipt && hashMatches(receiptPayload, rightsReceipt.hash);
  const receiptCurrent = receiptHashValid && receiptPayload?.artifactFingerprint === artifactFingerprint;
  const rightsCheck = record(receiptPayload?.rightsCheck);
  const audioRecognition = record(receiptPayload?.audioRecognition);
  const rightsRisk = typeof rightsCheck?.overallRisk === 'string' ? rightsCheck.overallRisk : null;
  const audioRecognitionClear = ['clear', 'matched_cleared'].includes(String(audioRecognition?.status ?? ''));
  const rightsOk = rightsCheck?.okToExport === true && audioRecognitionClear;

  const splitSheet = normalizeSplitSheet(song.splitSheet);
  const splitAttestation = attestations.find((attestation) => attestation.kind === 'split_sheet') ?? null;
  const splitPayload = record(splitAttestation?.payload);
  const splitAttested = !!splitAttestation
    && hashMatches(splitPayload, splitAttestation.hash)
    && splitPayload?.accepted === true
    && canonicalJson(splitPayload?.splitSheet) === canonicalJson(splitSheet);

  const artistLanguages = normalizedLanguages(song.project.artist.languages);
  const requiredNativeLanguages = artistLanguages.filter((language) =>
    (RELEASE_REVIEW_LANGUAGES as readonly string[]).includes(language),
  );
  const nativeAttestation = attestations.find((attestation) => attestation.kind === 'native_language') ?? null;
  const nativePayload = record(nativeAttestation?.payload);
  const reviewedLanguages = normalizedLanguages(nativePayload?.languages);
  const nativeAttested = !!nativeAttestation
    && hashMatches(nativePayload, nativeAttestation.hash)
    && nativePayload?.attested === true
    && requiredNativeLanguages.every((language) => reviewedLanguages.includes(language));

  const shareTotal = splitSheet.reduce((total, entry) => total + entry.share, 0);
  const baseReadiness = evaluateReleaseReadiness({
    audio: canonicalAudio
      ? {
          kind: canonicalAudio.kind,
          approved: canonicalAudio.approved,
          qualityState: canonicalAudio.qualityState,
          contentHash: canonicalAudio.contentHash,
          verified: !!canonicalAudio.verifiedAt,
        }
      : null,
    cover: cover
      ? {
          approved: cover.approved,
          qualityState: cover.qualityState,
          contentHash: cover.contentHash,
          verified: !!cover.verifiedAt,
          width: cover.width,
          height: cover.height,
        }
      : null,
    lyric: lyric
      ? { present: true, approved: lyric.approved, contentHash: lyricHash }
      : null,
    splits: { total: shareTotal, count: splitSheet.length, attested: splitAttested },
    rights: {
      present: !!rightsReceipt,
      hashValid: receiptHashValid,
      current: receiptCurrent,
      okToExport: rightsOk,
      risk: rightsRisk,
    },
    nativeReview: {
      required: requiredNativeLanguages.length > 0,
      attested: nativeAttested,
      languages: requiredNativeLanguages,
    },
    hitScore: Math.max(song.hitScore ?? 0, song.viralScore ?? 0),
    hitTarget: options.hitTarget,
  });

  const lineageCheck: ReleaseReadinessCheck = {
    name: 'Exact audio lineage',
    ok: (!master?.mixId || certifiedSourceMix !== null) && sourceClaimHash !== null,
    detail: sourceClaimHash === null
      ? 'audio source claim is missing, ambiguous, or does not bind exact component hashes'
      : master?.mixId
        ? certifiedSourceMix
          ? 'master is bound to certified source mix ' + certifiedSourceMix.id
          : 'master source mix receipt is missing, stale, or uncertified'
        : 'certified direct artifact identity and source claim are bound',
  };
  const readiness = {
    ready: baseReadiness.ready && lineageCheck.ok,
    checks: [...baseReadiness.checks, lineageCheck],
  };
  return {
    song: {
      id: song.id,
      workspaceId: song.workspaceId,
      projectId: song.projectId,
      title: song.title,
      isrc: song.isrc,
      upc: song.upc,
      splitSheet: song.splitSheet,
      hitScore: song.hitScore,
      viralScore: song.viralScore,
      project: {
        genre: song.project.genre,
        artist: {
          stageName: song.project.artist.stageName,
          languages: song.project.artist.languages,
          references: song.project.artist.references,
        },
      },
    },
    audio: canonicalAudio,
    cover,
    lyric,
    artifactSnapshot,
    artifactFingerprint,
    splitSheet,
    requiredNativeLanguages,
    rightsReceipt,
    splitAttestation,
    nativeAttestation,
    readiness,
    evidence: {
      receiptHashValid,
      receiptCurrent,
      splitAttested,
      nativeAttested,
      rightsRisk,
      rightsOk,
    },
  };
}
