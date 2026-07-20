import { createHash } from 'node:crypto';
import {
  isMelismaToken,
  parseLyricSections,
  syllabify,
  type MelodyScore,
} from '@afrohit/shared';

export const AFROONE_SINGING_CONTRACT_VERSION = 1 as const;
export const AFROONE_SINGING_FEATURE_FLAG = 'AFROONE_SINGING_ENABLED' as const;

export type AfroOneSingingEngine =
  | 'local-score-singer'
  | 'fal-ace-step'
  | 'replicate-ace-step';
export type AfroOneSingingOutputKind = 'isolated_vocal' | 'full_mix';
export type AfroOneSingingPerformanceSource =
  | 'score_synth'
  | 'generative_singing';

export interface AfroOneSingingAlignmentNote {
  sectionIndex: number;
  sectionName: string;
  noteIndex: number;
  syllable: string;
  startBeat: number;
  durationBeats: number;
  midi: number;
  anchor: boolean;
}

export interface AfroOneSingingManifest {
  contractVersion: typeof AFROONE_SINGING_CONTRACT_VERSION;
  performanceKind: 'sung_vocal';
  lyrics: string;
  lyricsHash: string;
  melodyScore: MelodyScore;
  scoreHash: string;
  alignment: AfroOneSingingAlignmentNote[];
  alignmentHash: string;
  manifestHash: string;
  genre: string;
  language: string | null;
  seed: number;
  bpm: number;
  key: string;
  scoreDurationS: number;
  targetDurationS: number;
}

export interface AfroOneSingingAttempt {
  engine: AfroOneSingingEngine;
  outcome: 'skipped' | 'failed' | 'succeeded';
  estimatedCostUsd: number;
  reason?: string;
}

export interface AfroOneSingingCostTelemetry {
  currency: 'USD';
  synthesisUsd: number;
  voiceConversionUsd: number;
  verificationUsd: number;
  totalUsd: number;
  estimated: boolean;
}

export interface AfroOneSingingRender {
  performanceKind: 'sung_vocal';
  performanceSource: AfroOneSingingPerformanceSource;
  outputKind: AfroOneSingingOutputKind;
  audioUrl: string;
  format: 'wav';
  engine: AfroOneSingingEngine;
  externalId: string | null;
  exactScoreInput: boolean;
  manifest: AfroOneSingingManifest;
  attempts: AfroOneSingingAttempt[];
  cost: AfroOneSingingCostTelemetry;
}

export interface AfroOneSungAssetReceipt {
  schemaVersion: 1;
  afroOneSinging: true;
  assetKind: 'isolated_vocal';
  performanceKind: 'sung_vocal';
  performanceSource: AfroOneSingingPerformanceSource | 'voice_conversion';
  spokenGuideNotSung: false;
  placeholder: false;
  engine: AfroOneSingingEngine;
  externalId: string | null;
  exactScoreInput: boolean;
  seed: number;
  lyricsHash: string;
  scoreHash: string;
  alignmentHash: string;
  manifestHash: string;
  cost: AfroOneSingingCostTelemetry;
  attempts: AfroOneSingingAttempt[];
  personalizedVoice: boolean;
}

export interface AfroOneSingingJobContract {
  afroOneSinging: true;
  contractVersion: typeof AFROONE_SINGING_CONTRACT_VERSION;
  lyricsHash: string;
  scoreHash: string;
  alignmentHash: string;
  manifestHash: string;
  seed: number;
  voiceProfileId: string | null;
}

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface AfroOneSingingDependencies {
  env?: Environment;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Reject a rendered candidate before the ladder accepts it (for measured lyric/QC gates). */
  verifyCandidate?: (
    render: Omit<AfroOneSingingRender, 'attempts'>
  ) => Promise<void>;
}

function money(value: number): number {
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
}

