import { prisma } from "@afrohit/db";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface VoiceLineageRepairSummary {
  scanned: number;
  repairedProfiles: number;
  repairedConsents: number;
  skipped: Array<{ profileId: string; reason: string }>;
}

/**
 * Backfill lineage on legacy trained voices without weakening authorization.
 * A consent is repaired only when every profile that references it agrees on
 * one artist. Revoked, cross-workspace, ambiguous, and mismatched records are
 * left untouched and disclosed in the receipt.
 */
export async function repairLegacyVoiceLineage(opts?: {
  workspaceId?: string;
}): Promise<VoiceLineageRepairSummary> {
  const profiles = await prisma.voiceProfile.findMany({
    where: {
      ...(opts?.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      status: "READY",
      OR: [
        { trainedVersion: { not: null } },
        { trainingId: { not: null } },
        { voiceDatasetId: { not: null } },
      ],
    },
    select: {
      id: true,
      workspaceId: true,
      artistId: true,
      consentId: true,
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
    orderBy: { createdAt: "asc" },
  });

  const allConsentProfiles = await prisma.voiceProfile.findMany({
    where: {
      consentId: { in: [...new Set(profiles.map(profile => profile.consentId))] },
    },
    select: { consentId: true, artistId: true, workspaceId: true },
  });
  const summary: VoiceLineageRepairSummary = {
    scanned: profiles.length,
    repairedProfiles: 0,
    repairedConsents: 0,
    skipped: [],
  };

  for (const profile of profiles) {
    const fail = (reason: string) =>
      summary.skipped.push({ profileId: profile.id, reason });
    if (profile.consent.revokedAt) {
      fail("consent revoked");
      continue;
    }
    if (profile.consent.workspaceId !== profile.workspaceId) {
      fail("consent workspace mismatch");
      continue;
    }
    const linked = allConsentProfiles.filter(
      item => item.consentId === profile.consentId
    );
    const artists = new Set(linked.map(item => item.artistId));
    const workspaces = new Set(linked.map(item => item.workspaceId));
    if (artists.size !== 1 || !artists.has(profile.artistId)) {
      fail("consent is shared by multiple artists");
      continue;
    }
    if (workspaces.size !== 1 || !workspaces.has(profile.workspaceId)) {
      fail("consent is shared across workspaces");
      continue;
    }
    if (
      profile.consent.artistId &&
      profile.consent.artistId !== profile.artistId
    ) {
      fail("existing consent artist mismatch");
      continue;
    }
    if (
      profile.voiceDataset &&
      profile.voiceDataset.workspaceId !== profile.workspaceId
    ) {
      fail("voice dataset workspace mismatch");
      continue;
    }

    const prior = objectValue(profile.trainingMeta);
    const alreadyRepaired =
      prior.artistId === profile.artistId &&
      prior.consentId === profile.consentId;
    const repairedAt =
      typeof prior.lineageRepairedAt === "string"
        ? prior.lineageRepairedAt
        : new Date().toISOString();

    await prisma.$transaction(async tx => {
      if (!profile.consent.artistId) {
        const consent = await tx.voiceConsent.updateMany({
          where: {
            id: profile.consentId,
            workspaceId: profile.workspaceId,
            artistId: null,
            revokedAt: null,
          },
          data: { artistId: profile.artistId },
        });
        summary.repairedConsents += consent.count;
      }
      if (!alreadyRepaired) {
        await tx.voiceProfile.update({
          where: { id: profile.id },
          data: {
            trainingMeta: {
              ...prior,
              artistId: profile.artistId,
              consentId: profile.consentId,
              voiceDatasetId: profile.voiceDatasetId,
              voiceDatasetContentHash:
                profile.voiceDataset?.contentHash ?? null,
              lineageRepairedAt: repairedAt,
              lineageRepairVersion: 1,
            } as never,
          },
        });
        summary.repairedProfiles += 1;
      }
    });
  }

  console.log(
    `[voice-lineage-repair] scanned=${summary.scanned} profiles=${summary.repairedProfiles} consents=${summary.repairedConsents} skipped=${summary.skipped.length}`
  );
  return summary;
}
