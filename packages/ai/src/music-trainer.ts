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
import { createHash } from 'node:crypto';
import { replicateToken } from './providers/music';
import {
  classifyModelLicense,
  type ModelLicense,
  type RouteLane,
} from './music-license';
import type { TrainingManifest, TrainingOrigin } from '@afrohit/shared';

/** LICENSE LAW (trainlegal): MODEL_LICENSES, licenseAllowsCommercial(),
 *  laneForBaseModel(), licenseGateReceipt() and the per-(genre|language)
 *  adapter route table are single-sourced in music-license.ts and re-exported
 *  here so the trainer surface carries its own legal classification. */
export * from './music-license';

const REPLICATE_API = 'https://api.replicate.com/v1';
const REQUEST_TIMEOUT_MS = 30_000;

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
  /** License of the BASE model this trainer fine-tunes (fail-closed 'unknown').
   *  Adapters inherit it: a cc-by-nc base (MusicGen) means every adapter is
   *  confined to the dev lane by the promotion gate — never a commercial render. */
  license: ModelLicense;
}

/** NO DEFAULT TRAINER SHIPS — the license unlock, told honestly (audited
 *  2026-07-21). Reaching the PRODUCTION lane requires an Apache-2.0 base
 *  (ACE-Step / YuE). But there is NO turnkey ACE-Step/YuE LoRA fine-tuner
 *  callable as a Replicate (or fal) model the way sakemin/musicgen-fine-tuner
 *  is: ACE-Step and YuE fine-tuning is a SELF-HOSTED GPU run today (their
 *  repo's trainer.py / one-click Gradio / ACE-Step's own hosted training
 *  endpoint), and the ACE-Step we already serve for INFERENCE
 *  (lucataco/ace-step on Replicate, fal-ai/ace-step) exposes no Train tab.
 *  So we refuse two dishonest shortcuts:
 *    1. shipping the CC-BY-NC MusicGen fine-tuner as the DEFAULT — its adapters
 *       are license-capped to the isolated dev lane forever, so "approve the
 *       training" can never change a production render (exactly the owner's bug);
 *    2. fabricating an ACE-Step version hash and pretending it trains.
 *  Instead the trainer stays UNCONFIGURED until the operator supplies a REAL
 *  Apache-2.0 trainer ref via MUSIC_TRAINER_MODEL + MUSIC_TRAINER_VERSION. The
 *  code is READY: an ace-step/yue trainer classifies apache-2.0
 *  (music-license.ts), so decideMusicCandidatePromotion opens the production
 *  lane the moment such a ref is set. The trainer ref is the ONE external
 *  dependency; MUSIC_TRAINER_ENABLED=1 stays the only spend gate. The MusicGen
 *  fine-tuner may still be set EXPLICITLY for dev-lane experiments — it simply
 *  can't be the silent default that never reaches production. */