export function combineAfroOneSingingCost(input: {
  synthesisUsd: number;
  voiceConversionUsd?: number;
  verificationUsd?: number;
  estimated: boolean;
}): AfroOneSingingCostTelemetry {
  const synthesisUsd = money(input.synthesisUsd);
  const voiceConversionUsd = money(input.voiceConversionUsd ?? 0);
  const verificationUsd = money(input.verificationUsd ?? 0);
  return {
    currency: 'USD',
    synthesisUsd,
    voiceConversionUsd,
    verificationUsd,
    totalUsd: money(synthesisUsd + voiceConversionUsd + verificationUsd),
    estimated: input.estimated,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

export function afroOneSingingHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizedWord(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/([aeiouy])(?:-\1)+/g, '$1')
    .replace(/[^a-z0-9]/g, '');
}

function lyricSyllables(lines: readonly string[]): string[] {
  const tokens = lines
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-zA-Z']+/, '').replace(/[^a-zA-Z'-]+$/, ''))
    .filter((token) => /[a-zA-Z]/.test(token));

  return tokens.flatMap((token) => {
    if (isMelismaToken(token)) {
      const repeats = Math.min(3, Math.max(2, token.split('-').length));
      return Array.from({ length: repeats }, () => normalizedWord(token));
    }
    return syllabify(token).map(normalizedWord);
  });
}

function assertFiniteNumber(
  value: number,
  label: string,
  min: number,
  max: number
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`afroone_singing_invalid_${label}`);
  }
}

/**
 * Build the immutable score/lyric contract consumed by every genuine singer.
 * A note sequence that no longer spells the approved lyric is rejected before
 * any provider call, so a stale melody can never be filed against new words.
 */
export function createAfroOneSingingManifest(input: {
  lyrics: string;
  melodyScore: MelodyScore;
  genre: string;
  language?: string | null;
  targetDurationS?: number;
}): AfroOneSingingManifest {
  const lyrics = input.lyrics.normalize('NFC').trim();
  const genre = input.genre.trim();
  if (!lyrics) throw new Error('afroone_singing_lyrics_required');
  if (!genre) throw new Error('afroone_singing_genre_required');

  const score = input.melodyScore;
  assertFiniteNumber(score.bpm, 'bpm', 30, 300);
  if (!Number.isInteger(score.seed)) {
    throw new Error('afroone_singing_score_seed_required');
  }
  if (!score.key?.trim()) throw new Error('afroone_singing_key_required');
  if (!Array.isArray(score.sections) || !score.sections.length) {
    throw new Error('afroone_singing_score_sections_required');
  }

  const lyricSections = parseLyricSections(lyrics).filter(
    (section) => section.lines.length > 0
  );
  if (lyricSections.length !== score.sections.length) {
    throw new Error('afroone_singing_section_count_mismatch');
  }

  const alignment: AfroOneSingingAlignmentNote[] = [];
  let totalBeats = 0;
  for (let sectionIndex = 0; sectionIndex < score.sections.length; sectionIndex += 1) {
    const scored = score.sections[sectionIndex]!;
    const written = lyricSections[sectionIndex]!;
    if (
      scored.kind !== written.kind ||
      scored.name.trim().toLowerCase() !== written.name.trim().toLowerCase()
    ) {
      throw new Error(`afroone_singing_section_identity_mismatch:${sectionIndex}`);
    }
    if (!Number.isInteger(scored.bars) || scored.bars < 1 || scored.bars > 64) {
      throw new Error(`afroone_singing_invalid_bars:${sectionIndex}`);
    }
    if (!Array.isArray(scored.notes) || !scored.notes.length) {
      throw new Error(`afroone_singing_empty_section:${sectionIndex}`);
    }

    const expected = lyricSyllables(written.lines);
    const actual: string[] = [];
    let previousStart = -1;
    scored.notes.forEach((note, noteIndex) => {
      assertFiniteNumber(note.startBeat, 'note_start', 0, scored.bars * 4);
      assertFiniteNumber(note.durBeats, 'note_duration', 0.01, scored.bars * 4);
      assertFiniteNumber(note.midi, 'note_midi', 24, 108);
      if (note.startBeat < previousStart) {
        throw new Error(`afroone_singing_note_order_mismatch:${sectionIndex}`);
      }
      if (note.startBeat + note.durBeats > scored.bars * 4 + 0.001) {
        throw new Error(`afroone_singing_note_overflow:${sectionIndex}`);
      }
      const syllable = normalizedWord(note.syllable);
      if (!syllable) {
        throw new Error(`afroone_singing_note_syllable_missing:${sectionIndex}:${noteIndex}`);
      }
      previousStart = note.startBeat;
      actual.push(syllable);
      alignment.push({
        sectionIndex,
        sectionName: scored.name,
        noteIndex,
        syllable: note.syllable,
        startBeat: note.startBeat,
        durationBeats: note.durBeats,
        midi: note.midi,
        anchor: note.anchor === true,
      });
    });
    if (canonical(actual) !== canonical(expected)) {
      throw new Error(`afroone_singing_lyric_score_mismatch:${sectionIndex}`);
    }
    totalBeats += scored.bars * 4;
  }

  const scoreDurationS = money((totalBeats * 60) / score.bpm);
  const targetDurationS = input.targetDurationS ?? scoreDurationS;
  assertFiniteNumber(targetDurationS, 'target_duration', scoreDurationS, 240);
  const seed = score.seed >>> 0;
  const lyricsHash = afroOneSingingHash(lyrics);
  const scoreHash = afroOneSingingHash(score);
  const alignmentHash = afroOneSingingHash(alignment);
  const base = {
    contractVersion: AFROONE_SINGING_CONTRACT_VERSION,
    performanceKind: 'sung_vocal' as const,
    lyrics,
    lyricsHash,
    melodyScore: score,
    scoreHash,
    alignment,
    alignmentHash,
    genre,
    language: input.language?.trim() || null,
    seed,
    bpm: score.bpm,
    key: score.key,
    scoreDurationS,
    targetDurationS: money(targetDurationS),
  };
  return { ...base, manifestHash: afroOneSingingHash(base) };
}

