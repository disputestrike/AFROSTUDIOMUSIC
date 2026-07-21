/**
 * AUDIO METRICS HARNESS (trainlegal wave) — measured evaluation for the music
 * training loop, replacing "the text judge admits it never heard audio" with
 * numbers computed FROM the audio:
 *
 *  - FAD-CLAP: CLAP embeddings for candidate clips + the AfroRef reference set
 *    (both via a Replicate CLAP model), then the Frechet distance computed
 *    CPU-side here (mean + covariance, small-set-safe via shrinkage toward the
 *    diagonal). Lower = closer to the reference sound.
 *  - LYRIC WER: Whisper large-v3 (Replicate) transcribes a rendered vocal clip;
 *    the transcript and the intended lyric are normalized with the SAME
 *    diacritics-aware tokenizer the alignment gate uses (@afrohit/shared
 *    lyricAlignmentTokens) and word error rate is computed here.
 *  - TONE-INTELLIGIBILITY SCAFFOLD: for tonal languages (Yoruba etc.) an HONEST
 *    stub — base-syllable match rate only, with explicit TODOs where native-
 *    speaker judgment is required. It never claims tones were verified.
 *
 * SPEND LAWS (same doctrine as the trainer):
 *  1. AUDIO_METRICS_ENABLED must be '1' — default OFF, zero spend.
 *  2. Every Replicate call is COST-LOGGED (console + the returned receipts).
 *  3. FAIL-SOFT: metrics unavailable is a { available:false, reason } result,
 *     never a throw — a missing metric must never fail the pipeline.
 *  4. NO FAKE MODELS: the CLAP model has no live-verified default, so it is
 *     operator-configured (AUDIO_METRICS_CLAP_MODEL + _VERSION) and refuses
 *     honestly when unset. Whisper defaults to the official 'openai/whisper'
 *     slug (version resolved live, pinnable via AUDIO_METRICS_WHISPER_VERSION).
 */
import { lyricAlignmentTokens } from '@afrohit/shared';
import { replicateToken } from './providers/music';

export function audioMetricsEnabled(): boolean {
  return process.env.AUDIO_METRICS_ENABLED === '1';
}

/** Per-call cost estimates (USD) — operator-tunable; logged on every call so
 *  the spend is visible even before Replicate's invoice lands. */
function envCost(name: string, def: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : def;
}
const clapCostUsd = () => envCost('AUDIO_METRICS_CLAP_COST_USD', 0.001);
const whisperCostUsd = () => envCost('AUDIO_METRICS_WHISPER_COST_USD', 0.01);

function logMetricCost(model: string, estCostUsd: number, receipts: string[]): void {
  const line = `[audio-metrics] replicate ${model} ~$${estCostUsd.toFixed(4)}`;
  console.log(line);
  receipts.push(line);
}

// ---------------------------------------------------------------------------
// Replicate plumbing (bounded poll, never throws past the caller's fail-soft).
// ---------------------------------------------------------------------------

interface ReplicatePredictionState {
  id?: string;
  status?: string;
  output?: unknown;
  error?: string | null;
}

async function runReplicatePrediction(opts: {
  token: string;
  version: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ output: unknown } | { error: string }> {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.token}`,
      'content-type': 'application/json',
      prefer: 'wait=60',
    },
    body: JSON.stringify({ version: opts.version, input: opts.input }),
  });
  if (!res.ok) {
    return { error: `replicate ${res.status}: ${(await res.text()).slice(0, 160)}` };
  }
  let data = (await res.json()) as ReplicatePredictionState;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (
    data.id &&
    (data.status === 'starting' || data.status === 'processing') &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 4_000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (!poll.ok) return { error: `replicate poll ${poll.status}` };
    data = (await poll.json()) as ReplicatePredictionState;
  }
  if (data.status !== 'succeeded') {
    return { error: String(data.error ?? data.status ?? 'no output').slice(0, 160) };
  }
  return { output: data.output };
}

/** Resolve a model's latest version unless one is pinned (same pattern as the
 *  music adapters). */
async function resolveModelVersion(
  token: string,
  slug: string,
  pinned?: string
): Promise<string | { error: string }> {
  if (pinned?.trim()) return pinned.trim();
  const res = await fetch(`https://api.replicate.com/v1/models/${slug}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: `model lookup ${res.status} for ${slug}` };
  const data = (await res.json()) as { latest_version?: { id?: string } };
  return data.latest_version?.id ?? { error: `model ${slug} has no version` };
}

