import type { FastifyInstance } from 'fastify';
import {
  loadReleaseCertification,
  normalizeSplitSheet,
  prisma,
  releaseEvidenceHash,
} from '@afrohit/db';
import { laneReleaseGate, rightsInputSchema } from '@afrohit/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { presignAssetRef } from '../lib/storage';
import { authenticRefCount, unseededForLane } from '../lib/lane-report';
import { distributeRelease } from '../lib/distribution';
import { BLOW_TARGET } from '../lib/will-it-blow';

type ReleaseMode = 'creative' | 'hitmaker';
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function modeFromQuery(query: unknown): ReleaseMode {
  return (query as { mode?: string } | null)?.mode === 'hitmaker' ? 'hitmaker' : 'creative';
}

async function assignIsrc(workspaceId: string): Promise<string | null> {
  const prefix = (process.env.ISRC_PREFIX ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (prefix.length !== 5) return null;
  const year = String(new Date().getFullYear()).slice(2);
  const sequence = (await prisma.song.count({
    where: { workspaceId, isrc: { not: null } },
  })) + 1;
  return [
    prefix.slice(0, 2),
    prefix.slice(2),
    year,
    String(sequence).padStart(5, '0'),
  ].join('-');
}

async function assignUpc(workspaceId: string): Promise<string | null> {
  const prefix = (process.env.GS1_PREFIX ?? '').replace(/[^0-9]/g, '');
  if (prefix.length < 6 || prefix.length > 11) return null;
  const sequence = (await prisma.song.count({
    where: { workspaceId, upc: { not: null } },
  })) + 1;
  const body = (prefix + String(sequence).padStart(11 - prefix.length, '0')).slice(0, 11);
  const sum = body.split('').reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return body + String((10 - (sum % 10)) % 10);
}

async function statusFor(options: {
  workspaceId: string;
  projectId: string;
  songId: string;
  mode: ReleaseMode;
}) {
  const certification = await loadReleaseCertification(prisma, {
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    songId: options.songId,
    hitTarget: BLOW_TARGET,
  });
  const [beat, unseeded, authenticReferences, currentSong, latestExport, latestCover] = await Promise.all([
    prisma.beatAsset.findFirst({
      where: { songId: options.songId },
      orderBy: { createdAt: 'desc' },
      select: { meta: true },
    }),
    unseededForLane(certification.song.project.genre),
    authenticRefCount(options.workspaceId, certification.song.project.genre),
    prisma.song.findUnique({
      where: { id: options.songId },
      select: { releaseReady: true },
    }),
    prisma.export.findFirst({
      where: { songId: options.songId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        qualityState: true,
        contentHash: true,
        sizeBytes: true,
        receiptId: true,
        sourceFingerprint: true,
        verifiedAt: true,
        createdAt: true,
        manifest: true,
      },
    }),
    prisma.imageAsset.findFirst({
      where: { projectId: options.projectId, kind: 'cover' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const beatMeta = record(beat?.meta);
  const audioMeta = record(certification.audio?.meta);
  const releaseGate = laneReleaseGate({
    compliance: (beatMeta?.compliance ?? null) as never,
    qc: (audioMeta?.qc ?? beatMeta?.qc ?? null) as never,
    mode: options.mode,
    lexicon: { unseeded },
    profile: { authenticRefs: authenticReferences, required: 3 },
  });
  const canonicalReady = certification.readiness.ready;
  if (currentSong && currentSong.releaseReady !== canonicalReady) {
    await prisma.song.update({
      where: { id: options.songId },
      data: { releaseReady: canonicalReady },
    });
  }
  const displayedCover = certification.cover ?? latestCover;
  const coverPlaybackUrl = displayedCover
    ? await presignAssetRef(displayedCover.url, 900)
    : null;
  const exportManifest = record(latestExport?.manifest);
  const exportCurrent = !!latestExport
    && latestExport.qualityState === 'ready'
    && exportManifest?.artifactFingerprint === certification.artifactFingerprint
    && latestExport.receiptId === certification.rightsReceipt?.id;

  return {
    song: {
      id: certification.song.id,
      title: certification.song.title,
      isrc: certification.song.isrc,
      upc: certification.song.upc,
      splitSheet: certification.splitSheet,
      releaseReady: canonicalReady,
      nativeReviewOk: certification.evidence.nativeAttested,
    },
    mode: options.mode,
    greenLight: {
      ready: canonicalReady && !releaseGate.blocked,
      checks: certification.readiness.checks,
      needsReview: certification.requiredNativeLanguages.length > 0,
    },
    releaseGate,
    evidence: {
      artifactFingerprint: certification.artifactFingerprint,
      receiptHashValid: certification.evidence.receiptHashValid,
      receiptCurrent: certification.evidence.receiptCurrent,
      splitAttested: certification.evidence.splitAttested,
      nativeAttested: certification.evidence.nativeAttested,
      requiredNativeLanguages: certification.requiredNativeLanguages,
    },
    assets: {
      audio: certification.audio
        ? {
            id: certification.audio.id,
            kind: certification.audio.kind,
            qualityState: certification.audio.qualityState,
            contentHash: certification.audio.contentHash,
            verifiedAt: certification.audio.verifiedAt,
          }
        : null,
      cover: displayedCover
        ? {
            id: displayedCover.id,
            width: displayedCover.width,
            height: displayedCover.height,
            approved: displayedCover.approved,
            qualityState: displayedCover.qualityState,
            contentHash: displayedCover.contentHash,
            verifiedAt: displayedCover.verifiedAt,
            playbackUrl: coverPlaybackUrl,
          }
        : null,
      lyric: certification.lyric
        ? {
            id: certification.lyric.id,
            approved: certification.lyric.approved,
          }
        : null,
    },
    rightsReceipt: certification.rightsReceipt
      ? {
          id: certification.rightsReceipt.id,
          hash: certification.rightsReceipt.hash,
          createdAt: certification.rightsReceipt.createdAt,
          risk: certification.evidence.rightsRisk,
          okToExport: certification.evidence.rightsOk,
        }
      : null,
    latestExport: latestExport
      ? {
          id: latestExport.id,
          qualityState: latestExport.qualityState,
          contentHash: latestExport.contentHash,
          sizeBytes: latestExport.sizeBytes,
          verifiedAt: latestExport.verifiedAt,
          createdAt: latestExport.createdAt,
          current: exportCurrent,
          downloadPath: exportCurrent
            ? '/projects/' + options.projectId + '/exports/' + latestExport.id + '/download'
            : null,
        }
      : null,
  };
}

export default async function release(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({
      where: { id: req.params.projectId, workspaceId },
    });
    const song = await prisma.song.findFirst({
      where: { projectId: req.params.projectId, workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!song) return { song: null, greenLight: null };
    return statusFor({
      workspaceId,
      projectId: req.params.projectId,
      songId: song.id,
      mode: modeFromQuery(req.query),
    });
  });

  app.get<{ Params: { projectId: string; songId: string } }>(
    '/:songId/performance',
    async (req) => {
      const { workspaceId } = requireAuth(req);
      const song = await prisma.song.findFirstOrThrow({
        where: {
          id: req.params.songId,
          projectId: req.params.projectId,
          workspaceId,
        },
      });
      const [beat, master, snippet] = await Promise.all([
        prisma.beatAsset.findFirst({
          where: {
            songId: song.id,
            approved: true,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.master.findFirst({
          where: {
            songId: song.id,
            approved: true,
            qualityState: 'passed',
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.videoRender.findFirst({
          where: { projectId: song.projectId, provider: 'snippet', approved: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const bakedVocalProviders = new Set(['suno', 'ace_step', 'minimax']);
      const instrumental = beat && !bakedVocalProviders.has(beat.provider) ? beat.url : null;
      return {
        title: song.title,
        bpm: beat?.bpm ?? null,
        key: beat?.keySignature ?? null,
        backingTrack: instrumental,
        fullMaster: master?.url ?? null,
        visualizer: snippet?.url ?? null,
        certified: !!master,
      };
    },
  );

  app.get<{ Params: { projectId: string; songId: string } }>('/:songId', async (req) => {
    const { workspaceId } = requireAuth(req);
    return statusFor({
      workspaceId,
      projectId: req.params.projectId,
      songId: req.params.songId,
      mode: modeFromQuery(req.query),
    });
  });

  app.patch<{ Params: { projectId: string; songId: string } }>(
    '/:songId',
    { schema: { body: rightsInputSchema } },
    async (req, reply) => {
      const { workspaceId, userId } = requireRole(req, ['OWNER', 'ADMIN']);
      const input = rightsInputSchema.parse(req.body);
      const song = await prisma.song.findFirst({
        where: {
          id: req.params.songId,
          projectId: req.params.projectId,
          workspaceId,
        },
      });
      if (!song) return reply.code(404).send({ error: 'song_not_found' });

      const splitSheet = normalizeSplitSheet(input.splitSheet ?? song.splitSheet);
      const splitTotal = splitSheet.reduce((total, split) => total + split.share, 0);
      const splitsValid = splitSheet.length > 0 && Math.abs(splitTotal - 100) < 0.01;
      if (input.acceptSplits && !splitsValid) {
        return reply.code(400).send({
          error: 'invalid_split_sheet',
          message: 'Accepted splits must have at least one contributor and total exactly 100%.',
          total: splitTotal,
        });
      }
      const isrc = input.isrc ?? song.isrc ?? (splitsValid ? await assignIsrc(workspaceId) : null);
      const upc = input.upc ?? song.upc ?? (splitsValid ? await assignUpc(workspaceId) : null);

      await prisma.$transaction(async (tx) => {
        await tx.song.update({
          where: { id: song.id },
          data: {
            splitSheet: splitSheet as never,
            isrc,
            upc,
            releaseReady: false,
            ...(input.revokeNativeReview ? { nativeReviewOk: false } : {}),
            ...(input.nativeReview ? { nativeReviewOk: true } : {}),
          },
        });
        if (input.acceptSplits) {
          const splitPayload = { splitSheet, accepted: true };
          await tx.releaseAttestation.create({
            data: {
              workspaceId,
              projectId: song.projectId,
              songId: song.id,
              kind: 'split_sheet',
              payload: splitPayload as never,
              hash: releaseEvidenceHash(splitPayload),
              attestedBy: userId,
            },
          });
        }
        if (input.revokeNativeReview) {
          await tx.releaseAttestation.deleteMany({
            where: { songId: song.id, kind: 'native_language' },
          });
        }
        if (input.nativeReview) {
          const nativePayload = {
            reviewerName: input.nativeReview.reviewerName,
            languages: [...new Set(input.nativeReview.languages.map((language) => language.toLowerCase()))].sort(),
            attested: true,
            notes: input.nativeReview.notes ?? null,
          };
          await tx.releaseAttestation.create({
            data: {
              workspaceId,
              projectId: song.projectId,
              songId: song.id,
              kind: 'native_language',
              payload: nativePayload as never,
              hash: releaseEvidenceHash(nativePayload),
              attestedBy: userId,
            },
          });
        }
      });

      const status = await statusFor({
        workspaceId,
        projectId: song.projectId,
        songId: song.id,
        mode: modeFromQuery(req.query),
      });
      if (status.song.releaseReady) {
        const { assembleProofPack } = await import('../lib/proof-pack');
        const proofPack = await assembleProofPack(workspaceId, song.id).catch(() => null);
        if (proofPack) {
          await prisma.song.update({
            where: { id: song.id },
            data: { proofPack: proofPack as never },
          }).catch(() => undefined);
        }
      }
      return status;
    },
  );

  app.post<{ Params: { projectId: string; songId: string } }>(
    '/:songId/distribute',
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ['OWNER', 'ADMIN']);
      const certification = await loadReleaseCertification(prisma, {
        workspaceId,
        projectId: req.params.projectId,
        songId: req.params.songId,
        hitTarget: BLOW_TARGET,
      });
      if (!certification.readiness.ready || !certification.audio || !certification.cover) {
        return reply.code(409).send({
          error: 'not_release_ready',
          checks: certification.readiness.checks,
        });
      }
      const releaseExport = await prisma.export.findFirst({
        where: {
          songId: certification.song.id,
          qualityState: 'ready',
          archiveUrl: { not: null },
          contentHash: { not: null },
          receiptId: certification.rightsReceipt?.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      const manifest = record(releaseExport?.manifest);
      if (!releaseExport || manifest?.artifactFingerprint !== certification.artifactFingerprint) {
        return reply.code(409).send({
          error: 'current_release_package_required',
          message: 'Build a fresh verified release package before distribution.',
        });
      }

      const result = await distributeRelease({
        title: certification.song.title,
        artist: certification.song.project.artist.stageName,
        genre: certification.song.project.genre,
        isrc: certification.song.isrc,
        upc: certification.song.upc,
        audioUrl: await presignAssetRef(certification.audio.url, 3600),
        coverUrl: await presignAssetRef(certification.cover.url, 3600),
      });
      if (result.status === 'not_configured') {
        return reply.code(501).send({
          error: 'distribution_adapter_not_configured',
          ...result,
        });
      }
      if (result.status !== 'submitted') {
        return reply.code(502).send({ error: 'distribution_failed', ...result });
      }

      await prisma.$transaction([
        prisma.release.upsert({
          where: { songId: certification.song.id },
          create: {
            workspaceId,
            artistId: (await prisma.project.findUniqueOrThrow({
              where: { id: certification.song.projectId },
              select: { artistId: true },
            })).artistId,
            songId: certification.song.id,
            isrc: certification.song.isrc,
            upc: certification.song.upc,
            releaseDate: new Date(),
            distributor: result.provider,
            status: 'released',
            channels: (result as { channels?: unknown }).channels as never,
          },
          update: {
            status: 'released',
            distributor: result.provider,
            releaseDate: new Date(),
          },
        }),
        prisma.song.update({
          where: { id: certification.song.id },
          data: { status: 'RELEASED' },
        }),
      ]);
      await prisma.analyticsEvent.create({
        data: {
          workspaceId,
          name: 'release.distribute',
          properties: {
            songId: certification.song.id,
            exportId: releaseExport.id,
            provider: result.provider,
            status: result.status,
          } as never,
        },
      }).catch(() => undefined);
      return result;
    },
  );
}
