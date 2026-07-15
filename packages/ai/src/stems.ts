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
import type {
  StemAudioContentType,
  StemAudioFormat,
  StemAudioOutput,
} from './providers/types';

const DEMUCS_MODEL = process.env.REPLICATE_DEMUCS_MODEL ?? 'cjwbw/demucs';

export interface StemSeparationResult {
  instrumentalUrl?: string;
  stems: StemAudioOutput[];
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
  // REPLICATE_DEMUCS_OUTPUT=wav: ask the model for lossless stems instead of its
  // mp3 default — the TRUE INSTRUMENTAL path must not re-encode a finished
  // master. Opt-in only (bigger transfers); default keeps the old behavior.
  const outputFormat: StemAudioFormat =
    (process.env.REPLICATE_DEMUCS_OUTPUT ?? '').toLowerCase() === 'wav' ? 'wav' : 'mp3';
  if (outputFormat === 'wav') input.output_format = 'wav';

  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`demucs ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let data = (await res.json()) as DemucsPrediction;
  let attempts = 0;
  let pollFails = 0;
  while ((data.status === 'starting' || data.status === 'processing') && attempts < 48) {
    await new Promise((r) => setTimeout(r, 5_000));
    attempts += 1;
    const pres = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, { headers: auth });
    if (!pres.ok) {
      // Transient poll blip (429/5xx) — retry rather than losing a render that
      // would have succeeded on the next poll. Only give up after several in a row.
      pollFails += 1;
      if (pollFails > 5) throw new Error(`demucs poll failed ${pres.status}`);
      continue;
    }
    pollFails = 0;
    data = (await pres.json()) as DemucsPrediction;
  }
  if (data.status !== 'succeeded' || !data.output) {
    throw new Error(`demucs ${data.status}: ${data.error ?? 'no output'}`);
  }
  return mapOutput(data.output, opts.mode ?? 'instrumental', outputFormat);
}

/** Demucs output shape varies by model build — handle object OR array. */
function mapOutput(
  output: unknown,
  mode: 'instrumental' | 'full',
  fallbackFormat: StemAudioFormat,
): StemSeparationResult {
  const stems: StemAudioOutput[] = [];

  const contentTypeFor = (format: StemAudioFormat): StemAudioContentType =>
    format === 'wav' ? 'audio/wav' : format === 'flac' ? 'audio/flac' : 'audio/mpeg';

  const normalizeFormat = (value: unknown): StemAudioFormat | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.toLowerCase().trim().replace(/^\./, '');
    if (normalized === 'wav' || normalized === 'wave' || normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
    if (normalized === 'mp3' || normalized === 'mpeg' || normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3';
    if (normalized === 'flac' || normalized === 'audio/flac' || normalized === 'audio/x-flac') return 'flac';
    return undefined;
  };

  const formatFromUrl = (url: string): StemAudioFormat | undefined => {
    try {
      const match = /\.(wav|wave|mp3|flac)$/i.exec(new URL(url).pathname);
      return normalizeFormat(match?.[1]);
    } catch {
      return undefined;
    }
  };

  const remoteStem = (value: unknown): Omit<StemAudioOutput, 'role'> | null => {
    let url: string | undefined;
    let declaredFormat: unknown;
    let declaredContentType: unknown;
    if (typeof value === 'string') {
      url = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      url = typeof record.url === 'string' ? record.url : undefined;
      declaredFormat = record.format;
      declaredContentType = record.contentType ?? record.content_type ?? record.mimeType ?? record.mime_type;
    }
    if (!url || !/^https?:\/\//.test(url)) return null;
    const format =
      normalizeFormat(declaredFormat) ??
      normalizeFormat(declaredContentType) ??
      formatFromUrl(url) ??
      fallbackFormat;
    return { url, format, contentType: contentTypeFor(format) };
  };

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
      const stem = remoteStem(val);
      if (stem) stems.push({ role: classify(key), ...stem });
    }
  } else if (Array.isArray(output)) {
    (output as unknown[]).forEach((value, i) => {
      const stem = remoteStem(value);
      if (stem) stems.push({ role: `stem_${i + 1}`, ...stem });
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