export function afroOneSingingEnabled(env: Environment = process.env): boolean {
  return env[AFROONE_SINGING_FEATURE_FLAG] === '1';
}

export function afroOneSingingJobContract(
  manifest: AfroOneSingingManifest,
  voiceProfileId?: string | null
): AfroOneSingingJobContract {
  return {
    afroOneSinging: true,
    contractVersion: AFROONE_SINGING_CONTRACT_VERSION,
    lyricsHash: manifest.lyricsHash,
    scoreHash: manifest.scoreHash,
    alignmentHash: manifest.alignmentHash,
    manifestHash: manifest.manifestHash,
    seed: manifest.seed,
    voiceProfileId: voiceProfileId ?? null,
  };
}

function genuineEngineLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const label = value.trim();
  return /\b(?:tts|speech|spoken|placeholder|stub|guide)\b/i.test(label)
    ? null
    : label;
}

function playableAudioUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function configuredOrder(env: Environment): AfroOneSingingEngine[] {
  const requested = (
    env.AFROONE_SINGING_ENGINE_ORDER ??
    'local-score-singer,fal-ace-step,replicate-ace-step'
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const valid = requested.filter(
    (value): value is AfroOneSingingEngine =>
      value === 'local-score-singer' ||
      value === 'fal-ace-step' ||
      value === 'replicate-ace-step'
  );
  return [...new Set(valid)];
}

function numericEnv(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function renderLocalScoreSinger(
  manifest: AfroOneSingingManifest,
  env: Environment,
  fetcher: FetchLike
): Promise<Omit<AfroOneSingingRender, 'attempts'>> {
  const endpoint = env.AFROONE_SINGING_LOCAL_URL?.trim();
  if (!endpoint) throw new Error('not_configured');
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))
  ) {
    throw new Error('local_score_singer_endpoint_must_be_https_or_loopback');
  }
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AFROONE_SINGING_LOCAL_TOKEN
        ? { authorization: `Bearer ${env.AFROONE_SINGING_LOCAL_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ manifest }),
    signal: AbortSignal.timeout(
      numericEnv(env, 'AFROONE_SINGING_LOCAL_TIMEOUT_MS', 20 * 60_000, 5_000, 30 * 60_000)
    ),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`local_score_singer_${response.status}`);
  }
  const output = (await response.json()) as Record<string, unknown>;
  if (output.performanceKind !== 'sung_vocal') {
    throw new Error('local_score_singer_did_not_return_sung_vocal');
  }
  if (!genuineEngineLabel(output.engine)) {
    throw new Error('local_score_singer_returned_non_singing_engine');
  }
  if (output.scoreInputConsumed !== true) {
    throw new Error('local_score_singer_did_not_consume_score');
  }
  if (
    output.scoreHash !== manifest.scoreHash ||
    output.lyricsHash !== manifest.lyricsHash ||
    output.alignmentHash !== manifest.alignmentHash ||
    output.seed !== manifest.seed
  ) {
    throw new Error('local_score_singer_receipt_mismatch');
  }
  if (!playableAudioUrl(output.audioUrl)) {
    throw new Error('local_score_singer_returned_no_playable_audio');
  }
  if (output.outputKind !== 'isolated_vocal') {
    throw new Error('local_score_singer_must_return_isolated_vocal');
  }
  const reportedCost = Number(output.costUsd ?? 0);
  if (!Number.isFinite(reportedCost) || reportedCost < 0) {
    throw new Error('local_score_singer_invalid_cost');
  }
  const synthesisUsd = money(reportedCost);
  return {
    performanceKind: 'sung_vocal',
    performanceSource: 'score_synth',
    outputKind: 'isolated_vocal',
    audioUrl: output.audioUrl,
    format: 'wav',
    engine: 'local-score-singer',
    externalId: typeof output.renderId === 'string' ? output.renderId : null,
    exactScoreInput: true,
    manifest,
    cost: {
      currency: 'USD',
      synthesisUsd,
      voiceConversionUsd: 0,
      verificationUsd: 0,
      totalUsd: synthesisUsd,
      estimated: output.costFinal !== true,
    },
  };
}

async function renderFalAceStep(
  manifest: AfroOneSingingManifest,
  env: Environment,
  fetcher: FetchLike,
  sleep: (ms: number) => Promise<void>
): Promise<Omit<AfroOneSingingRender, 'attempts'>> {
  const key = env.FAL_KEY?.trim();
  if (!key) throw new Error('not_configured');
  const duration = Math.min(240, Math.max(30, Math.ceil(manifest.targetDurationS)));
  const auth = { authorization: `Key ${key}` };
  const kickoff = await fetcher('https://queue.fal.run/fal-ai/ace-step', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      tags: [
        manifest.genre,
        `${manifest.bpm} bpm`,
        manifest.key,
        'lead vocal performance',
        'clear lyric diction',
      ].join(', '),
      lyrics: manifest.lyrics,
      duration,
      seed: manifest.seed,
      number_of_steps: Math.round(
        numericEnv(env, 'AFROONE_SINGING_FAL_STEPS', 40, 3, 60)
      ),
      lyric_guidance_scale: numericEnv(
        env,
        'AFROONE_SINGING_FAL_LYRIC_GUIDANCE',
        4,
        0,
        10
      ),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!kickoff.ok) {
    const detail = (await kickoff.text()).slice(0, 160);
    throw new Error(`fal_singing_kickoff_${kickoff.status}:${detail}`);
  }
  const started = (await kickoff.json()) as { request_id?: string };
  if (!started.request_id) throw new Error('fal_singing_request_id_missing');

  const deadline = Date.now() + 20 * 60_000;
  let complete = false;
  while (Date.now() < deadline) {
    const statusResponse = await fetcher(
      `https://queue.fal.run/fal-ai/ace-step/requests/${started.request_id}/status`,
      { headers: auth, signal: AbortSignal.timeout(30_000) }
    );
    if (!statusResponse.ok) {
      throw new Error(`fal_singing_status_${statusResponse.status}`);
    }
    const status = (await statusResponse.json()) as {
      status?: string;
      error?: string;
    };
    if (status.status === 'COMPLETED') {
      complete = true;
      break;
    }
    if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
      throw new Error(`fal_singing_${status.status ?? 'failed'}:${status.error ?? ''}`);
    }
    await sleep(5_000);
  }
  if (!complete) throw new Error('fal_singing_timed_out');

  const resultResponse = await fetcher(
    `https://queue.fal.run/fal-ai/ace-step/requests/${started.request_id}`,
    { headers: auth, signal: AbortSignal.timeout(30_000) }
  );
  if (!resultResponse.ok) {
    throw new Error(`fal_singing_result_${resultResponse.status}`);
  }
  const result = (await resultResponse.json()) as {
    audio?: { url?: string };
    seed?: number;
    lyrics?: string;
  };
  if (!playableAudioUrl(result.audio?.url)) {
    throw new Error('fal_singing_returned_no_playable_audio');
  }
  if (result.seed !== manifest.seed) {
    throw new Error('fal_singing_seed_receipt_mismatch');
  }
  const synthesisUsd = money(duration * 0.0002);
  return {
    performanceKind: 'sung_vocal',
    performanceSource: 'generative_singing',
    outputKind: 'full_mix',
    audioUrl: result.audio.url,
    format: 'wav',
    engine: 'fal-ace-step',
    externalId: started.request_id,
    // ACE-Step consumes the deterministic seed and lyric, but not AfroOne's
    // note list. The receipt says that plainly instead of claiming score synth.
    exactScoreInput: false,
    manifest,
    cost: {
      currency: 'USD',
      synthesisUsd,
      voiceConversionUsd: 0,
      verificationUsd: 0,
      totalUsd: synthesisUsd,
      estimated: true,
    },
  };
}

