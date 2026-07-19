import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  loadReleaseCertification,
  normalizeSplitSheet,
  prisma,
  Prisma,
  releaseEvidenceHash,
} from "@afrohit/db";
import { laneReleaseGate, rightsInputSchema } from "@afrohit/shared";
import { requireAuth, requireRole } from "../middleware/auth";
import { presignAssetRef } from "../lib/storage";
import { authenticRefCount, unseededForLane } from "../lib/lane-report";
import {
  distributeRelease,
  distributionConfigurationStatus,
  distributionLifecycleDiagnostics,
} from "../lib/distribution";
import { BLOW_TARGET } from "../lib/will-it-blow";

type ReleaseMode = "creative" | "hitmaker";
type JsonRecord = Record<string, unknown>;
type Transaction = Prisma.TransactionClient;

const LOCKED_RELEASE_STATUSES = new Set([
  "submitting",
  "submitted",
  "accepted",
  "live",
]);

const artworkSelectionSchema = z
  .object({ imageAssetId: z.string().min(1).max(200) })
  .strict();

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

type ReleasePackageEvidence = {
  qualityState: string;
  archiveUrl: string | null;
  contentHash: string | null;
  sourceFingerprint: string | null;
  receiptId: string | null;
  verifiedAt: Date | null;
  manifest: unknown;
};

export function releasePackageIsCurrent(
  releaseExport: ReleasePackageEvidence | null | undefined,
  expectation: { artifactFingerprint: string; receiptId: string }
): boolean {
  const manifest = record(releaseExport?.manifest);
  return (
    !!releaseExport &&
    releaseExport.qualityState === "ready" &&
    !!releaseExport.archiveUrl &&
    !!releaseExport.contentHash &&
    !!releaseExport.sourceFingerprint &&
    !!releaseExport.verifiedAt &&
    releaseExport.receiptId === expectation.receiptId &&
    manifest?.sourceFingerprint === releaseExport.sourceFingerprint &&
    manifest?.artifactFingerprint === expectation.artifactFingerprint &&
    manifest?.receiptId === expectation.receiptId
  );
}

export function publicReleaseRevisionSnapshot(revision: {
  id: string;
  revision: number;
  status: string;
  snapshot: unknown;
  createdAt: Date;
}) {
  const snapshot = record(revision.snapshot);
  const audio = record(snapshot?.audio);
  const cover = record(snapshot?.cover);
  const releaseExport = record(snapshot?.export);
  const distribution = record(snapshot?.distribution);
  return {
    id: revision.id,
    revision: revision.revision,
    status: revision.status,
    createdAt: revision.createdAt,
    metadata: {
      title: typeof snapshot?.title === "string" ? snapshot.title : null,
      artistName:
        typeof snapshot?.artistName === "string" ? snapshot.artistName : null,
      genre: typeof snapshot?.genre === "string" ? snapshot.genre : null,
    },
    identifiers: {
      isrc: typeof snapshot?.isrc === "string" ? snapshot.isrc : null,
      upc: typeof snapshot?.upc === "string" ? snapshot.upc : null,
    },
    package: {
      audioAssetId:
        typeof audio?.assetId === "string" ? audio.assetId : null,
      audioAssetKind: typeof audio?.kind === "string" ? audio.kind : null,
      coverAssetId:
        typeof cover?.assetId === "string" ? cover.assetId : null,
      exportId:
        typeof releaseExport?.exportId === "string"
          ? releaseExport.exportId
          : null,
      artifactFingerprint:
        typeof releaseExport?.artifactFingerprint === "string"
          ? releaseExport.artifactFingerprint
          : null,
      evidenceHash:
        typeof releaseExport?.evidenceHash === "string"
          ? releaseExport.evidenceHash
          : null,
    },
    distribution: {
      status:
        typeof distribution?.status === "string"
          ? distribution.status
          : revision.status,
      provider:
        typeof distribution?.provider === "string"
          ? distribution.provider
          : null,
      externalId:
        typeof distribution?.externalId === "string"
          ? distribution.externalId
          : null,
      channels: record(distribution?.channels),
      submittedAt:
        typeof distribution?.submittedAt === "string"
          ? distribution.submittedAt
          : null,
      statusAt:
        typeof distribution?.statusAt === "string"
          ? distribution.statusAt
          : null,
      liveAt:
        typeof distribution?.liveAt === "string" ? distribution.liveAt : null,
      releaseDate:
        typeof distribution?.releaseDate === "string"
          ? distribution.releaseDate
          : null,
    },
  };
}

