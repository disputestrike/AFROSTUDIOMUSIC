/**
 * TRAINING-LICENSE CONSENT — the legal basis that turns a user's OWN uploaded
 * content into training fuel for AfroHit's own model.
 *
 * Owner decision (2026-07-18): "on our terms and conditions, when they sign up,
 * when they agree to sign up, they accept this by default." So acceptance is
 * captured at signup via the ToS. This module makes that acceptance VERSIONED,
 * HASHED and AUDITABLE — the same discipline as VoiceConsent/LikenessConsent —
 * so "we had the right to train on this" is provable per user, not asserted.
 *
 * SCOPE OF THE GRANT (what the user licenses to us):
 *   a non-exclusive license to use the user's OWN original uploads (their voice,
 *   masters, stems, recordings) to train and improve AfroHit's models. The user
 *   KEEPS ownership of their work. It does NOT cover third-party-engine renders
 *   (MiniMax/Suno) — those aren't the user's to license and are refused upstream
 *   by the training-corpus gate regardless of consent.
 *
 * The clause TEXT below is the engineering default; the operator + counsel own
 * the final wording. Bump TRAINING_LICENSE_VERSION whenever the grant text
 * materially changes — a materially newer license requires fresh acceptance.
 */
import { createHash } from 'node:crypto';

/** Bump on any material change to the grant → forces re-acceptance. */
export const TRAINING_LICENSE_VERSION = 'tl-2026-07-18';

/** The grant a signed-up user accepts (operator + counsel own final wording). */
export const TRAINING_LICENSE_CLAUSE = [
  'TRAINING LICENSE.',
  'You grant AfroHit Studio a worldwide, non-exclusive, royalty-free license to',
  'use content you upload that is YOUR OWN original work (including your voice,',
  'recordings, stems and masters) to train, fine-tune and improve AfroHit’s',
  'audio, voice and video models and the services built on them.',
  'You retain ownership of your work; this license does not transfer it.',
  'This grant does NOT extend to material you do not own, and AfroHit does not',
  'train its models on the outputs of third-party generation engines.',
  'You may withdraw this grant for future training at any time; content already',
  'incorporated into a trained model cannot be retroactively removed from it.',
].join(' ');

/** Stable hash of the exact clause the user accepted — tamper-evident receipt. */
export function hashTrainingLicense(clause: string = TRAINING_LICENSE_CLAUSE): string {
  return createHash('sha256').update(clause, 'utf8').digest('hex');
}

/** A recorded acceptance (what the DB row / ToS-acceptance event carries). */
export interface TrainingConsentRecord {
  version: string;
  acceptedAt: string | Date;
  /** sha256 of the clause the user actually accepted; verified when present. */
  textHash?: string | null;
  /** Set when the user withdraws the grant for FUTURE training. */
  revokedAt?: string | Date | null;
}

export interface TrainingConsentVerdict {
  granted: boolean;
  /** true only when the accepted version equals the CURRENT license version. */
  current: boolean;
  version?: string;
  reason?: string;
}

/**
 * Resolve whether we may train on a user's original content, from their recorded
 * ToS acceptance. Fail-closed: no record, a revoked grant, or a clause-hash
 * mismatch (tampered/older text) all deny. A grant accepted under an OLDER
 * license version is honored but flagged `current:false` so the app can prompt
 * re-acceptance rather than silently relying on stale terms.
 */
export function resolveTrainingConsent(
  record: TrainingConsentRecord | null | undefined,
  opts: { currentVersion?: string; expectedHash?: string } = {}
): TrainingConsentVerdict {
  const currentVersion = opts.currentVersion ?? TRAINING_LICENSE_VERSION;
  if (!record) {
    return { granted: false, current: false, reason: 'no training-license acceptance on record' };
  }
  if (record.revokedAt) {
    return { granted: false, current: false, version: record.version, reason: 'training-license grant was withdrawn' };
  }
  if (!record.version || !record.acceptedAt) {
    return { granted: false, current: false, reason: 'incomplete consent record (missing version or acceptedAt)' };
  }
  // If we know the exact clause hash, a mismatch means the accepted text differs
  // from ours — treat as not-granted rather than assume equivalence.
  if (opts.expectedHash && record.textHash && record.textHash !== opts.expectedHash) {
    return { granted: false, current: false, version: record.version, reason: 'accepted clause hash does not match the current license text' };
  }
  const current = record.version === currentVersion;
  return {
    granted: true,
    current,
    version: record.version,
    reason: current ? undefined : `accepted under older license ${record.version}; current is ${currentVersion} — prompt re-acceptance`,
  };
}
