import { createHash } from "node:crypto";
import {
  JobStatus,
  openSecret,
  prisma,
  releaseEvidenceHash,
  type Prisma,
} from "@afrohit/db";
import {
  singWithVoice,
  type SingPitchChange,
  type SingTuning,
} from "@afrohit/ai";
import { isStorageUri } from "@afrohit/shared";
import { markFailed } from "../lib/jobs";
import { separateStemsRouted } from "../lib/demucs-local";
import { measureAudioQuality, transformAudio } from "../lib/ffmpeg";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "../lib/storage";
import { inspectIsolatedVocal } from "../lib/vocal-inspection";
import { assertStoredContentHash } from "../lib/certified-assets";
import {
  resolveCertifiedDerivedAudioSource,
  type CertifiedSourceAssetRef,
} from "../lib/derived-audio-lineage";

interface SingConvertPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  artistId?: string;
  consentId?: string;
  modelUrl: string;
  songInputUrl: string;
  pitchChange?: SingPitchChange;
  tuning?: SingTuning;
  songId?: string;
  projectId?: string;
}

type AuthorizedVoice = {
  id: string;
  workspaceId: string;
  artistId: string;
  consentId: string;
  status: string;
  trainedVersion: string | null;
  trainingMeta: unknown;
  voiceDatasetId: string | null;
  consent: {
    id: string;
    workspaceId: string;
    artistId: string | null;
    revokedAt: Date | null;
  };
  voiceDataset: { id: string; workspaceId: string; contentHash: string } | null;
};

type CertifiedSourceAsset = {
  id: string;
  url: string;
  contentHash: string | null;
};

type CertifiedSourceMix = CertifiedSourceAsset & { meta: unknown };
type CertifiedSourceMaster = CertifiedSourceAsset & {
  mixId: string | null;
};

export type CertifiedVoiceSingSourceLineage = {
  input: {
    kind: "beat" | "mix" | "master";
    id: string;
    url: string;
    contentHash: string;
  };
  beat: { id: string; contentHash: string };
  mix: { id: string; contentHash: string } | null;
  master: { id: string; contentHash: string } | null;
  sourceVocals: Array<{ id: string; contentHash: string }>;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isModelUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^https?:\/\//i.test(value) || isStorageUri(value))
  );
}

function artifactCandidates(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(artifactCandidates).reverse();
  if (!value || typeof value !== "object") return [];
  const object = objectValue(value);
  return [
    "weights",
    "artifact",
    "artifact_url",
    "model",
    "url",
    "version",
    "model_version",
  ].flatMap(key => artifactCandidates(object[key]));
}

export function trainedVoiceArtifactIdentifier(
  profile: Pick<AuthorizedVoice, "trainedVersion" | "trainingMeta">
): string | null {
  for (const raw of artifactCandidates([
    profile.trainedVersion,
    objectValue(profile.trainingMeta).output,
  ])) {
    const candidate = raw.trim();
    if (isModelUrl(candidate) || /^[a-zA-Z0-9_-]{20,160}$/.test(candidate))
      return candidate;
    if (
      /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+[@:][a-zA-Z0-9_-]{20,160}$/.test(
        candidate
      )
    )
      return candidate;
  }
  return null;
}

export function trainedVoiceModelUrl(
  profile: Pick<AuthorizedVoice, "trainedVersion" | "trainingMeta">
): string | null {
  return (
    artifactCandidates([
      profile.trainedVersion,
      objectValue(profile.trainingMeta).output,
    ]).find(isModelUrl) ?? null
  );
}

