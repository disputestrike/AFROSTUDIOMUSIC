import { canonicalReceiptHash, recognizeSong, runRightsCheck } from '@afrohit/ai';
import { loadReleaseCertification, prisma } from '@afrohit/db';
import { extractClip, probeDurationS } from '../lib/ffmpeg';
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

    const [hook, approvals, beat, vocal, materialUsages, referenceUsages] = await Promise.all([
      prisma.hookCandidate.findFirst({
        where: { songId: payload.songId, approved: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.approval.findMany({
        where: { projectId: payload.projectId, decision: 'approved' },
        select: { id: true, gate: true, decision: true, userId: true, createdAt: true },
      }),
      prisma.beatAsset.findFirst({
        where: { songId: payload.songId, approved: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, contentHash: true, assetKind: true, meta: true },
      }),
      prisma.vocalRender.findFirst({
        where: { songId: payload.songId, approved: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, performanceSource: true, contentHash: true, assetKind: true, voiceProfileId: true },
      }),
      prisma.materialUsage.findMany({
        where: { songId: payload.songId },
        orderBy: { createdAt: 'asc' },
        include: {
          material: {
            select: { id: true, role: true, source: true, rightsBasis: true, contentHash: true, roleEvidence: true },
          },
        },
      }),
      prisma.referenceUsage.findMany({
        where: { songId: payload.songId },
        orderBy: { position: 'asc' },
        include: {
          reference: {
            select: { id: true, title: true, genre: true, rightsBasis: true, analysisState: true, contentHash: true },
          },
        },
      }),
    ]);

    const audioBytes = await downloadToBuffer(certification.audio.url, { maxBytes: 256 * 1024 * 1024 });
    const duration = await probeDurationS(certification.audio.url);
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
      audioRecognition,
      rightsCheck: { ...rightsCheck, okToExport },
      approvals,
      providers: [
        beat ? { kind: 'music', provider: beat.provider, assetId: beat.id, assetKind: beat.assetKind } : null,
        vocal ? { kind: 'vocal', provider: vocal.performanceSource, assetId: vocal.id, assetKind: vocal.assetKind } : null,
        { kind: 'audio_recognition', provider: 'audd' },
      ].filter(Boolean),
      provenance: {
        beat,
        vocal,
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
