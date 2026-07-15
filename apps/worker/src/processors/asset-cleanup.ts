import { Prisma, prisma } from "@afrohit/db";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import { deleteObjectByUrl } from "../lib/storage";

type AssetCleanupPayload = {
  jobId: string;
  workspaceId: string;
  refs: string[];
  reason: string;
};

type CleanupScope = { songId: string } | { projectId: string } | null;
type AssetRefRow = { ref: string };
type DeletionCandidateRow = { id: string; ref: string };

export function cleanupScopeFromReason(reason: string): CleanupScope {
  const separator = reason.indexOf(":");
  if (separator < 1) return null;
  const kind = reason.slice(0, separator);
  const id = reason.slice(separator + 1).trim();
  if (!id) return null;
  if (kind === "song") return { songId: id };
  if (kind === "project") return { projectId: id };
  return null;
}

export function planAssetCleanup(
  requested: string[],
  tombstoned: string[],
  protectedRefs: Iterable<string>
): { candidates: string[]; deletable: string[]; protected: string[] } {
  const candidates = [
    ...new Set([...requested, ...tombstoned].filter(Boolean)),
  ];
  const protectedSet = new Set(protectedRefs);
  const protectedUrls = candidates.filter(ref => protectedSet.has(ref));
  return {
    candidates,
    deletable: candidates.filter(ref => !protectedSet.has(ref)),
    protected: protectedUrls,
  };
}

async function protectedAssetRefs(
  workspaceId: string,
  candidates: string[]
): Promise<Set<string>> {
  const protectedRefs = new Set<string>();
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const chunk = candidates.slice(offset, offset + 500);
    if (!chunk.length) continue;
    const values = Prisma.join(chunk.map(ref => Prisma.sql`(${ref})`));
    const rows = (await prisma.$queryRaw(Prisma.sql`
      WITH candidates("ref") AS (VALUES ${values}),
      referenced("ref") AS (
        SELECT song."instrumentalUrl" FROM "Song" song
          WHERE song."workspaceId" = ${workspaceId}
        UNION ALL SELECT song."acapellaUrl" FROM "Song" song
          WHERE song."workspaceId" = ${workspaceId}
        UNION ALL SELECT beat."url" FROM "BeatAsset" beat
          JOIN "Project" project ON project."id" = beat."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT stem."url" FROM "Stem" stem
          JOIN "BeatAsset" beat ON beat."id" = stem."beatId"
          JOIN "Project" project ON project."id" = beat."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT vocal."url" FROM "VocalRender" vocal
          JOIN "Project" project ON project."id" = vocal."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT mix."url" FROM "Mix" mix
          JOIN "Project" project ON project."id" = mix."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT master."url" FROM "Master" master
          JOIN "Project" project ON project."id" = master."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT master."meta" #>> '{deliveryMp3,url}' FROM "Master" master
          JOIN "Project" project ON project."id" = master."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT image."url" FROM "ImageAsset" image
          LEFT JOIN "Project" project ON project."id" = image."projectId"
          LEFT JOIN "BrandKit" brand ON brand."id" = image."brandKitId"
          WHERE project."workspaceId" = ${workspaceId}
             OR brand."workspaceId" = ${workspaceId}
        UNION ALL SELECT video."url" FROM "VideoRender" video
          JOIN "Project" project ON project."id" = video."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT export."archiveUrl" FROM "Export" export
          JOIN "Project" project ON project."id" = export."projectId"
          WHERE project."workspaceId" = ${workspaceId}
        UNION ALL SELECT material."url" FROM "MaterialAsset" material
          WHERE material."workspaceId" = ${workspaceId}
        UNION ALL SELECT reference."sourceUrl" FROM "SoundReference" reference
          WHERE reference."workspaceId" = ${workspaceId}
        UNION ALL SELECT dataset."url" FROM "VoiceDataset" dataset
          WHERE dataset."workspaceId" = ${workspaceId}
        UNION ALL SELECT UNNEST(profile."sampleUrls") FROM "VoiceProfile" profile
          WHERE profile."workspaceId" = ${workspaceId}
        UNION ALL SELECT consent."consentAudioUrl" FROM "VoiceConsent" consent
          WHERE consent."workspaceId" = ${workspaceId}
        UNION ALL SELECT consent."signatureUrl" FROM "VoiceConsent" consent
          WHERE consent."workspaceId" = ${workspaceId}
        UNION ALL SELECT brand."logoUrl" FROM "BrandKit" brand
          WHERE brand."workspaceId" = ${workspaceId}
        UNION ALL SELECT rating."audioUrl" FROM "BenchmarkRating" rating
          WHERE rating."workspaceId" = ${workspaceId}
        UNION ALL SELECT pair."afrohitAssetRef" FROM "BenchmarkPair" pair
          WHERE pair."workspaceId" = ${workspaceId}
        UNION ALL SELECT pair."referenceAssetRef" FROM "BenchmarkPair" pair
          WHERE pair."workspaceId" = ${workspaceId}
        UNION ALL SELECT memory."sourceUrl" FROM "ArtistMemoryChunk" memory
          WHERE memory."workspaceId" = ${workspaceId}
        UNION ALL SELECT release."audioUrl" FROM "Release" release
          WHERE release."workspaceId" = ${workspaceId}
            AND release."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
        UNION ALL SELECT release."coverUrl" FROM "Release" release
          WHERE release."workspaceId" = ${workspaceId}
            AND release."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
        UNION ALL SELECT release."archiveUrl" FROM "Release" release
          WHERE release."workspaceId" = ${workspaceId}
            AND release."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
        UNION ALL SELECT revision."audioUrl" FROM "ReleaseRevision" revision
          WHERE revision."workspaceId" = ${workspaceId}
            AND revision."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
        UNION ALL SELECT revision."coverUrl" FROM "ReleaseRevision" revision
          WHERE revision."workspaceId" = ${workspaceId}
            AND revision."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
        UNION ALL SELECT revision."archiveUrl" FROM "ReleaseRevision" revision
          WHERE revision."workspaceId" = ${workspaceId}
            AND revision."status" IN ('draft', 'submitting', 'submitted', 'accepted', 'live', 'legacy_unverified')
      )
      SELECT DISTINCT candidates."ref"
      FROM candidates
      JOIN referenced ON referenced."ref" = candidates."ref"
    `)) as AssetRefRow[];
    for (const row of rows) protectedRefs.add(row.ref);
  }
  return protectedRefs;
}

