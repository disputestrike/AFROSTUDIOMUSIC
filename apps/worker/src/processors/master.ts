import { Prisma, prisma } from '@afrohit/db';
import { assertStoredContentHash, certifyAudioBytes } from '../lib/certified-assets';
import {
  ffmpegAvailable,
  master as ffmpegMaster,
  masterReferenceDelta,
  MASTER_TARGETS,
  NATIVE_AUDIO_LIMITS,
  type AudioQuality,
  type MasterRenderReport,
} from '../lib/ffmpeg';
import { markFailed, markRunning } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer } from '../lib/storage';
import { enqueueReleaseKit } from '../lib/release-kit';
import { enqueueGenerateVisuals } from '../lib/visuals';

interface MasterPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string;
  mixId?: string;
  preset: string;
  finished?: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * MASTER REPORT — the measured verdict of what shipped: loudness, peak,
 * dynamics, spectral tilt, stereo correlation, plus the delta against this
 * lane's rights-cleared reference vector when one exists (numbers only — see
 * the reference-seam contract in ffmpeg.ts). When the render itself supplied a
 * MasterRenderReport, its measured drive passes and applied match-EQ ride
 * along. Null fields mean "unmeasured", never a guess. Exported so the
 * re-certification sweep and the test harness build the exact same shape.
 */
export function buildMasterReport(
  qc: AudioQuality,
  genre: string | undefined,
  render?: MasterRenderReport | null,
): Record<string, unknown> {
  return {
    lufs: qc.integratedLufs,
    dBTP: qc.truePeakDb,
    lra: qc.loudnessRangeLra,
    crest: qc.crestFactorDb,
    tilt: qc.spectralTiltDbPerOct,
    correlation: qc.stereoCorrelation,
    referenceDelta: masterReferenceDelta(genre, qc),
    ...(render
      ? { drivePasses: render.drivePasses, appliedMatchEq: render.appliedMatchEq }
      : {}),
  };
}

export function isAttestedDirectUpload(meta: unknown): boolean {
  const direct = record(record(meta)?.directOwnedUpload);
  const rights = record(direct?.rightsConfirmation);
  return (
    direct?.schemaVersion === 1
    && (direct.sourceKind === 'workspace_upload' || direct.sourceKind === 'url_import')
    && rights?.version === 1
    && rights.confirmed === true
  );
}

