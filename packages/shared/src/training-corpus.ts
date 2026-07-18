/**
 * THE TRAINING CORPUS — provenance-gated fuel for AfroHit's OWN music model.
 *
 * Owner decision (2026-07-18): "We have to train. Every music that comes here,
 * we have to train... our masters, our licensed catalog, and the users." This
 * module turns the catalog we already store into a rights-clean training
 * manifest, so nothing evaporates and the model compounds as content arrives.
 *
 * THE ONE LINE WE DO NOT CROSS (it protects us, it does not slow us):
 *   Third-party-engine renders (MiniMax / Suno bridge / ACE-step / MusicGen)
 *   are REJECTED as training fuel. That is MiniMax's and Suno's own ToS — their
 *   outputs may not train a competing model — not our preference. Training on
 *   them hands them a lawsuit and poisons the "rights-clean weights" claim that
 *   makes the model sellable. See lora-dataset.ts (ADDENDUM W-5).
 *
 * THE UNLOCK (how user content legitimately trains us):
 *   1. USER-ORIGINAL uploads (their own voice/master/stem/video) are trainable
 *      — but ONLY with an explicit training-license grant (consentGranted).
 *      The grant is a ToS/legal decision the operator makes; this code refuses
 *      to treat user content as trainable until that flag is true.
 *   2. OWN-ENGINE renders are own-origin → trainable. So moving generation onto
 *      our own engine is what turns every user song into training fuel — the
 *      quality goal and the training goal are the same goal.
 *
 * This module is READ-ONLY over existing rows and makes NO training decision on
 * its own — it classifies and gates. The trainer (Appendix A) consumes only
 * what buildTrainingManifest() returns as eligible.
 */
import { validateDatasetTrack, type DatasetTrackOrigin } from './lora-dataset';

/** Every provenance a candidate asset can carry, trainable or not. */
export type TrainingOrigin =
  | DatasetTrackOrigin // 'own-master' | 'licensed-catalog' | 'live-session' — the clean three
  | 'user-original' // user-uploaded original work — trainable ONLY with consent
  | 'third-party-render' // MiniMax/Suno/ACE-step/MusicGen output — NEVER trainable (their ToS)
  | 'unknown'; // provenance not established — refused (fail-closed)

/** Engines whose OUTPUT we may train on because we own/synthesize it. */
const OWN_ENGINES = new Set(['own', 'own_engine', 'afrohit-own', 'lora', 'forged', 'synth']);
/** Engines whose output is a third party's — ToS forbids training on it. */
const THIRD_PARTY_ENGINES = new Set([
  'minimax',
  'minimax_ref',
  'ace_step',
  'musicgen',
  'replicate', // generic replicate music model
  'suno', // the bridge — explicitly rejected even for first-party (lora-dataset W-5)
  'eleven',
]);

export interface AssetProvenance {
  id: string;
  /** Which engine rendered the audio (BeatAsset.provider / render `engine` field). */
  engine?: string | null;
  /** Material/reference source tag ('forged' | 'artist_stem' | 'upload' | 'live-session' | ...). */
  materialSource?: string | null;
  /** Recorded rights basis ('user-attested' | 'licensed' | 'code-generated' | 'provider-generated' | 'self-generated' | 'unknown'). */
  rightsBasis?: string | null;
  /** Did the uploader grant a training-license? (ToS/consent — operator-set, never inferred.) */
  consentGranted?: boolean | null;
}

/**
 * Derive the training origin from the provenance we already store. Deterministic
 * and fail-closed: anything not positively cleared lands in 'unknown' or
 * 'third-party-render', never silently in a trainable bucket.
 *
 * Order matters: a third-party engine STAMP is dispositive even if a rights
 * basis looks clean — a MiniMax render with "user-attested" lyrics is still a
 * MiniMax render, and its instrumental is theirs.
 */
