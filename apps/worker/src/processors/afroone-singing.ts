import { createHash } from 'node:crypto';
import {
  DEFAULT_VOICE_CONVERSION_COST_USD,
  afroOneSingingJobContract,
  buildAfroOneSungAssetReceipt,
  combineAfroOneSingingCost,
  createAfroOneSingingManifest,
  renderAfroOneSinging,
  singWithVoice,
  transcribeAudio,
} from '@afrohit/ai';
import { JobStatus, openSecret, prisma } from '@afrohit/db';
import {
  scoreLyricAudioAlignment,
  type LyricAudioAlignmentScore,
  type MelodyScore,
} from '@afrohit/shared';
import { markFailed } from '../lib/jobs';
import { separateStemsRouted } from '../lib/demucs-local';
import { mixdown, transformAudio } from '../lib/ffmpeg';
import { certifyAudioBytes, type CertifiedAudio } from '../lib/certified-assets';
import {
  deleteObjectByUrl,
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from '../lib/storage';
import { inspectIsolatedVocal } from '../lib/vocal-inspection';
import {
  singVoiceAuthorizationFailure,
  trainedVoiceArtifactIdentifier,
  trainedVoiceModelUrl,
} from './voice-sing';

export interface AfroOneSingingPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string | null;
  voiceProfileId?: string | null;
  lyrics: string;
  melodyScore: MelodyScore;
  genre: string;
  language?: string | null;
  targetDurationS?: number;
  role?: 'lead' | 'double' | 'ad-lib' | 'harmony';
  instrumentalBeatId?: string | null;
  instrumentalUrl?: string | null;
}

type PersonalVoice = NonNullable<Awaited<ReturnType<typeof loadPersonalVoice>>>;

interface MeasuredSingingAlignment extends LyricAudioAlignmentScore {
  state: 'passed' | 'failed';
  provider: 'openai' | 'replicate';
  model: string;
  language: string | null;
  expectedHash: string;
  transcriptHash: string;
  measuredAt: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function money(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

async function loadPersonalVoice(
  workspaceId: string,
  voiceProfileId: string | null | undefined
) {
  if (!voiceProfileId) return null;
  const profile = await prisma.voiceProfile.findFirst({
    where: { id: voiceProfileId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      artistId: true,
      consentId: true,
      status: true,
      trainedVersion: true,
      trainingMeta: true,
      voiceDatasetId: true,
      consent: {
        select: {
          id: true,
          workspaceId: true,
          artistId: true,
          revokedAt: true,
        },
      },
      voiceDataset: {
        select: { id: true, workspaceId: true, contentHash: true },
      },
    },
  });
  if (!profile) throw new Error('afroone_singing_voice_profile_not_found');
  const failure = singVoiceAuthorizationFailure(profile, workspaceId);
  if (failure) throw new Error(`afroone_singing_${failure}`);
  return profile;
}

function personalVoiceSignature(profile: PersonalVoice): string {
  return JSON.stringify({
    id: profile.id,
    workspaceId: profile.workspaceId,
    artistId: profile.artistId,
    consentId: profile.consentId,
    voiceDatasetId: profile.voiceDatasetId,
    datasetContentHash: profile.voiceDataset?.contentHash ?? null,
    modelArtifactId: trainedVoiceArtifactIdentifier(profile),
    modelUrl: trainedVoiceModelUrl(profile),
  });
}

async function assertProjectScope(payload: AfroOneSingingPayload): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: payload.projectId, workspaceId: payload.workspaceId },
    select: { id: true },
  });
  if (!project) throw new Error('afroone_singing_project_not_found');
  if (payload.songId) {
    const song = await prisma.song.findFirst({
      where: {
        id: payload.songId,
        projectId: payload.projectId,
        workspaceId: payload.workspaceId,
      },
      select: { id: true },
    });
    if (!song) throw new Error('afroone_singing_song_not_found');
  }
}

async function certifiedInstrumental(payload: AfroOneSingingPayload) {
  if (!payload.instrumentalBeatId && !payload.instrumentalUrl) return null;
  if (!payload.instrumentalBeatId || !payload.instrumentalUrl) {
    throw new Error('afroone_singing_instrumental_receipt_incomplete');
  }
  const beat = await prisma.beatAsset.findFirst({
    where: {
      id: payload.instrumentalBeatId,
      projectId: payload.projectId,
      songId: payload.songId ?? undefined,
      url: payload.instrumentalUrl,
      contentHash: { not: null },
      verifiedAt: { not: null },
      project: { workspaceId: payload.workspaceId },
    },
    select: { id: true, url: true, contentHash: true },
  });
  if (!beat?.contentHash || !/^[a-f0-9]{64}$/i.test(beat.contentHash)) {
    throw new Error('afroone_singing_instrumental_not_certified');
  }
  return beat;
}

