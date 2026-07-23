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

export async function purgeSeededMaterials(): Promise<{ deleted: number; kept: number }> {
  const before = await prisma.materialAsset.groupBy({ by: ["source"], _count: { _all: true } });
  console.log(
    "[purge-seeded] shelf before:",
    before.map(r => `${r.source}=${r._count._all}`).join(" ")
  );
  const { count: deleted } = await prisma.materialAsset.deleteMany({
    where: { source: { notIn: REAL_SOURCES } },
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
