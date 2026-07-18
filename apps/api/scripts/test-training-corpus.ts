/**
 * TRAINING CORPUS — provenance gate proof (2026-07-18).
 *
 * Owner approved building the training flywheel ("every music that comes here,
 * we have to train... masters, licensed catalog, and the users"). This proves
 * the corpus gate implements that EXACTLY:
 *   - own-engine / licensed / live / consented-user-original  → TRAINABLE
 *   - user-original WITHOUT consent                            → refused
 *   - MiniMax / Suno / ACE-step / MusicGen renders             → refused (ToS)
 *   - unknown provenance                                       → refused (fail-closed)
 * and that a MiniMax render is refused EVEN when its lyrics rights look clean
 * (the engine stamp is dispositive — the instrumental is theirs).
 */
import assert from 'node:assert/strict';
import {
  deriveTrainingOrigin,
  trainingEligibility,
  buildTrainingManifest,
} from '../../../packages/shared/src/training-corpus';
import {
  resolveTrainingConsent,
  hashTrainingLicense,
  TRAINING_LICENSE_VERSION,
  TRAINING_LICENSE_CLAUSE,
} from '../../../packages/shared/src/training-consent';

// ── origin derivation ────────────────────────────────────────────────────────
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'own_engine' }), 'own-master', 'own engine → own-master');
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'afrohit-own' }), 'own-master', 'afrohit-own → own-master');
assert.equal(deriveTrainingOrigin({ id: 'a', materialSource: 'forged' }), 'own-master', 'forged synth → own-master');
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'minimax' }), 'third-party-render', 'minimax → third-party');
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'suno' }), 'third-party-render', 'suno bridge → third-party');
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'ace_step' }), 'third-party-render', 'ace_step → third-party');
assert.equal(deriveTrainingOrigin({ id: 'a', engine: 'musicgen' }), 'third-party-render', 'musicgen → third-party');
assert.equal(deriveTrainingOrigin({ id: 'a', rightsBasis: 'licensed' }), 'licensed-catalog', 'licensed → licensed-catalog');
assert.equal(deriveTrainingOrigin({ id: 'a', materialSource: 'live-session' }), 'live-session', 'live → live-session');
assert.equal(deriveTrainingOrigin({ id: 'a', materialSource: 'upload', rightsBasis: 'user-attested' }), 'user-original', 'user upload + attested → user-original');
assert.equal(deriveTrainingOrigin({ id: 'a' }), 'unknown', 'no provenance → unknown (fail-closed)');

// ── THE DISPOSITIVE RULE: a MiniMax render is theirs even with clean lyric rights
assert.equal(
  deriveTrainingOrigin({ id: 'x', engine: 'minimax', rightsBasis: 'user-attested', materialSource: 'upload' }),
  'third-party-render',
  'engine stamp beats a clean-looking rights basis — the instrumental is MiniMax'
);

// ── eligibility gate ─────────────────────────────────────────────────────────
assert.equal(trainingEligibility({ id: 'a', engine: 'own_engine' }).eligible, true, 'own-master trainable');
assert.equal(trainingEligibility({ id: 'a', rightsBasis: 'licensed' }).eligible, true, 'licensed trainable');
assert.equal(trainingEligibility({ id: 'a', materialSource: 'live-session' }).eligible, true, 'live trainable');

// user-original: the consent gate is the whole point of the owner's approval
const noConsent = trainingEligibility({ id: 'u1', materialSource: 'upload', rightsBasis: 'user-attested' });
assert.equal(noConsent.eligible, false, 'user-original WITHOUT consent is refused');
assert.match(noConsent.reason ?? '', /training-license grant|consent/i, 'refusal names the missing consent');
const withConsent = trainingEligibility({ id: 'u2', materialSource: 'upload', rightsBasis: 'user-attested', consentGranted: true });
assert.equal(withConsent.eligible, true, 'user-original WITH consent is trainable (the unlock)');

