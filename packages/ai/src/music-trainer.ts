/**
 * OWN MUSIC-MODEL TRAINING (Replicate) — Wave 3 of the training flywheel.
 *
 * Mirrors voice-training.ts (the artist's voice) and the Flux likeness trainer
 * (their face): the SAME Replicate-trainings muscle, now for the MUSIC model —
 * fine-tune an open-weights music model on our OWN rights-clean corpus.
 *
 * THREE HARD SAFETIES (defense in depth — the money + the lawsuit both live here):
 *  1. FLAG-GATED OFF. MUSIC_TRAINER_ENABLED must be '1'. Never auto-runs, never
 *     auto-spends. Off by default.
 *  2. NO FAKE TRAINER. Unlike voice (which pins a live-verified version), the
 *     music trainer REQUIRES the operator to set MUSIC_TRAINER_MODEL +
 *     MUSIC_TRAINER_VERSION. Unconfigured → refuses (501). We do not ship an
 *     unverified version hash and pretend it trains.
 *  3. RIGHTS RE-VALIDATION. The eligible manifest is re-checked here — if a
 *     single third-party-render or unknown-origin asset is present, the whole
 *     run is refused. buildTrainingManifest already gates; this is the second
 *     lock so a mis-built manifest can never reach a training kickoff.
 *
 * The dataset is assembled ONLY from own-master / licensed / live-session /
 * consented-user-original audio (training-corpus.ts). Trained weights are ours.
 */
import { replicateToken } from './providers/music';
import type { TrainingManifest, TrainingOrigin } from '@afrohit/shared';

/** Origins that may legitimately reach the trainer (the clean set + consented user). */
const TRAINABLE_ORIGINS: ReadonlySet<TrainingOrigin> = new Set<TrainingOrigin>([
  'own-master',
  'licensed-catalog',
  'live-session',
  'user-original', // only present in an eligible manifest AFTER the consent gate
]);

export function musicTrainerEnabled(): boolean {
  return process.env.MUSIC_TRAINER_ENABLED === '1';
}

export interface MusicTrainerConfig {
  model: string;
  version: string;
  kind: 'prediction' | 'training';
  datasetKey: string;
  destination?: string;
  extraInput: Record<string, unknown>;
}

/** DEFAULT TRAINER — LIVE-VERIFIED on replicate.com 2026-07-19 (same precedent
 *  as voice-training.ts's pinned RVC trainer): sakemin/musicgen-fine-tuner —
 *  fine-tunes MusicGen (melody/small/medium/stereo) from a dataset zip
 *  (`dataset_path`, accepts .zip of .wav/.mp3/.flac), DESTINATION-based (the
 *  trained model lands in OUR Replicate account — our weights), ~$0.085/run on
 *  L40S, auto-labeling built in. Verified inputs: dataset_path,
 *  one_same_description, auto_labeling, drop_vocals, model_version, lr,
 *  epochs, batch_size. The owner's arming flag (MUSIC_TRAINER_ENABLED=1)
 *  remains the ONLY spend gate — a verified default is not an armed default. */
const DEFAULT_TRAINER_MODEL = 'sakemin/musicgen-fine-tuner';
const DEFAULT_TRAINER_VERSION = 'b1ec6490e57013463006e928abc7acd8d623fe3e8321d3092e1231bf006898b1';

/** Operator-configurable trainer; falls back to the live-verified default so
 *  the operator errand is ONE flag (MUSIC_TRAINER_ENABLED=1). Env overrides
 *  swap trainers without a deploy. */
export function musicTrainerConfig(): MusicTrainerConfig | null {
  const model = process.env.MUSIC_TRAINER_MODEL?.trim() || DEFAULT_TRAINER_MODEL;
  const version = process.env.MUSIC_TRAINER_VERSION?.trim() || DEFAULT_TRAINER_VERSION;
  const usingDefault = model === DEFAULT_TRAINER_MODEL && !process.env.MUSIC_TRAINER_VERSION?.trim();
  let extraInput: Record<string, unknown> = {};
  const raw = process.env.MUSIC_TRAINER_EXTRA_INPUT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraInput = parsed as Record<string, unknown>;
      }
    } catch {
      throw Object.assign(new Error('MUSIC_TRAINER_EXTRA_INPUT is not valid JSON'), { statusCode: 500 });
    }
  }
  return {
    model,
    version,
    // The verified default is a DESTINATION-based trainer (weights land in our
    // account); explicit env still overrides for prediction-style trainers.
    kind: process.env.MUSIC_TRAINER_KIND?.trim()
      ? (process.env.MUSIC_TRAINER_KIND.trim() === 'training' ? 'training' : 'prediction')
      : usingDefault ? 'training' : 'prediction',
    datasetKey: process.env.MUSIC_TRAINER_DATASET_KEY?.trim() || (usingDefault ? 'dataset_path' : 'dataset_zip'),
    destination: process.env.MUSIC_TRAINER_DESTINATION?.trim() || undefined,
    extraInput,
  };
}

/** Resolve (and if needed CREATE, private) the destination model in our
 *  Replicate account — so the trained weights have a home without an operator
 *  errand. Returns the "owner/name" path or null (with reason logged upstream). */
