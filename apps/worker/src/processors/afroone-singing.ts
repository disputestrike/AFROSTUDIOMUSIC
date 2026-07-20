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
import {
  afroOneVocalOffsetDb,
  master,
  measureAudioBufferQuality,
  mixdownVocalForward,
  transformAudio,
  vocalGainDbFromLufs,
} from '../lib/ffmpeg';
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

/**
 * SING IN MY VOICE (SOUNDWAVE2 Target C): when the workspace owns a trained,
 * READY voice profile, AfroOne's sung takes convert into that artist's own
 * timbre instead of shipping the generic engine voice. Default ON whenever a
 * ready profile exists; AFROONE_SING_IN_MY_VOICE=0 is the kill switch. The
 * payload's explicit voiceProfileId always wins over the auto-pick.
 */
export function singInMyVoiceEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.AFROONE_SING_IN_MY_VOICE !== '0';
}

/** Newest READY, consent-active voice profile in the workspace (the auto-pick
 *  for Target C). Null — never a throw — when the shelf has no trained voice. */
async function newestReadyVoiceProfileId(
  workspaceId: string
): Promise<string | null> {
  const profile = await prisma.voiceProfile.findFirst({
    where: {
      workspaceId,
      status: 'READY',
      consent: { workspaceId, revokedAt: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return profile?.id ?? null;
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
    // VOICE SELECTION (Target C): the payload's explicit profile is law; when
    // absent, the newest READY workspace profile is auto-picked (kill switch
    // AFROONE_SING_IN_MY_VOICE=0). The auto path is FAIL-OPEN end to end — a
    // broken profile or a failed conversion ships the studio voice with an
    // honest note, never a dead render. An EXPLICIT profile keeps the original
    // hard-fail law: the user asked for that voice; shipping another silently
    // would be a lie.
    let voice = await loadPersonalVoice(
      payload.workspaceId,
      payload.voiceProfileId
    );
    let voiceSource: 'payload' | 'auto' | null = voice ? 'payload' : null;
    let attemptedVoiceProfileId: string | null = voice?.id ?? null;
    let voiceNote: string | null = null;
    if (!voice && singInMyVoiceEnabled()) {
      try {
        const autoId = await newestReadyVoiceProfileId(payload.workspaceId);
        if (autoId) {
          attemptedVoiceProfileId = autoId;
          voice = await loadPersonalVoice(payload.workspaceId, autoId);
          voiceSource = 'auto';
        }
      } catch (error) {
        voiceNote = `sung in the studio voice — voice conversion skipped: ${
          (error as Error)?.message ?? 'voice profile unavailable'
        }`;
        voice = null;
        voiceSource = null;
      }
    }
    let voiceSignature = voice ? personalVoiceSignature(voice) : null;
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
    let voiceConverted = false;
    if (voice) {
      try {
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
          voice.id
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
        voiceConverted = true;
      } catch (error) {
        // Explicit request → the original hard-fail law stands. Auto-pick →
        // fail-open: the studio voice ships with the honest note.
        if (voiceSource !== 'auto') throw error;
        voiceNote = `sung in the studio voice — voice conversion skipped: ${
          (error as Error)?.message ?? 'conversion failed'
        }`;
        voice = null;
        voiceSource = null;
        voiceSignature = null;
      }
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
    // VOCAL-FORWARD RECEIPT (Target A4) — every field measured or a faithful
    // record of the chain that ran; null only when there was no instrumental.
    let vocalForward: {
      bedLufs: number | null;
      vocalLufs: number | null;
      targetOffsetDb: number;
      appliedVocalGainDb: number;
      loudnessMatched: boolean;
      ducked: boolean;
      mastered: boolean;
      masterPreset: string | null;
      note?: string;
    } | null = null;
    if (instrumental) {
      const instrumentalBytes = await downloadToBuffer(instrumental.url, {
        maxBytes: 256 * 1024 * 1024,
      });
      // A1 — MEASURE, then gain-stage the vocal to a fixed audible offset
      // ABOVE the bed (the old static 1.0/1.1 weights left the separated stem
      // at whatever level it happened to arrive — "the voice is behind").
      const [bedQc, vocalQc] = await Promise.all([
        measureAudioBufferQuality(instrumentalBytes).catch(() => null),
        measureAudioBufferQuality(isolatedBytes).catch(() => null),
      ]);
      const targetOffsetDb = afroOneVocalOffsetDb();
      const { gainDb, matched } = vocalGainDbFromLufs(
        bedQc?.integratedLufs ?? null,
        vocalQc?.integratedLufs ?? null,
        targetOffsetDb
      );
      // A2 — the bed ducks under the vocal (sidechaincompress keyed by the
      // voice); A3 prep — subtle early-reflection treatment replaces the 60ms
      // slapback inside the vocal chain.
      const mixedBytes = await mixdownVocalForward({
        beat: instrumentalBytes,
        vocal: isolatedBytes,
        vocalGainDb: gainDb,
      });
      // A3 — the sung mix meets the SAME two-pass master chain instrumental
      // beds get (genre tone curve included). Fail-open: an unmasterable mix
      // ships un-mastered with the honest note, never dies here.
      let shippedBytes = mixedBytes;
      let mastered = false;
      let masterNote: string | undefined;
      try {
        const masteredMix = await master({
          mix: mixedBytes,
          preset: 'afro_stream_-9',
          genre: payload.genre,
        });
        shippedBytes = masteredMix.wav;
        mastered = true;
      } catch (error) {
        masterNote = `master failed — un-mastered mix shipped (${
          (error as Error)?.message ?? 'unknown'
        })`;
      }
      vocalForward = {
        bedLufs: bedQc?.integratedLufs ?? null,
        vocalLufs: vocalQc?.integratedLufs ?? null,
        targetOffsetDb,
        appliedVocalGainDb: gainDb,
        loudnessMatched: matched,
        ducked: true,
        mastered,
        masterPreset: mastered ? 'afro_stream_-9' : null,
        ...(masterNote
          ? { note: masterNote }
          : matched
            ? {}
            : { note: 'bed/vocal loudness unmeasurable — vocal mixed at unity gain' }),
      };
      finishedMix = await certifyAudioBytes({
        workspaceId: payload.workspaceId,
        kind: 'mixes',
        bytes: shippedBytes,
        contentType: 'audio/wav',
        ext: 'wav',
      });
      createdUrls.add(finishedMix.url);
    }
    const persistenceVoice = voice
      ? await loadPersonalVoice(payload.workspaceId, voice.id)
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
            // SING-IN-MY-VOICE receipt (Target C): which profile was used or
            // attempted, whether the timbre conversion actually happened, and
            // the honest note when the auto path failed open.
            voiceConversion: {
              enabled: singInMyVoiceEnabled(),
              voiceProfileId: persistenceVoice?.id ?? attemptedVoiceProfileId,
              source: voiceSource,
              converted: voiceConverted,
              ...(voiceNote ? { note: voiceNote } : {}),
            },
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
              preset: 'afroone-vocal-forward',
              url: finishedMix.url,
              notes: [
                'AfroOne owned instrumental with a genuine generated singing performance.',
                'Vocal loudness-matched over the bed, bed ducked under the voice' +
                  (vocalForward?.mastered ? ', full mix mastered (afro_stream_-9).' : '.'),
                ...(vocalForward?.note ? [vocalForward.note] : []),
                ...(voiceConverted
                  ? ["Sung in the artist's own trained voice (voice conversion)."]
                  : voiceNote
                    ? [voiceNote]
                    : []),
              ].join(' '),
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
                // Target A4 receipts: vocalLufs/bedLufs/appliedOffsetDb +
                // ducked/mastered, all measured — never a guess.
                vocalForward,
                voiceConversion: {
                  voiceProfileId:
                    persistenceVoice?.id ?? attemptedVoiceProfileId,
                  source: voiceSource,
                  converted: voiceConverted,
                  ...(voiceNote ? { note: voiceNote } : {}),
                },
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
            // SOUNDWAVE2 receipts ride the job output so the own-engine's
            // render meta/notes carry them without re-reading the rows.
            vocalForward,
            voiceConversion: {
              voiceProfileId: persistenceVoice?.id ?? attemptedVoiceProfileId,
              source: voiceSource,
              converted: voiceConverted,
              ...(voiceNote ? { note: voiceNote } : {}),
            },
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