// ---------------------------------------------------------------------------
// FAD-CLAP — pure math first (unit-tested offline), then the spend-aware wrap.
// ---------------------------------------------------------------------------

export interface GaussianStats {
  mean: number[];
  cov: number[][];
}

/**
 * Sample mean + covariance (n-1 denominator) with SHRINKAGE toward the
 * diagonal — the small-set safety: with a handful of clips the off-diagonal
 * covariance estimates are mostly noise, so they are shrunk by
 * λ = dim / (dim + n) (clamped to [minShrinkage, 1]) while variances survive.
 * A tiny ridge keeps the matrix positive semi-definite for the sqrt.
 */
export function gaussianStats(
  embeddings: number[][],
  opts: { shrinkage?: number; ridge?: number } = {}
): GaussianStats {
  const n = embeddings.length;
  if (n === 0) throw new Error('gaussianStats requires at least one embedding');
  const dim = embeddings[0]!.length;
  const mean = new Array<number>(dim).fill(0);
  for (const row of embeddings) {
    if (row.length !== dim) throw new Error('embeddings must share one dimension');
    for (let i = 0; i < dim; i += 1) mean[i]! += row[i]!;
  }
  for (let i = 0; i < dim; i += 1) mean[i]! /= n;
  const cov: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  if (n > 1) {
    for (const row of embeddings) {
      for (let i = 0; i < dim; i += 1) {
        const di = row[i]! - mean[i]!;
        for (let j = i; j < dim; j += 1) {
          cov[i]![j]! += di * (row[j]! - mean[j]!);
        }
      }
    }
    for (let i = 0; i < dim; i += 1) {
      for (let j = i; j < dim; j += 1) {
        const value = cov[i]![j]! / (n - 1);
        cov[i]![j] = value;
        cov[j]![i] = value;
      }
    }
  }
  const shrink =
    opts.shrinkage ?? Math.min(1, Math.max(0.05, dim / (dim + Math.max(1, n))));
  const ridge = opts.ridge ?? 1e-6;
  for (let i = 0; i < dim; i += 1) {
    for (let j = 0; j < dim; j += 1) {
      if (i === j) cov[i]![j]! += ridge;
      else cov[i]![j]! *= 1 - shrink;
    }
  }
  return { mean, cov };
}

/** Jacobi eigendecomposition of a symmetric matrix (returns eigenvalues +
 *  eigenvectors as columns). Adequate for embedding-sized matrices offline. */
function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map(row => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  const maxSweeps = 64;
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += a[p]![q]! * a[p]![q]!;
    }
    if (off < 1e-18) break;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]!), vectors: v };
}

function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const m = b[0]!.length;
  const inner = b.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < inner; k += 1) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < m; j += 1) out[i]![j]! += aik * b[k]![j]!;
    }
  }
  return out;
}

/** Symmetric PSD matrix square root via eigendecomposition (negative
 *  eigenvalues from numeric noise clamp to zero). */
function sqrtmSymmetric(matrix: number[][]): number[][] {
  const { values, vectors } = jacobiEigen(matrix);
  const n = matrix.length;
  const sqrtVals = values.map(value => Math.sqrt(Math.max(0, value)));
  // V * diag(sqrt) * V^T
  const scaled: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => vectors[i]![j]! * sqrtVals[j]!)
  );
  const vt: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => vectors[j]![i]!)
  );
  return matMul(scaled, vt);
}

/**
 * Frechet distance between two Gaussians:
 *   |mu1-mu2|^2 + Tr(C1 + C2 - 2*(C1^{1/2} C2 C1^{1/2})^{1/2})
 * (the symmetric form of sqrtm(C1*C2), stable for PSD covariances).
 */
export function frechetDistance(a: GaussianStats, b: GaussianStats): number {
  const dim = a.mean.length;
  if (b.mean.length !== dim) throw new Error('frechetDistance: dimension mismatch');
  let meanTerm = 0;
  for (let i = 0; i < dim; i += 1) {
    const d = a.mean[i]! - b.mean[i]!;
    meanTerm += d * d;
  }
  const sqrtA = sqrtmSymmetric(a.cov);
  const inner = matMul(matMul(sqrtA, b.cov), sqrtA);
  const { values } = jacobiEigen(inner);
  let traceCross = 0;
  for (const value of values) traceCross += Math.sqrt(Math.max(0, value));
  let traceA = 0;
  let traceB = 0;
  for (let i = 0; i < dim; i += 1) {
    traceA += a.cov[i]![i]!;
    traceB += b.cov[i]![i]!;
  }
  const fad = meanTerm + traceA + traceB - 2 * traceCross;
  // Numeric noise can dip a true-zero distance a hair negative — clamp.
  return Math.max(0, fad);
}

