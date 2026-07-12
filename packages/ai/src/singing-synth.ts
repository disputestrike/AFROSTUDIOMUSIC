/**
 * SCORE-INPUT SINGING SYNTHESIS — the honest seam for the Own Singer's last leg.
 *
 * The chain that exists TODAY: the Melody Brain composes the score, the guide
 * WAV plays it, the artist (or the mumble booth) performs it once, and the
 * trained voice model converts that performance (voice-sing.ts). What does NOT
 * exist yet, anywhere hosted (verified on Replicate 2026-07-13: only voice
 * CONVERSION models are hosted — no DiffSinger-class score-in/vocals-out
 * service): an engine that takes the score + phonemes directly and sings with
 * no human pass at all.
 *
 * This seam is that engine's slot — the same honest not-configured pattern as
 * distribution.ts and voice-training.ts. The day a score-input engine is
 * hosted (or built into the worker image), the operator pins it here and the
 * whole pipeline lights up with zero rework:
 *   SINGING_SYNTH_MODEL    "owner/name" on Replicate (or 'local:<binary>')
 *   SINGING_SYNTH_VERSION  version hash (Replicate) — omit for local
 *   SINGING_SYNTH_INPUT    optional JSON template merged into the input
 * NOTHING here fabricates a model. Unconfigured → null, callers say so.
 */
import type { MelodyScore } from '@afrohit/shared';
import { replicateToken } from './providers/music';

export interface SingingSynthConfig {
  model: string;
  version?: string;
  extraInput: Record<string, unknown>;
}

export function singingSynthConfig(): SingingSynthConfig | null {
  const model = process.env.SINGING_SYNTH_MODEL?.trim();
  if (!model) return null;
  let extraInput: Record<string, unknown> = {};
  const raw = process.env.SINGING_SYNTH_INPUT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extraInput = parsed as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error('SINGING_SYNTH_INPUT is not valid JSON'), { statusCode: 500 });
    }
  }
  return { model, version: process.env.SINGING_SYNTH_VERSION?.trim() || undefined, extraInput };
}

export function singingSynthConfigured(): boolean {
  return singingSynthConfig() !== null;
}

/**
 * Sing a composed score. Returns null when no engine is pinned — callers keep
 * the guide-then-convert chain (melody guide → human/mumble pass → trained
 * voice) and SAY so, never pretending a synthesized vocal exists.
 */
export async function synthesizeSinging(opts: {
  score: MelodyScore;
  lyricsBySyllable?: string[];
  voiceModelUrl?: string;
  apiKey?: string;
}): Promise<{ url: string } | null> {
  const cfg = singingSynthConfig();
  if (!cfg) return null;
  const token = opts.apiKey || replicateToken();
  if (!token) throw Object.assign(new Error('REPLICATE_API_TOKEN missing'), { statusCode: 501 });
  if (!cfg.version) throw Object.assign(new Error('SINGING_SYNTH_VERSION required for a hosted engine'), { statusCode: 501 });
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      version: cfg.version,
      input: { score: opts.score, ...(opts.voiceModelUrl ? { voice_model: opts.voiceModelUrl } : {}), ...cfg.extraInput },
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`singing synth kickoff ${res.status}: ${(await res.text()).slice(0, 200)}`), { statusCode: 502 });
  const data = (await res.json()) as { id?: string; status?: string; output?: string | string[] };
  // Poll to terminal (engines of this class run minutes).
  const deadline = Date.now() + 15 * 60_000;
  let cur = data;
  while (cur.id && (cur.status === 'starting' || cur.status === 'processing') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8_000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${cur.id}`, { headers: { authorization: `Bearer ${token}` } });
    cur = (await poll.json()) as typeof cur;
  }
  const out = Array.isArray(cur.output) ? cur.output[0] : cur.output;
  if (cur.status === 'succeeded' && out) return { url: out };
  throw Object.assign(new Error(`singing synth ${cur.status ?? 'failed'}`), { statusCode: 502 });
}