export function musicTrainerConfig(): MusicTrainerConfig | null {
  const model = process.env.MUSIC_TRAINER_MODEL?.trim();
  const version = process.env.MUSIC_TRAINER_VERSION?.trim();
  // Unconfigured → refuse (no kickoff, no spend). We never ship an unverified
  // version hash and pretend it trains (see the block above).
  if (!model || !version) return null;
  let extraInput: Record<string, unknown> = {};
  const raw = process.env.MUSIC_TRAINER_EXTRA_INPUT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraInput = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      throw Object.assign(new Error('MUSIC_TRAINER_EXTRA_INPUT is not valid JSON'), { statusCode: 500 });
    }
  }
  return {
    model,
    version,
    // A real LoRA fine-tuner is a DESTINATION-based Replicate training (the
    // trained weights land in OUR account); default to 'training'. A
    // prediction-style trainer sets MUSIC_TRAINER_KIND=prediction.
    kind: process.env.MUSIC_TRAINER_KIND?.trim() === 'prediction' ? 'prediction' : 'training',
    datasetKey: process.env.MUSIC_TRAINER_DATASET_KEY?.trim() || 'dataset_zip',
    destination: process.env.MUSIC_TRAINER_DESTINATION?.trim() || undefined,
    extraInput,
    // Fail-closed classification of the BASE model's weight license. An
    // ace-step/yue trainer classifies apache-2.0 → the promotion gate opens the
    // production lane; anything unknown (or an explicitly-set cc-by-nc MusicGen
    // trainer) stays dev-lane only.
    license: classifyModelLicense(model),
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
        description: 'AfroHits own music model — fine-tuned ONLY on the rights-clean corpus (own-master/licensed/live).',
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

export interface TrainerDatasetFingerprint {
  id: string;
  origin: TrainingOrigin;
  /** Prefer the audio sha256. A stable storage URL is an acceptable fallback. */
  contentFingerprint?: string | null;
}

/** Stable hash used by the worker's idempotency receipt. Input order never
 * changes the result, while any asset, provenance, or content change does. */
export function trainingDatasetHash(
  assets: readonly TrainerDatasetFingerprint[]
): string {
  const normalized = assets
    .map(asset => ({
      id: asset.id.trim(),
      origin: asset.origin,
      contentFingerprint: asset.contentFingerprint?.trim() || null,
    }))
    .sort((a, b) =>
      a.id.localeCompare(b.id) ||
      a.origin.localeCompare(b.origin) ||
      (a.contentFingerprint ?? '').localeCompare(b.contentFingerprint ?? '')
    );
  return createHash('sha256')
    .update(JSON.stringify({ schema: 'afrohit-music-dataset-v1', assets: normalized }), 'utf8')
    .digest('hex');
}

/** Minimum corpus before a fine-tune is worth spending on (operator-tunable). */
export function minCorpusSize(): number {
  const n = Number.parseInt(process.env.MUSIC_TRAINER_MIN_CORPUS ?? '', 10);
  // ACE-Step's wrapper requires at least three usable 30s+ song segments.
  // Small early corpora may train a candidate, but measured evaluation still
  // blocks promotion unless that candidate beats the incumbent.
  return Number.isFinite(n) && n > 0 ? n : 3;
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
  kind?: MusicTrainerConfig['kind'];
  destination?: string;
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

  // MUSIC_TRAINER_VERSION=latest → resolve the trainer's newest pushed version
  // at kickoff, so re-pushing the Cog image never needs a hash-paste errand.
  // Fail-closed: an unresolvable 'latest' refuses instead of guessing.
  let version = cfg.version;
  if (version.toLowerCase() === 'latest') {
    try {
      const res = await fetch(`https://api.replicate.com/v1/models/${cfg.model}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = res.ok ? ((await res.json()) as { latest_version?: { id?: string } }) : null;
      const resolved = data?.latest_version?.id;
      if (!resolved) {
        return { started: false, reason: `could not resolve latest version of ${cfg.model} (HTTP ${res.status}) — has the trainer image been pushed?` };
      }
      version = resolved;
    } catch (err) {
      return { started: false, reason: `latest-version lookup failed: ${(err as Error).message.slice(0, 120)}` };
    }
  }

  const input = { [cfg.datasetKey]: opts.datasetZipUrl, ...cfg.extraInput };
  const url =
    cfg.kind === 'training'
      ? `https://api.replicate.com/v1/models/${cfg.model}/versions/${version}/trainings`
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
  const body = cfg.kind === 'training' ? { destination, input } : { version, input };
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
  return {
    started: true,
    trainingId: data.id,
    model: cfg.model,
    version,
    kind: cfg.kind,
    destination,
    datasetSize: dataset.size,
  };
}

/**
 * PROMOTE GATE — a freshly trained model replaces the current one ONLY if it
 * WINS on measured quality (the ear / lane score), never on vibes. Ties and
 * regressions HOLD the incumbent. This is the receipt that keeps "our model got
 * better" honest.
 */
export type MusicTrainingProviderStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface MusicTrainingProviderState {
  id: string;
  status: MusicTrainingProviderStatus;
  output?: unknown;
  error?: string | null;
  metrics?: unknown;
}

function normalizeProviderStatus(status: unknown): MusicTrainingProviderStatus {
  if (status === 'starting' || status === 'processing' || status === 'succeeded' || status === 'failed') {
    return status;
  }
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  throw new Error(`replicate training returned unsupported status '${String(status)}'`);
}

/** Poll one durable Replicate training/prediction id. The kind is stored in the
 * kickoff receipt so changing environment variables cannot redirect an
 * in-flight poll to the wrong endpoint. */
export async function pollMusicTraining(opts: {
  trainingId: string;
  kind: MusicTrainerConfig['kind'];
  apiKey?: string;
}): Promise<MusicTrainingProviderState> {
  const token = opts.apiKey || replicateToken();
  if (!token) throw new Error('REPLICATE_API_TOKEN missing');
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(opts.trainingId)) {
    throw new Error('music training id is invalid');
  }
  const collection = opts.kind === 'training' ? 'trainings' : 'predictions';
  const res = await fetch(`${REPLICATE_API}/${collection}/${opts.trainingId}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`replicate music training poll ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    id?: unknown;
    status?: unknown;
    output?: unknown;
    error?: unknown;
    metrics?: unknown;
  };
  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('replicate music training poll returned no id');
  }
  return {
    id: data.id,
    status: normalizeProviderStatus(data.status),
    output: data.output,
    error: typeof data.error === 'string' ? data.error : null,
    metrics: data.metrics,
  };
}

const MODEL_REF_RE = /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*:[A-Za-z0-9_-]{6,128}$/;
const VERSION_RE = /^[A-Za-z0-9_-]{6,128}$/;

/** Resolve the runnable artifact out of the different Replicate trainer output
 * shapes. A bare version hash is accepted only when bound to the kickoff's
 * durable destination. */
export function musicCandidateModelRef(
  output: unknown,
  destination?: string | null
): string | null {
  const accept = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (MODEL_REF_RE.test(text) || /^https:\/\//i.test(text)) return text;
    if (
      destination &&
      /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(destination) &&
      VERSION_RE.test(text)
    ) {
      return `${destination}:${text}`;
    }
    return null;
  };
  const direct = accept(output);
  if (direct) return direct;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  for (const key of ['version', 'model_version', 'trained_model', 'model', 'weights']) {
    const found = accept(record[key]);
    if (found) return found;
  }
  return null;
}

export interface MusicModelRouteEntry {
  modelRef: string;
  providerJobId: string;
  trainingId: string;
  datasetHash: string;
  score: number;
  evaluatedAt: string;
  activatedAt: string;
  /** LICENSE LANE (trainlegal): 'production' ONLY when the base model's
   *  license permits commercial use. Absent on legacy entries → parsed as
   *  'dev' (fail-closed) so a pre-gate MusicGen fine-tune can never keep
   *  backing commercial renders on a technicality. */
  lane?: RouteLane;
  license?: ModelLicense;
}

export interface MusicModelRouteEvent {
  type: 'promoted' | 'rolled_back';
  from: string | null;
  to: string;
  at: string;
  reason: string;
}

/** Versioned, reversible pointer persisted in SystemSetting by the worker. */
export interface MusicModelRouteState {
  schemaVersion: 1;
  active: MusicModelRouteEntry | null;
  previous: MusicModelRouteEntry | null;
  events: MusicModelRouteEvent[];
  updatedAt: string;
}

export function emptyMusicModelRoute(at = new Date(0).toISOString()): MusicModelRouteState {
  return { schemaVersion: 1, active: null, previous: null, events: [], updatedAt: at };
}

function routeEntry(value: unknown): MusicModelRouteEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.modelRef !== 'string' || !row.modelRef.trim() ||
    typeof row.providerJobId !== 'string' || !row.providerJobId ||
    typeof row.trainingId !== 'string' || !row.trainingId ||
    typeof row.datasetHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.datasetHash) ||
    typeof row.score !== 'number' || !Number.isFinite(row.score) ||
    typeof row.evaluatedAt !== 'string' ||
    typeof row.activatedAt !== 'string'
  ) return null;
  return {
    modelRef: row.modelRef.trim(),
    providerJobId: row.providerJobId,
    trainingId: row.trainingId,
    datasetHash: row.datasetHash,
    score: row.score,
    evaluatedAt: row.evaluatedAt,
    activatedAt: row.activatedAt,
    // Fail-closed lane parse: anything not explicitly 'production' is 'dev'.
    lane: row.lane === 'production' ? 'production' : 'dev',
    license:
      row.license === 'cc-by-nc' || row.license === 'apache-2.0'
        ? row.license
        : 'unknown',
  };
}