async function renderReplicateAceStep(
  manifest: AfroOneSingingManifest,
  env: Environment,
  fetcher: FetchLike,
  sleep: (ms: number) => Promise<void>
): Promise<Omit<AfroOneSingingRender, 'attempts'>> {
  const token = env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error('not_configured');
  const auth = { authorization: `Bearer ${token}` };
  let version = env.REPLICATE_SONG_VERSION?.trim();
  if (!version) {
    const slug = env.REPLICATE_SONG_MODEL?.trim() || 'lucataco/ace-step';
    const modelResponse = await fetcher(
      `https://api.replicate.com/v1/models/${slug}`,
      { headers: auth, signal: AbortSignal.timeout(30_000) }
    );
    if (!modelResponse.ok) {
      throw new Error(`replicate_singing_model_${modelResponse.status}`);
    }
    const model = (await modelResponse.json()) as {
      latest_version?: { id?: string };
    };
    version = model.latest_version?.id;
    if (!version) throw new Error('replicate_singing_model_version_missing');
  }

  const duration = Math.min(240, Math.max(30, Math.ceil(manifest.targetDurationS)));
  const kickoff = await fetcher('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      version,
      input: {
        tags: [
          manifest.genre,
          `${manifest.bpm} bpm`,
          manifest.key,
          'lead vocal performance',
          'clear lyric diction',
        ].join(', '),
        lyrics: manifest.lyrics,
        duration,
        seed: manifest.seed,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!kickoff.ok) {
    const detail = (await kickoff.text()).slice(0, 160);
    throw new Error(`replicate_singing_kickoff_${kickoff.status}:${detail}`);
  }
  let prediction = (await kickoff.json()) as {
    id?: string;
    status?: string;
    output?: string | string[];
    error?: string;
  };
  if (!prediction.id) throw new Error('replicate_singing_prediction_id_missing');

  const deadline = Date.now() + 20 * 60_000;
  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled' &&
    Date.now() < deadline
  ) {
    await sleep(5_000);
    const statusResponse = await fetcher(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: auth, signal: AbortSignal.timeout(30_000) }
    );
    if (!statusResponse.ok) {
      throw new Error(`replicate_singing_status_${statusResponse.status}`);
    }
    prediction = (await statusResponse.json()) as typeof prediction;
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(
      prediction.status === 'failed' || prediction.status === 'canceled'
        ? `replicate_singing_${prediction.status}:${prediction.error ?? ''}`
        : 'replicate_singing_timed_out'
    );
  }
  const output = Array.isArray(prediction.output)
    ? prediction.output[prediction.output.length - 1]
    : prediction.output;
  if (!playableAudioUrl(output)) {
    throw new Error('replicate_singing_returned_no_playable_audio');
  }
  const synthesisUsd = money(
    numericEnv(env, 'AFROONE_SINGING_REPLICATE_COST_USD', 0.1, 0, 10)
  );
  return {
    performanceKind: 'sung_vocal',
    performanceSource: 'generative_singing',
    outputKind: 'full_mix',
    audioUrl: output,
    format: 'wav',
    engine: 'replicate-ace-step',
    externalId: prediction.id ?? null,
    exactScoreInput: false,
    manifest,
    cost: {
      currency: 'USD',
      synthesisUsd,
      voiceConversionUsd: 0,
      verificationUsd: 0,
      totalUsd: synthesisUsd,
      estimated: true,
    },
  };
}