export function singVoiceAuthorizationFailure(
  profile: AuthorizedVoice,
  workspaceId: string
): string | null {
  if (
    profile.workspaceId !== workspaceId ||
    profile.consent.workspaceId !== workspaceId
  )
    return "voice_workspace_mismatch";
  if (profile.consentId !== profile.consent.id) return "voice_consent_mismatch";
  if (profile.consent.revokedAt) return "voice_consent_revoked";
  if (
    !profile.consent.artistId ||
    profile.artistId !== profile.consent.artistId
  )
    return "voice_artist_mismatch";
  if (profile.status !== "READY") return `voice_not_ready:${profile.status}`;
  if (
    profile.voiceDatasetId !== profile.voiceDataset?.id &&
    (profile.voiceDatasetId || profile.voiceDataset)
  ) {
    return "voice_dataset_relation_mismatch";
  }
  if (profile.voiceDataset && profile.voiceDataset.workspaceId !== workspaceId)
    return "voice_dataset_workspace_mismatch";

  const meta = objectValue(profile.trainingMeta);
  const hasTrainingLineage =
    profile.trainedVersion !== null ||
    profile.voiceDatasetId !== null ||
    Object.keys(meta).length > 0;
  if (hasTrainingLineage && meta.artistId !== profile.artistId)
    return "voice_training_artist_mismatch";
  if (hasTrainingLineage && meta.consentId !== profile.consentId)
    return "voice_training_consent_mismatch";
  if (profile.voiceDataset) {
    if (meta.datasetId !== profile.voiceDataset.id)
      return "voice_training_dataset_mismatch";
    if (meta.datasetContentHash !== profile.voiceDataset.contentHash) {
      return "voice_training_dataset_hash_mismatch";
    }
  } else if (
    typeof meta.datasetId === "string" ||
    typeof meta.datasetContentHash === "string"
  ) {
    return "voice_training_dataset_relation_mismatch";
  }
  if (!trainedVoiceArtifactIdentifier(profile))
    return "trained_model_artifact_missing";
  if (!trainedVoiceModelUrl(profile)) return "trained_model_file_missing";
  return null;
}