// the guard that protects the company
const mm = trainingEligibility({ id: 'm1', engine: 'minimax' });
assert.equal(mm.eligible, false, 'MiniMax render is NEVER trainable');
assert.match(mm.reason ?? '', /ToS|third-party|own engine/i, 'refusal explains WHY + the own-engine path');
assert.equal(trainingEligibility({ id: 'z' }).eligible, false, 'unknown provenance refused (fail-closed)');

// ── manifest: eligible + rejected both reported, nothing silently dropped ────
const manifest = buildTrainingManifest([
  { id: 'own1', engine: 'own_engine' },
  { id: 'own2', materialSource: 'forged' },
  { id: 'lic1', rightsBasis: 'licensed' },
  { id: 'live1', materialSource: 'live-session' },
  { id: 'usr_ok', materialSource: 'upload', rightsBasis: 'user-attested', consentGranted: true },
  { id: 'usr_no', materialSource: 'upload', rightsBasis: 'user-attested' },
  { id: 'mm1', engine: 'minimax' },
  { id: 'suno1', engine: 'suno' },
  { id: 'huh', engine: 'mystery-box' },
]);
assert.equal(manifest.counts.total, 9, 'all rows accounted for');
assert.equal(manifest.eligible.length, 5, 'exactly the 5 clean+consented rows train');
assert.equal(manifest.rejected.length, 4, 'the 4 (no-consent, minimax, suno, unknown) are refused WITH reasons');
assert.equal(manifest.eligible.length + manifest.rejected.length, manifest.counts.total, 'nothing silently dropped');
assert.ok(manifest.rejected.every((r) => !!r.reason), 'every rejection carries a reason');
assert.equal(manifest.counts.byOrigin['third-party-render'], 2, 'both third-party renders counted');

console.log('training-corpus gate: masters/licensed/live/consented-user TRAIN; MiniMax/Suno/unknown/unconsented REFUSED with reasons — nothing silently dropped.');
console.log(JSON.stringify(manifest.counts, null, 2));

// ── TRAINING-LICENSE CONSENT (ToS-on-signup, versioned + hashed) ─────────────
const HASH = hashTrainingLicense();
assert.equal(HASH, hashTrainingLicense(TRAINING_LICENSE_CLAUSE), 'hash is stable for the current clause');

// no record → not granted (fail-closed)
assert.equal(resolveTrainingConsent(null).granted, false, 'no acceptance → not granted');

// current-version acceptance → granted + current
const now = new Date().toISOString();
const good = resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: now, textHash: HASH }, { expectedHash: HASH });
assert.equal(good.granted, true, 'current signed ToS → granted');
assert.equal(good.current, true, 'flagged as current license');

// revoked → denied even if it was once accepted
assert.equal(resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: now, revokedAt: now }).granted, false, 'withdrawn grant → denied');

// older version → still honored but flagged not-current (prompt re-accept)
const older = resolveTrainingConsent({ version: 'tl-2026-01-01', acceptedAt: now }, { currentVersion: TRAINING_LICENSE_VERSION });
assert.equal(older.granted, true, 'older accepted license still grants');
assert.equal(older.current, false, 'older license flagged for re-acceptance');

// tampered/mismatched clause hash → denied (accepted text differs from ours)
assert.equal(
  resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: now, textHash: 'deadbeef' }, { expectedHash: HASH }).granted,
  false,
  'clause-hash mismatch → denied'
);

// end-to-end: a consented user-original asset trains, because consent resolves true
const consentTrue = resolveTrainingConsent({ version: TRAINING_LICENSE_VERSION, acceptedAt: now, textHash: HASH }, { expectedHash: HASH }).granted;
assert.equal(
  trainingEligibility({ id: 'e2e', materialSource: 'upload', rightsBasis: 'user-attested', consentGranted: consentTrue }).eligible,
  true,
  'ToS-accepted user-original flows through to trainable'
);

console.log('training-license consent: fail-closed, versioned, hashed, revocable — ToS acceptance resolves user-original to trainable.');