/**
 * Cheapest-first genuine singer. There is intentionally no TTS, spoken-guide,
 * stub, silent WAV, or placeholder fallback in this ladder.
 */
export async function renderAfroOneSinging(
  manifest: AfroOneSingingManifest,
  dependencies: AfroOneSingingDependencies = {}
): Promise<AfroOneSingingRender> {
  const env = dependencies.env ?? process.env;
  if (!afroOneSingingEnabled(env)) {
    throw new Error('afroone_singing_disabled');
  }
  const { manifestHash: _manifestHash, ...manifestBase } = manifest;
  if (afroOneSingingHash(manifestBase) !== manifest.manifestHash) {
    throw new Error('afroone_singing_manifest_tampered');
  }

  const fetcher = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts: AfroOneSingingAttempt[] = [];
  let incurredSynthesisUsd = 0;
  for (const engine of configuredOrder(env)) {
    try {
      const rendered = engine === 'local-score-singer'
        ? await renderLocalScoreSinger(manifest, env, fetcher)
        : engine === 'fal-ace-step'
          ? await renderFalAceStep(manifest, env, fetcher, sleep)
          : await renderReplicateAceStep(manifest, env, fetcher, sleep);
      if (dependencies.verifyCandidate) {
        try {
          await dependencies.verifyCandidate(rendered);
        } catch (error) {
          incurredSynthesisUsd = money(
            incurredSynthesisUsd + rendered.cost.synthesisUsd
          );
          attempts.push({
            engine,
            outcome: 'failed',
            estimatedCostUsd: rendered.cost.synthesisUsd,
            reason: `verification:${(error as Error).message || 'failed'}`,
          });
          continue;
        }
      }
      attempts.push({
        engine,
        outcome: 'succeeded',
        estimatedCostUsd: rendered.cost.synthesisUsd,
      });
      const synthesisUsd = money(
        incurredSynthesisUsd + rendered.cost.synthesisUsd
      );
      return {
        ...rendered,
        attempts,
        cost: {
          ...rendered.cost,
          synthesisUsd,
          totalUsd: money(
            synthesisUsd +
              rendered.cost.voiceConversionUsd +
              rendered.cost.verificationUsd
          ),
        },
      };
    } catch (error) {
      const reason = (error as Error).message || 'failed';
      attempts.push({
        engine,
        outcome: reason === 'not_configured' ? 'skipped' : 'failed',
        estimatedCostUsd: 0,
        reason,
      });
    }
  }
  const error = new Error('afroone_singing_no_genuine_engine_succeeded') as Error & {
    attempts?: AfroOneSingingAttempt[];
  };
  error.attempts = attempts;
  throw error;
}