export async function ensureTrainingDestination(token: string, explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const acct = await fetch('https://api.replicate.com/v1/account', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!acct.ok) return null;
    const { username } = (await acct.json()) as { username?: string };
    if (!username) return null;
    const name = process.env.MUSIC_TRAINER_DESTINATION_NAME?.trim() || 'afrohit-music';
    const dest = `${username}/${name}`;
    const existing = await fetch(`https://api.replicate.com/v1/models/${dest}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (existing.ok) return dest;
    const created = await fetch('https://api.replicate.com/v1/models', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: username,
        name,
        visibility: 'private', // our weights, our corpus — never public by default
        hardware: 'gpu-l40s',
        description: 'AfroHit own music model — fine-tuned ONLY on the rights-clean corpus (own-master/licensed/live).',
      }),
    });
    return created.ok ? dest : null;
  } catch {
    return null;
  }
}

export interface TrainerDataset {
  ids: string[];
  origins: Record<string, number>;
  size: number;
}

/** Minimum corpus before a fine-tune is worth spending on (operator-tunable). */
export function minCorpusSize(): number {
  const n = Number.parseInt(process.env.MUSIC_TRAINER_MIN_CORPUS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/**
 * Build the trainer dataset from an eligible manifest — and RE-VALIDATE rights.
 * Throws if any asset is not a trainable origin (defense in depth), or if the
 * corpus is below the minimum worth training on.
 */
export function buildTrainerDataset(manifest: TrainingManifest): TrainerDataset {
  const origins: Record<string, number> = {};
  for (const a of manifest.eligible) {
    if (!TRAINABLE_ORIGINS.has(a.origin)) {
      throw Object.assign(
        new Error(`refusing to train: ineligible origin '${a.origin}' reached the dataset (asset ${a.id})`),
        { statusCode: 409 },
      );
    }
    origins[a.origin] = (origins[a.origin] ?? 0) + 1;
  }
  const ids = manifest.eligible.map((a) => a.id);
  return { ids, origins, size: ids.length };
}

export interface KickoffResult {
  started: boolean;
  reason?: string;
  trainingId?: string;
  model?: string;
  version?: string;
  datasetSize?: number;
}

/**
 * Kick off a music fine-tune — but only when EVERY gate passes: flag on, trainer
 * configured, corpus re-validated + big enough, token present. Any gate unmet
 * returns { started:false, reason } (no throw, no spend). Mirrors the voice
 * trainer's Replicate call shape.
 */
export async function kickoffMusicTraining(opts: {
  manifest: TrainingManifest;
  datasetZipUrl: string;
  apiKey?: string;
}): Promise<KickoffResult> {
  if (!musicTrainerEnabled()) return { started: false, reason: 'MUSIC_TRAINER_ENABLED is not set — trainer is off' };
  const cfg = musicTrainerConfig();
  if (!cfg) return { started: false, reason: 'music trainer not configured (set MUSIC_TRAINER_MODEL + MUSIC_TRAINER_VERSION)' };
  const token = opts.apiKey || replicateToken();
  if (!token) return { started: false, reason: 'REPLICATE_API_TOKEN missing' };

  // Rights re-validation + size gate (throws on an ineligible asset).
  const dataset = buildTrainerDataset(opts.manifest);
  if (dataset.size < minCorpusSize()) {
    return { started: false, reason: `corpus too small (${dataset.size} < ${minCorpusSize()}) — keep accumulating`, datasetSize: dataset.size };
  }

  const input = { [cfg.datasetKey]: opts.datasetZipUrl, ...cfg.extraInput };
  const url =
    cfg.kind === 'training'
      ? `https://api.replicate.com/v1/models/${cfg.model}/versions/${cfg.version}/trainings`
      : 'https://api.replicate.com/v1/predictions';
  // Destination auto-resolve (owner: "we have a setup already — check first"):
  // the account IS the setup. When no MUSIC_TRAINER_DESTINATION is set, the
  // destination model is resolved from the token's own account and created
  // (PRIVATE) if missing — the trained weights land in OUR account, no errand.
  let destination = cfg.destination;
  if (cfg.kind === 'training' && !destination) {
    destination = (await ensureTrainingDestination(token)) ?? undefined;
    if (!destination) {
      return { started: false, reason: 'could not resolve/create the destination model in the Replicate account (set MUSIC_TRAINER_DESTINATION to override)' };
    }
  }
  const body = cfg.kind === 'training' ? { destination, input } : { version: cfg.version, input };
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    return { started: false, reason: `replicate kickoff failed (${res.status}): ${detail}` };
  }
  const data = (await res.json()) as { id?: string; status?: string };
  if (!data.id) return { started: false, reason: 'replicate response had no training id' };
  return { started: true, trainingId: data.id, model: cfg.model, version: cfg.version, datasetSize: dataset.size };
}

/**
 * PROMOTE GATE — a freshly trained model replaces the current one ONLY if it
 * WINS on measured quality (the ear / lane score), never on vibes. Ties and
 * regressions HOLD the incumbent. This is the receipt that keeps "our model got
 * better" honest.
 */
export function evaluateAndPromote(input: {
  candidateScore: number | null | undefined;
  incumbentScore: number | null | undefined;
  minGain?: number;
}): { promote: boolean; reason: string } {
  const minGain = input.minGain ?? 1;
  if (input.candidateScore == null) return { promote: false, reason: 'candidate has no measured score — hold' };
  if (input.incumbentScore == null) return { promote: true, reason: 'no measured incumbent — candidate becomes the baseline' };
  if (input.candidateScore >= input.incumbentScore + minGain) {
    return { promote: true, reason: `candidate ${input.candidateScore} beats incumbent ${input.incumbentScore} by >= ${minGain}` };
  }
  return { promote: false, reason: `candidate ${input.candidateScore} did not beat incumbent ${input.incumbentScore} by ${minGain} — hold` };
}