async function measureSingingAlignment(input: {
  lyrics: string;
  audioUrl: string;
  bytes: Buffer;
  replicateApiKey?: string;
}): Promise<MeasuredSingingAlignment | null> {
  const providerUrl = await resolveAssetForProvider(input.audioUrl).catch(
    () => input.audioUrl
  );
  const transcription = await transcribeAudio({
    url: providerUrl,
    bytes: input.bytes,
    filename: 'afroone-vocal.wav',
    replicateApiKey: input.replicateApiKey,
  });
  if (!transcription?.text) return null;
  const score = scoreLyricAudioAlignment(input.lyrics, transcription.text);
  return {
    ...score,
    state: score.pass ? 'passed' : 'failed',
    provider: transcription.provider,
    model: transcription.model,
    language: transcription.language,
    expectedHash: createHash('sha256')
      .update(input.lyrics.normalize('NFC'))
      .digest('hex'),
    transcriptHash: createHash('sha256')
      .update(transcription.text.normalize('NFC'))
      .digest('hex'),
    measuredAt: new Date().toISOString(),
  };
}

function estimatedVerificationCostUsd(
  durationS: number | null,
  alignment: MeasuredSingingAlignment | null
): number {
  if (!alignment || !durationS) return 0;
  const configured = Number(
    process.env.AFROONE_SINGING_TRANSCRIBE_USD_PER_MINUTE
  );
  const perMinute = Number.isFinite(configured) && configured >= 0
    ? configured
    : 0.006;
  return money((durationS / 60) * perMinute);
}

async function assertJobContract(
  payload: AfroOneSingingPayload,
  expected: ReturnType<typeof afroOneSingingJobContract>
): Promise<void> {
  const job = await prisma.providerJob.findFirst({
    where: {
      id: payload.jobId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      status: JobStatus.RUNNING,
    },
    select: { inputJson: true },
  });
  if (!job) throw new Error('afroone_singing_job_not_running');
  const actual = objectValue(job.inputJson);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`afroone_singing_job_contract_mismatch:${key}`);
    }
  }
}

/**
 * Genuine singing worker. It never calls voiceAdapter/Eleven TTS and never
 * manufactures audio. A failed singer, revoked consent, failed vocal QC, or
 * measured lyric mismatch leaves no VocalRender and fails the provider job.
 */
