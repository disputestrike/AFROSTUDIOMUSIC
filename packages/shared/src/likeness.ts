/**
 * ARTIST LIKENESS — consent doctrine + pure gating laws.
 *
 * A likeness belongs to a real person. This mirrors the voice-consent law
 * (voice-consent.ts + the /voices consent flow) exactly: versioned consent is
 * recorded BEFORE any training or generation, everything is workspace-scoped,
 * no cross-tenant likeness ever, and every likeness render carries provenance.
 * Rights basis on trained models: 'user-attested-likeness' — the platform
 * frames the feature as OWN-FACE-ONLY and the signer attests it is their face.
 *
 * Every gate here is a PURE function so the API route, the worker processor,
 * and the UI honesty copy all enforce the same law from one place, and the
 * law itself is unit-testable without a database or a provider key.
 */

export const LIKENESS_CONSENT_VERSION = '2026-07-16.v1' as const;

export const LIKENESS_CONSENT_TEXT =
  'I confirm that I am the person shown in the submitted photos and videos, or that I am legally authorized by that person to act for them. I authorize AfroHit Studio to process the submitted images to create and use a visual likeness model for this workspace, so that generated artwork and music-video scenes can feature this likeness. I will not upload images of any other person, and I will not use the model to deceive, impersonate without disclosure, violate another person\'s rights, or create unlawful or intimate content. I understand that I can revoke this consent, which disables the likeness and starts deletion of the workspace copies and supported provider copies.' as const;

/** Rights basis recorded on every trained likeness model and every render made with one. */
export const LIKENESS_RIGHTS_BASIS = 'user-attested-likeness' as const;

/** Training refuses below this — a Flux LoRA needs enough angles of one face. */
export const MIN_LIKENESS_TRAINING_PHOTOS = 10;

export type LikenessStatus = 'pending' | 'training' | 'trained' | 'failed';

export type LikenessStatusEvent =
  | { type: 'training_started' }
  | { type: 'training_succeeded'; trainedModelRef: string }
  | { type: 'training_failed'; reason: string };

/**
 * The ONLY legal status transitions. Anything else returns null so callers
 * fail closed instead of writing an impossible state ("trained" without a
 * model ref, "trained" from "failed" without a new run, ...).
 *
 *   pending  --training_started-->  training
 *   trained  --training_started-->  training   (retrain with more photos)
 *   failed   --training_started-->  training   (retry)
 *   training --training_succeeded-> trained    (REQUIRES a trainedModelRef)
 *   training --training_failed---->  failed
 */
export function nextLikenessStatus(
  current: LikenessStatus,
  event: LikenessStatusEvent
): LikenessStatus | null {
  if (event.type === 'training_started') {
    return current === 'pending' || current === 'trained' || current === 'failed'
      ? 'training'
      : null;
  }
  if (current !== 'training') return null;
  if (event.type === 'training_succeeded') {
    return event.trainedModelRef.trim() ? 'trained' : null;
  }
  return 'failed';
}

export interface LikenessTrainingGateInput {
  /** Operator kill-switch: LIKENESS_TRAINING_ENABLED === '1'. Default OFF. */
  trainingEnabled: boolean;
  /** Consented, non-deleted photos owned by THIS workspace+artist. */
  photoCount: number;
  /** A LikenessConsent row exists for this artist. */
  consentRecorded: boolean;
  /** That consent has been revoked. */
  consentRevoked: boolean;
  /** A Replicate token is available (env or workspace key). */
  replicateConfigured: boolean;
}

export interface LikenessTrainingGate {
  ok: boolean;
  /** Honest, user-readable reasons — surfaced VERBATIM by the UI when the
   *  train button is disabled. Empty when ok. */
  reasons: string[];
}

/**
 * THE TRAINING GATE. One law, three enforcers (API route, worker processor,
 * UI button). No consent → refuse. Revoked consent → refuse. Fewer than
 * MIN_LIKENESS_TRAINING_PHOTOS photos → refuse. Operator flag off → refuse.
 * No provider key → refuse. Never trains "a little bit" — all or nothing.
 */
export function likenessTrainingGate(
  input: LikenessTrainingGateInput
): LikenessTrainingGate {
  const reasons: string[] = [];
  if (!input.trainingEnabled) {
    reasons.push(
      'Likeness training is not switched on for this studio yet — the operator must set LIKENESS_TRAINING_ENABLED=1.'
    );
  }
  if (!input.consentRecorded) {
    reasons.push('Sign the likeness consent first — training refuses without a recorded consent.');
  } else if (input.consentRevoked) {
    reasons.push('The likeness consent was revoked — sign a new consent before training.');
  }
  if (input.photoCount < MIN_LIKENESS_TRAINING_PHOTOS) {
    reasons.push(
      `Upload at least ${MIN_LIKENESS_TRAINING_PHOTOS} photos of yourself (${input.photoCount} so far) — varied angles and lighting train best.`
    );
  }
  if (!input.replicateConfigured) {
    // Wall discipline: no capitalized vendor branding on user surfaces — the
    // env-var name and the Settings screen are the actionable pointers.
    reasons.push('No training key is connected — paste your engine key in Settings → Music engine, or the operator sets REPLICATE_API_TOKEN.');
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// VIDEO ENGINE CLASSES — ADDENDUM §1.11 (the public/internal wall) applied to
// video. User surfaces speak CLASS language only ('draft' | 'standard' |
// 'flagship'); which vendor model backs a class is internal operator config.
// ---------------------------------------------------------------------------

export const VIDEO_ENGINE_CLASSES = ['draft', 'standard', 'flagship'] as const;
export type VideoEngineClass = (typeof VIDEO_ENGINE_CLASSES)[number];

export const DEFAULT_VIDEO_ENGINE_CLASS: VideoEngineClass = 'standard';

export function isVideoEngineClass(value: unknown): value is VideoEngineClass {
  return (
    typeof value === 'string' &&
    (VIDEO_ENGINE_CLASSES as readonly string[]).includes(value)
  );
}
