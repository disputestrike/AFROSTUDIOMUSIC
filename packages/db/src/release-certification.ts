import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { canonicalJson, evaluateReleaseReadiness, type ReleaseReadinessCheck } from '@afrohit/shared';

export const RELEASE_REVIEW_LANGUAGES = ['yo', 'ig', 'ha', 'zu', 'xh', 'st'] as const;

type SplitEntry = { name: string; role: string; share: number };
type JsonRecord = Record<string, unknown>;

export interface ReleaseArtifactSnapshot {
  audio: { kind: 'master' | 'mix'; id: string; contentHash: string } | null;
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

export async function loadReleaseCertification(
  db: PrismaClient,
  options: { workspaceId: string; songId: string; projectId?: string; hitTarget?: number },
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

  const [master, mix, cover, rightsReceipt, attestations] = await Promise.all([
    db.master.findFirst({
      where: {
        songId: song.id,
        approved: true,
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.mix.findFirst({
      where: {
        songId: song.id,
        approved: true,
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.imageAsset.findFirst({
      where: {
        projectId: song.projectId,
        kind: 'cover',
        approved: true,
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.rightsReceipt.findFirst({ where: { songId: song.id }, orderBy: { createdAt: 'desc' } }),
    db.releaseAttestation.findMany({
      where: { songId: song.id, kind: { in: ['split_sheet', 'native_language'] } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const selectedAudio = master
    ? { kind: 'master' as const, ...master }
    : mix
      ? { kind: 'mix' as const, ...mix }
      : null;
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
    audio: selectedAudio?.contentHash
      ? { kind: selectedAudio.kind, id: selectedAudio.id, contentHash: selectedAudio.contentHash }
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
  const readiness = evaluateReleaseReadiness({
    audio: selectedAudio
      ? {
          kind: selectedAudio.kind,
          approved: selectedAudio.approved,
          qualityState: selectedAudio.qualityState,
          contentHash: selectedAudio.contentHash,
          verified: !!selectedAudio.verifiedAt,
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
    audio: selectedAudio,
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