export async function processMaster(payload: MasterPayload): Promise<void> {
  await markRunning(payload.jobId);
  const uploaded: string[] = [];
  try {
    if (!(await ffmpegAvailable())) {
      throw new Error('ffmpeg binary not found on worker host');
    }
    let mix = payload.mixId
      ? await prisma.mix.findFirstOrThrow({
          where: {
            id: payload.mixId,
            songId: payload.songId,
            projectId: payload.projectId,
            project: { workspaceId: payload.workspaceId },
          },
        })
      : await prisma.mix.findFirstOrThrow({
          where: {
            songId: payload.songId,
            projectId: payload.projectId,
            project: { workspaceId: payload.workspaceId },
            approved: true,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        });

    const sourceBytes = await downloadToBuffer(mix.url, {
      maxBytes: NATIVE_AUDIO_LIMITS.remoteInputMaxBytes,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    const sourceAlreadyCertified =
      mix.approved
      && mix.qualityState === 'passed'
      && typeof mix.contentHash === 'string'
      && /^[a-f0-9]{64}$/i.test(mix.contentHash)
      && !!mix.verifiedAt;
    // THE CIRCULAR TRAP, WORKER HALF (2026-07-16): certification is produced
    // HERE, so a legacy (pre-certification-era) source must be allowed in — the
    // API marks such a wrapper mix with sourceCertification:'unverified-legacy'
    // and this run certifies the actual source bytes (hash + QC) before
    // mastering them. The lineage keeps releaseLineageCertified:false so the
    // release gate stays exactly as strict as before.
    const legacySource =
      record(mix.meta)?.sourceCertification === 'unverified-legacy';
    if (sourceAlreadyCertified) {
      assertStoredContentHash(sourceBytes, mix.contentHash, 'master_source_mix');
    } else {
      if (
        !legacySource
        && (
          !payload.finished
          || !['uploaded', 'imported'].includes(mix.preset)
          || !isAttestedDirectUpload(mix.meta)
        )
      ) {
        throw new Error('master_source_mix_not_certified');
      }
      const certifiedSource = await certifyAudioBytes({
        workspaceId: payload.workspaceId,
        kind: 'mixes',
        bytes: sourceBytes,
      });
      uploaded.push(certifiedSource.url);
      const existingMeta = record(mix.meta) ?? {};
      const directOwnedUpload = record(existingMeta.directOwnedUpload) ?? {};
      mix = await prisma.mix.update({
        where: { id: mix.id },
        data: {
          url: certifiedSource.url,
          qualityState: certifiedSource.qualityState,
          contentHash: certifiedSource.contentHash,
          verifiedAt: certifiedSource.verifiedAt,
          approved: true,
          meta: {
            ...existingMeta,
            // A legacy catalog source is NOT a direct owned upload — never
            // fabricate that attestation; its own honest marker (already in
            // existingMeta) travels instead.
            ...(legacySource
              ? {}
              : {
                  directOwnedUpload: {
                    ...directOwnedUpload,
                    sourceContentHash: certifiedSource.contentHash,
                    certifiedAt: certifiedSource.verifiedAt.toISOString(),
                  },
                }),
            qc: certifiedSource.qc,
            releaseLineageCertified: false,
          } as never,
        },
      });
      uploaded.splice(uploaded.indexOf(certifiedSource.url), 1);
    }
    const finished =
      payload.finished || mix.preset === 'uploaded' || mix.preset === 'imported';
    // The project's lane drives the per-genre mastering tone curve (amapiano's
    // low-mid control is not afrobeats' percussion presence). Best-effort read:
    // a missing project/genre falls back to the default curve inside master().
    const project = await prisma.project.findUnique({
      where: { id: payload.projectId },
      select: { genre: true },
    });
    const genre = project?.genre ?? undefined;
    const rendered = await ffmpegMaster({
      mix: sourceBytes,
      preset: payload.preset,
      finished,
      genre,
    });
    const certified = await certifyAudioBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: rendered.wav,
    });
    uploaded.push(certified.url);
    const certifiedMp3 = await certifyAudioBytes({
      workspaceId: payload.workspaceId,
      kind: 'masters',
      bytes: rendered.mp3,
      contentType: 'audio/mpeg',
      ext: 'mp3',
    });
    uploaded.push(certifiedMp3.url);

    // Fallback preset MUST match what ffmpeg.ts master() actually renders with
    // ('afro_stream_-9'). It used to record 'streaming_lufs_-14' here while the
    // render ran the -9 chain — the stored target was a fabricated number the
    // audio never aimed at (honesty law: the record states what happened).
    const target = MASTER_TARGETS[payload.preset] ?? MASTER_TARGETS['afro_stream_-9']!;
    // The report card of what shipped (see buildMasterReport above) — including
    // the render's own measured drive passes (LRA density iteration) and the
    // clamped match-EQ it applied (null while references are absent).
    const masterReport = buildMasterReport(certified.qc, genre, rendered.report);
    const master = await prisma.$transaction(async (tx) => {
      const created = await tx.master.create({
        data: {
          projectId: payload.projectId,
          songId: payload.songId,
          mixId: mix.id,
          preset: payload.preset,
          url: certified.url,
          loudness: certified.qc.integratedLufs ?? target.lufs,
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            masterReport,
            genre: genre ?? null,
            sourceMixId: mix.id,
            sourceContentHash: mix.contentHash,
            // Honest lineage: this master's source predated certification.
            // The master itself IS certified (hashed + QC'd above).
            ...(legacySource ? { sourceCertification: 'unverified-legacy' } : {}),
            releaseLineageCertified:
              record(mix.meta)?.releaseLineageCertified === true,
            deliveryMp3: {
              url: certifiedMp3.url,
              contentHash: certifiedMp3.contentHash,
              qualityState: certifiedMp3.qualityState,
              verifiedAt: certifiedMp3.verifiedAt.toISOString(),
              qc: certifiedMp3.qc,
            },
          } as never,
        },
      });
      await tx.song.update({
        where: { id: payload.songId },
        data: {
          status: 'MASTERED',
          releaseReady: false,
          instrumentalUrl: null,
          acapellaUrl: null,
          instrumentalMeta: Prisma.DbNull,
        },
      });
      await tx.providerJob.update({
        where: { id: payload.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            masterId: created.id,
            wavUrl: certified.url,
            mp3Url: certifiedMp3.url,
            targetLufs: target.lufs,
            measuredLufs: certified.qc.integratedLufs,
            qualityState: certified.qualityState,
            contentHash: certified.contentHash,
          } as never,
        },
      });
      return created;
    });
    void master;
    uploaded.length = 0;
    // AUTO RELEASE KIT (owner: "we did not see it") — the song is now mastered;
    // build its full release kit in the background so the tab opens populated.
    // Idempotent + fail-soft; never fails this master.
    await enqueueReleaseKit({ songId: payload.songId, workspaceId: payload.workspaceId, reason: 'song-mastered' });
    // AUTO-VISUALS (Phase 3): the song is mastered — build the lyric video +
    // visualizer + thumbnails off it. Fail-soft; never fails this master.
    await enqueueGenerateVisuals({ songId: payload.songId, workspaceId: payload.workspaceId, reason: 'song-mastered' });
  } catch (error) {
    await Promise.allSettled(uploaded.map((url) => deleteObjectByUrl(url)));
    await markFailed(payload.jobId, error);
  }
}
