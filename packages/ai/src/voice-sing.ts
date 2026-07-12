/**
 * SING WITH MY VOICE — the artist's TRAINED voice performs an existing track.
 *
 * Engine (schema verified live on replicate.com 2026-07-11):
 * zsxkib/realistic-voice-cloning (RVC v2, ~2M runs). `song_input` is a FULL
 * song or a bare vocal: the model separates the vocal, converts it with the
 * trained RVC model (`custom_rvc_model_download_url` — EXACTLY the trained
 * model file URL our training run outputs), and remixes it back over the
 * instrumental. Output: one audio file URI.
 *
 * HONEST LIMIT: the voice sings whatever the INPUT sings. RVC converts a
 * performance — it never invents one. Melody + timing come from the input
 * vocal (or the melody guide the artist hums over the beat).
 *
 * Community model → resolve the version at RUNTIME via GET /v1/models/{slug}
 * then POST /v1/predictions {version, input} (the same dance as
 * providers/music.ts community adapters). Operator overrides: SING_MODEL
 * (slug) and SING_VERSION (pin a version hash, skips the lookup).
 */
import { replicateToken } from './providers/music';

const DEFAULT_SING_MODEL = 'zsxkib/realistic-voice-cloning';

export type SingPitchChange = 'no-change' | 'male-to-female' | 'female-to-male';

/**
 * Realism knobs (schema-verified on the model 2026-07-13). The AI-sounding
 * artifacts live here: fixed loudness flattens human dynamics, unprotected
 * consonants/breaths get synthesis tearing, and the model's baked-in reverb
 * reads as "AI voice in a box".
 */
export interface SingTuning {
  /** 0–1: how much of the trained voice's character (feature index) to apply. */
  indexRate?: number;
  /** 0–1: 0 keeps the source performance's natural loudness dynamics; 1 = fixed. */
  rmsMixRate?: number;
  /** 0–0.5: breath/voiceless-consonant protection; 0.5 disables protection. */
  protect?: number;
  /** rmvpe (clarity, default) | mangio-crepe (smoother). */
  pitchAlgo?: 'rmvpe' | 'mangio-crepe';
  reverbWetness?: number;
  reverbSize?: number;
  reverbDryness?: number;
}

/**
 * Studio realism defaults — differ from the model's where the model's default
 * is the robotic choice: rms_mix_rate 0 (keep the human dynamics, model
 * default 0.25 partially flattens), drier reverb (our mix chain owns space).
 */
const REALISM_DEFAULTS = {
  index_rate: 0.5,
  rms_mix_rate: 0,
  protect: 0.33,
  pitch_detection_algorithm: 'rmvpe',
  reverb_wetness: 0.15,
  reverb_size: 0.1,
  reverb_dryness: 0.85,
} as const;

export interface SingWithVoiceOpts {
  /** A full song (or bare vocal) URL — the performance the voice will sing. */
  songInputUrl: string;
  /** Trained RVC model file URL (VoiceProfile training output). */
  modelUrl: string;
  pitchChange?: SingPitchChange;
  tuning?: SingTuning;
  /** Workspace-pasted Replicate key overrides the env token. */
  apiKey?: string;
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string | null;
}

/**
 * Run the conversion to a TERMINAL state and return the output URI.
 * T4-class hardware, typically a few MINUTES per song — poll every 10s,
 * capped at 30 minutes so a wedged prediction can't hold a worker forever.
 * Throws with the real reason on any failure (honest, never a placeholder).
 */
export async function singWithVoice(
  opts: SingWithVoiceOpts
): Promise<{ url: string; predictionId: string }> {
  const token = opts.apiKey || replicateToken();
  if (!token) throw new Error('REPLICATE_API_TOKEN missing');
  const auth = { authorization: `Bearer ${token}` };

  let version = process.env.SING_VERSION?.trim();
  if (!version) {
    const slug = process.env.SING_MODEL?.trim() || DEFAULT_SING_MODEL;
    const mres = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
    if (!mres.ok) {
      throw new Error(`sing model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}`);
    }
    version = ((await mres.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    if (!version) throw new Error('sing model has no version');
  }

  // Operator seam: SING_EXTRA_INPUT (JSON) merges LAST — experiment with any
  // model input without a code push. Malformed JSON must not silently change
  // the render — throw honestly.
  let envExtra: Record<string, unknown> = {};
  const rawExtra = process.env.SING_EXTRA_INPUT?.trim();
  if (rawExtra) {
    try {
      const parsed = JSON.parse(rawExtra) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) envExtra = parsed as Record<string, unknown>;
    } catch {
      throw new Error('SING_EXTRA_INPUT is not valid JSON');
    }
  }
  const t = opts.tuning ?? {};
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      version,
      input: {
        song_input: opts.songInputUrl,
        custom_rvc_model_download_url: opts.modelUrl,
        pitch_change: opts.pitchChange ?? 'no-change',
        output_format: 'wav',
        index_rate: t.indexRate ?? REALISM_DEFAULTS.index_rate,
        rms_mix_rate: t.rmsMixRate ?? REALISM_DEFAULTS.rms_mix_rate,
        protect: t.protect ?? REALISM_DEFAULTS.protect,
        pitch_detection_algorithm: t.pitchAlgo ?? REALISM_DEFAULTS.pitch_detection_algorithm,
        reverb_wetness: t.reverbWetness ?? REALISM_DEFAULTS.reverb_wetness,
        reverb_size: t.reverbSize ?? REALISM_DEFAULTS.reverb_size,
        reverb_dryness: t.reverbDryness ?? REALISM_DEFAULTS.reverb_dryness,
        ...envExtra,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`sing kickoff ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  let pred = (await res.json()) as ReplicatePrediction;
  if (!pred.id) throw new Error('sing kickoff: prediction had no id');

  const deadline = Date.now() + 30 * 60_000;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > deadline) throw new Error('sing conversion timed out after 30 minutes');
    await new Promise((r) => setTimeout(r, 10_000));
    const pres = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: auth });
    if (!pres.ok) throw new Error(`sing poll ${pres.status}`);
    pred = (await pres.json()) as ReplicatePrediction;
  }

  const url = Array.isArray(pred.output) ? pred.output[pred.output.length - 1] : pred.output;
  if (pred.status !== 'succeeded' || !url) {
    throw new Error(`sing conversion ${pred.status}: ${pred.error ?? 'no output'}`);
  }
  return { url, predictionId: pred.id };
}
