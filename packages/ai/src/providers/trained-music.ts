/**
 * TRAINED-MODEL INFERENCE (Replicate) — the promoted OWN music model IN THE SOUND.
 *
 * Owner order 2026-07-20 ("where is all the training? we trained — where is
 * it?"): promotion used to write a pointer nothing read, so training was
 * invisible in the sound by construction. This adapter closes that: it runs ONE
 * prediction against the PROMOTED fine-tune (music.training.activeModel.v1 —
 * a MusicGen fine-tune living in OUR Replicate account, trained ONLY on the
 * rights-clean corpus) so the own-engine render can mix a trained topping layer.
 *
 * LAWS (same as every music adapter here):
 *  - FAIL-OPEN, NEVER THROW: every failure path returns { url: null, note }
 *    with an honest "trained layer skipped: <reason>" — a topping failure must
 *    never fail the take.
 *  - COST HONESTY: inference is a PAID Replicate call (~$0.08/render on the
 *    MusicGen-class hardware, same scale as the stock musicgen topping the
 *    own-engine cost guard prices at $0.07-0.08). Success carries
 *    estimatedCostUsd so the job's cost evidence stays real.
 *  - RIGHTS: the OUTPUT of our own trained model is own-origin trainable fuel —
 *    callers stamp the layer engine 'lora' (OWN_ENGINES, training-corpus.ts).
 *    Stock musicgen keeps its 'musicgen' stamp and stays third-party.
 */
import { replicateToken } from './music';

/** ~L40S MusicGen inference on Replicate. The trainer doc pegs ~$0.085/run on
 *  the same hardware; the own-engine cost guard prices the stock topping at
 *  $0.07-0.08. One honest default, override-free by design. */
export const TRAINED_MUSIC_LAYER_COST_USD = 0.08;

/** MusicGen conditioning window: a topping render is 8-30s by construction. */
const MIN_LAYER_S = 8;
const MAX_LAYER_S = 30;

/** Same shape musicCandidateModelRef promotes: "owner/name:versionhash". */
const TRAINED_MODEL_REF_RE =
  /^[a-z0-9][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*:[A-Za-z0-9_-]{6,128}$/;

/** Extract the runnable Replicate version hash from a promoted model ref.
 *  Returns null for anything that is not "owner/name:version" — an https
 *  weights URL cannot run through /v1/predictions, so the caller skips with an
 *  honest note instead of guessing. */
export function trainedModelVersion(modelRef: string | null | undefined): string | null {
  const text = (modelRef ?? '').trim();
  if (!TRAINED_MODEL_REF_RE.test(text)) return null;
  return text.slice(text.lastIndexOf(':') + 1);
}

/** PURE gate for the own-engine call site (unit-testable without a DB):
 *  a promoted ref + the flag not literally '0' => attempt the trained layer.
 *  Default ON when a ref exists — the owner ordered training INTO the sound. */
export function trainedLayerDecision(input: {
  modelRef: string | null;
  flag?: string | null;
}): { attempt: boolean; reason: string } {
  if (input.flag === '0') {
    return { attempt: false, reason: 'disabled by OWN_ENGINE_TRAINED_LAYER=0' };
  }
  if (!input.modelRef) {
    return {
      attempt: false,
      reason: 'no promoted music model yet (train + promote and the next render carries it)',
    };
  }
  return { attempt: true, reason: `promoted model ${input.modelRef}` };
}

export interface TrainedMusicLayerRequest {
  /** The promoted "owner/name:version" ref from the active-model route. */
  modelRef: string;
  /** Text conditioning — the render's genre/bpm/melodyPrompt. */
  prompt: string;
  durationS: number;
  apiKey?: string;
}

export interface TrainedMusicLayerResult {
  url: string | null;
  note: string;
  /** Present ONLY when audio actually rendered (money honestly spent). */
  estimatedCostUsd?: number;
}

/** Run one prediction on the promoted fine-tune. Mirrors the melodyLayer call
 *  shape (prefer:wait + bounded poll) so slower renders we already paid for are
 *  not dropped. NEVER throws. */
export async function renderTrainedMusicLayer(
  req: TrainedMusicLayerRequest
): Promise<TrainedMusicLayerResult> {
  const token = req.apiKey || replicateToken();
  if (!token) return { url: null, note: 'trained layer skipped: no REPLICATE_API_TOKEN' };
  const version = trainedModelVersion(req.modelRef);
  if (!version) {
    return {
      url: null,
      note: `trained layer skipped: promoted ref is not a runnable owner/name:version (${req.modelRef.slice(0, 80)})`,
    };
  }
  try {
    const duration = Math.min(
      MAX_LAYER_S,
      Math.max(MIN_LAYER_S, Math.round(req.durationS))
    );
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'wait=60',
      },
      body: JSON.stringify({
        version,
        input: { prompt: req.prompt, duration, output_format: 'wav' },
      }),
    });
    if (!res.ok) {
      return {
        url: null,
        note: `trained layer skipped: replicate ${res.status}: ${(await res.text()).slice(0, 160)}`,
      };
    }
    let data = (await res.json()) as {
      id?: string;
      status?: string;
      output?: string | string[] | null;
      error?: string | null;
    };
    // prefer:wait only holds 60s — poll out slower renders (up to ~5 min)
    // instead of dropping audio we already paid for.
    const deadline = Date.now() + 5 * 60_000;
    while (
      data.id &&
      (data.status === 'starting' || data.status === 'processing') &&
      Date.now() < deadline
    ) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const poll = await fetch(
        `https://api.replicate.com/v1/predictions/${data.id}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      if (!poll.ok) {
        return { url: null, note: `trained layer skipped: poll ${poll.status}` };
      }
      data = (await poll.json()) as typeof data;
    }
    const out = Array.isArray(data.output)
      ? data.output[data.output.length - 1]
      : data.output;
    if (data.status === 'succeeded' && typeof out === 'string' && out) {
      return {
        url: out,
        note: `trained layer: promoted model rendered a ${duration}s topping`,
        estimatedCostUsd: TRAINED_MUSIC_LAYER_COST_USD,
      };
    }
    return {
      url: null,
      note: `trained layer skipped: ${String(data.error ?? data.status ?? 'no output').slice(0, 160)}`,
    };
  } catch (err) {
    return {
      url: null,
      note: `trained layer skipped: ${((err as Error)?.message ?? 'unknown').slice(0, 120)}`,
    };
  }
}