export function deriveTrainingOrigin(a: AssetProvenance): TrainingOrigin {
  const engine = (a.engine ?? '').trim().toLowerCase();
  const src = (a.materialSource ?? '').trim().toLowerCase();
  const rights = (a.rightsBasis ?? '').trim().toLowerCase();

  // 1. A third-party ENGINE stamp is dispositive — the audio is theirs.
  if (THIRD_PARTY_ENGINES.has(engine)) return 'third-party-render';

  // 2. Own/synthesized engine output — we own the audio.
  if (OWN_ENGINES.has(engine) || src === 'forged') return 'own-master';

  // 3. Licensed catalog — commercial license on file.
  if (rights === 'licensed') return 'licensed-catalog';

  // 4. Live session recording.
  if (src === 'live-session' || src === 'live') return 'live-session';

  // 5. User-uploaded ORIGINAL work (their stem / master / recording). Trainable
  //    only with consent — the gate below enforces that; here we only classify.
  if (
    (src === 'artist_stem' || src === 'upload' || src === 'user') &&
    (rights === 'user-attested' || rights === 'self-generated')
  ) {
    return 'user-original';
  }

  // 6. Anything else: provenance not established → fail closed.
  return 'unknown';
}

export interface EligibilityVerdict {
  eligible: boolean;
  origin: TrainingOrigin;
  reason?: string;
}

/**
 * Can this asset train our weights? Reuses the W-5 provenance gate for the clean
 * three; adds the consent requirement for user-original; refuses everything else
 * with a plain reason (nothing is silently dropped).
 */
export function trainingEligibility(a: AssetProvenance): EligibilityVerdict {
  const origin = deriveTrainingOrigin(a);
  switch (origin) {
    case 'own-master':
    case 'licensed-catalog':
    case 'live-session': {
      // Defer to the existing W-5 gate so there is ONE source of truth.
      const gate = validateDatasetTrack({ id: a.id, origin });
      return gate.ok
        ? { eligible: true, origin }
        : { eligible: false, origin, reason: gate.reason };
    }
    case 'user-original':
      return a.consentGranted === true
        ? { eligible: true, origin }
        : {
            eligible: false,
            origin,
            reason: `track ${a.id}: user-original content needs an explicit training-license grant (consentGranted) before it can train our weights`,
          };
    case 'third-party-render':
      return {
        eligible: false,
        origin,
        reason: `track ${a.id}: third-party-engine output (MiniMax/Suno/ACE-step/MusicGen) — their ToS forbids training a competing model on it; render on our OWN engine to make it trainable`,
      };
    case 'unknown':
    default:
      return {
        eligible: false,
        origin,
        reason: `track ${a.id}: provenance not established — refused (fail-closed); stamp engine + rightsBasis to classify it`,
      };
  }
}

export interface TrainingManifest {
  eligible: Array<{ id: string; origin: TrainingOrigin }>;
  rejected: Array<{ id: string; origin: TrainingOrigin; reason: string }>;
  counts: {
    total: number;
    eligible: number;
    byOrigin: Record<string, number>;
  };
}

/**
 * Build the training manifest from a set of candidate assets. Returns BOTH the
 * eligible set and the rejected set (with reasons) — a training run must be able
 * to show exactly what it trained on and what it refused, so "rights-clean
 * weights" is provable, not asserted.
 */
export function buildTrainingManifest(rows: AssetProvenance[]): TrainingManifest {
  const eligible: TrainingManifest['eligible'] = [];
  const rejected: TrainingManifest['rejected'] = [];
  const byOrigin: Record<string, number> = {};
  for (const row of rows) {
    const v = trainingEligibility(row);
    byOrigin[v.origin] = (byOrigin[v.origin] ?? 0) + 1;
    if (v.eligible) eligible.push({ id: row.id, origin: v.origin });
    else rejected.push({ id: row.id, origin: v.origin, reason: v.reason ?? 'ineligible' });
  }
  return {
    eligible,
    rejected,
    counts: { total: rows.length, eligible: eligible.length, byOrigin },
  };
}