function modeFromQuery(query: unknown): ReleaseMode {
  return (query as { mode?: string } | null)?.mode === "hitmaker"
    ? "hitmaker"
    : "creative";
}

async function nextIdentifierValue(
  tx: Transaction,
  namespace: string
): Promise<number> {
  const rows = await tx.$queryRaw(Prisma.sql`
    INSERT INTO "ReleaseIdentifierSequence" ("namespace", "value", "updatedAt")
    VALUES (${namespace}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("namespace") DO UPDATE
    SET
      "value" = "ReleaseIdentifierSequence"."value" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "value"
  `);
  const value = (rows as Array<{ value: number }>)[0]?.value;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("release_identifier_sequence_failed");
  }
  return Number(value);
}

export function formatIsrc(
  prefix: string,
  year: number,
  sequence: number
): string | null {
  const normalized = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (
    normalized.length !== 5 ||
    !Number.isInteger(year) ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > 99_999
  ) {
    return null;
  }
  return [
    normalized.slice(0, 2),
    normalized.slice(2),
    String(year).slice(-2).padStart(2, "0"),
    String(sequence).padStart(5, "0"),
  ].join("-");
}

export function formatUpc(prefix: string, sequence: number): string | null {
  const normalized = prefix.replace(/[^0-9]/g, "");
  if (
    normalized.length < 6 ||
    normalized.length > 10 ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    return null;
  }
  const width = 11 - normalized.length;
  if (sequence >= 10 ** width) return null;
  const body = normalized + String(sequence).padStart(width, "0");
  const sum = body.split("").reduce(
    (total, digit, index) =>
      total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0
  );
  return body + String((10 - (sum % 10)) % 10);
}