export interface FadClapResult {
  available: boolean;
  reason?: string;
  fad?: number;
  candidateCount?: number;
  referenceCount?: number;
  receipts: string[];
  estCostUsd: number;
}

function parseEmbedding(output: unknown): number[] | null {
  const candidate = Array.isArray(output)
    ? output
    : output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>).embedding
      : null;
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  const values = candidate.map(Number);
  return values.every(value => Number.isFinite(value)) ? values : null;
}

/**
 * FAD-CLAP between a candidate clip set and a reference clip set. Spend-aware
 * and fail-soft: gate off / unconfigured / any provider failure returns
 * { available:false, reason } — never a throw, never a fabricated number.
 */
export async function computeFadClap(
  candidateUrls: string[],
  referenceUrls: string[]
): Promise<FadClapResult> {
  const receipts: string[] = [];
  const unavailable = (reason: string, estCostUsd = 0): FadClapResult => ({
    available: false,
    reason,
    receipts,
    estCostUsd,
  });
  if (!audioMetricsEnabled()) {
    return unavailable('AUDIO_METRICS_ENABLED is not set — audio metrics are off (no spend)');
  }
  const token = replicateToken();
  if (!token) return unavailable('REPLICATE_API_TOKEN missing');
  const slug = process.env.AUDIO_METRICS_CLAP_MODEL?.trim();
  if (!slug) {
    // NO FAKE MODELS: we do not ship an unverified CLAP slug and pretend it
    // embeds. The operator pins one (owner errand, stated in the runbook).
    return unavailable(
      'CLAP model unconfigured — set AUDIO_METRICS_CLAP_MODEL (+ optional AUDIO_METRICS_CLAP_VERSION) to a live-verified Replicate CLAP embedding model'
    );
  }
  if (candidateUrls.length < 2 || referenceUrls.length < 2) {
    return unavailable(
      `FAD needs >=2 candidate and >=2 reference clips (got ${candidateUrls.length}/${referenceUrls.length})`
    );
  }
  const version = await resolveModelVersion(
    token,
    slug,
    process.env.AUDIO_METRICS_CLAP_VERSION
  );
  if (typeof version !== 'string') return unavailable(version.error);

  let estCostUsd = 0;
  const embed = async (url: string): Promise<number[] | { error: string }> => {
    logMetricCost(slug, clapCostUsd(), receipts);
    estCostUsd += clapCostUsd();
    const result = await runReplicatePrediction({
      token,
      version,
      input: { audio: url },
    });
    if ('error' in result) return { error: result.error };
    const embedding = parseEmbedding(result.output);
    return embedding ?? { error: 'CLAP output had no numeric embedding' };
  };
  try {
    const candidates: number[][] = [];
    for (const url of candidateUrls) {
      const embedding = await embed(url);
      if ('error' in embedding) return unavailable(`candidate embed failed: ${embedding.error}`, estCostUsd);
      candidates.push(embedding);
    }
    const references: number[][] = [];
    for (const url of referenceUrls) {
      const embedding = await embed(url);
      if ('error' in embedding) return unavailable(`reference embed failed: ${embedding.error}`, estCostUsd);
      references.push(embedding);
    }
    const fad = frechetDistance(gaussianStats(candidates), gaussianStats(references));
    receipts.push(
      `FAD-CLAP ${fad.toFixed(4)} over ${candidates.length} candidate vs ${references.length} reference clips (model ${slug})`
    );
    return {
      available: true,
      fad,
      candidateCount: candidates.length,
      referenceCount: references.length,
      receipts,
      estCostUsd,
    };
  } catch (err) {
    return unavailable(
      `FAD-CLAP failed: ${((err as Error)?.message ?? 'unknown').slice(0, 160)}`,
      estCostUsd
    );
  }
}

// ---------------------------------------------------------------------------
// LYRIC WER — pure math first, then the Whisper wrap.
// ---------------------------------------------------------------------------

export interface WordErrorRateResult {
  wer: number;
  distance: number;
  expectedTokens: number;
  heardTokens: number;
}

/**
 * Word error rate between the intended lyric and a transcript. Both sides are
 * normalized with the shared diacritics-aware tokenizer (lowercase, punctuation
 * stripped, Latin diacritics/tone marks folded, section labels removed) so a
 * Yoruba tone mark or a "[Chorus]" header never counts as an error. WER =
 * levenshtein(expected tokens, heard tokens) / expected token count.
 */