export function parseMusicModelRoute(raw: string | null | undefined): MusicModelRouteState {
  if (!raw) return emptyMusicModelRoute();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== 1) return emptyMusicModelRoute();
    const events = Array.isArray(value.events)
      ? value.events.filter((event): event is MusicModelRouteEvent => {
          if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
          const row = event as Record<string, unknown>;
          return (row.type === 'promoted' || row.type === 'rolled_back') &&
            (row.from === null || typeof row.from === 'string') &&
            typeof row.to === 'string' && typeof row.at === 'string' && typeof row.reason === 'string';
        }).slice(-50)
      : [];
    return {
      schemaVersion: 1,
      active: routeEntry(value.active),
      previous: routeEntry(value.previous),
      events,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyMusicModelRoute();
  }
}

/**
 * THE LANE-GATED PRODUCTION RESOLVER (pure, single-sourced). The active pointer
 * backs a commercial render ONLY when it sits in the 'production' lane. A dev
 * pointer, or a legacy entry that parses fail-closed to 'dev' (a pre-gate
 * MusicGen fine-tune), returns null so a non-commercial-base adapter can never
 * leak onto a paying render. The worker's DB-bound resolveActiveMusicModelRef
 * reads the route, then calls THIS — so "does the trained layer reach
 * production?" is answered by one function the offline gate can also prove.
 */