export async function deleteUnreferencedAssetRefs(
  workspaceId: string,
  refs: string[]
): Promise<{ candidates: string[]; deletable: string[]; protected: string[] }> {
  const candidates = [...new Set(refs.filter(Boolean))].slice(0, 10_000);
  const protectedRefs = await protectedAssetRefs(workspaceId, candidates);
  const plan = planAssetCleanup(candidates, [], protectedRefs);
  for (const ref of plan.deletable) await deleteObjectByUrl(ref);
  return plan;
}

export async function processAssetCleanup(
  payload: AssetCleanupPayload
): Promise<void> {
  await markRunning(payload.jobId);
  try {
    const scope = cleanupScopeFromReason(payload.reason);
    const tombstones: DeletionCandidateRow[] = scope
      ? await prisma.assetDeletionCandidate.findMany({
          where: { workspaceId: payload.workspaceId, ...scope },
          select: { id: true, ref: true },
        })
      : [];
    const initial = planAssetCleanup(
      payload.refs.slice(0, 10_000),
      tombstones.map(row => row.ref),
      []
    );
    const plan = await deleteUnreferencedAssetRefs(
      payload.workspaceId,
      initial.candidates
    );
    if (tombstones.length) {
      await prisma.assetDeletionCandidate.deleteMany({
        where: { id: { in: tombstones.map(row => row.id) } },
      });
    }
    await markSucceeded(payload.jobId, {
      requested: payload.refs.length,
      candidates: plan.candidates.length,
      deleted: plan.deletable.length,
      protected: plan.protected.length,
      reason: payload.reason,
    });
  } catch (error) {
    await markFailed(payload.jobId, error);
    throw error;
  }
}
