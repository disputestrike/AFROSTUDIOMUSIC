/**
 * OWN-VOICE TRAINING seam (Replicate trainings API). The artist trains a
 * singing-voice model on HIS OWN recordings — his data, his rights — and the
 * trained weights land in HIS Replicate account (a private destination model).
 *
 * The trainer itself is OPERATOR CONFIG, never guessed by code: pick an
 * RVC-family voice trainer on Replicate and pin it via env. NOTHING here
 * fabricates a model slug, version hash, or input schema:
 *   VOICE_TRAINER_MODEL       "owner/name" of the trainer on Replicate
 *   VOICE_TRAINER_VERSION     the trainer's version hash
 *   VOICE_TRAINER_DATASET_KEY the trainer's input field for the dataset zip
 *                             (default "dataset_zip" — check the trainer's schema)
 *   VOICE_TRAINER_EXTRA_INPUT optional JSON merged into the training input
 *   VOICE_TRAINER_DESTINATION default "user/model" destination (route param overrides)
 *
 * Unset model/version → the route answers 501 voice_training_not_configured,
 * the same honest not-configured seam as lib/distribution.ts.
 */
import { replicateToken } from '@afrohit/ai';

export interface VoiceTrainerConfig {
  model: string;
  version: string;
  datasetKey: string;
  extraInput: Record<string, unknown>;
}

export function voiceTrainerConfig(): VoiceTrainerConfig | null {
  const model = process.env.VOICE_TRAINER_MODEL?.trim();
  const version = process.env.VOICE_TRAINER_VERSION?.trim();
  if (!model || !version) return null;
  let extraInput: Record<string, unknown> = {};
  const raw = process.env.VOICE_TRAINER_EXTRA_INPUT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraInput = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed operator JSON must not silently change the training input.
      throw Object.assign(new Error('VOICE_TRAINER_EXTRA_INPUT is not valid JSON'), { statusCode: 500 });
    }
  }
  return {
    model,
    version,
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
 * Kick off a training run: POST /v1/models/{model}/versions/{version}/trainings
 * with { destination, input: { [datasetKey]: datasetZipUrl, ...extra } }.
 * `destination` must be an existing (or creatable) "user/model" path in the
 * ARTIST's Replicate account — never invented here.
 */
export async function startVoiceTraining(opts: {
  datasetZipUrl: string;
  destination: string;
  extra?: Record<string, unknown>;
  /** Workspace-pasted Replicate key (Settings → Music engine) overrides the env token. */
  apiKey?: string;
}): Promise<StartTrainingResult> {
  const cfg = voiceTrainerConfig();
  if (!cfg) throw Object.assign(new Error('voice trainer not configured'), { statusCode: 501 });
  const token = opts.apiKey || replicateToken();
  if (!token) throw Object.assign(new Error('REPLICATE_API_TOKEN missing'), { statusCode: 501 });

  const res = await fetch(
    `https://api.replicate.com/v1/models/${cfg.model}/versions/${cfg.version}/trainings`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        destination: opts.destination,
        input: { [cfg.datasetKey]: opts.datasetZipUrl, ...cfg.extraInput, ...(opts.extra ?? {}) },
      }),
    }
  );
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
  const res = await fetch(`https://api.replicate.com/v1/trainings/${id}`, {
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
