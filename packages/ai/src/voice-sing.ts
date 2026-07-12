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

export interface SingWithVoiceOpts {
  /** A full song (or bare vocal) URL — the performance the voice will sing. */
  songInputUrl: string;
  /** Trained RVC model file URL (VoiceProfile training output). */
  modelUrl: string;
  pitchChange?: SingPitchChange;
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
