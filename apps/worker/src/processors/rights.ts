import { canonicalReceiptHash, recognizeSong, runRightsCheck } from '@afrohit/ai';
import { loadReleaseCertification, prisma } from '@afrohit/db';
import { assertStoredContentHash } from '../lib/certified-assets';
import { extractClip, NATIVE_AUDIO_LIMITS, probeAudioBufferDurationS } from '../lib/ffmpeg';
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

export type CertifiedReleaseLineage = {
  audio: { kind: 'master' | 'mix'; id: string; contentHash: string };
  master: { id: string; contentHash: string; mixId: string } | null;
  mix: { id: string; contentHash: string };
  beat: { id: string; url: string; provider: string; assetKind: string; contentHash: string };
  vocals: Array<{
    id: string;
    role: string;
    performanceSource: string;
    assetKind: string;
    voiceProfileId: string | null;
    contentHash: string;
  }>;
  materials: Array<{
    usageId: string;
    providerJobId: string;
    materialId: string;
    contentHash: string;
  }>;
  learnedReferences: Array<{
    usageId: string;
    providerJobId: string;
    referenceId: string;
    contentHash: string;
  }>;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function certifiedHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('release_lineage_uncertified_' + field);
  }
  return value.toLowerCase();
}

function strictIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('release_lineage_invalid_' + field);
  const ids = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('release_lineage_invalid_' + field + '_' + index);
    }
    return entry.trim();
  });
  if (new Set(ids).size !== ids.length) throw new Error('release_lineage_duplicate_' + field);
  return ids;
}

export function parseReleaseMixLineage(meta: unknown): {
  beatId: string;
  vocalRenderIds: string[];
} {
  const source = record(record(meta)?.source);
  if (!source) throw new Error('release_lineage_mix_source_missing');
  const beatId = typeof source.beatId === 'string' && source.beatId.trim()
    ? source.beatId.trim()
    : null;
  const beatIds = strictIds(source.beatIds, 'beat_ids');
  const exactBeatIds = [...new Set([...(beatId ? [beatId] : []), ...beatIds])];
  if (exactBeatIds.length !== 1) throw new Error('release_lineage_requires_exactly_one_beat');
  return {
    beatId: exactBeatIds[0]!,
    vocalRenderIds: strictIds(source.vocalRenderIds, 'vocal_render_ids').sort(),
  };
}

