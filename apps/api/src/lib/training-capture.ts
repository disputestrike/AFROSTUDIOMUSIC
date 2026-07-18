/**
 * TRAINING CAPTURE — "see the music." Turns the REAL catalog (material loops,
 * instrumentals, vocals) into a rights-gated training manifest so we can see,
 * per asset, exactly what may train our own model and what is refused (and why).
 *
 * Read-only over existing rows. No migration. The row→provenance MAPPERS are
 * pure + exported so they are unit-tested on real-catalog-shaped fixtures
 * without a database; buildWorkspaceTrainingManifest() does the live reads.
 *
 * Consent: user-original assets are trainable ONLY when the workspace's
 * training-license consent resolves true (ToS-on-signup). Until a consent
 * record exists the resolver fails closed, so user-original shows as
 * pending-consent rather than being silently treated as trainable.
 */
import { prisma } from '@afrohit/db';
import {
  buildTrainingManifest,
  type AssetProvenance,
  type TrainingManifest,
} from '@afrohit/shared';

/** MaterialAsset (instrument/beat loop) → provenance. */
export function materialToProvenance(row: {
  id: string;
  source?: string | null;
  rightsBasis?: string | null;
  consentGranted?: boolean;
}): AssetProvenance {
  return { id: `material:${row.id}`, materialSource: row.source, rightsBasis: row.rightsBasis, consentGranted: row.consentGranted };
}

/** BeatAsset (instrumental / full mix) → provenance. `provider` IS the engine. */
export function beatToProvenance(row: {
  id: string;
  provider?: string | null;
  consentGranted?: boolean;
}): AssetProvenance {
  return { id: `beat:${row.id}`, engine: row.provider, consentGranted: row.consentGranted };
}

/** VocalRender → provenance. performanceSource carries the origin. */
export function vocalToProvenance(row: {
  id: string;
  performanceSource?: string | null;
  consentGranted?: boolean;
}): AssetProvenance {
  return { id: `vocal:${row.id}`, performanceSource: row.performanceSource, consentGranted: row.consentGranted };
}

export interface CaptureInput {
  materials: Array<{ id: string; source?: string | null; rightsBasis?: string | null }>;
  beats: Array<{ id: string; provider?: string | null }>;
  vocals: Array<{ id: string; performanceSource?: string | null }>;
}

/**
 * PURE: map a catalog snapshot → a training manifest. `consentGranted` is the
 * resolved training-license verdict for THIS workspace (applied to user-original
 * assets). Fully testable without a DB.
 */
export function manifestFromCatalog(input: CaptureInput, consentGranted: boolean): TrainingManifest {
  const rows: AssetProvenance[] = [
    ...input.materials.map((m) => materialToProvenance({ ...m, consentGranted })),
    ...input.beats.map((b) => beatToProvenance({ ...b, consentGranted })),
    ...input.vocals.map((v) => vocalToProvenance({ ...v, consentGranted })),
  ];
  return buildTrainingManifest(rows);
}

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
      select: { id: true, provider: true },
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

  const manifest = manifestFromCatalog({ materials, beats, vocals }, consentGranted);
  return { ...manifest, scannedWorkspace: opts.workspaceId ?? 'ALL' };
}
