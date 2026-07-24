/**
 * THE TRAINING CORPUS — provenance-gated fuel for AfroHit's OWN music model.
 *
 * Owner decision (2026-07-18): "We have to train. Every music that comes here,
 * we have to train... our masters, our licensed catalog, and the users." This
 * module turns the catalog we already store into a rights-clean training
 * manifest, so nothing evaporates and the model compounds as content arrives.
 *
 * THE ONE LINE WE DO NOT CROSS (it protects us without discarding learning):
 *   Third-party-engine bytes enter weights only after an asset-level agreement
 *   explicitly grants commercial model-training rights. Before clearance they
 *   remain learning candidates for facts, evaluation, preference labels,
 *   provenance repair, licensing, and owned AfroOne recreation.
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
  | 'third-party-render' // provider output — trainable after explicit license evidence
  | 'unknown'; // provenance not established — retained for repair

/** Engines whose OUTPUT we may train on because we own/synthesize it. */
const OWN_ENGINES = new Set(['own', 'own_engine', 'afrohit-own', 'lora', 'forged', 'synth']);

/** Is this engine id one of OUR OWN engines ('lora' = our trained model's
 *  output — own-origin trainable fuel)? Exposed so the melody-topping law in
 *  training-capture.ts can distinguish an own-model topping (never downgrades a
 *  bed, never launders one either) from a third-party topping (dispositive). */
export function isOwnEngineId(engine: string | null | undefined): boolean {
  return OWN_ENGINES.has((engine ?? '').trim().toLowerCase());
}
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
  /** VocalRender.performanceSource ('artist_upload' | 'artist_import' | 'voice_conversion' | 'score_synth' | 'stem_separation' | ...). */
  performanceSource?: string | null;
  /** Did the uploader grant a training-license? (ToS/consent — operator-set, never inferred.) */
  consentGranted?: boolean | null;
  /** Does an asset-level agreement explicitly permit commercial model training? */
  trainingLicenseGranted?: boolean | null;
  /** Agreement/receipt id retained with the asset for audit. */
  trainingLicenseId?: string | null;
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
  const perf = (a.performanceSource ?? '').trim().toLowerCase();

  // 1. An explicit asset-level model-training license is dispositive. This is
  // the legal path for provider/Zap/catalog bytes; a global toggle is not.
  if (a.trainingLicenseGranted === true && typeof a.trainingLicenseId === 'string' && a.trainingLicenseId.trim()) {
    return 'licensed-catalog';
  }

  // 2. A third-party ENGINE stamp is dispositive — the audio is theirs. A
  //    'provider-generated' material rights-basis means a third-party generator
  //    produced it, same rule.
  if (THIRD_PARTY_ENGINES.has(engine)) return 'third-party-render';
  if (rights === 'provider-generated') return 'third-party-render';

  // 3. Own / synthesized origin — we own the audio. Includes our own render
  //    engine, forged synth loops, code/self-generated material, and our OWN
  //    voice model's conversion of a consented voice (own-model output).
  if (OWN_ENGINES.has(engine) || src === 'forged') return 'own-master';
  if (rights === 'code-generated' || rights === 'self-generated') return 'own-master';
  if (perf === 'voice_conversion' || perf === 'score_synth') return 'own-master';

  // 4. Licensed catalog — commercial license on file.
  if (rights === 'licensed') return 'licensed-catalog';

  // 5. Live session recording.
  if (src === 'live-session' || src === 'live') return 'live-session';

  // 6. User-uploaded ORIGINAL work (their stem / master / recording / voice).
  //    Trainable ONLY with consent — the gate below enforces that; here we only
  //    classify. A vocal the artist uploaded/imported is their original work.
  if (perf === 'artist_upload' || perf === 'artist_import') return 'user-original';
  if ((src === 'artist_stem' || src === 'upload' || src === 'user') && rights === 'user-attested') {
    return 'user-original';
  }

  // 7. Anything else (incl. stem_separation off an unknown mix): fail closed.
  return 'unknown';
}

export interface EligibilityVerdict {
  eligible: boolean;
  origin: TrainingOrigin;
  reason?: string;
}