export async function assignIsrc(
  tx: Transaction,
  now = new Date()
): Promise<string | null> {
  const prefix = (process.env.ISRC_PREFIX ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (prefix.length !== 5) return null;
  const year = now.getUTCFullYear();
  const namespace = `isrc:${prefix}:${String(year).slice(-2)}`;
  for (;;) {
    const sequence = await nextIdentifierValue(tx, namespace);
    const candidate = formatIsrc(prefix, year, sequence);
    if (!candidate) throw new Error("isrc_sequence_exhausted");
    const [song, release] = await Promise.all([
      tx.song.findUnique({ where: { isrc: candidate }, select: { id: true } }),
      tx.release.findUnique({ where: { isrc: candidate }, select: { id: true } }),
    ]);
    if (!song && !release) return candidate;
  }
}

export async function assignUpc(tx: Transaction): Promise<string | null> {
  const prefix = (process.env.GS1_PREFIX ?? "").replace(/[^0-9]/g, "");
  if (prefix.length < 6 || prefix.length > 10) return null;
  const namespace = `upc:${prefix}`;
  for (;;) {
    const sequence = await nextIdentifierValue(tx, namespace);
    const candidate = formatUpc(prefix, sequence);
    if (!candidate) throw new Error("upc_sequence_exhausted");
    const [song, release] = await Promise.all([
      tx.song.findUnique({ where: { upc: candidate }, select: { id: true } }),
      tx.release.findUnique({ where: { upc: candidate }, select: { id: true } }),
    ]);
    if (!song && !release) return candidate;
  }
}

export function artworkBelongsToSong(
  artwork: { projectId: string | null; kind: string },
  song: { projectId: string }
): boolean {
  return artwork.kind === "cover" && artwork.projectId === song.projectId;
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
  const [
    beat,
    unseeded,
    authenticReferences,
    currentSong,
    latestExport,
    latestRelease,
  ] = await Promise.all([
    prisma.beatAsset.findFirst({
      where: { songId: options.songId },
      orderBy: { createdAt: "desc" },
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
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        qualityState: true,
        archiveUrl: true,
        contentHash: true,
        sizeBytes: true,
        receiptId: true,
        sourceFingerprint: true,
        verifiedAt: true,
        createdAt: true,
        manifest: true,
      },
    }),
    prisma.release.findFirst({
      where: { songId: options.songId, workspaceId: options.workspaceId },
      select: {
        id: true,
        revision: true,
        projectId: true,
        status: true,
        distributor: true,
        externalId: true,
        channels: true,
        submittedAt: true,
        distributionStatusAt: true,
        liveAt: true,
        coverAssetId: true,
        audioAssetId: true,
        audioAssetKind: true,
        exportId: true,
        artifactFingerprint: true,
        evidenceHash: true,
        _count: { select: { events: true } },
        events: {
          orderBy: { occurredAt: "desc" },
          take: 10,
          select: {
            eventId: true,
            status: true,
            applied: true,
            occurredAt: true,
            receivedAt: true,
          },
        },
        coverAsset: {
          select: {
            id: true,
            projectId: true,
            kind: true,
            url: true,
            width: true,
            height: true,
            approved: true,
            qualityState: true,
            contentHash: true,
            verifiedAt: true,
          },
        },
        revisions: {
          orderBy: { revision: "desc" },
          take: 50,
          select: {
            id: true,
            revision: true,
            status: true,
            snapshot: true,
            createdAt: true,
          },
        },
      },
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
  const displayedCover = latestRelease?.coverAsset ?? null;
  const artworkSelected =
    !!displayedCover &&
    latestRelease?.coverAssetId === displayedCover.id &&
    artworkBelongsToSong(displayedCover, {
      projectId: options.projectId,
    });
  const certifiedArtworkSelected =
    artworkSelected && certification.cover?.id === displayedCover.id;
  const artworkSelectionCheck = {
    name: "Song-scoped cover selection",
    ok: certifiedArtworkSelected,
    detail: !displayedCover
      ? "select cover art for this song"
      : certifiedArtworkSelected
        ? "selected cover is certified for this song"
        : "selected cover is outside this song or is no longer the approved certified cover",
  };
  const canonicalReady =
    certification.readiness.ready && certifiedArtworkSelected;
  if (currentSong && currentSong.releaseReady !== canonicalReady) {
    await prisma.song.update({
      where: { id: options.songId },
      data: { releaseReady: canonicalReady },
    });
  }
  const coverPlaybackUrl = displayedCover
    ? await presignAssetRef(displayedCover.url, 900)
    : null;
  const exportCurrent =
    !!certification.rightsReceipt &&
    releasePackageIsCurrent(latestExport, {
      artifactFingerprint: certification.artifactFingerprint,
      receiptId: certification.rightsReceipt.id,
    });
  const distributionConfiguration = distributionConfigurationStatus();
  const distributionLifecycle = distributionLifecycleDiagnostics(
    latestRelease,
    distributionConfiguration
  );

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
      checks: [...certification.readiness.checks, artworkSelectionCheck],
      needsReview: certification.requiredNativeLanguages.length > 0,
    },
    releaseGate,
    evidence: {
      artifactFingerprint: certification.artifactFingerprint,
      receiptHashValid: certification.evidence.receiptHashValid,
      receiptCurrent: certification.evidence.receiptCurrent,
      splitAttested: certification.evidence.splitAttested,
      nativeAttested: certification.evidence.nativeAttested,
      artworkSelected: certifiedArtworkSelected,
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
            ? "/projects/" +
              options.projectId +
              "/exports/" +
              latestExport.id +
              "/download"
            : null,
        }
      : null,
    distribution: latestRelease
      ? {
          id: latestRelease.id,
          revision: latestRelease.revision,
          status: latestRelease.status,
          provider: latestRelease.distributor,
          externalId: latestRelease.externalId,
          channels: latestRelease.channels,
          submittedAt: latestRelease.submittedAt,
          liveAt: latestRelease.liveAt,
          package: {
            audioAssetId: latestRelease.audioAssetId,
            audioAssetKind: latestRelease.audioAssetKind,
            coverAssetId: latestRelease.coverAssetId,
            exportId: latestRelease.exportId,
            artifactFingerprint: latestRelease.artifactFingerprint,
            evidenceHash: latestRelease.evidenceHash,
          },
          history: latestRelease.revisions.map(publicReleaseRevisionSnapshot),
        }
      : null,
    distributionDiagnostics: {
      configuration: {
        ready: distributionConfiguration.ready,
        provider: distributionConfiguration.provider,
        endpointConfigured: distributionConfiguration.endpointConfigured,
        signingSecretConfigured:
          distributionConfiguration.signingSecretConfigured,
        signingSecretStrong: distributionConfiguration.signingSecretStrong,
        inboundWebhookReady: distributionConfiguration.inboundWebhookReady,
        missing: distributionConfiguration.missing,
        issues: distributionConfiguration.issues,
      },
      lifecycle: distributionLifecycle,
      eventCount: latestRelease?._count.events ?? 0,
      recentEvents: latestRelease?.events ?? [],
    },
  };
}

export default async function release(app: FastifyInstance) {
  app.get<{ Params: { projectId: string } }>("/", async req => {
    const { workspaceId } = requireAuth(req);
    await prisma.project.findFirstOrThrow({
      where: { id: req.params.projectId, workspaceId },
    });
    const song = await prisma.song.findFirst({
      where: { projectId: req.params.projectId, workspaceId },
      orderBy: { createdAt: "desc" },
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
    "/:songId/performance",
    async req => {
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
            qualityState: "passed",
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.master.findFirst({
          where: {
            songId: song.id,
            approved: true,
            qualityState: "passed",
            contentHash: { not: null },
            verifiedAt: { not: null },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.videoRender.findFirst({
          where: {
            projectId: song.projectId,
            provider: "snippet",
            approved: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const bakedVocalProviders = new Set(["suno", "ace_step", "minimax"]);
      const instrumental =
        beat && !bakedVocalProviders.has(beat.provider) ? beat.url : null;
      return {
        title: song.title,
        bpm: beat?.bpm ?? null,
        key: beat?.keySignature ?? null,
        backingTrack: instrumental,
        fullMaster: master?.url ?? null,
        visualizer: snippet?.url ?? null,
        certified: !!master,
      };
    }
  );

  app.get<{ Params: { projectId: string; songId: string } }>(
    "/:songId",
    async req => {
      const { workspaceId } = requireAuth(req);
      return statusFor({
        workspaceId,
        projectId: req.params.projectId,
        songId: req.params.songId,
        mode: modeFromQuery(req.query),
      });
    }
  );

  app.patch<{ Params: { projectId: string; songId: string } }>(
    "/:songId",
    { schema: { body: rightsInputSchema } },
    async (req, reply) => {
      const { workspaceId, userId } = requireRole(req, ["OWNER", "ADMIN"]);
      const input = rightsInputSchema.parse(req.body);
      const song = await prisma.song.findFirst({
        where: {
          id: req.params.songId,
          projectId: req.params.projectId,
          workspaceId,
        },
        include: {
          project: {
            select: {
              artistId: true,
              genre: true,
              artist: { select: { stageName: true } },
            },
          },
        },
      });
      if (!song) return reply.code(404).send({ error: "song_not_found" });

      const splitSheet = normalizeSplitSheet(
        input.splitSheet ?? song.splitSheet
      );
      const splitTotal = splitSheet.reduce(
        (total, split) => total + split.share,
        0
      );
      const splitsValid =
        splitSheet.length > 0 && Math.abs(splitTotal - 100) < 0.01;
      if (input.acceptSplits && !splitsValid) {
        return reply.code(400).send({
          error: "invalid_split_sheet",
          message:
            "Accepted splits must have at least one contributor and total exactly 100%.",
          total: splitTotal,
        });
      }
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`
            SELECT 1::int AS locked
            FROM pg_advisory_xact_lock(hashtext(${song.id}))
          `);
          const [currentSong, currentRelease] = await Promise.all([
            tx.song.findUniqueOrThrow({
              where: { id: song.id },
              select: { isrc: true, upc: true },
            }),
            tx.release.findUnique({
              where: { songId: song.id },
              include: {
                coverAsset: { select: { id: true, url: true } },
              },
            }),
          ]);
          if (
            currentRelease &&
            LOCKED_RELEASE_STATUSES.has(currentRelease.status)
          ) {
            throw new Error("release_locked");
          }

          const isrc =
            input.isrc ??
            currentSong.isrc ??
            (splitsValid ? await assignIsrc(tx) : null);
          const upc =
            input.upc ??
            currentSong.upc ??
            (splitsValid ? await assignUpc(tx) : null);

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

          let selectedCover = currentRelease?.coverAsset ?? null;
          if (!currentRelease?.coverAssetId) {
            const projectSongCount = await tx.song.count({
              where: { projectId: song.projectId },
            });
            if (projectSongCount === 1) {
              const candidates = await tx.imageAsset.findMany({
                where: {
                  projectId: song.projectId,
                  kind: "cover",
                  approved: true,
                  qualityState: "passed",
                  contentHash: { not: null },
                  verifiedAt: { not: null },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 2,
                select: { id: true, url: true },
              });
              if (candidates.length === 1) selectedCover = candidates[0]!;
            }
          }

          await tx.release.upsert({
            where: { songId: song.id },
            create: {
              workspaceId,
              projectId: song.projectId,
              artistId: song.project.artistId,
              songId: song.id,
              title: song.title,
              artistName: song.project.artist.stageName,
              genre: song.project.genre,
              isrc,
              upc,
              coverAssetId: selectedCover?.id,
              coverUrl: selectedCover?.url,
              status: "draft",
            },
            update: {
              projectId: song.projectId,
              title: song.title,
              artistName: song.project.artist.stageName,
              genre: song.project.genre,
              isrc,
              upc,
              coverAssetId: selectedCover?.id,
              coverUrl: selectedCover?.url,
              status: "draft",
              submittedAt: null,
              distributionStatusAt: null,
              distributor: null,
              externalId: null,
              channels: Prisma.DbNull,
              liveAt: null,
              releaseDate: null,
            },
          });

          if (input.acceptSplits) {
            const splitPayload = { splitSheet, accepted: true };
            await tx.releaseAttestation.create({
              data: {
                workspaceId,
                projectId: song.projectId,
                songId: song.id,
                kind: "split_sheet",
                payload: splitPayload as never,
                hash: releaseEvidenceHash(splitPayload),
                attestedBy: userId,
              },
            });
          }
          if (input.revokeNativeReview) {
            await tx.releaseAttestation.deleteMany({
              where: { songId: song.id, kind: "native_language" },
            });
          }
          if (input.nativeReview) {
            const nativePayload = {
              reviewerName: input.nativeReview.reviewerName,
              languages: [
                ...new Set(
                  input.nativeReview.languages.map(language =>
                    language.toLowerCase()
                  )
                ),
              ].sort(),
              attested: true,
              notes: input.nativeReview.notes ?? null,
            };
            await tx.releaseAttestation.create({
              data: {
                workspaceId,
                projectId: song.projectId,
                songId: song.id,
                kind: "native_language",
                payload: nativePayload as never,
                hash: releaseEvidenceHash(nativePayload),
                attestedBy: userId,
              },
            });
          }
        });
      } catch (error) {
        if ((error as Error).message === "release_locked") {
          return reply.code(409).send({
            error: "release_locked",
            message: "Submitted and live release revisions cannot be edited.",
          });
        }
        if ((error as { code?: unknown } | null)?.code === "P2002") {
          return reply.code(409).send({ error: "identifier_already_assigned" });
        }
        throw error;
      }

      const status = await statusFor({
        workspaceId,
        projectId: song.projectId,
        songId: song.id,
        mode: modeFromQuery(req.query),
      });
      if (status.song.releaseReady) {
        const { assembleProofPack } = await import("../lib/proof-pack");
        const proofPack = await assembleProofPack(workspaceId, song.id).catch(
          () => null
        );
        if (proofPack) {
          await prisma.song
            .update({
              where: { id: song.id },
              data: { proofPack: proofPack as never },
            })
            .catch(() => undefined);
        }
      }
      return status;
    }
  );

  app.put<{ Params: { projectId: string; songId: string } }>(
    "/:songId/artwork",
    { schema: { body: artworkSelectionSchema } },
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ["OWNER", "ADMIN"]);
      const input = artworkSelectionSchema.parse(req.body);
      const [song, artwork] = await Promise.all([
        prisma.song.findFirst({
          where: {
            id: req.params.songId,
            projectId: req.params.projectId,
            workspaceId,
          },
          include: {
            project: {
              select: {
                artistId: true,
                genre: true,
                artist: { select: { stageName: true } },
              },
            },
          },
        }),
        prisma.imageAsset.findFirst({
          where: {
            id: input.imageAssetId,
            kind: "cover",
            project: { workspaceId },
          },
        }),
      ]);
      if (!song) return reply.code(404).send({ error: "song_not_found" });
      if (!artwork || !artworkBelongsToSong(artwork, song)) {
        return reply.code(404).send({
          error: "cover_not_found_for_song",
          message: "Select cover art owned by this song's project.",
        });
      }

      try {
        const selected = await prisma.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`
            SELECT 1::int AS locked
            FROM pg_advisory_xact_lock(hashtext(${song.id}))
          `);
          const current = await tx.release.findUnique({
            where: { songId: song.id },
            select: { status: true },
          });
          if (current && LOCKED_RELEASE_STATUSES.has(current.status)) {
            throw new Error("release_locked");
          }
          const head = await tx.release.upsert({
            where: { songId: song.id },
            create: {
              workspaceId,
              projectId: song.projectId,
              artistId: song.project.artistId,
              songId: song.id,
              title: song.title,
              artistName: song.project.artist.stageName,
              genre: song.project.genre,
              isrc: song.isrc,
              upc: song.upc,
              coverAssetId: artwork.id,
              coverUrl: artwork.url,
              status: "draft",
            },
            update: {
              projectId: song.projectId,
              title: song.title,
              artistName: song.project.artist.stageName,
              genre: song.project.genre,
              coverAssetId: artwork.id,
              coverUrl: artwork.url,
              exportId: null,
              archiveUrl: null,
              artifactFingerprint: null,
              evidenceHash: null,
              status: "draft",
              submittedAt: null,
              distributionStatusAt: null,
              distributor: null,
              externalId: null,
              channels: Prisma.DbNull,
              liveAt: null,
              releaseDate: null,
            },
            select: { id: true, revision: true, status: true },
          });
          await tx.song.update({
            where: { id: song.id },
            data: { releaseReady: false },
          });
          return head;
        });
        return {
          release: selected,
          artwork: {
            id: artwork.id,
            approved: artwork.approved,
            qualityState: artwork.qualityState,
            contentHash: artwork.contentHash,
          },
        };
      } catch (error) {
        if ((error as Error).message === "release_locked") {
          return reply.code(409).send({
            error: "release_locked",
            message: "Submitted and live release revisions cannot change artwork.",
          });
        }
        throw error;
      }
    }
  );

  app.post<{ Params: { projectId: string; songId: string } }>(
    "/:songId/distribute",
    async (req, reply) => {
      const { workspaceId } = requireRole(req, ["OWNER", "ADMIN"]);
      const observedHead = await prisma.release.findUnique({
        where: { songId: req.params.songId },
        include: { coverAsset: true },
      });
      if (!observedHead || observedHead.workspaceId !== workspaceId) {
        return reply.code(409).send({
          error: "release_artwork_selection_required",
          message:
            "Select this song's approved cover before building and distributing its release package.",
        });
      }
      if (observedHead.status === "live") {
        return {
          status: "live",
          provider: observedHead.distributor,
          externalId: observedHead.externalId,
          channels: observedHead.channels,
          message: "This release is already confirmed live.",
        };
      }
      if (["submitted", "accepted"].includes(observedHead.status)) {
        return {
          status: observedHead.status,
          provider: observedHead.distributor,
          externalId: observedHead.externalId,
          channels: observedHead.channels,
          message: "This release revision is already with the distributor.",
        };
      }
      if (observedHead.status === "submitting") {
        return reply.code(409).send({ error: "release_submission_in_progress" });
      }

      const distributionConfiguration = distributionConfigurationStatus();
      if (!distributionConfiguration.ready) {
        return reply.code(503).send({
          error: "distribution_not_ready",
          diagnostics: {
            provider: distributionConfiguration.provider,
            endpointConfigured:
              distributionConfiguration.endpointConfigured,
            signingSecretConfigured:
              distributionConfiguration.signingSecretConfigured,
            signingSecretStrong:
              distributionConfiguration.signingSecretStrong,
            inboundWebhookReady:
              distributionConfiguration.inboundWebhookReady,
            missing: distributionConfiguration.missing,
            issues: distributionConfiguration.issues,
          },
        });
      }

      const observedCertification = await loadReleaseCertification(prisma, {
        workspaceId,
        projectId: req.params.projectId,
        songId: req.params.songId,
        coverAssetId: observedHead.coverAssetId,
        hitTarget: BLOW_TARGET,
      } as never);
      if (
        !observedHead.coverAsset ||
        !artworkBelongsToSong(
          observedHead.coverAsset,
          observedCertification.song
        ) ||
        observedCertification.cover?.id !== observedHead.coverAssetId
      ) {
        return reply.code(409).send({
          error: "release_artwork_selection_required",
          message:
            "Select this song's approved cover before building and distributing its release package.",
        });
      }
      if (
        !observedCertification.readiness.ready ||
        !observedCertification.audio ||
        !observedCertification.cover ||
        !observedCertification.rightsReceipt
      ) {
        return reply.code(409).send({
          error: "not_release_ready",
          checks: observedCertification.readiness.checks,
        });
      }

      const observedExport = await prisma.export.findFirst({
        where: {
          songId: observedCertification.song.id,
          qualityState: "ready",
          archiveUrl: { not: null },
          contentHash: { not: null },
          sourceFingerprint: { not: null },
          verifiedAt: { not: null },
          receiptId: observedCertification.rightsReceipt.id,
        },
        orderBy: { createdAt: "desc" },
      });
      if (
        !releasePackageIsCurrent(observedExport, {
          artifactFingerprint: observedCertification.artifactFingerprint,
          receiptId: observedCertification.rightsReceipt.id,
        })
      ) {
        return reply.code(409).send({
          error: "current_release_package_required",
          message:
            "Build a fresh verified release package before distribution.",
        });
      }

      const stagedAt = new Date();
      let staged;
      try {
        staged = await prisma.$transaction(
          async tx => {
            await tx.$queryRawUnsafe(
              "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))",
              observedCertification.song.id
            );
            const current = await tx.release.findUniqueOrThrow({
              where: { songId: observedCertification.song.id },
              include: { coverAsset: true },
            });
            if (LOCKED_RELEASE_STATUSES.has(current.status)) {
              throw new Error("release_locked");
            }
            if (current.revision !== observedHead.revision) {
              throw new Error("release_preflight_changed");
            }

            const certification = await loadReleaseCertification(tx, {
              workspaceId,
              projectId: req.params.projectId,
              songId: req.params.songId,
              coverAssetId: current.coverAssetId,
              hitTarget: BLOW_TARGET,
            } as never);
            if (
              certification.artifactFingerprint !==
              observedCertification.artifactFingerprint
            ) {
              throw new Error("release_preflight_changed");
            }
            if (
              !current.coverAsset ||
              !artworkBelongsToSong(current.coverAsset, certification.song) ||
              certification.cover?.id !== current.coverAssetId
            ) {
              throw new Error("release_artwork_selection_required");
            }
            if (
              !certification.readiness.ready ||
              !certification.audio ||
              !certification.cover ||
              !certification.rightsReceipt
            ) {
              throw new Error("not_release_ready");
            }

            const releaseExport = await tx.export.findFirst({
              where: {
                songId: certification.song.id,
                qualityState: "ready",
                archiveUrl: { not: null },
                contentHash: { not: null },
                sourceFingerprint: { not: null },
                verifiedAt: { not: null },
                receiptId: certification.rightsReceipt.id,
              },
              orderBy: { createdAt: "desc" },
            });
            if (
              !releasePackageIsCurrent(releaseExport, {
                artifactFingerprint: certification.artifactFingerprint,
                receiptId: certification.rightsReceipt.id,
              }) ||
              releaseExport?.id !== observedExport!.id ||
              releaseExport.sourceFingerprint !==
                observedExport!.sourceFingerprint ||
              releaseExport.contentHash !== observedExport!.contentHash
            ) {
              throw new Error("release_package_changed");
            }

            const head = await tx.release.update({
              where: { id: current.id },
              data: {
                projectId: certification.song.projectId,
                title: certification.song.title,
                artistName: certification.song.project.artist.stageName,
                genre: certification.song.project.genre,
                isrc: certification.song.isrc,
                upc: certification.song.upc,
                audioAssetId: certification.audio.id,
                audioAssetKind: certification.audio.kind,
                audioUrl: certification.audio.url,
                coverAssetId: certification.cover.id,
                coverUrl: certification.cover.url,
                exportId: releaseExport.id,
                archiveUrl: releaseExport.archiveUrl,
                artifactFingerprint: certification.artifactFingerprint,
                evidenceHash: releaseExport.contentHash,
                status: "submitting",
                distributionStatusAt: stagedAt,
                submittedAt: null,
                distributor: null,
                externalId: null,
                channels: Prisma.DbNull,
                liveAt: null,
                releaseDate: null,
              },
              select: { id: true, revision: true },
            });
            return {
              ...head,
              songId: certification.song.id,
              title: certification.song.title,
              artist: certification.song.project.artist.stageName,
              genre: certification.song.project.genre,
              isrc: certification.song.isrc,
              upc: certification.song.upc,
              audioAssetId: certification.audio.id,
              audioAssetKind: certification.audio.kind,
              audioUrl: certification.audio.url,
              coverAssetId: certification.cover.id,
              coverUrl: certification.cover.url,
              exportId: releaseExport.id,
              archiveUrl: releaseExport.archiveUrl!,
              artifactFingerprint: certification.artifactFingerprint,
              evidenceHash: releaseExport.contentHash!,
            };
          },
          { isolationLevel: "Serializable" as never }
        );
      } catch (error) {
        const message = (error as Error).message;
        if (message === "release_locked") {
          return reply.code(409).send({ error: "release_locked" });
        }
        if (
          message === "release_preflight_changed" ||
          message === "release_package_changed" ||
          (error as { code?: unknown } | null)?.code === "P2034"
        ) {
          return reply.code(409).send({
            error: "release_preflight_changed",
            message:
              "The release changed during final validation. Review the current revision and submit again.",
          });
        }
        if (message === "release_artwork_selection_required") {
          return reply
            .code(409)
            .send({ error: "release_artwork_selection_required" });
        }
        if (message === "not_release_ready") {
          return reply.code(409).send({ error: "not_release_ready" });
        }
        throw error;
      }

      const result = await distributeRelease({
        releaseId: staged.id,
        revision: staged.revision,
        title: staged.title,
        artist: staged.artist,
        genre: staged.genre,
        isrc: staged.isrc,
        upc: staged.upc,
        audioAssetId: staged.audioAssetId,
        audioAssetKind: staged.audioAssetKind,
        coverAssetId: staged.coverAssetId,
        exportId: staged.exportId,
        artifactFingerprint: staged.artifactFingerprint,
        audioUrl: await presignAssetRef(staged.audioUrl, 3600),
        coverUrl: await presignAssetRef(staged.coverUrl, 3600),
        bundleUrl: await presignAssetRef(staged.archiveUrl, 3600),
        evidenceHash: staged.evidenceHash,
        idempotencyKey:
          "release:" + staged.id + ":r" + String(staged.revision),
      });
      const restoreDraft = () =>
        prisma.release.updateMany({
          where: {
            id: staged.id,
            revision: staged.revision,
            status: "submitting",
          },
          data: { status: "draft", distributionStatusAt: null },
        });
      if (result.status === "not_configured") {
        await restoreDraft();
        return reply.code(501).send({
          error: "distribution_adapter_not_configured",
          ...result,
        });
      }
      if (result.status !== "submitted" || !result.externalId) {
        await restoreDraft();
        return reply
          .code(502)
          .send({ error: "distribution_failed", ...result });
      }

      const submittedAt = new Date();
      await prisma.$transaction(
        async tx => {
          await tx.$queryRawUnsafe(
            "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))",
            staged.songId
          );
          const current = await tx.release.findUniqueOrThrow({
            where: { songId: staged.songId },
            select: {
              id: true,
              revision: true,
              status: true,
              audioAssetId: true,
              coverAssetId: true,
              exportId: true,
              artifactFingerprint: true,
              evidenceHash: true,
            },
          });
          if (
            current.status !== "submitting" ||
            current.revision !== staged.revision ||
            current.audioAssetId !== staged.audioAssetId ||
            current.coverAssetId !== staged.coverAssetId ||
            current.exportId !== staged.exportId ||
            current.artifactFingerprint !== staged.artifactFingerprint ||
            current.evidenceHash !== staged.evidenceHash
          ) {
            throw new Error("release_submission_superseded");
          }
          await tx.release.update({
            where: { id: current.id },
            data: {
              submittedAt,
              distributionStatusAt: submittedAt,
              distributor: result.provider,
              externalId: result.externalId,
              status: result.partnerStatus ?? "submitted",
              channels: result.channels
                ? (result.channels as never)
                : Prisma.DbNull,
            },
          });
          await tx.song.update({
            where: { id: staged.songId },
            data: { status: "EXPORTED" },
          });
        },
        { isolationLevel: "Serializable" as never }
      );
      await prisma.analyticsEvent
        .create({
          data: {
            workspaceId,
            name: "release.distribute",
            properties: {
              songId: staged.songId,
              exportId: staged.exportId,
              releaseId: staged.id,
              revision: staged.revision,
              provider: result.provider,
              status: result.status,
            } as never,
          },
        })
        .catch(() => undefined);
      return result;
    }
  );
}