async function loadAuthorizedVoice(
  payload: Pick<SingConvertPayload, "workspaceId" | "voiceProfileId">
): Promise<AuthorizedVoice> {
  const profile = await prisma.voiceProfile.findFirst({
    where: { id: payload.voiceProfileId, workspaceId: payload.workspaceId },
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
  if (!profile) throw new Error("voice_profile_not_found");
  const failure = singVoiceAuthorizationFailure(profile, payload.workspaceId);
  if (failure) throw new Error(failure);
  return profile;
}

function voiceLineageSignature(profile: AuthorizedVoice): string {
  return JSON.stringify({
    workspaceId: profile.workspaceId,
    artistId: profile.artistId,
    consentId: profile.consentId,
    voiceDatasetId: profile.voiceDatasetId,
    datasetContentHash: profile.voiceDataset?.contentHash ?? null,
    modelArtifactId: trainedVoiceArtifactIdentifier(profile),
    modelUrl: trainedVoiceModelUrl(profile),
  });
}

function pitchChange(value: unknown): SingPitchChange | undefined {
  return value === "no-change" ||
    value === "male-to-female" ||
    value === "female-to-male"
    ? value
    : undefined;
}

/** Convert an existing performance into the trained voice. The provider output
 * is a full remix, so song-bound work is stem-separated again: the full result
 * is a Mix and the measured vocals stem is the only VocalRender. */
export async function processSingConvert(
  payload: SingConvertPayload
): Promise<void> {
  const claimed = await prisma.providerJob.updateMany({
    where: {
      id: payload.jobId,
      workspaceId: payload.workspaceId,
      status: JobStatus.QUEUED,
    },
    data: { status: JobStatus.RUNNING, startedAt: new Date() },
  });
  if (claimed.count !== 1) return;

  const createdUrls = new Set<string>();
  const transientStemUrls = new Set<string>();
  try {
    const profile = await loadAuthorizedVoice(payload);
    const providerJob = await prisma.providerJob.findFirst({
      where: {
        id: payload.jobId,
        workspaceId: payload.workspaceId,
        status: JobStatus.RUNNING,
      },
      select: { inputJson: true, projectId: true },
    });
    if (!providerJob) throw new Error("voice_job_not_running");
    const input = objectValue(providerJob.inputJson);
    if (input.voiceProfileId !== profile.id)
      throw new Error("voice_job_profile_mismatch");
    if (input.artistId !== profile.artistId)
      throw new Error("voice_job_artist_mismatch");
    if (input.consentId !== profile.consentId)
      throw new Error("voice_job_consent_mismatch");
    if (input.voiceDatasetId !== profile.voiceDatasetId)
      throw new Error("voice_job_dataset_mismatch");
    if (
      input.datasetContentHash !== (profile.voiceDataset?.contentHash ?? null)
    )
      throw new Error("voice_job_dataset_hash_mismatch");
    const modelArtifactId = trainedVoiceArtifactIdentifier(profile);
    if (input.modelArtifactId !== modelArtifactId) {
      throw new Error("voice_job_model_artifact_mismatch");
    }
    const expectedLineage = voiceLineageSignature(profile);
    if (typeof input.songInputUrl !== "string")
      throw new Error("voice_job_source_missing");
    const songInputUrl = input.songInputUrl;
    const songId = typeof input.songId === "string" ? input.songId : undefined;
    const projectId = providerJob.projectId ?? undefined;
    if ((songId && !projectId) || (!songId && projectId))
      throw new Error("voice_job_song_lineage_mismatch");
    const requestedPitchChange = pitchChange(input.pitchChange);
    const requestedTuning =
      input.tuning &&
      typeof input.tuning === "object" &&
      !Array.isArray(input.tuning)
        ? (input.tuning as SingTuning)
        : undefined;

    let providerSongInputUrl = songInputUrl;
    let sourceIdentity: {
      type: 'beat' | 'mix' | 'master' | 'external';
      id: string;
      contentHash: string;
      claim: Record<string, unknown> | null;
      claimHash: string | null;
    };
    if (songId && projectId) {
      const source = objectValue(input.sourceAsset);
      const type = source.type;
      if (type !== 'beat' && type !== 'mix' && type !== 'master') {
        throw new Error('voice_job_source_asset_missing');
      }
      if (typeof source.id !== 'string' || !source.id) {
        throw new Error('voice_job_source_asset_id_missing');
      }
      const certification = objectValue(source.certification);
      const sourceRef: CertifiedSourceAssetRef = {
        type,
        id: source.id,
        url: typeof source.url === 'string' ? source.url : undefined,
        certification: {
          contentHash: typeof certification.contentHash === 'string'
            ? certification.contentHash
            : null,
        },
      };
      const resolved = await resolveCertifiedDerivedAudioSource({
        workspaceId: payload.workspaceId,
        projectId,
        songId,
        source: sourceRef,
      });
      if (songInputUrl !== resolved.url) throw new Error('voice_job_source_url_changed');
      const sourceBytes = await downloadToBuffer(resolved.url, {
        maxBytes: 256 * 1024 * 1024,
      });
      assertStoredContentHash(sourceBytes, resolved.contentHash, 'voice_conversion_source_audio');
      providerSongInputUrl = resolved.url;
      sourceIdentity = {
        type: resolved.type,
        id: resolved.id,
        contentHash: resolved.contentHash,
        claim: resolved.claim,
        claimHash: resolved.claimHash,
      };
    } else {
      if (input.externalRightsConfirmed !== true) {
        throw new Error('voice_job_external_source_rights_unconfirmed');
      }
      const sourceBytes = await downloadToBuffer(songInputUrl, {
        maxBytes: 256 * 1024 * 1024,
      });
      const snapshotBytes = await transformAudio(sourceBytes, {});
      const sourceContentHash = createHash('sha256').update(snapshotBytes).digest('hex');
      const snapshotUrl = await uploadBytes({
        workspaceId: payload.workspaceId,
        kind: 'voice-input-snapshots',
        bytes: snapshotBytes,
        contentType: 'audio/wav',
        ext: 'wav',
      });
      transientStemUrls.add(snapshotUrl);
      providerSongInputUrl = snapshotUrl;
      const claim = {
        schemaVersion: 1,
        kind: 'direct_owned_upload',
        sourceKind: 'url_import',
        sourceContentHash,
        parentSourceContentHash: null,
        parentClaimHash: null,
        rightsConfirmationVersion: 1,
        rightsConfirmed: true,
      };
      sourceIdentity = {
        type: 'external',
        id: 'external-performance',
        contentHash: sourceContentHash,
        claim,
        claimHash: releaseEvidenceHash(claim),
      };
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey =
      workspace?.musicProvider === "replicate"
        ? openSecret(workspace.musicApiKey)
        : undefined;
    const resolvedSongInputUrl = await resolveAssetForProvider(providerSongInputUrl);
    const currentModelUrl = trainedVoiceModelUrl(profile)!;
    const resolvedModelUrl = await resolveAssetForProvider(currentModelUrl);

    // This reload is deliberately the final awaited operation before synthesis.
    const invocationProfile = await loadAuthorizedVoice(payload);
    if (voiceLineageSignature(invocationProfile) !== expectedLineage) {
      throw new Error("voice_model_changed_before_provider");
    }
    const conversion = await singWithVoice({
      songInputUrl: resolvedSongInputUrl,
      modelUrl: resolvedModelUrl,
      pitchChange: requestedPitchChange,
      tuning: requestedTuning,
      apiKey: replicateApiKey,
    });
    const fullBytes = await downloadToBuffer(conversion.url, {
      maxBytes: 256 * 1024 * 1024,
    });
    const fullUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: "mixes",
      bytes: fullBytes,
      contentType: "audio/wav",
      ext: "wav",
    });
    createdUrls.add(fullUrl);
    const fullQc = await measureAudioQuality(fullUrl);
    if (fullQc.verdict !== "pass") {
      throw new Error(
        `voice_conversion_mix_qc_failed: ${fullQc.flags.join(", ") || fullQc.verdict}`
      );
    }
    const fullContentHash = createHash("sha256")
      .update(fullBytes)
      .digest("hex");
    const lineageReceipt = {
      voiceProfileId: invocationProfile.id,
      artistId: invocationProfile.artistId,
      consentId: invocationProfile.consentId,
      voiceDatasetId: invocationProfile.voiceDatasetId,
      datasetContentHash: invocationProfile.voiceDataset?.contentHash ?? null,
      modelArtifactId,
      sourceAsset: {
        type: sourceIdentity.type,
        id: sourceIdentity.id,
        contentHash: sourceIdentity.contentHash,
        claimHash: sourceIdentity.claimHash,
      },
    };

    if (!songId || !projectId) {
      const persistenceProfile = await loadAuthorizedVoice(payload);
      if (voiceLineageSignature(persistenceProfile) !== expectedLineage) {
        throw new Error("voice_model_changed_before_persistence");
      }
      await prisma.$transaction(async tx => {
        const activeConsent = await tx.voiceConsent.updateMany({
          where: {
            id: persistenceProfile.consentId,
            workspaceId: payload.workspaceId,
            artistId: persistenceProfile.artistId,
            revokedAt: null,
          },
          data: { revokedAt: null },
        });
        if (activeConsent.count !== 1)
          throw new Error("voice_consent_changed_before_persistence");
        const authorized = await tx.voiceProfile.updateMany({
          where: {
            id: persistenceProfile.id,
            workspaceId: payload.workspaceId,
            artistId: persistenceProfile.artistId,
            consentId: persistenceProfile.consentId,
            status: "READY",
            consent: {
              workspaceId: payload.workspaceId,
              artistId: persistenceProfile.artistId,
              revokedAt: null,
            },
          },
          data: { status: "READY" },
        });
        if (authorized.count !== 1)
          throw new Error("voice_consent_changed_before_persistence");
        const completed = await tx.providerJob.updateMany({
          where: {
            id: payload.jobId,
            workspaceId: payload.workspaceId,
            status: JobStatus.RUNNING,
          },
          data: {
            status: JobStatus.SUCCEEDED,
            finishedAt: new Date(),
            cost: "0.150000" as never,
            outputJson: {
              url: fullUrl,
              durationS: fullQc.durationS,
              predictionId: conversion.predictionId,
              pitchChange: requestedPitchChange ?? "no-change",
              assetKind: "full_mix",
              qualityState: "passed",
              contentHash: fullContentHash,
              ...lineageReceipt,
            } as never,
          },
        });
        if (completed.count !== 1)
          throw new Error("voice_job_canceled_before_persistence");
      });
      createdUrls.delete(fullUrl);
      return;
    }

    const song = await prisma.song.findFirstOrThrow({
      where: {
        id: songId,
        projectId,
        workspaceId: payload.workspaceId,
      },
      select: { id: true },
    });
    // Separation can route to a provider, so consent is checked at this boundary too.
    const separationProfile = await loadAuthorizedVoice(payload);
    if (voiceLineageSignature(separationProfile) !== expectedLineage) {
      throw new Error("voice_model_changed_before_separation");
    }
    const separated = await separateStemsRouted({
      audioUrl: fullUrl,
      apiKey: replicateApiKey,
      mode: "instrumental",
      purpose: "user",
      workspaceId: payload.workspaceId,
      preferLocal: true,
    });
    for (const stem of separated.stems) transientStemUrls.add(stem.url);
    if (separated.instrumentalUrl)
      transientStemUrls.add(separated.instrumentalUrl);
    const rawVocalUrl = separated.stems.find(
      stem => stem.role === "vocals"
    )?.url;
    if (!rawVocalUrl)
      throw new Error("voice_conversion_stem_separation_returned_no_vocals");
    const rawVocalBytes = await downloadToBuffer(rawVocalUrl, {
      maxBytes: 256 * 1024 * 1024,
    });
    const vocalBytes = await transformAudio(rawVocalBytes, {});
    const vocalUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: "vocals",
      bytes: vocalBytes,
      contentType: "audio/wav",
      ext: "wav",
    });
    createdUrls.add(vocalUrl);
    const vocalInspection = await inspectIsolatedVocal({
      bytes: vocalBytes,
      url: vocalUrl,
      isolationConfirmed: true,
    });
    if (
      vocalInspection.qualityState !== "passed" ||
      !vocalInspection.verifiedAt
    ) {
      throw new Error(
        `voice_conversion_vocal_qc_failed: ${vocalInspection.reasons.join(", ") || vocalInspection.qualityState}`
      );
    }

    const rawInstrumentalUrl =
      separated.instrumentalUrl ??
      separated.stems.find(stem => stem.role === "instrumental")?.url;
    if (!rawInstrumentalUrl) {
      throw new Error("voice_conversion_stem_separation_returned_no_instrumental");
    }
    const rawInstrumentalBytes = await downloadToBuffer(rawInstrumentalUrl, {
      maxBytes: 256 * 1024 * 1024,
    });
    const instrumentalBytes = await transformAudio(rawInstrumentalBytes, {});
    const instrumentalUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: "beats",
      bytes: instrumentalBytes,
      contentType: "audio/wav",
      ext: "wav",
    });
    createdUrls.add(instrumentalUrl);
    const instrumentalQc = await measureAudioQuality(instrumentalUrl);
    if (instrumentalQc.verdict !== "pass") {
      throw new Error(
        "voice_conversion_instrumental_qc_failed: " +
          (instrumentalQc.flags.join(", ") || instrumentalQc.verdict)
      );
    }
    const instrumentalContentHash = createHash("sha256")
      .update(instrumentalBytes)
      .digest("hex");
    const instrumentalVerifiedAt = new Date();
    const sourceFingerprint = createHash("sha256")
      .update(sourceIdentity.contentHash)
      .digest("hex")
      .slice(0, 24);
    const persistenceProfile = await loadAuthorizedVoice(payload);
    if (voiceLineageSignature(persistenceProfile) !== expectedLineage) {
      throw new Error("voice_model_changed_before_persistence");
    }
    const result = await prisma.$transaction(async tx => {
      const activeConsent = await tx.voiceConsent.updateMany({
        where: {
          id: persistenceProfile.consentId,
          workspaceId: payload.workspaceId,
          artistId: persistenceProfile.artistId,
          revokedAt: null,
        },
        data: { revokedAt: null },
      });
      if (activeConsent.count !== 1)
        throw new Error("voice_consent_changed_before_persistence");
      const authorized = await tx.voiceProfile.updateMany({
        where: {
          id: persistenceProfile.id,
          workspaceId: payload.workspaceId,
          artistId: persistenceProfile.artistId,
          consentId: persistenceProfile.consentId,
          status: "READY",
          consent: {
            workspaceId: payload.workspaceId,
            artistId: persistenceProfile.artistId,
            revokedAt: null,
          },
        },
        data: { status: "READY" },
      });
      if (authorized.count !== 1)
        throw new Error("voice_consent_changed_before_persistence");
      const beat = await tx.beatAsset.create({
        data: {
          projectId,
          songId: song.id,
          url: instrumentalUrl,
          format: "wav",
          duration: instrumentalQc.durationS,
          provider: "internal",
          assetKind: "instrumental",
          qualityState: "passed",
          contentHash: instrumentalContentHash,
          verifiedAt: instrumentalVerifiedAt,
          approved: true,
          meta: {
            ownVoiceConversion: true,
            sourceFingerprint,
            separationEngine: separated.engine ?? "unknown",
            qc: instrumentalQc,
            ...lineageReceipt,
          } as never,
        },
      });
      const vocal = await tx.vocalRender.create({
        data: {
          projectId,
          songId: song.id,
          voiceProfileId: persistenceProfile.id,
          role: "lead",
          url: vocalUrl,
          duration: vocalInspection.durationS,
          assetKind: "isolated_vocal",
          performanceSource: "voice_conversion",
          qualityState: "passed",
          contentHash: vocalInspection.contentHash,
          verifiedAt: vocalInspection.verifiedAt,
          approved: true,
          meta: {
            ownVoiceConversion: true,
            convertedFromPerformance: true,
            sourceFingerprint,
            separationEngine: separated.engine ?? "unknown",
            qc: vocalInspection.qc,
            activeRatio: vocalInspection.activeRatio,
            ...lineageReceipt,
          } as never,
        },
      });
      const mix = await tx.mix.create({
        data: {
          projectId,
          songId: song.id,
          preset: "own-voice",
          url: fullUrl,
          notes: "Own-voice conversion of an existing sung performance.",
          qualityState: "passed",
          contentHash: fullContentHash,
          verifiedAt: new Date(),
          meta: {
            qc: fullQc,
            ownVoiceConversion: true,
            convertedFromPerformance: true,
            predictionId: conversion.predictionId,
            sourceFingerprint,
            source: {
              beatId: beat.id,
              beatContentHash: instrumentalContentHash,
              vocalRenderIds: [vocal.id],
              vocalRenderContentHashes: [vocalInspection.contentHash],
            },
            derivedFrom: {
              type: sourceIdentity.type,
              id: sourceIdentity.id,
              contentHash: sourceIdentity.contentHash,
              claimHash: sourceIdentity.claimHash,
              claim: sourceIdentity.claim,
              operation: {
                kind: "voice_conversion",
                voiceProfileId: persistenceProfile.id,
                modelArtifactId,
              },
            },
            ...lineageReceipt,
          } as never,
          approved: true,
        },
      });
      await tx.song.update({
        where: { id: song.id },
        data: { status: "MIXED" },
      });
      const completed = await tx.providerJob.updateMany({
        where: {
          id: payload.jobId,
          workspaceId: payload.workspaceId,
          status: JobStatus.RUNNING,
        },
        data: {
          status: JobStatus.SUCCEEDED,
          finishedAt: new Date(),
          cost: "0.250000" as never,
          outputJson: {
            url: mix.url,
            mixId: mix.id,
            beatId: beat.id,
            instrumentalUrl: beat.url,
            instrumentalContentHash,
            vocalRenderId: vocal.id,
            isolatedVocalUrl: vocal.url,
            durationS: fullQc.durationS,
            predictionId: conversion.predictionId,
            pitchChange: requestedPitchChange ?? "no-change",
            separationEngine: separated.engine ?? "unknown",
            qualityState: "passed",
            contentHash: fullContentHash,
            isolatedVocalContentHash: vocalInspection.contentHash,
            isolatedVocalQualityState: vocalInspection.qualityState,
            ...lineageReceipt,
          } as never,
        },
      });
      if (completed.count !== 1)
        throw new Error("voice_job_canceled_before_persistence");
      return { beat, mix, vocal };
    });
    createdUrls.delete(result.beat.url);
    createdUrls.delete(result.mix.url);
    createdUrls.delete(result.vocal.url);
  } catch (error) {
    await markFailed(payload.jobId, error);
  } finally {
    await Promise.all([
      ...[...transientStemUrls].map(url =>
        deleteObjectByUrl(url).catch(() => undefined)
      ),
      ...[...createdUrls].map(url =>
        deleteObjectByUrl(url).catch(() => undefined)
      ),
    ]);
  }
}