/**
 * Legacy policy shape retained for API compatibility. A global operator switch
 * no longer admits provider bytes into weights. Outside-render learning controls
 * analysis and owned recreation; raw weights require asset-level license proof.
 */
export interface TrainingPolicy {
  allowThirdPartyRenders?: boolean;
}

/**
 * Can this asset train our weights? Reuses the W-5 provenance gate for the clean
 * three; adds the consent requirement for user-original; refuses everything else
 * with a plain reason (nothing is silently dropped).
 */
export function trainingEligibility(a: AssetProvenance, policy?: TrainingPolicy): EligibilityVerdict {
  void policy;
  const origin = deriveTrainingOrigin(a);
  switch (origin) {
    case 'own-master':
    case 'licensed-catalog':
    case 'live-session': {
      // Defer to the existing W-5 gate so there is ONE source of truth.
      const gate = validateDatasetTrack({ id: a.id, origin });
      return gate.ok ? { eligible: true, origin } : { eligible: false, origin, reason: gate.reason };
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
        reason: `track ${a.id}: provider bytes are pending an explicit commercial model-training license; retain facts/evaluations and create an owned AfroOne recreation for immediate weight training`,
      };
    case 'unknown':
    default:
      return {
        eligible: false,
        origin,
        reason: `track ${a.id}: provenance repair is pending; preserve the asset, recover its source/rights receipt, or create a documented owned recreation`,
      };
  }
}

/**
 * AFROREF ELIGIBILITY (trainlegal item 4) — may this asset enter the AfroRef
 * REFERENCE set (the measuring stick FAD-CLAP compares candidates against)?
 *
 * STRICTER than the training gate on purpose, and with NO policy override:
 * the reference set defines what "our sound" means, so it admits ONLY
 *  - own-engine renders / own masters ('own-master'), and
 *  - consented user-original uploads ('user-original' + consentGranted).
 * MiniMax/Suno/ACE-step/Eleven renders are refused UNCONDITIONALLY — even the
 * operator's outside-render learning toggle never reaches this gate. A
 * measuring stick built from someone else's engine would make every FAD
 * number a comparison to THEIR sound (and their ToS problem), not ours.
 */
export function afroRefEligibility(a: AssetProvenance): EligibilityVerdict {
  const origin = deriveTrainingOrigin(a);
  switch (origin) {
    case 'own-master':
      return { eligible: true, origin };
    case 'user-original':
      return a.consentGranted === true
        ? { eligible: true, origin }
        : {
            eligible: false,
            origin,
            reason: `clip ${a.id}: user-original audio needs an explicit training-license grant (consentGranted) before it can anchor the AfroRef reference set`,
          };
    case 'third-party-render':
      return {
        eligible: false,
        origin,
        reason: `clip ${a.id}: third-party-engine render (MiniMax/Suno/ACE-step/Eleven) — NEVER admitted to the AfroRef reference set, no override exists`,
      };
    case 'licensed-catalog':
    case 'live-session':
      return {
        eligible: false,
        origin,
        reason: `clip ${a.id}: AfroRef admits only own-engine renders and consented user-original uploads — '${origin}' stays training fuel, not the measuring stick`,
      };
    case 'unknown':
    default:
      return {
        eligible: false,
        origin,
        reason: `clip ${a.id}: provenance not established — refused (fail-closed)`,
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
export function buildTrainingManifest(rows: AssetProvenance[], policy?: TrainingPolicy): TrainingManifest {
  const eligible: TrainingManifest['eligible'] = [];
  const rejected: TrainingManifest['rejected'] = [];
  const byOrigin: Record<string, number> = {};
  for (const row of rows) {
    const v = trainingEligibility(row, policy);
    byOrigin[v.origin] = (byOrigin[v.origin] ?? 0) + 1;
    if (v.eligible) eligible.push({ id: row.id, origin: v.origin });
    else
      rejected.push({
        id: row.id,
        origin: v.origin,
        reason: v.reason ?? 'ineligible',
      });
  }
  return {
    eligible,
    rejected,
    counts: { total: rows.length, eligible: eligible.length, byOrigin },
  };
}