export function wordErrorRate(expectedLyric: string, transcript: string): WordErrorRateResult {
  const expected = lyricAlignmentTokens(expectedLyric);
  const heard = lyricAlignmentTokens(transcript);
  const distance = tokenLevenshtein(expected, heard);
  return {
    wer: expected.length > 0 ? distance / expected.length : heard.length > 0 ? 1 : 0,
    distance,
    expectedTokens: expected.length,
    heardTokens: heard.length,
  };
}

function tokenLevenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

export interface LyricWerResult {
  available: boolean;
  reason?: string;
  wer?: number;
  transcript?: string;
  expectedTokens?: number;
  heardTokens?: number;
  receipts: string[];
  estCostUsd: number;
}

function parseWhisperTranscript(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  if (typeof record.transcription === 'string') return record.transcription;
  if (typeof record.text === 'string') return record.text;
  if (Array.isArray(record.segments)) {
    const joined = record.segments
      .map(segment =>
        segment && typeof segment === 'object' && typeof (segment as Record<string, unknown>).text === 'string'
          ? String((segment as Record<string, unknown>).text)
          : ''
      )
      .join(' ')
      .trim();
    return joined || null;
  }
  return null;
}

/**
 * Transcribe a rendered vocal clip with Whisper large-v3 (Replicate) and score
 * it against the intended lyric. Spend-aware, fail-soft, cost-logged.
 */
export async function computeLyricWer(opts: {
  audioUrl: string;
  expectedLyrics: string;
  language?: string;
}): Promise<LyricWerResult> {
  const receipts: string[] = [];
  const unavailable = (reason: string, estCostUsd = 0): LyricWerResult => ({
    available: false,
    reason,
    receipts,
    estCostUsd,
  });
  if (!audioMetricsEnabled()) {
    return unavailable('AUDIO_METRICS_ENABLED is not set — audio metrics are off (no spend)');
  }
  const token = replicateToken();
  if (!token) return unavailable('REPLICATE_API_TOKEN missing');
  const slug = process.env.AUDIO_METRICS_WHISPER_MODEL?.trim() || 'openai/whisper';
  const version = await resolveModelVersion(
    token,
    slug,
    process.env.AUDIO_METRICS_WHISPER_VERSION
  );
  if (typeof version !== 'string') return unavailable(version.error);
  logMetricCost(slug, whisperCostUsd(), receipts);
  try {
    const result = await runReplicatePrediction({
      token,
      version,
      input: {
        audio: opts.audioUrl,
        model: 'large-v3',
        transcription: 'plain text',
        ...(opts.language ? { language: opts.language } : {}),
      },
    });
    if ('error' in result) return unavailable(`whisper failed: ${result.error}`, whisperCostUsd());
    const transcript = parseWhisperTranscript(result.output);
    if (!transcript) return unavailable('whisper returned no transcript', whisperCostUsd());
    const scored = wordErrorRate(opts.expectedLyrics, transcript);
    receipts.push(
      `lyric WER ${scored.wer.toFixed(4)} (${scored.distance} edits over ${scored.expectedTokens} expected tokens, model ${slug} large-v3)`
    );
    return {
      available: true,
      wer: scored.wer,
      transcript,
      expectedTokens: scored.expectedTokens,
      heardTokens: scored.heardTokens,
      receipts,
      estCostUsd: whisperCostUsd(),
    };
  } catch (err) {
    return unavailable(
      `lyric WER failed: ${((err as Error)?.message ?? 'unknown').slice(0, 160)}`,
      whisperCostUsd()
    );
  }
}

// ---------------------------------------------------------------------------
// TONE-INTELLIGIBILITY SCAFFOLD (honest stub for tonal languages).
// ---------------------------------------------------------------------------

export interface ToneMarkedSyllable {
  /** The syllable WITH its tone marks, e.g. 'ọmọ́' — the intended realization. */
  syllable: string;
  /** Optional explicit tone label ('high' | 'mid' | 'low' | ...), if annotated. */
  tone?: string;
}

export interface ToneIntelligibilityReport {
  expected: number;
  matchedBase: number;
  /** Share of expected syllables whose BASE (tone-stripped) form was heard. */
  baseMatchRate: number;
  /** ALWAYS false here — ASR text cannot verify tone realization. */
  toneVerified: false;
  note: string;
}