export function buildAfroOneSungAssetReceipt(input: {
  render: AfroOneSingingRender;
  personalizedVoice: boolean;
  performanceSource?: AfroOneSungAssetReceipt['performanceSource'];
  cost?: AfroOneSingingCostTelemetry;
}): AfroOneSungAssetReceipt {
  if (input.render.performanceKind !== 'sung_vocal') {
    throw new Error('afroone_singing_non_sung_asset_rejected');
  }
  const performanceSource =
    input.performanceSource ?? input.render.performanceSource;
  if (
    performanceSource !== 'score_synth' &&
    performanceSource !== 'generative_singing' &&
    performanceSource !== 'voice_conversion'
  ) {
    throw new Error('afroone_singing_invalid_performance_source');
  }
  return {
    schemaVersion: 1,
    afroOneSinging: true,
    assetKind: 'isolated_vocal',
    performanceKind: 'sung_vocal',
    performanceSource,
    spokenGuideNotSung: false,
    placeholder: false,
    engine: input.render.engine,
    externalId: input.render.externalId,
    exactScoreInput: input.render.exactScoreInput,
    seed: input.render.manifest.seed,
    lyricsHash: input.render.manifest.lyricsHash,
    scoreHash: input.render.manifest.scoreHash,
    alignmentHash: input.render.manifest.alignmentHash,
    manifestHash: input.render.manifest.manifestHash,
    cost: input.cost ?? input.render.cost,
    attempts: input.render.attempts,
    personalizedVoice: input.personalizedVoice,
  };
}
