/**
 * Stem separation (Demucs on Replicate) — turn a finished song into an
 * INSTRUMENTAL + individual stems, all legally (it only processes audio we
 * already generated / the user owns).
 *
 *  - mode 'instrumental': two-stem split (vocals + no_vocals) → a clean
 *    downloadable instrumental of the actual record.
 *  - mode 'full': four stems (vocals/drums/bass/other) → true remix material.
 */
import { replicateToken } from './providers/music';

const DEMUCS_MODEL = process.env.REPLICATE_DEMUCS_MODEL ?? 'cjwbw/demucs';

export interface StemSeparationResult {
  instrumentalUrl?: string;
  stems: Array<{ role: string; url: string }>;
  raw?: unknown;
}

interface DemucsPrediction {
  id: string;
  status: string;
  output?: unknown;
  error?: string;
}

export async function separateStems(opts: {
  audioUrl: string;
  apiKey?: string;
  mode?: 'instrumental' | 'full';
}): Promise<StemSeparationResult> {
  const token = opts.apiKey || replicateToken();
  if (!token) throw new Error('REPLICATE_API_TOKEN missing — connect your music engine first');
  const auth = { authorization: `Bearer ${token}` };

  let version = process.env.REPLICATE_DEMUCS_VERSION;
  if (!version) {
    const mres = await fetch(`https://api.replicate.com/v1/models/${DEMUCS_MODEL}`, { headers: auth });
    if (!mres.ok) throw new Error(`demucs model lookup ${mres.status}: ${(await mres.text()).slice(0, 160)}`);
    version = ((await mres.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    if (!version) throw new Error('demucs: model has no version');
  }

  // Demucs two-stem mode: stem=vocals → outputs `vocals` + `no_vocals` (the
  // instrumental). Omit `stem` for the full four-way split.
  const input: Record<string, unknown> = { audio: opts.audioUrl };
  if (opts.mode === 'instrumental') input.stem = 'vocals';

  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`demucs ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let data = (await res.json()) as DemucsPrediction;
  let attempts = 0;
  while ((data.status === 'starting' || data.status === 'processing') && attempts < 48) {
    await new Promise((r) => setTimeout(r, 5_000));
    attempts += 1;
    const pres = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, { headers: auth });
    if (!pres.ok) break;
    data = (await pres.json()) as DemucsPrediction;
  }
  if (data.status !== 'succeeded' || !data.output) {
    throw new Error(`demucs ${data.status}: ${data.error ?? 'no output'}`);
  }
  return mapOutput(data.output, opts.mode ?? 'instrumental');
}

/** Demucs output shape varies by model build — handle object OR array. */
function mapOutput(output: unknown, mode: 'instrumental' | 'full'): StemSeparationResult {
  let stems: Array<{ role: string; url: string }> = [];

  const classify = (key: string): string => {
    const k = key.toLowerCase();
    if (k.includes('no_vocal') || k.includes('novocal') || k === 'instrumental') return 'instrumental';
    if (k.includes('vocal')) return 'vocals';
    if (k.includes('drum')) return 'drums';
    if (k.includes('bass')) return 'bass';
    if (k.includes('other') || k.includes('accompan') || k.includes('melod')) return 'other';
    return k;
  };

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    for (const [key, val] of Object.entries(output as Record<string, unknown>)) {
      if (typeof val !== 'string' || !/^https?:\/\//.test(val)) continue;
      stems.push({ role: classify(key), url: val });
    }
  } else if (Array.isArray(output)) {
    (output as unknown[]).forEach((u, i) => {
      if (typeof u === 'string' && /^https?:\/\//.test(u)) stems.push({ role: `stem_${i + 1}`, url: u });
    });
  }

  // Two-stem mode (stem=vocals) returns `vocals` + `other`, where `other` is the
  // full no-vocals mix = the instrumental. Relabel it so it downloads correctly.
  if (mode === 'instrumental') {
    const nonVocal = stems.filter((s) => s.role !== 'vocals');
    if (nonVocal.length === 1) nonVocal[0]!.role = 'instrumental';
  }

  const instrumentalUrl = stems.find((s) => s.role === 'instrumental')?.url;
  return { instrumentalUrl, stems, raw: output };
}
