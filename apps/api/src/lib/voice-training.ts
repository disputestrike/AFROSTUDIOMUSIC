/**
 * OWN-VOICE TRAINING (Replicate). The artist trains a singing-voice model on
 * HIS OWN recordings — his data, his rights, his weights.
 *
 * DEFAULT TRAINER (verified live on replicate.com 2026-07-12, README's own
 * documented version): replicate/train-rvc-model — a PREDICTION-style trainer:
 * ~$0.27/run on L40S, takes { dataset_zip, sample_rate, version, f0method,
 * epoch, batch_size }, dataset zip layout `dataset/<name>/split_<i>.wav`, and
 * OUTPUTS a URL to the trained model file (no destination model involved).
 * RVC lineage is MIT; the voice data is the artist's — the trained model is his.
 *
 * Env overrides (all optional now that the default is a real, verified trainer):
 *   VOICE_TRAINER_MODEL / VOICE_TRAINER_VERSION   swap trainers
 *   VOICE_TRAINER_KIND        'prediction' (default — train-rvc-model) or
 *                             'training' (destination-based trainers)
 *   VOICE_TRAINER_DATASET_KEY input field for the dataset zip (default dataset_zip)
 *   VOICE_TRAINER_EXTRA_INPUT JSON merged into the input
 *   VOICE_TRAINER_DESTINATION only for KIND=training
 */
import { replicateToken } from '@afrohit/ai';

const DEFAULT_TRAINER_MODEL = 'replicate/train-rvc-model';
const DEFAULT_TRAINER_VERSION = 'cf360587a27f67500c30fc31de1e0f0f9aa26dcd7b866e6ac937a07bd104bad9';
// The trainer's own documented defaults (48k / v2 / rmvpe_gpu recommended);
// epoch 50 per its README training example.
const DEFAULT_EXTRA_INPUT: Record<string, unknown> = { sample_rate: '48k', version: 'v2', f0method: 'rmvpe_gpu', epoch: 50, batch_size: '7' };

export interface VoiceTrainerConfig {
  model: string;
  version: string;
  kind: 'prediction' | 'training';
  datasetKey: string;
  extraInput: Record<string, unknown>;
}

export function voiceTrainerConfig(): VoiceTrainerConfig | null {
  const model = process.env.VOICE_TRAINER_MODEL?.trim() || DEFAULT_TRAINER_MODEL;
  const version = process.env.VOICE_TRAINER_VERSION?.trim() || DEFAULT_TRAINER_VERSION;
  const usingDefault = model === DEFAULT_TRAINER_MODEL && !process.env.VOICE_TRAINER_VERSION?.trim();
  let extraInput: Record<string, unknown> = usingDefault ? { ...DEFAULT_EXTRA_INPUT } : {};
  const raw = process.env.VOICE_TRAINER_EXTRA_INPUT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraInput = { ...extraInput, ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // Malformed operator JSON must not silently change the training input.
      throw Object.assign(new Error('VOICE_TRAINER_EXTRA_INPUT is not valid JSON'), { statusCode: 500 });
    }
  }
  return {
    model,
    version,
    kind: process.env.VOICE_TRAINER_KIND?.trim() === 'training' ? 'training' : 'prediction',
    datasetKey: process.env.VOICE_TRAINER_DATASET_KEY?.trim() || 'dataset_zip',
    extraInput,
  };
}

export function voiceTrainerConfigured(): boolean {
  return voiceTrainerConfig() !== null;
}

export interface StartTrainingResult {
  id: string;
  status: string;
}

/**
 * Kick off a training run. KIND=prediction (default — train-rvc-model):
 * POST /v1/predictions { version, input } and the trained model file arrives
 * as the prediction OUTPUT (a URL). KIND=training (destination-based trainers):
 * POST /v1/models/{model}/versions/{version}/trainings with { destination, input }
 * — destination must be a real "user/model" path, never invented here.
 */
export async function startVoiceTraining(opts: {
  datasetZipUrl: string;
  destination?: string;
  extra?: Record<string, unknown>;
  /** Workspace-pasted Replicate key (Settings → Music engine) overrides the env token. */
  apiKey?: string;
}): Promise<StartTrainingResult> {
  const cfg = voiceTrainerConfig();
  if (!cfg) throw Object.assign(new Error('voice trainer not configured'), { statusCode: 501 });
  const token = opts.apiKey || replicateToken();
  if (!token) throw Object.assign(new Error('REPLICATE_API_TOKEN missing'), { statusCode: 501 });

  const input = { [cfg.datasetKey]: opts.datasetZipUrl, ...cfg.extraInput, ...(opts.extra ?? {}) };
  const url =
    cfg.kind === 'training'
      ? `https://api.replicate.com/v1/models/${cfg.model}/versions/${cfg.version}/trainings`
      : 'https://api.replicate.com/v1/predictions';
  const body =
    cfg.kind === 'training'
      ? { destination: opts.destination, input }
      : { version: cfg.version, input };
  if (cfg.kind === 'training' && !opts.destination) {
    throw Object.assign(new Error('destination required for a destination-based trainer'), { statusCode: 400 });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw Object.assign(new Error(`replicate training kickoff ${res.status}: ${detail}`), {
      statusCode: 502,
    });
  }
  const data = (await res.json()) as { id?: string; status?: string };
  if (!data.id) throw Object.assign(new Error('replicate training response had no id'), { statusCode: 502 });
  return { id: data.id, status: data.status ?? 'starting' };
}

export interface TrainingState {
  /** Replicate statuses: starting | processing | succeeded | failed | canceled */
  status: string;
  output: unknown;
  error: string | null;
}

export async function getVoiceTraining(id: string, apiKey?: string): Promise<TrainingState> {
  const token = apiKey || replicateToken();
  if (!token) throw Object.assign(new Error('REPLICATE_API_TOKEN missing'), { statusCode: 501 });
  const cfg = voiceTrainerConfig();
  const endpoint = cfg?.kind === 'training' ? 'trainings' : 'predictions';
  const res = await fetch(`https://api.replicate.com/v1/${endpoint}/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`replicate training poll ${res.status}`), { statusCode: 502 });
  }
  const data = (await res.json()) as { status?: string; output?: unknown; error?: unknown };
  return {
    status: data.status ?? 'unknown',
    output: data.output ?? null,
    error: data.error != null ? String(data.error).slice(0, 500) : null,
  };
}