function stripToneMarks(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * TONE-INTELLIGIBILITY SCAFFOLD. Pairs the Whisper transcript's syllable-ish
 * tokens against the expected tone-marked syllables ON BASE FORM ONLY and
 * reports the base match rate.
 *
 * HONESTY, load-bearing:
 *  - Whisper emits orthography, usually WITHOUT reliable tone diacritics, so
 *    a transcript match proves the SEGMENTS were sung, never that the TONES
 *    were realized. `toneVerified` is therefore hard-typed `false`.
 *  - TODO(native-speaker): actual tone verification needs either (a) a native
 *    speaker listening against the tone-marked text, or (b) a pitch-track
 *    analysis aligned to syllable boundaries with language-specific tone
 *    targets. Neither can be faked from ASR text — do not "upgrade" this stub
 *    without one of those inputs.
 *  - TODO(native-speaker): the greedy in-order pairing below is a scaffold;
 *    real syllabification for Yoruba/Igbo/Hausa needs language rules a native
 *    reviewer must sign off.
 */
export function toneIntelligibilityScaffold(input: {
  transcript: string;
  expectedSyllables: ToneMarkedSyllable[];
}): ToneIntelligibilityReport {
  const heard = lyricAlignmentTokens(input.transcript).map(stripToneMarks);
  const expected = input.expectedSyllables.map(row => stripToneMarks(row.syllable));
  let cursor = 0;
  let matchedBase = 0;
  for (const syllable of expected) {
    if (!syllable) continue;
    for (let i = cursor; i < heard.length; i += 1) {
      if (heard[i]!.includes(syllable)) {
        matchedBase += 1;
        cursor = i; // in-order pairing; repeats may share one heard token
        break;
      }
    }
  }
  const baseMatchRate = expected.length > 0 ? matchedBase / expected.length : 0;
  return {
    expected: expected.length,
    matchedBase,
    baseMatchRate: Math.round(baseMatchRate * 10_000) / 10_000,
    toneVerified: false,
    note: 'base-syllable match only — tone realization is NOT verified by ASR text; native-speaker listening or pitch-track analysis required before any tone claim',
  };
}

// ---------------------------------------------------------------------------
// THRESHOLD GATE — pure; consumed by decideMusicCandidatePromotion.
// ---------------------------------------------------------------------------

export interface AudioMetricsGateInput {
  fadClap?: number | null;
  lyricWer?: number | null;
}

export interface AudioMetricsGateResult {
  block: boolean;
  reasons: string[];
  notes: string[];
}

/** WER above this blocks promotion (env MUSIC_EVAL_MAX_WER, default 0.5 — more
 *  than half the intended words missing is not a promotable singer). */
export function maxLyricWer(): number {
  const raw = Number(process.env.MUSIC_EVAL_MAX_WER);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.5;
}

/** FAD-CLAP threshold is ADVISORY until the operator calibrates one against
 *  the AfroRef set (env MUSIC_EVAL_MAX_FAD_CLAP; unset = report, never block —
 *  an uncalibrated cutoff would be a fabricated gate). */
export function maxFadClap(): number | null {
  const raw = Number(process.env.MUSIC_EVAL_MAX_FAD_CLAP);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function audioMetricsGate(metrics: AudioMetricsGateInput): AudioMetricsGateResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (typeof metrics.lyricWer === 'number' && Number.isFinite(metrics.lyricWer)) {
    if (metrics.lyricWer > maxLyricWer()) {
      reasons.push(
        `measured lyric WER ${metrics.lyricWer.toFixed(3)} exceeds the ${maxLyricWer()} gate — the candidate does not sing the words`
      );
    } else {
      notes.push(`measured lyric WER ${metrics.lyricWer.toFixed(3)} within the ${maxLyricWer()} gate`);
    }
  }
  if (typeof metrics.fadClap === 'number' && Number.isFinite(metrics.fadClap)) {
    const cutoff = maxFadClap();
    if (cutoff != null && metrics.fadClap > cutoff) {
      reasons.push(
        `measured FAD-CLAP ${metrics.fadClap.toFixed(3)} vs AfroRef exceeds the ${cutoff} gate — the candidate drifted from the reference sound`
      );
    } else {
      notes.push(
        `measured FAD-CLAP ${metrics.fadClap.toFixed(3)} vs AfroRef${cutoff == null ? ' (advisory — set MUSIC_EVAL_MAX_FAD_CLAP to enforce)' : ` within the ${cutoff} gate`}`
      );
    }
  }
  return { block: reasons.length > 0, reasons, notes };
}
