/**
 * TRAINING CAPTURE — "see the music." The PURE mappers/manifest builder moved
 * to @afrohit/shared (training-capture.ts) so the worker's nightly flywheel
 * classifies with the same rights law (P3, owner approval 2026-07-19); this
 * file re-exports them for every existing API import/test and keeps the LIVE
 * DB read.
 *
 * Consent: user-original assets are trainable ONLY when the workspace's
 * training-license consent resolves true (ToS-on-signup). Until a consent
 * record exists the resolver fails closed, so user-original shows as
 * pending-consent rather than being silently treated as trainable.
 */
import { isOutsideRenderLearningEnabled, prisma } from '@afrohit/db';
import { beatIngredientIds, manifestFromCatalog, type TrainingManifest } from '@afrohit/shared';

export {
  materialToProvenance,
  beatToProvenance,
  vocalToProvenance,
  manifestFromCatalog,
} from '@afrohit/shared';
export type { CaptureInput } from '@afrohit/shared';

/**
 * LIVE: read the workspace's (or the whole tenant's) real catalog and build the
 * manifest. Only assets that passed QC / are approved are considered — junk
 * takes never train. `resolveConsent` decides user-original eligibility per
 * workspace; it fails closed by default until the consent record is wired.
 */
export async function buildWorkspaceTrainingManifest(opts: {
  workspaceId?: string;
  resolveConsent?: (workspaceId?: string) => boolean;
  limit?: number;
} = {}): Promise<TrainingManifest & { scannedWorkspace: string | 'ALL' }> {
  const take = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const wsWhere = opts.workspaceId ? { workspaceId: opts.workspaceId } : {};
  const consentGranted = (opts.resolveConsent ?? (() => false))(opts.workspaceId);

  const [materials, beats, vocals] = await Promise.all([
    prisma.materialAsset.findMany({
      where: { ...wsWhere, readiness: 'ready', qualityState: { notIn: ['failed', 'duplicate'] } },
      select: { id: true, source: true, rightsBasis: true },
      take,
    }),
    prisma.beatAsset.findMany({
      where: opts.workspaceId
        ? { project: { workspaceId: opts.workspaceId }, approved: true }
        : { approved: true },
      // meta rides along so a third-party melody topping (meta.melodyLayer)
      // downgrades the bed to third-party-render in the manifest.
      select: { id: true, provider: true, meta: true },
      take,
    }),
    prisma.vocalRender.findMany({
      where: opts.workspaceId
        ? { project: { workspaceId: opts.workspaceId }, approved: true }
        : { approved: true },
      select: { id: true, performanceSource: true },
      take,
    }),
  ]);

  // INGREDIENT LINEAGE (parity with the flywheel): assembled beds classify by
  // their ingredient loops' rights, not the 'material' provider stamp.
  const allIngredientIds = [...new Set(beats.flatMap((row) => beatIngredientIds(row.meta)))];
  const rightsById = new Map<string, string | null>();
  if (allIngredientIds.length) {
    const rows = await prisma.materialAsset.findMany({
      where: { id: { in: allIngredientIds } },
      select: { id: true, rightsBasis: true },
    });
    for (const row of rows) rightsById.set(row.id, row.rightsBasis);
  }
  const enrichedBeats = beats.map((row) => {
    const ids = beatIngredientIds(row.meta);
    return ids.length
      ? { ...row, ingredientRights: ids.map((id) => rightsById.get(id) ?? 'unknown') }
      : row;
  });

  // OUTSIDE-RENDER LEARNING: operator toggle (SystemSetting, fail-closed).
  // When ON, third-party renders classify eligible but KEEP their
  // 'third-party-render' origin label — provenance is never laundered.
  const allowThirdPartyRenders = await isOutsideRenderLearningEnabled();
  const manifest = manifestFromCatalog({ materials, beats: enrichedBeats, vocals }, consentGranted, { allowThirdPartyRenders });
  return { ...manifest, scannedWorkspace: opts.workspaceId ?? 'ALL' };
}