export function activeProductionModelRef(route: MusicModelRouteState): string | null {
  const active = route.active;
  if (!active) return null;
  return active.lane === 'production' ? active.modelRef : null;
}

export function promoteMusicModelRoute(input: {
  current: MusicModelRouteState;
  candidate: Omit<MusicModelRouteEntry, 'activatedAt'>;
  reason: string;
  at?: string;
}): MusicModelRouteState {
  const at = input.at ?? new Date().toISOString();
  const active: MusicModelRouteEntry = { ...input.candidate, activatedAt: at };
  return {
    schemaVersion: 1,
    active,
    previous: input.current.active,
    events: [...input.current.events, {
      type: 'promoted' as const,
      from: input.current.active?.modelRef ?? null,
      to: active.modelRef,
      at,
      reason: input.reason,
    }].slice(-50),
    updatedAt: at,
  };
}

export function rollbackMusicModelRoute(input: {
  current: MusicModelRouteState;
  reason: string;
  at?: string;
}): { rolledBack: boolean; route: MusicModelRouteState; reason: string } {
  if (!input.current.previous) {
    return { rolledBack: false, route: input.current, reason: 'no previous active music model to restore' };
  }
  const at = input.at ?? new Date().toISOString();
  const restored = { ...input.current.previous, activatedAt: at };
  return {
    rolledBack: true,
    reason: input.reason,
    route: {
      schemaVersion: 1,
      active: restored,
      previous: input.current.active,
      events: [...input.current.events, {
        type: 'rolled_back' as const,
        from: input.current.active?.modelRef ?? null,
        to: restored.modelRef,
        at,
        reason: input.reason,
      }].slice(-50),
      updatedAt: at,
    },
  };
}

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