export function releaseLineageEvidence(lineage: CertifiedReleaseLineage): JsonRecord {
  return {
    schemaVersion: 1,
    audio: lineage.audio,
    master: lineage.master,
    mix: lineage.mix,
    beat: { id: lineage.beat.id, contentHash: lineage.beat.contentHash },
    vocals: lineage.vocals
      .map((vocal) => ({ id: vocal.id, contentHash: vocal.contentHash }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    materials: [...lineage.materials].sort((left, right) => left.usageId.localeCompare(right.usageId)),
    learnedReferences: [...lineage.learnedReferences]
      .sort((left, right) => left.usageId.localeCompare(right.usageId)),
  };
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
      select: { id: true, mixId: true, contentHash: true },
    });
    if (!row?.mixId) throw new Error('release_lineage_master_mix_missing');
    if (!options.audio.source || options.audio.source.id !== row.mixId) {
      throw new Error('release_lineage_master_mix_mismatch');
    }
    mixId = row.mixId;
    expectedMixHash = certifiedHash(options.audio.source.contentHash, 'source_mix_hash');
    master = { id: row.id, contentHash: certifiedHash(row.contentHash, 'master_hash'), mixId };
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

  const [beat, vocals, materialUsages, referenceUsages] = await Promise.all([
    prisma.beatAsset.findFirst({
      where: {
        id: source.beatId,
        projectId: options.projectId,
        songId: options.songId,
        project: { workspaceId: options.workspaceId },
        assetKind: 'instrumental',
        approved: true,
        qualityState: 'passed',
        contentHash: { not: null },
        verifiedAt: { not: null },
      },
      select: { id: true, url: true, provider: true, assetKind: true, contentHash: true },
    }),
    source.vocalRenderIds.length
      ? prisma.vocalRender.findMany({
          where: {
            id: { in: source.vocalRenderIds },
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
            role: true,
            performanceSource: true,
            assetKind: true,
            voiceProfileId: true,
            contentHash: true,
          },
        })
      : Promise.resolve([]),
    prisma.materialUsage.findMany({
      where: { workspaceId: options.workspaceId, songId: options.songId, beatId: source.beatId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        providerJobId: true,
        material: {
          select: {
            id: true,
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
      where: { workspaceId: options.workspaceId, songId: options.songId, beatId: source.beatId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        providerJobId: true,
        reference: {
          select: { id: true, contentHash: true, rightsBasis: true, analysisState: true },
        },
      },
    }),
  ]);

  if (!beat) throw new Error('release_lineage_beat_not_certified');
  type VocalRow = {
    id: string;
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
      contentHash: string | null;
      rightsBasis: string;
      analysisState: string;
    };
  };
  const vocalRows = vocals as VocalRow[];
  const materialRows = materialUsages as MaterialUsageRow[];
  const referenceRows = referenceUsages as ReferenceUsageRow[];
  const vocalById = new Map(vocalRows.map((vocal) => [vocal.id, vocal]));
  if (source.vocalRenderIds.some((id) => !vocalById.has(id))) {
    throw new Error('release_lineage_vocal_set_not_certified');
  }
  const certifiedVocals = source.vocalRenderIds.map((id) => {
    const vocal = vocalById.get(id)!;
    return { ...vocal, contentHash: certifiedHash(vocal.contentHash, 'vocal_hash_' + id) };
  });
  const materials = materialRows.map((usage) => {
    if (
      usage.material.rightsBasis === 'unknown'
      || usage.material.readiness !== 'ready'
      || usage.material.qualityState !== 'passed'
      || !usage.material.verifiedAt
    ) {
      throw new Error('release_lineage_material_not_certified:' + usage.material.id);
    }
    return {
      usageId: usage.id,
      providerJobId: usage.providerJobId,
      materialId: usage.material.id,
      contentHash: certifiedHash(usage.material.contentHash, 'material_hash_' + usage.material.id),
    };
  });
  const learnedReferences = referenceRows.map((usage) => {
    if (usage.reference.rightsBasis === 'unknown' || usage.reference.analysisState === 'failed') {
      throw new Error('release_lineage_reference_not_certified:' + usage.reference.id);
    }
    return {
      usageId: usage.id,
      providerJobId: usage.providerJobId,
      referenceId: usage.reference.id,
      contentHash: certifiedHash(usage.reference.contentHash, 'reference_hash_' + usage.reference.id),
    };
  });

  return {
    audio: { kind: options.audio.kind, id: options.audio.id, contentHash: audioHash },
    master,
    mix: { id: mix.id, contentHash: certifiedHash(mix.contentHash, 'mix_hash') },
    beat: { ...beat, contentHash: certifiedHash(beat.contentHash, 'beat_hash') },
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
    if (!certification.audio) throw new Error('rights_check_requires_certified_audio');
    if (!certification.cover) throw new Error('rights_check_requires_an_approved_certified_cover');
    if (!certification.lyric?.approved) throw new Error('rights_check_requires_approved_lyrics');

    const lineage = await resolveCertifiedReleaseLineage({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      songId: payload.songId,
      audio: certification.audio,
    });
    const [hook, approvals, materialUsages, referenceUsages] = await Promise.all([
      prisma.hookCandidate.findFirst({
        where: { songId: payload.songId, approved: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.approval.findMany({
        where: { projectId: payload.projectId, decision: 'approved' },
        select: { id: true, gate: true, decision: true, userId: true, createdAt: true },
      }),
      prisma.materialUsage.findMany({
        where: {
          workspaceId: payload.workspaceId,
          songId: payload.songId,
          beatId: lineage.beat.id,
        },
        orderBy: { createdAt: 'asc' },
        include: {
          material: {
            select: { id: true, role: true, source: true, rightsBasis: true, contentHash: true, roleEvidence: true },
          },
        },
      }),
      prisma.referenceUsage.findMany({
        where: {
          workspaceId: payload.workspaceId,
          songId: payload.songId,
          beatId: lineage.beat.id,
        },
        orderBy: { position: 'asc' },
        include: {
          reference: {
            select: { id: true, title: true, genre: true, rightsBasis: true, analysisState: true, contentHash: true },
          },
        },
      }),
    ]);
    const beat = lineage.beat;
    const vocal = lineage.vocals.find((entry) => entry.role === 'lead') ?? lineage.vocals[0] ?? null;
    const audioBytes = await downloadToBuffer(certification.audio.url, {
      maxBytes: 256 * 1024 * 1024,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    assertStoredContentHash(audioBytes, certification.audio.contentHash, 'rights_source_audio');
    const duration = await probeAudioBufferDurationS(audioBytes);
    const clipStart = Math.max(0, Math.min(Math.floor(duration / 3), Math.max(0, duration - 12)));
    const clip = await extractClip(audioBytes, clipStart, Math.min(12, Math.max(1, duration || 12)));
    const recognition = await recognizeSong({ audio: clip, filename: 'rights-check.mp3' });
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
            status: payload.audioRightsAttestation ? 'matched_cleared' : 'matched_unconfirmed',
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
      references: certification.song.project.artist.references as Array<{ name: string; lane: string }>,
    });
    const audioClear = audioRecognition.status === 'clear' || audioRecognition.status === 'matched_cleared';
    const okToExport = rightsCheck.okToExport && audioClear;
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
      providers: [
        { kind: 'music', provider: beat.provider, assetId: beat.id, assetKind: beat.assetKind },
        ...lineage.vocals.map((entry) => ({
          kind: 'vocal',
          provider: entry.performanceSource,
          assetId: entry.id,
          assetKind: entry.assetKind,
        })),
        { kind: 'audio_recognition', provider: 'audd' },
      ],
      provenance: {
        beat,
        vocals: lineage.vocals,
        materials: materialUsages.map((usage: MaterialUsageEvidence) => ({
          usageId: usage.id,
          role: usage.role,
          material: usage.material,
          sections: usage.sections,
        })),
        learnedReferences: referenceUsages.map((usage: ReferenceUsageEvidence) => ({
          usageId: usage.id,
          position: usage.position,
          pinned: usage.pinned,
          influence: usage.influence,
          reference: usage.reference,
        })),
      },
      samples: materialUsages.map((usage: MaterialUsageEvidence) => ({
        materialId: usage.material.id,
        rightsBasis: usage.material.rightsBasis,
        contentHash: usage.material.contentHash,
      })),
      aiDisclosure: {
        distroDisclosure: 'GenAI-assisted, human-directed and edited',
        credits: {
          lyrics: 'AI-assisted, human-edited',
          production: 'AI-assisted',
          vocals: vocal?.performanceSource ?? 'not_recorded',
        },
      },
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
        humanContribution: payload.audioRightsAttestation?.note ?? null,
        aiDisclosure: canonicalPayload.aiDisclosure as never,
        hash,
      },
    });

    if (!okToExport) {
      persistedFailure = true;
      const reason = audioRecognition.status === 'unavailable'
        ? 'rights_audio_recognition_unavailable'
        : audioRecognition.status === 'matched_unconfirmed'
          ? 'rights_audio_match_requires_clearance_attestation'
          : 'rights_review_not_clear';
      await markFailed(payload.jobId, reason);
      return;
    }

    await prisma.$transaction([
      prisma.song.update({ where: { id: payload.songId }, data: { releaseReady: false } }),
      prisma.providerJob.update({
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
      }),
    ]);
  } catch (error) {
    if (!persistedFailure) await markFailed(payload.jobId, error);
  }
}
