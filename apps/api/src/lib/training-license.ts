/**
 * TRAINING-LICENSE HASHING — Node-only. Kept OUT of packages/shared because the
 * shared barrel is bundled into the Next.js web client, which cannot resolve
 * `node:crypto`. The clause text + versioning + the (pure) resolver live in
 * @afrohit/shared/training-consent; the sha256 tamper-evidence lives here.
 */
import { createHash } from 'node:crypto';
import { TRAINING_LICENSE_CLAUSE } from '@afrohit/shared';

/** Stable sha256 of the exact clause the user accepted — tamper-evident receipt. */
export function hashTrainingLicense(clause: string = TRAINING_LICENSE_CLAUSE): string {
  return createHash('sha256').update(clause, 'utf8').digest('hex');
}
