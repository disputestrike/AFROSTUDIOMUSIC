/**
 * OWNER ORDERS (2026-07-23, repeated from yesterday — executed with receipts):
 *
 * 1. purgeSeededMaterials — "delete every single material we had put before…
 *    everything that was seeded… start building the material all over" from
 *    REAL songs only. Every MaterialAsset whose source is not a real-song stem
 *    or an artist's own upload is HARD-DELETED. Per-source counts are logged
 *    before and after — the receipt. The harvest (artist_stem) then rebuilds
 *    the shelf from the owned catalog alone.
 *
 * 2. restoreAllSongs — "all songs that have been created from the start should
 *    be returned… retrieve all songs that have been deleted." Clears
 *    deletedAt + quarantined on EVERY song, platform-wide, with counts.
 */
import { prisma } from "@afrohit/db";

/** Sources that came from REAL audio a human owns — everything else was seeded. */
const REAL_SOURCES = ["artist_stem", "provider_stem", "upload", "import", "artist_upload"];

/** FK GUARD (the bug that silently defeated every material delete): MaterialUsage
 *  points at MaterialAsset with onDelete: Restrict, and AfroRefClip holds an
 *  optional materialId — so deleting a referenced material throws P2003 and the
 *  whole delete rolls back untouched. Clear the dependents FIRST, for the exact
 *  ids we're about to remove. */
async function clearMaterialDependents(materialIds: string[]): Promise<void> {
  if (!materialIds.length) return;
  const u = await prisma.materialUsage.deleteMany({ where: { materialId: { in: materialIds } } });
  const a = await prisma.afroRefClip.updateMany({
    where: { materialId: { in: materialIds } },
    data: { materialId: null },
  });
  console.log(`[purge] cleared ${u.count} MaterialUsage + unlinked ${a.count} AfroRefClip before delete`);
}

export async function purgeSeededMaterials(): Promise<{ deleted: number; kept: number }> {
  const before = await prisma.materialAsset.groupBy({ by: ["source"], _count: { _all: true } });
  console.log(
    "[purge-seeded] shelf before:",
    before.map(r => `${r.source}=${r._count._all}`).join(" ")
  );
  const doomed = await prisma.materialAsset.findMany({
    where: { source: { notIn: REAL_SOURCES } },
    select: { id: true },
  });
  await clearMaterialDependents(doomed.map(m => m.id));
  const { count: deleted } = await prisma.materialAsset.deleteMany({
    where: { id: { in: doomed.map(m => m.id) } },
  });
  const kept = await prisma.materialAsset.count();
  console.log(
    `[purge-seeded] DELETED ${deleted} seeded material(s); ${kept} real-song material(s) remain — the shelf now rebuilds from the owned catalog only`
  );
  return { deleted, kept };
}

export async function restoreAllSongs(): Promise<{ restored: number; unquarantined: number }> {
  const { count: restored } = await prisma.song.updateMany({
    where: { deletedAt: { not: null } },
    data: { deletedAt: null, deletedReason: null },
  });
  const { count: unquarantined } = await prisma.song.updateMany({
    where: { quarantined: true },
    data: { quarantined: false, quarantineReason: null },
  });
  console.log(
    `[restore-all-songs] restored ${restored} deleted song(s), un-quarantined ${unquarantined} — every song ever made is visible again`
  );
  return { restored, unquarantined };
}

/** TOTAL LAKE RESET (owner 2026-07-23: "this page should have ZERO of
 * everything — start over"). Deletes ALL learned conditioning: every reference
 * (self-training, zap, unknown, minimax-derived), every material, every trend
 * snapshot, the whole usage ledger. ONE exception, per the owner's own words
 * ("with music we're adding"): user-attested uploads survive — they are the
 * new foundation, and the harvest re-cuts the shelf from them alone. */
export async function resetDataLake(): Promise<void> {
  const { count: usages } = await prisma.referenceUsage.deleteMany({});
  const { count: refs } = await prisma.soundReference.deleteMany({
    where: { rightsBasis: { not: "user-attested" } },
  });
  const keptRefs = await prisma.soundReference.count();
  // FK-SAFE MATERIAL WIPE (the delete that kept silently failing on P2003):
  // clear every MaterialUsage + unlink every AfroRefClip FIRST, then delete
  // ALL materials. Each step logs so a failure can never hide again.
  const allMats = await prisma.materialAsset.findMany({ select: { id: true } });
  await clearMaterialDependents(allMats.map(m => m.id));
  const { count: mats } = await prisma.materialAsset.deleteMany({});
  const remainingMats = await prisma.materialAsset.count();
  const { count: trends } = await prisma.systemSetting.deleteMany({
    where: { key: { startsWith: "trends:" } },
  });
  console.log(
    `[lake-reset] ZEROED: ${refs} reference(s), ${mats} material(s), ${trends} trend snapshot(s), ${usages} usage row(s) — kept ${keptRefs} user-attested upload(s); ${remainingMats} material(s) remain (must be 0)`
  );
}