export async function processAfroOneSinging(
  payload: AfroOneSingingPayload
): Promise<void> {
  const claimed = await prisma.providerJob.updateMany({
    where: {
      id: payload.jobId,
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      status: JobStatus.QUEUED,
    },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  if (claimed.count !== 1) return;

  const createdUrls = new Set<string>();
  const transientUrls = new Set<string>();
  try {
    await assertProjectScope(payload);
    const manifest = createAfroOneSingingManifest({
      lyrics: payload.lyrics,
      melodyScore: payload.melodyScore,
      genre: payload.genre,
      language: payload.language,
      targetDurationS: payload.targetDurationS,
    });
    await assertJobContract(
      payload,
      afroOneSingingJobContract(manifest, payload.voiceProfileId)
    );

    const workspace = await prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const workspaceMusicKey = openSecret(workspace?.musicApiKey);
    const replicateApiKey = workspace?.musicProvider === 'replicate'
      ? workspaceMusicKey
      : undefined;
    const falKey = workspace?.musicProvider === 'fal'
      ? workspaceMusicKey
      : process.env.FAL_KEY;
    const voice = await loadPersonalVoice(
      payload.workspaceId,
      payload.voiceProfileId
    );
    const voiceSignature = voice ? personalVoiceSignature(voice) : null;
    const instrumental = await certifiedInstrumental(payload);

    const rendered = await renderAfroOneSinging(manifest, {
      env: { ...process.env, ...(falKey ? { FAL_KEY: falKey } : {}) },
    });

    let isolatedBytes: Buffer;
    if (rendered.outputKind === 'isolated_vocal') {
      isolatedBytes = await downloadToBuffer(rendered.audioUrl, {
        maxBytes: 256 * 1024 * 1024,
      });
    } else {
      const separated = await separateStemsRouted({
        audioUrl: rendered.audioUrl,
        apiKey: replicateApiKey,
        mode: 'instrumental',
        purpose: 'user',
        workspaceId: payload.workspaceId,
        preferLocal: true,
      });
      separated.stems.forEach((stem) => transientUrls.add(stem.url));
      if (separated.instrumentalUrl) {
        transientUrls.add(separated.instrumentalUrl);
      }
      const vocalUrl = separated.stems.find(
        (stem) => stem.role === 'vocals'
      )?.url;
      if (!vocalUrl) {
        throw new Error('afroone_singing_separation_returned_no_vocal');
      }
      isolatedBytes = await downloadToBuffer(vocalUrl, {
        maxBytes: 256 * 1024 * 1024,
      });
    }
    isolatedBytes = await transformAudio(isolatedBytes, {});

    let voiceConversionUsd = 0;
    let predictionId: string | null = null;
    if (voice) {
      const baseUrl = await uploadBytes({
        workspaceId: payload.workspaceId,
        kind: 'voice-input-snapshots',
        bytes: isolatedBytes,
        contentType: 'audio/wav',
        ext: 'wav',
      });
      transientUrls.add(baseUrl);
      const invocationVoice = await loadPersonalVoice(
        payload.workspaceId,
        payload.voiceProfileId
      );
      if (
        !invocationVoice ||
        personalVoiceSignature(invocationVoice) !== voiceSignature
      ) {
        throw new Error('afroone_singing_voice_changed_before_conversion');
      }
      const modelUrl = trainedVoiceModelUrl(invocationVoice);
      if (!modelUrl) throw new Error('afroone_singing_voice_model_missing');
      const conversion = await singWithVoice({
        songInputUrl: await resolveAssetForProvider(baseUrl),
        modelUrl: await resolveAssetForProvider(modelUrl),
        apiKey: replicateApiKey,
      });
      isolatedBytes = await transformAudio(
        await downloadToBuffer(conversion.url, {
          maxBytes: 256 * 1024 * 1024,
        }),
        {}
      );
      predictionId = conversion.predictionId;
      voiceConversionUsd = DEFAULT_VOICE_CONVERSION_COST_USD;
    }

    const storedUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'vocals',
      bytes: isolatedBytes,
      contentType: 'audio/wav',
      ext: 'wav',
    });
    createdUrls.add(storedUrl);
    const inspection = await inspectIsolatedVocal({
      bytes: isolatedBytes,
      url: storedUrl,
      isolationConfirmed: true,
    });
    if (inspection.qualityState === 'failed') {
      throw new Error(
        `afroone_singing_vocal_qc_failed:${inspection.reasons.join(',')}`
      );
    }

    const alignment = await measureSingingAlignment({
      lyrics: manifest.lyrics,
      audioUrl: storedUrl,
      bytes: isolatedBytes,
      replicateApiKey,
    });
    if (!alignment) {
      throw new Error('afroone_singing_lyric_alignment_unverified');
    }
    if (alignment && !alignment.pass) {
      throw new Error(
        `afroone_singing_lyric_alignment_failed:${alignment.failures.join(',')}`
      );
    }
    const verificationUsd = estimatedVerificationCostUsd(
      inspection.durationS,
      alignment
    );
    const totalCost = combineAfroOneSingingCost({
      synthesisUsd: rendered.cost.synthesisUsd,
      voiceConversionUsd,
      verificationUsd,
      estimated: rendered.cost.estimated || voiceConversionUsd > 0 || verificationUsd > 0,
    });
    const receipt = buildAfroOneSungAssetReceipt({
      render: rendered,
      personalizedVoice: Boolean(voice),
      performanceSource: voice ? 'voice_conversion' : rendered.performanceSource,
      cost: totalCost,
    });
    const approved = inspection.qualityState === 'passed' && alignment.pass;
    let finishedMix: CertifiedAudio | null = null;
    if (instrumental) {
      const instrumentalBytes = await downloadToBuffer(instrumental.url, {
        maxBytes: 256 * 1024 * 1024,
      });
      const mixedBytes = await mixdown({
        beat: instrumentalBytes,
        vocal: isolatedBytes,
        preset: 'radio',
      });
      finishedMix = await certifyAudioBytes({
        workspaceId: payload.workspaceId,
        kind: 'mixes',
        bytes: mixedBytes,
        contentType: 'audio/wav',
        ext: 'wav',
      });
      createdUrls.add(finishedMix.url);
    }
    const persistenceVoice = voice
      ? await loadPersonalVoice(payload.workspaceId, payload.voiceProfileId)
      : null;
    if (
      voice &&
      (!persistenceVoice ||
        personalVoiceSignature(persistenceVoice) !== voiceSignature)
    ) {
      throw new Error('afroone_singing_voice_changed_before_persistence');
    }

    const result = await prisma.$transaction(async (tx) => {
      if (persistenceVoice) {
        const activeConsent = await tx.voiceConsent.updateMany({
          where: {
            id: persistenceVoice.consentId,
            workspaceId: payload.workspaceId,
            artistId: persistenceVoice.artistId,
            revokedAt: null,
          },
          data: { revokedAt: null },
        });
        if (activeConsent.count !== 1) {
          throw new Error('afroone_singing_consent_changed_before_persistence');
        }
        const authorized = await tx.voiceProfile.updateMany({
          where: {
            id: persistenceVoice.id,
            workspaceId: payload.workspaceId,
            artistId: persistenceVoice.artistId,
            consentId: persistenceVoice.consentId,
            status: 'READY',
            consent: {
              workspaceId: payload.workspaceId,
              artistId: persistenceVoice.artistId,
              revokedAt: null,
            },
          },
          data: { status: 'READY' },
        });
        if (authorized.count !== 1) {
          throw new Error('afroone_singing_consent_changed_before_persistence');
        }
      }
      const created = await tx.vocalRender.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId ?? null,
          voiceProfileId: persistenceVoice?.id ?? null,
          role: payload.role ?? 'lead',
          url: storedUrl,
          duration: inspection.durationS ?? undefined,
          language: payload.language ?? undefined,
          assetKind: 'isolated_vocal',
          performanceSource: receipt.performanceSource,
          qualityState: inspection.qualityState,
          contentHash: inspection.contentHash,
          verifiedAt: inspection.verifiedAt,
          alignment: alignment ? (alignment as never) : undefined,
          approved,
          meta: {
            ...receipt,
            alignmentState: alignment?.state ?? 'unmeasured',
            alignmentRequired: true,
            predictionId,
            quality: {
              reasons: inspection.reasons,
              activeRatio: inspection.activeRatio,
              qc: inspection.qc,
            },
            personalizedVoice: persistenceVoice
              ? {
                  voiceProfileId: persistenceVoice.id,
                  artistId: persistenceVoice.artistId,
                  consentId: persistenceVoice.consentId,
                  voiceDatasetId: persistenceVoice.voiceDatasetId,
                  datasetContentHash:
                    persistenceVoice.voiceDataset?.contentHash ?? null,
                  modelArtifactId:
                    trainedVoiceArtifactIdentifier(persistenceVoice),
                }
              : null,
          } as never,
        },
      });
      const mix = finishedMix
        ? await tx.mix.create({
            data: {
              projectId: payload.projectId,
              songId: payload.songId ?? null,
              preset: 'afroone-radio',
              url: finishedMix.url,
              notes: 'AfroOne owned instrumental with a genuine generated singing performance.',
              qualityState: finishedMix.qualityState,
              contentHash: finishedMix.contentHash,
              verifiedAt: finishedMix.verifiedAt,
              approved: approved && finishedMix.qualityState === 'passed',
              meta: {
                afroOneSinging: true,
                source: {
                  beatId: instrumental?.id ?? null,
                  beatContentHash: instrumental?.contentHash ?? null,
                  vocalRenderId: created.id,
                  vocalContentHash: inspection.contentHash,
                },
                receipt,
                qc: finishedMix.qc,
              } as never,
            },
          })
        : null;
      if (mix && payload.songId) {
        await tx.song.update({
          where: { id: payload.songId },
          data: { status: mix.approved ? 'MIXED' : 'DEMO' },
        });
      }
      const completed = await tx.providerJob.updateMany({
        where: {
          id: payload.jobId,
          workspaceId: payload.workspaceId,
          projectId: payload.projectId,
          status: JobStatus.RUNNING,
        },
        data: {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          cost: totalCost.totalUsd.toFixed(6) as never,
          externalId: rendered.externalId,
          outputJson: {
            vocalRenderId: created.id,
            isolatedVocalUrl: created.url,
            url: mix?.url ?? created.url,
            mixId: mix?.id ?? null,
            instrumentalBeatId: instrumental?.id ?? null,
            assetKind: 'isolated_vocal',
            performanceKind: 'sung_vocal',
            performanceSource: receipt.performanceSource,
            approved,
            qualityState: inspection.qualityState,
            alignmentState: alignment?.state ?? 'unmeasured',
            contentHash: inspection.contentHash,
            receipt,
          } as never,
        },
      });
      if (completed.count !== 1) {
        throw new Error('afroone_singing_job_canceled_before_persistence');
      }
      return { vocal: created, mix };
    });
    createdUrls.delete(result.vocal.url);
    if (result.mix) createdUrls.delete(result.mix.url);
  } catch (error) {
    await markFailed(payload.jobId, error);
  } finally {
    await Promise.all([
      ...[...transientUrls].map((url) =>
        deleteObjectByUrl(url).catch(() => undefined)
      ),
      ...[...createdUrls].map((url) =>
        deleteObjectByUrl(url).catch(() => undefined)
      ),
    ]);
  }
}
