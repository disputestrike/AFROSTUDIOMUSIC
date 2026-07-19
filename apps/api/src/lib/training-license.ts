/**
 * TRAINING-LICENSE HASHING — Node-only. Kept OUT of packages/shared because the
 * shared barrel is bundled into the Next.js web client, which cannot resolve
 * `node:crypto`. The clause text + versioning + the (pure) resolver live in
 * @afrohit/shared/training-consent; the sha256 tamper-evidence lives here.
 */
import { createHash } from 'node:crypto';
import { prisma } from '@afrohit/db';
import {
  TRAINING_LICENSE_CLAUSE,
  resolveTrainingConsent,
  type TrainingConsentVerdict,
} from '@afrohit/shared';

/** Stable sha256 of the exact clause the user accepted — tamper-evident receipt. */
export function hashTrainingLicense(clause: string = TRAINING_LICENSE_CLAUSE): string {
  return createHash('sha256').update(clause, 'utf8').digest('hex');
}

/**
 * THE DOOR (2026-07-19): resolve a workspace's RECORDED training-license grant
 * — latest non-revoked TrainingConsent row through the pure fail-closed
 * resolver, hash-verified against the current clause. This is the resolver the
 * audit found dead-coded; it now has its record.
 */
export async function resolveWorkspaceTrainingConsent(
  workspaceId: string
): Promise<TrainingConsentVerdict> {
  try {
    const row = await prisma.trainingConsent.findFirst({
      where: { workspaceId, revokedAt: null },
      orderBy: { signedAt: 'desc' },
      select: { consentVersion: true, signedAt: true, consentTextHash: true, revokedAt: true },
    });
    return resolveTrainingConsent(
      row
        ? {
            version: row.consentVersion,
            acceptedAt: row.signedAt,
            textHash: row.consentTextHash,
            revokedAt: row.revokedAt,
          }
        : null,
      { expectedHash: hashTrainingLicense() }
    );
  } catch (err) {
    // FAIL-SOFT with the REAL reason (live 500 on the owner's first tap): a
    // missing table (P2021 — db push not landed) or any read error resolves as
    // not-granted with the cause named, never a masked internal_error.
    const e = err as Error & { code?: string };
    return {
      granted: false,
      current: false,
      reason: `consent record unreadable (${e.code ?? 'error'}): ${(e.message ?? '').slice(0, 160)}`,
    };
  }
}
