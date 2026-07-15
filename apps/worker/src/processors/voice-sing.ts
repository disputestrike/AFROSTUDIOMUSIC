import { createHash } from 'node:crypto';
import { openSecret, prisma } from '@afrohit/db';
import { singWithVoice, type SingPitchChange, type SingTuning } from '@afrohit/ai';
import { markFailed, markRunning } from '../lib/jobs';
import { separateStemsRouted } from '../lib/demucs-local';
import { measureAudioQuality, transformAudio } from '../lib/ffmpeg';
import { deleteObjectByUrl, downloadToBuffer, resolveAssetForProvider, uploadBytes } from '../lib/storage';
import { inspectIsolatedVocal } from '../lib/vocal-inspection';

interface SingConvertPayload {
  jobId: string;
  workspaceId: string;
  voiceProfileId: string;
  modelUrl: string;
  songInputUrl: string;
  pitchChange?: SingPitchChange;
  tuning?: SingTuning;
  songId?: string;
  projectId?: string;
}

/** Convert an existing performance into the trained voice. The provider output
 * is a full remix, so song-bound work is stem-separated again: the full result
 * is a Mix and the measured vocals stem is the only VocalRender. */
export async function processSingConvert(payload: SingConvertPayload): Promise<void> {
  await markRunning(payload.jobId);
  const createdUrls = new Set<string>();
  const transientStemUrls = new Set<string>();
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: payload.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey = workspace?.musicProvider === 'replicate'
      ? openSecret(workspace.musicApiKey)
      : undefined;
    const conversion = await singWithVoice({
      songInputUrl: await resolveAssetForProvider(payload.songInputUrl),
      modelUrl: await resolveAssetForProvider(payload.modelUrl),
      pitchChange: payload.pitchChange,
      tuning: payload.tuning,
      apiKey: replicateApiKey,
    });
    const fullBytes = await downloadToBuffer(conversion.url, { maxBytes: 256 * 1024 * 1024 });
    const fullUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'mixes',
      bytes: fullBytes,
      contentType: 'audio/wav',
      ext: 'wav',
    });
    createdUrls.add(fullUrl);
    const fullQc = await measureAudioQuality(fullUrl);
    if (fullQc.verdict !== 'pass') {
      throw new Error(`voice_conversion_mix_qc_failed: ${fullQc.flags.join(', ') || fullQc.verdict}`);
    }
    const fullContentHash = createHash('sha256').update(fullBytes).digest('hex');

    if (!payload.songId || !payload.projectId) {
      await prisma.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          cost: '0.150000' as never,
          outputJson: {
            url: fullUrl,
            durationS: fullQc.durationS,
            predictionId: conversion.predictionId,
            pitchChange: payload.pitchChange ?? 'no-change',
            assetKind: 'full_mix',
            qualityState: 'passed',
            contentHash: fullContentHash,
          } as never,
        },
      });
      createdUrls.delete(fullUrl);
      return;
    }

    const song = await prisma.song.findFirstOrThrow({
      where: {
        id: payload.songId,
        projectId: payload.projectId,
        workspaceId: payload.workspaceId,
      },
      select: { id: true },
    });
    const separated = await separateStemsRouted({
      audioUrl: fullUrl,
      apiKey: replicateApiKey,
      mode: 'instrumental',
      purpose: 'user',
      workspaceId: payload.workspaceId,
      preferLocal: true,
    });
    for (const stem of separated.stems) transientStemUrls.add(stem.url);
    if (separated.instrumentalUrl) transientStemUrls.add(separated.instrumentalUrl);
    const rawVocalUrl = separated.stems.find((stem) => stem.role === 'vocals')?.url;
    if (!rawVocalUrl) throw new Error('voice_conversion_stem_separation_returned_no_vocals');
    const rawVocalBytes = await downloadToBuffer(rawVocalUrl, { maxBytes: 256 * 1024 * 1024 });
    const vocalBytes = await transformAudio(rawVocalBytes, {});
    const vocalUrl = await uploadBytes({
      workspaceId: payload.workspaceId,
      kind: 'vocals',
      bytes: vocalBytes,
      contentType: 'audio/wav',
      ext: 'wav',
    });
    createdUrls.add(vocalUrl);
    const vocalInspection = await inspectIsolatedVocal({
      bytes: vocalBytes,
      url: vocalUrl,
      isolationConfirmed: true,
    });
    if (vocalInspection.qualityState !== 'passed' || !vocalInspection.verifiedAt) {
      throw new Error(`voice_conversion_vocal_qc_failed: ${vocalInspection.reasons.join(', ') || vocalInspection.qualityState}`);
    }

    const sourceFingerprint = createHash('sha256').update(payload.songInputUrl).digest('hex').slice(0, 24);
    const result = await prisma.$transaction(async (tx) => {
      const mix = await tx.mix.create({
        data: {
          projectId: payload.projectId!,
          songId: song.id,
          preset: 'own-voice',
          url: fullUrl,
          notes: 'Own-voice conversion of an existing sung performance.',
          qualityState: 'passed',
          contentHash: fullContentHash,
          verifiedAt: new Date(),
          meta: {
            qc: fullQc,
            ownVoiceConversion: true,
            convertedFromPerformance: true,
            predictionId: conversion.predictionId,
            sourceFingerprint,
          } as never,
          approved: true,
        },
      });
      const vocal = await tx.vocalRender.create({
        data: {
          projectId: payload.projectId!,
          songId: song.id,
          voiceProfileId: payload.voiceProfileId,
          role: 'lead',
          url: vocalUrl,
          duration: vocalInspection.durationS,
          assetKind: 'isolated_vocal',
          performanceSource: 'voice_conversion',
          qualityState: 'passed',
          contentHash: vocalInspection.contentHash,
          verifiedAt: vocalInspection.verifiedAt,
          approved: true,
          meta: {
            ownVoiceConversion: true,
            convertedFromPerformance: true,
            sourceFingerprint,
            separationEngine: separated.engine ?? 'unknown',
            sourceMixId: mix.id,
            qc: vocalInspection.qc,
            activeRatio: vocalInspection.activeRatio,
          } as never,
        },
      });
      await tx.song.update({ where: { id: song.id }, data: { status: 'MIXED' } });
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          cost: '0.250000' as never,
          outputJson: {
            url: mix.url,
            mixId: mix.id,
            vocalRenderId: vocal.id,
            isolatedVocalUrl: vocal.url,
            durationS: fullQc.durationS,
            predictionId: conversion.predictionId,
            pitchChange: payload.pitchChange ?? 'no-change',
            separationEngine: separated.engine ?? 'unknown',
            qualityState: 'passed',
            contentHash: fullContentHash,
            isolatedVocalContentHash: vocalInspection.contentHash,
            isolatedVocalQualityState: vocalInspection.qualityState,
          } as never,
        },
      });
      return { mix, vocal };
    });
    createdUrls.delete(result.mix.url);
    createdUrls.delete(result.vocal.url);
  } catch (error) {
    await markFailed(payload.jobId, error);
  } finally {
    await Promise.all([
      ...[...transientStemUrls].map((url) => deleteObjectByUrl(url).catch(() => undefined)),
      ...[...createdUrls].map((url) => deleteObjectByUrl(url).catch(() => undefined)),
    ]);
  }
}
