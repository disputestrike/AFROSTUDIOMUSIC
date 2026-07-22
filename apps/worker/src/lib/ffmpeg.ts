/**
 * FFmpeg helpers — spawn the system ffmpeg binary directly (no wrapper dep).
 * Railway worker image includes ffmpeg via nixpacks (see apps/worker/railway.json).
 * Locally, install ffmpeg or mixes/masters will fail with a clear error.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { familyOf, grooveOffsetMs, isMaterialRole, jobOf, parseStorageUri, sectionEnergyGainDb } from '@afrohit/shared';
import { downloadToBuffer } from './storage';

export const NATIVE_AUDIO_LIMITS = Object.freeze({
  availabilityTimeoutMs: 10_000,
  probeTimeoutMs: 30_000,
  analysisTimeoutMs: 5 * 60_000,
  renderTimeoutMs: 15 * 60_000,
  outputLimitBytes: 2 * 1024 * 1024,
  probeOutputLimitBytes: 64 * 1024,
  maxOutputLimitBytes: 8 * 1024 * 1024,
  remoteInputMaxBytes: 512 * 1024 * 1024,
  remoteInputTimeoutMs: 90_000,
  terminateGraceMs: 1_000,
});

export interface NativeAudioExecutionOptions {
  timeoutMs?: number;
  outputLimitBytes?: number;
}

type NativeProcessFailure = 'timeout' | 'output_limit' | 'spawn' | null;
type BoundedProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  failure: NativeProcessFailure;
  errorMessage: string | null;
};

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value!)));
}

function stopChild(child: ChildProcess): () => void {
  if (child.exitCode !== null || child.signalCode !== null) return () => undefined;
  try {
    child.kill('SIGTERM');
  } catch {
    // The close/error handlers still settle the bounded execution result.
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Nothing else can be done once the OS rejects termination.
      }
    }
  }, NATIVE_AUDIO_LIMITS.terminateGraceMs);
  forceTimer.unref();
  return () => clearTimeout(forceTimer);
}

function runBoundedProcess(options: {
  command: 'ffmpeg' | 'ffprobe';
  args: string[];
  timeoutMs: number;
  outputLimitBytes: number;
  captureStdout: boolean;
  captureStderr: boolean;
}): Promise<BoundedProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      stdio: [
        'ignore',
        options.captureStdout ? 'pipe' : 'ignore',
        options.captureStderr ? 'pipe' : 'ignore',
      ],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let failure: NativeProcessFailure = null;
    let errorMessage: string | null = null;
    let settled = false;
    let cancelForcedStop: () => void = () => undefined;

    const requestStop = (reason: Exclude<NativeProcessFailure, null>) => {
      if (failure) return;
      failure = reason;
      cancelForcedStop = stopChild(child);
    };
    const append = (target: Buffer[], value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = Math.max(0, options.outputLimitBytes - capturedBytes);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      capturedBytes += Math.min(remaining, chunk.byteLength);
      if (chunk.byteLength > remaining) requestStop('output_limit');
    };
    const deadline = setTimeout(() => requestStop('timeout'), options.timeoutMs);
    deadline.unref();
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      cancelForcedStop();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        failure,
        errorMessage,
      });
    };

    child.stdout?.on('data', (chunk) => append(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk) => append(stderrChunks, chunk));
    child.once('error', (error) => {
      failure = 'spawn';
      errorMessage = error.message;
      finish(null);
    });
    child.once('close', (code) => finish(code));
  });
}

type StagedFfmpegInput = { path: string; cleanup: () => Promise<void> };

function hasNonFileScheme(input: string): boolean {
  return !/^[a-zA-Z]:[\\/]/.test(input) && /^[a-z][a-z0-9+.-]*:/i.test(input);
}

async function stageFfmpegInput(input: string): Promise<StagedFfmpegInput> {
  const remote = !!parseStorageUri(input) || /^https?:\/\//i.test(input);
  if (!remote) {
    if (hasNonFileScheme(input)) throw new Error('ffmpeg_input_protocol_unsupported');
    return { path: input, cleanup: async () => undefined };
  }

  const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-input-'));
  const path = join(directory, 'input.bin');
  try {
    const bytes = await downloadToBuffer(input, {
      maxBytes: NATIVE_AUDIO_LIMITS.remoteInputMaxBytes,
      timeoutMs: NATIVE_AUDIO_LIMITS.remoteInputTimeoutMs,
    });
    if (!bytes.byteLength) throw new Error('ffmpeg_input_empty');
    await writeFile(path, bytes);
    return {
      path,
      cleanup: () => rm(directory, { recursive: true, force: true }).catch(() => undefined),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ffmpegAvailable(options: NativeAudioExecutionOptions = {}): Promise<boolean> {
  const result = await runBoundedProcess({
    command: 'ffmpeg',
    args: ['-version'],
    timeoutMs: boundedInteger(
      options.timeoutMs,
      NATIVE_AUDIO_LIMITS.availabilityTimeoutMs,
      NATIVE_AUDIO_LIMITS.renderTimeoutMs,
    ),
    outputLimitBytes: 1,
    captureStdout: false,
    captureStderr: false,
  });
  return result.failure === null && result.exitCode === 0;
}

export async function runFfmpeg(
  args: string[],
  options: NativeAudioExecutionOptions = {},
): Promise<void> {
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    NATIVE_AUDIO_LIMITS.renderTimeoutMs,
    NATIVE_AUDIO_LIMITS.renderTimeoutMs,
  );
  const outputLimitBytes = boundedInteger(
    options.outputLimitBytes,
    NATIVE_AUDIO_LIMITS.outputLimitBytes,
    NATIVE_AUDIO_LIMITS.maxOutputLimitBytes,
  );
  const result = await runBoundedProcess({
    command: 'ffmpeg',
    args: ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    timeoutMs,
    outputLimitBytes,
    captureStdout: false,
    captureStderr: true,
  });
  if (result.failure === 'timeout') throw new Error(`ffmpeg timeout after ${timeoutMs}ms`);
  if (result.failure === 'output_limit') throw new Error(`ffmpeg output exceeded ${outputLimitBytes} bytes`);
  if (result.failure === 'spawn') throw new Error(`ffmpeg spawn failed: ${result.errorMessage ?? 'unknown error'}`);
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg exit ${result.exitCode ?? 'unknown'}: ${result.stderr.slice(0, 500)}`);
  }
}

/**
 * Read the real duration (seconds) of an audio file or URL via ffprobe.
 * Providers that stream results back through a poll (MiniMax, Suno) can't
 * report duration up front, so we probe the rendered file. Returns 0 on any
 * failure — callers treat 0 as "unknown", never crash on it.
 */
async function probeLocalDurationS(
  input: string,
  options: NativeAudioExecutionOptions = {},
): Promise<number> {
  const result = await runBoundedProcess({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      input,
    ],
    timeoutMs: boundedInteger(
      options.timeoutMs,
      NATIVE_AUDIO_LIMITS.probeTimeoutMs,
      NATIVE_AUDIO_LIMITS.renderTimeoutMs,
    ),
    outputLimitBytes: boundedInteger(
      options.outputLimitBytes,
      NATIVE_AUDIO_LIMITS.probeOutputLimitBytes,
      NATIVE_AUDIO_LIMITS.maxOutputLimitBytes,
    ),
    captureStdout: true,
    captureStderr: true,
  });
  if (result.failure !== null || result.exitCode !== 0) return 0;
  const durationS = Math.round(Number.parseFloat(result.stdout.trim()));
  return Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
}

export async function probeDurationS(
  input: string,
  options: NativeAudioExecutionOptions = {},
): Promise<number> {
  let staged: StagedFfmpegInput | null = null;
  try {
    staged = await stageFfmpegInput(input);
    return await probeLocalDurationS(staged.path, options);
  } catch {
    return 0;
  } finally {
    await staged?.cleanup();
  }
}

export async function probeAudioBufferDurationS(
  input: Buffer,
  options: NativeAudioExecutionOptions = {},
): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'audio-duration-'));
  const inputPath = join(directory, 'audio.bin');
  try {
    await writeFile(inputPath, input);
    return await probeLocalDurationS(inputPath, options);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Extract a short mono, low-bitrate clip — used before audio analysis so a 7B
 * audio model doesn't OOM on a full 3-minute track (it only needs ~60s to read
 * the production). Returns an mp3 Buffer. Fast-seek (-ss before -i).
 */
export async function extractClip(input: Buffer, startS: number, durS: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'clip-'));
  const inPath = join(dir, 'in');
  const outPath = join(dir, 'clip.mp3');
  try {
    await writeFile(inPath, input);
    await runFfmpeg(['-ss', String(startS), '-t', String(durS), '-i', inPath, '-ac', '1', '-ar', '22050', '-b:a', '96k', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface AudioQuality {
  durationS: number;
  integratedLufs: number | null; // overall loudness (I) — too low = dead/quiet
  loudnessRangeLra: number | null; // LRA — LOW = flat, no dynamics ("straight line")
  truePeakDb: number | null; // dBTP — > 0 means it clips on export
  crestFactorDb: number | null; // peak-to-RMS — LOW = squashed/lifeless
  flatFactor: number | null; // astats flatness — HIGH = digital silence/clipping runs
  // MASTER REPORT metrics (the "billion-dollar studio" bar, stated honestly):
  // measured spectral balance and stereo health, so a QC record is a real
  // {lufs, dBTP, lra, crest, tilt, correlation} report, not just loudness.
  spectralTiltDbPerOct: number | null; // slope of per-octave RMS — strongly negative = dull, ~0/positive = harsh
  octaveRmsDb: number[] | null; // the measured per-octave band RMS (dB) behind the tilt, 63 Hz → 8 kHz — kept for reference deltas
  stereoCorrelation: number | null; // +1 = mono-safe, 0 = decorrelated, <0 = phase trouble on mono fold-down
  flags: string[]; // e.g. ["flat","too_quiet","clipping"]
  verdict: 'pass' | 'weak' | 'fail';
  ok: boolean; // back-compat: verdict !== 'fail'
}

export type FfmpegCaptureResult = {
  stderr: string;
  exitCode: number | null;
  failure: NativeProcessFailure;
};

/** Run ffmpeg capturing stderr (where filter summaries print). Never throws. */
async function ffmpegCapture(
  args: string[],
  options: NativeAudioExecutionOptions = {},
): Promise<FfmpegCaptureResult> {
  const result = await runBoundedProcess({
    command: 'ffmpeg',
    args: ['-hide_banner', '-nostats', ...args],
    timeoutMs: boundedInteger(
      options.timeoutMs,
      NATIVE_AUDIO_LIMITS.analysisTimeoutMs,
      NATIVE_AUDIO_LIMITS.renderTimeoutMs,
    ),
    outputLimitBytes: boundedInteger(
      options.outputLimitBytes,
      NATIVE_AUDIO_LIMITS.outputLimitBytes,
      NATIVE_AUDIO_LIMITS.maxOutputLimitBytes,
    ),
    captureStdout: false,
    captureStderr: true,
  });
  return { stderr: result.stderr, exitCode: result.exitCode, failure: result.failure };
}

const numAfter = (s: string, re: RegExp): number | null => {
  const m = s.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
};

/**
 * Measure the ACTUAL quality of a rendered track — fast, free, deterministic
 * (one ffmpeg pass after bounded local staging for remote inputs). This is the first
 * gate of the quality loop: it catches the "shallow / same-y / straight line"
 * defect objectively instead of only checking that a file exists.
 *
 *   - loudnessRangeLra: how much the track moves dynamically. LOW LRA = a flat,
 *     going-nowhere loop with no arrangement — literally the "straight line".
 *   - crestFactorDb: peak vs RMS. LOW = squashed to death, lifeless.
 *   - integratedLufs / truePeak: too quiet, or clipping on export.
 *
 * Heuristic and conservative (AI renders arrive pre-loudness-processed, so we
 * only flag clear failures). Returns a verdict the UI/eval harness can act on.
 * Falls back to a duration-only verdict if ffmpeg/parse is unavailable.
 */
function durationOnlyAudioQuality(durationS: number): AudioQuality {
  const verdict: AudioQuality['verdict'] = durationS >= 12 ? 'weak' : 'fail';
  return {
    durationS,
    integratedLufs: null,
    loudnessRangeLra: null,
    truePeakDb: null,
    crestFactorDb: null,
    flatFactor: null,
    spectralTiltDbPerOct: null,
    octaveRmsDb: null,
    stereoCorrelation: null,
    flags: ['unmeasured'],
    verdict,
    ok: verdict !== 'fail',
  };
}

export function audioQualityFromFfmpegCapture(
  durationS: number,
  capture: FfmpegCaptureResult,
): AudioQuality {
  const fallback = () => durationOnlyAudioQuality(durationS);
  if (capture.failure !== null || capture.exitCode !== 0) return fallback();
  const out = capture.stderr;
  const summaryIdx = out.lastIndexOf('Summary:');
  const hasSummary = summaryIdx >= 0;
  const summary = hasSummary ? out.slice(summaryIdx) : '';
  const integratedLufs = hasSummary ? numAfter(summary, /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/) : null;
  const loudnessRangeLra = hasSummary ? numAfter(summary, /LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/) : null;
  const peaks = hasSummary
    ? [...summary.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)]
      .map((match) => Number.parseFloat(match[1]!))
      .filter(Number.isFinite)
    : [];
  const truePeakDb = peaks.length ? Math.max(...peaks) : null;
  const overallIdx = out.lastIndexOf('Overall');
  const astatsOverall = overallIdx >= 0 ? out.slice(overallIdx) : out;
  const peakLevelDb = numAfter(astatsOverall, /Peak level dB:\s*(-?\d+(?:\.\d+)?)/);
  const rmsLevelDb = numAfter(astatsOverall, /RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
  const crestFactorDb = peakLevelDb !== null && rmsLevelDb !== null
    ? Math.round((peakLevelDb - rmsLevelDb) * 10) / 10
    : null;
  const flatFactor = numAfter(astatsOverall, /Flat factor:\s*(-?\d+(?:\.\d+)?)/);

  const flags: string[] = [];
  if (integratedLufs !== null && integratedLufs < -23) flags.push('too_quiet');
  if (truePeakDb !== null && truePeakDb > 0.5) flags.push('clipping');
  const loudMaster = integratedLufs !== null && integratedLufs > -11;
  if (loudnessRangeLra !== null && loudnessRangeLra < 3 && !loudMaster) flags.push('flat');
  if (crestFactorDb !== null && crestFactorDb < 6) flags.push('squashed');
  if (durationS > 0 && durationS < 20) flags.push('short');

  const hard = flags.some((flag) => flag === 'too_quiet' || flag === 'clipping')
    || (durationS > 0 && durationS < 8);
  const soft = flags.some((flag) => flag === 'flat' || flag === 'squashed');
  const verdict: AudioQuality['verdict'] = hard ? 'fail' : soft ? 'weak' : 'pass';
  if (integratedLufs === null && loudnessRangeLra === null && crestFactorDb === null) return fallback();
  return {
    durationS,
    integratedLufs,
    loudnessRangeLra,
    truePeakDb,
    crestFactorDb,
    flatFactor,
    // Spectral/stereo metrics come from a SECOND measurement pass (see
    // measureSpectralAndStereo) — a raw ebur128/astats capture can't provide
    // them, so this parser honestly reports null and measureAudioQuality fills
    // them in when its extra pass succeeds.
    spectralTiltDbPerOct: null,
    octaveRmsDb: null,
    stereoCorrelation: null,
    flags,
    verdict,
    ok: verdict !== 'fail',
  };
}

/** Octave-band centers for the spectral-tilt measurement — 63 Hz to 8 kHz covers
 *  the musically decisive range (sub anchor → air) in 8 one-octave bands. */
const OCTAVE_CENTERS_HZ = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

/**
 * SECOND measurement pass — spectral tilt + stereo correlation, one ffmpeg run.
 *
 *   - Per-octave RMS: a bank of one-octave bandpass branches each ending in
 *     volumedetect (its single `mean_volume` summary line is the most reliable
 *     RMS readout ffmpeg prints — astats-per-band would print ~40 lines each
 *     and make instance attribution fragile). Tilt = least-squares slope of
 *     band dB vs octave index, in dB/octave.
 *   - Stereo correlation: mid/side energy via stereotools lr>ms + ONE astats
 *     (channel 1 = mid RMS, channel 2 = side RMS); correlation is the standard
 *     meter quantity (M²−S²)/(M²+S²). Chosen over averaging aphasemeter frame
 *     metadata deliberately: aphasemeter only exposes per-frame values, and
 *     parsing thousands of metadata lines against the bounded stderr capture is
 *     exactly the kind of fragile plumbing the honesty law forbids — this is
 *     the same physical quantity from two summary numbers.
 *
 * Best-effort by contract: any failure returns nulls, never throws, never
 * fails QC — an unmeasured tilt is honorably null.
 */
async function measureSpectralAndStereo(
  path: string,
  options: NativeAudioExecutionOptions = {},
): Promise<{ tiltDbPerOct: number | null; octaveRmsDb: number[] | null; correlation: number | null }> {
  const empty = { tiltDbPerOct: null, octaveRmsDb: null, correlation: null };
  try {
    const n = OCTAVE_CENTERS_HZ.length;
    // asplit → n band branches + 1 mid/side branch + 1 passthrough the null
    // muxer can map (a filtergraph must still produce one mapped output).
    const splitLabels = ['[q_out]', ...OCTAVE_CENTERS_HZ.map((_, i) => `[q_b${i}]`), '[q_ms]'].join('');
    const chains = [
      `[0:a]aformat=channel_layouts=stereo,asplit=${n + 2}${splitLabels}`,
      ...OCTAVE_CENTERS_HZ.map(
        (hz, i) => `[q_b${i}]bandpass=f=${hz}:width_type=o:width=1,volumedetect,anullsink`,
      ),
      '[q_ms]stereotools=mode=lr>ms,astats=metadata=0,anullsink',
    ];
    const capture = await ffmpegCapture([
      '-i', path,
      '-filter_complex', chains.join(';'),
      '-map', '[q_out]',
      '-f', 'null', '-',
    ], options);
    if (capture.failure !== null || capture.exitCode !== 0) return empty;
    const err = capture.stderr;

    // volumedetect instances print in whatever order they flush, but every line
    // carries its parse-order index — sort by it and the bands come back in the
    // exact order the branches were written above.
    const bandMatches = [...err.matchAll(/\[Parsed_volumedetect_(\d+) @ [^\]]+\] mean_volume:\s*(-?\d+(?:\.\d+)?) dB/g)]
      .map((m) => ({ idx: Number.parseInt(m[1]!, 10), db: Number.parseFloat(m[2]!) }))
      .filter((m) => Number.isFinite(m.idx) && Number.isFinite(m.db))
      .sort((a, b) => a.idx - b.idx);
    let tiltDbPerOct: number | null = null;
    let octaveRmsDb: number[] | null = null;
    if (bandMatches.length === n) {
      octaveRmsDb = bandMatches.map((m) => Math.round(m.db * 10) / 10);
      // Least-squares slope of band dB against octave index (bands are exactly
      // one octave apart, so the index IS the octave axis).
      const xs = octaveRmsDb.map((_, i) => i);
      const meanX = xs.reduce((a, b) => a + b, 0) / n;
      const meanY = octaveRmsDb.reduce((a, b) => a + b, 0) / n;
      const cov = xs.reduce((a, x, i) => a + (x - meanX) * (octaveRmsDb![i]! - meanY), 0);
      const varX = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
      tiltDbPerOct = varX > 0 ? Math.round((cov / varX) * 100) / 100 : null;
    }

    // The single astats in the graph reports Channel 1 (mid) then Channel 2
    // (side) then Overall — take the first two RMS levels. A pure-mono side
    // channel prints "-inf": treat as zero energy (correlation exactly +1).
    const rmsMatches = [...err.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/g)].map((m) => m[1]!);
    let correlation: number | null = null;
    if (rmsMatches.length >= 2) {
      const toPower = (s: string): number | null => {
        if (s === '-inf') return 0;
        const db = Number.parseFloat(s);
        return Number.isFinite(db) ? Math.pow(10, db / 10) : null;
      };
      const mid = toPower(rmsMatches[0]!);
      const side = toPower(rmsMatches[1]!);
      if (mid !== null && side !== null && mid + side > 0) {
        correlation = Math.round(((mid - side) / (mid + side)) * 100) / 100;
      }
    }
    return { tiltDbPerOct, octaveRmsDb, correlation };
  } catch {
    return empty;
  }
}

export async function measureAudioQuality(
  input: string,
  options: NativeAudioExecutionOptions = {},
): Promise<AudioQuality> {
  let staged: StagedFfmpegInput | null = null;
  let durationS = 0;
  try {
    staged = await stageFfmpegInput(input);
    durationS = await probeLocalDurationS(staged.path, options);
    if (!(await ffmpegAvailable(options))) return durationOnlyAudioQuality(durationS);
    const capture = await ffmpegCapture([
      '-i', staged.path,
      '-af', 'ebur128=peak=true,astats=metadata=0',
      '-f', 'null', '-',
    ], options);
    const quality = audioQualityFromFfmpegCapture(durationS, capture);
    // MASTER REPORT pass — tilt + correlation ride the same staged file. Failure
    // leaves the fields null and never degrades the loudness verdict.
    const spectral = await measureSpectralAndStereo(staged.path, options);
    quality.spectralTiltDbPerOct = spectral.tiltDbPerOct;
    quality.octaveRmsDb = spectral.octaveRmsDb;
    quality.stereoCorrelation = spectral.correlation;
    return quality;
  } catch {
    return durationOnlyAudioQuality(durationS);
  } finally {
    await staged?.cleanup();
  }
}

/** Measure the exact bytes supplied by a caller, without a second network read. */
export async function measureAudioBufferQuality(
  input: Buffer,
  options: NativeAudioExecutionOptions = {},
): Promise<AudioQuality> {
  const dir = await mkdtemp(join(tmpdir(), 'audio-qc-'));
  const inputPath = join(dir, 'audio.bin');
  try {
    await writeFile(inputPath, input);
    return await measureAudioQuality(inputPath, options);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Measure how much of a file is above a conservative vocal-activity floor.
 * This is not speech recognition and makes no lyric/alignment claim; it only
 * catches empty, mostly silent, or undecodable uploads before they reach a mix
 * or training dataset. Null means the measurement could not be completed. */
export async function measureVocalActivity(input: string): Promise<{
  durationS: number;
  activeRatio: number;
  silenceSeconds: number;
} | null> {
  let staged: StagedFfmpegInput | null = null;
  try {
    staged = await stageFfmpegInput(input);
    const durationS = await probeLocalDurationS(staged.path);
    if (durationS <= 0 || !(await ffmpegAvailable())) return null;
    const capture = await ffmpegCapture([
      '-i', staged.path,
      '-af', 'silencedetect=noise=-45dB:d=0.25',
      '-f', 'null', '-',
    ]);
    if (capture.failure !== null || capture.exitCode !== 0) return null;
    const output = capture.stderr;
    if (!/silence_(?:start|end|duration)/.test(output)) {
      if (/audio:|video:0kB/i.test(output)) return { durationS, activeRatio: 1, silenceSeconds: 0 };
      return null;
    }
    const durations = [...output.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)]
      .map((match) => Number.parseFloat(match[1]!))
      .filter(Number.isFinite);
    let silenceSeconds = durations.reduce((sum, value) => sum + value, 0);
    const trailingStart = [...output.matchAll(/silence_start:\s*(\d+(?:\.\d+)?)/g)]
      .map((match) => Number.parseFloat(match[1]!))
      .filter(Number.isFinite)
      .at(-1);
    const lastEnd = [...output.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)]
      .map((match) => Number.parseFloat(match[1]!))
      .filter(Number.isFinite)
      .at(-1);
    if (trailingStart != null && (lastEnd == null || trailingStart > lastEnd)) {
      silenceSeconds += Math.max(0, durationS - trailingStart);
    }
    silenceSeconds = Math.min(durationS, Math.max(0, silenceSeconds));
    const activeRatio = Math.max(0, Math.min(1, (durationS - silenceSeconds) / durationS));
    return {
      durationS,
      activeRatio: Math.round(activeRatio * 10_000) / 10_000,
      silenceSeconds: Math.round(silenceSeconds * 100) / 100,
    };
  } catch {
    return null;
  } finally {
    await staged?.cleanup();
  }
}

// ---------------------------------------------------------------------------
// MATERIAL LAYER — the arranger's hands. Real loops in, a real beat out.
// ---------------------------------------------------------------------------

/** Trim raw audio to an exact N-bar loop at the given BPM (4/4), gentle edges.
 *
 * DOWNBEAT LAW (scattered-beat diagnosis 2026-07): the old fixed startS=0.5 cut
 * every provider render at an arbitrary half-second — whatever transient
 * happened to sit there became "beat one", so separately-forged loops landed
 * with different phase and the assembled kit never locked. opts.startS lets the
 * caller pass the MEASURED first downbeat (DSP-detected for provider renders;
 * 0 for synth loops, which start exactly on the grid by construction). The 0.5s
 * default is kept ONLY as the legacy fallback for callers that have no
 * measurement yet — unknown is honorable, but measured wins. */
export async function trimToLoop(
  input: Buffer,
  bpm: number,
  bars = 8,
  opts: { startS?: number } = {},
): Promise<Buffer> {
  const startS = Number.isFinite(opts.startS) && (opts.startS as number) >= 0 ? (opts.startS as number) : 0.5;
  const dur = (60 / bpm) * 4 * bars;
  const dir = await mkdtemp(join(tmpdir(), 'loop-'));
  const inPath = join(dir, 'in');
  const outPath = join(dir, 'loop.wav');
  try {
    await writeFile(inPath, input);
    // Tiny declick fades at the edges so the loop seam doesn't pop.
    await runFfmpeg([
      '-ss', String(startS), '-t', dur.toFixed(3), '-i', inPath,
      '-af', `afade=t=in:d=0.01,afade=t=out:st=${(dur - 0.015).toFixed(3)}:d=0.015`,
      '-ar', '44100', '-ac', '2', outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface AssemblyLayer {
  /** local temp path to the loop file */
  path: string;
  /** loop's native bpm (time-stretched to the target) */
  sourceBpm: number;
  /** relative gain 0..1.5 */
  gain: number;
  /** stereo placement -1 (left) .. +1 (right); 0/undefined = center */
  pan?: number;
  /** material role — drives the GROOVE offset (grooveOffsetMs); absent = on-grid */
  role?: string;
}
export interface AssemblySection {
  name: string; // intro | verse | hook | outro …
  bars: number;
  /** indexes into the layers array — which material plays in this section */
  layerIdx: number[];
  /** 0..1 — the arrangement's energy arc (Producer Brain / direction profiles).
   * Scales this section's bus gain via sectionEnergyGainDb (-2.5..+1.5 dB) so
   * hooks audibly lift and intros sit back. Absent → 0 dB (legacy behavior). */
  energy?: number;
}

/** The musical job a layer's role serves — the SAME mapping the arranger and
 *  own-engine use (jobOf for taxonomy roles, the legacy coarse-role table for
 *  the stem-separator names), so the mix bus and the arrangement never disagree
 *  about what counts as low end. */
function layerJobOf(role: string | undefined): string | null {
  if (!role) return null; // unknown is honorable — never carve blind
  if (isMaterialRole(role)) return jobOf(role);
  return (
    {
      drums: 'rhythm',
      percussion: 'rhythm',
      bass: 'low_end',
      log_drum: 'low_end',
      chords: 'harmony',
    } as Record<string, string>
  )[role] ?? null;
}

// ---------------------------------------------------------------------------
// PRE-HOOK DROP (SOUNDWAVE2 — "the beat is not Afrobeats"): every commercial
// Afro record breathes for the final bar before the hook — kick and bass OUT,
// shakers/percussion/harmony carry, then the full band slams back on the hook
// downbeat. The assembler had no such move: hooks arrived as a layer-count
// change and nothing else. This pure transform splits the last bar of any
// section that leads into a hook into its own 1-bar drop section whose kick-
// bearing and low-end layers are removed. Deterministic, bounded (1 bar, total
// bar count preserved), fail-open (no hook / nothing to drop / nothing left →
// section untouched), and receipted by the caller from the returned notes.
// ---------------------------------------------------------------------------

export const PRE_HOOK_DROP_BARS = 1;
/** Sections whose ARRIVAL earns the breath before it. */
const HOOK_SECTION_RE = /hook|chorus/i;
/** Legacy coarse roles that carry the kick/low end (taxonomy roles resolve via
 *  jobOf/familyOf below). */
const LEGACY_DROP_ROLES = new Set(['drums', 'bass', 'log_drum']);

/** Does this layer's role carry the kick or the low end? (the voices the
 *  pre-hook breath removes — percussion/harmony/texture keep playing). */
export function isPreHookDropRole(role: string | undefined): boolean {
  if (!role) return false; // unknown is honorable — never silence what we can't identify
  if (isMaterialRole(role)) return jobOf(role) === 'low_end' || familyOf(role) === 'drumkit';
  return LEGACY_DROP_ROLES.has(role);
}

export interface PreHookDropNote {
  /** the section whose final bar became the breath */
  from: string;
  /** the hook section the drop leads into */
  into: string;
  bars: number;
  /** layer indexes silenced for the drop bar */
  droppedLayerIdx: number[];
}

/** The drop bar sits back (energy 0.25 → ~-1.9 dB on the bounded curve) so the
 *  equal-power bus trim can't level-compensate the missing low end away. */
export const PRE_HOOK_DROP_ENERGY = 0.25;

export function applyPreHookDrops(
  sections: AssemblySection[],
  layerRoles: Array<string | undefined>,
): { sections: AssemblySection[]; drops: PreHookDropNote[] } {
  const out: AssemblySection[] = [];
  const drops: PreHookDropNote[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const next = sections[i + 1];
    const leadsIntoHook = !!next && HOOK_SECTION_RE.test(next.name);
    if (!leadsIntoHook || sec.bars < PRE_HOOK_DROP_BARS + 1) {
      out.push(sec);
      continue;
    }
    const kept = sec.layerIdx.filter((idx) => !isPreHookDropRole(layerRoles[idx]));
    const dropped = sec.layerIdx.filter((idx) => isPreHookDropRole(layerRoles[idx]));
    // Fail-open: nothing to drop, or the breath would be silence → untouched.
    if (!dropped.length || !kept.length) {
      out.push(sec);
      continue;
    }
    out.push({ ...sec, bars: sec.bars - PRE_HOOK_DROP_BARS });
    out.push({
      name: `${sec.name}_prehook_drop`,
      bars: PRE_HOOK_DROP_BARS,
      layerIdx: kept,
      energy: PRE_HOOK_DROP_ENERGY,
    });
    drops.push({
      from: sec.name,
      into: next!.name,
      bars: PRE_HOOK_DROP_BARS,
      droppedLayerIdx: dropped,
    });
  }
  return { sections: out, drops };
}

/** SECTION CROSSFADE (SOUNDWAVE1 fix 4): sections used to be independent files
 *  butt-spliced with the concat demuxer — an audible splice at every boundary
 *  (beds cut mid-ring, phrases hard-reset). Each non-final section now renders
 *  CROSSFADE_S longer (the extra tail is the next loop repetition continuing
 *  naturally — the loops are seamless by construction) and acrossfade overlaps
 *  exactly that extra tail, so every boundary stays ON the bar grid and the
 *  total duration is exactly the sum of the section lengths. */
export const SECTION_CROSSFADE_S = 0.03;

/** Pure builder for the section-join filtergraph (exported for the offline
 *  gate suite): chains n-1 acrossfades (tri/tri = constant-amplitude linear,
 *  correct for correlated loop material) into [a]. n must be >= 2. */
export function buildCrossfadeJoinGraph(n: number, fadeS = SECTION_CROSSFADE_S): string {
  if (!Number.isInteger(n) || n < 2) throw new Error(`crossfade join needs >=2 inputs (got ${n})`);
  const parts: string[] = [];
  let prev = '[0:a]';
  for (let i = 1; i < n; i++) {
    const label = i === n - 1 ? '[a]' : `[x${i}]`;
    parts.push(`${prev}[${i}:a]acrossfade=d=${fadeS}:c1=tri:c2=tri${label}`);
    prev = label;
  }
  return parts.join(';');
}

/**
 * Assemble a full beat from real material: each section loops its layers to the
 * section length (time-stretched to the target BPM), mixes them, then sections
 * join with short crossfades into one continuous WAV. Deterministic — the exact
 * beat, every time.
 */
export async function assembleBeat(opts: {
  layers: AssemblyLayer[];
  sections: AssemblySection[];
  targetBpm: number;
  /** Native stem buses retain silent gaps where a role is not active. */
  preserveEmptySections?: boolean;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-'));
  try {
    const sectionFiles: string[] = [];
    // Exact musical length of the record (sum of included section lengths).
    // Every section file carries a SECTION_CROSSFADE_S pad tail; each join
    // consumes one pad, and the final -t trim drops the last — boundaries land
    // exactly on the bar grid and the bookkeeping stays honest.
    let totalDurS = 0;
    for (let s = 0; s < opts.sections.length; s++) {
      const sec = opts.sections[s]!;
      const secDur = (60 / opts.targetBpm) * 4 * sec.bars;
      const renderDur = secDur + SECTION_CROSSFADE_S;
      const active = sec.layerIdx.map((i) => opts.layers[i]).filter(Boolean) as AssemblyLayer[];
      if (!active.length) {
        if (!opts.preserveEmptySections) continue;
        const outPath = join(dir, `sec${s}.wav`);
        await runFfmpeg([
          '-f', 'lavfi',
          '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', renderDur.toFixed(3),
          '-ar', '44100',
          '-ac', '2',
          outPath,
        ]);
        sectionFiles.push(outPath);
        totalDurS += secDur;
        continue;
      }
      const inputs: string[] = [];
      const chains: string[] = [];
      const labels: string[] = [];
      active.forEach((l, i) => {
        // Time-stretch to the target tempo (atempo valid 0.5–2.0 per stage).
        const ratio = Math.min(Math.max(opts.targetBpm / l.sourceBpm, 0.5), 2.0);
        // -stream_loop -1 + -t: loop the material to the section length. The -t
        // here measures PRE-stretch input time, but atempo=ratio>1 CONSUMES it
        // faster — a plain (secDur+1) read shrank to (secDur+1)/ratio of output
        // and the layer went SILENT before the section ended (the "layers
        // randomly vanish / scattered beat" defect, confirmed 2026-07). Read
        // ratio× more input so the post-stretch output always covers the
        // section; the output-side -t secDur below trims the excess exactly.
        inputs.push('-stream_loop', '-1', '-t', ((secDur + 1) * Math.max(1, ratio)).toFixed(3), '-i', l.path);
        // PAN (producer doctrine): shakers wide, congas/bells off-center, low end
        // center — the width that makes a layered kit read as a real mix.
        const pan = Math.max(-1, Math.min(1, l.pan ?? 0));
        const panF = pan !== 0 ? `,stereotools=balance_out=${pan.toFixed(2)}` : '';
        // FREQUENCY CARVING (mud diagnosis 2026-07): every loop used to occupy
        // the full spectrum, so chord beds, leads and vocals all dumped energy
        // into the lows on top of the bass — the "mud". Only the low-end anchor
        // family (bass/log_drum/808-class) and the rhythm family (kicks NEED
        // their fundamentals) keep the lows; every other KNOWN role is high-
        // passed at 170 Hz so exactly one family owns the foundation. Unknown
        // roles stay full-range — carving what we can't identify could gut a
        // mislabeled bass (unknown is honorable). Deterministic and modest by
        // design. TODO(diagnosis follow-up): no kick→bass sidechain this pass —
        // that needs a keyed split of the kick as a sidechain source per section
        // graph, a structural change to this filtergraph, not a one-line filter.
        const job = layerJobOf(l.role);
        const carveF = job && job !== 'low_end' && job !== 'rhythm' ? ',highpass=f=170' : '';
        // GROOVE (the PDF's law: "Afrobeats doesn't sit perfectly on the grid"):
        // timekeepers stay dead-on, hand percussion sits a few ms behind —
        // deterministic per role, ≤10ms, so layered kits breathe like players,
        // never like a sequencer.
        const groove = l.role ? Math.min(10, Math.max(0, grooveOffsetMs(l.role))) : 0;
        const grooveF = groove > 0 ? `,adelay=${groove}|${groove}` : '';
        chains.push(`[${i}:a]aformat=channel_layouts=stereo,atempo=${ratio.toFixed(4)},volume=${l.gain.toFixed(2)}${carveF}${panF}${grooveF}[l${i}]`);
        labels.push(`[l${i}]`);
      });
      const outPath = join(dir, `sec${s}.wav`);
      // HEADROOM LAW for the deep kits: normalize=0 raw-sums the layers, so a
      // 10-layer hook section clips guaranteed (hit live: "failed QC (clipping)
      // — nothing shipped"). Density-scaled bus trim keeps the sum in headroom
      // (≤3 layers ≈ unity, 12 layers ≈ -6 dB) and a safety limiter catches the
      // peaks; the master downstream restores loudness. Deterministic ffmpeg —
      // no brain, no credit, no excuse.
      const busTrim = Math.min(1, 1 / Math.sqrt(Math.max(1, active.length / 3)));
      // HOOK LIFT (SOUNDWAVE1 fix 3): the equal-power busTrim makes N·gain²
      // constant, so layer-count dynamics cancel and every section lands at the
      // same RMS. The planned energy arc (0..1) now scales the section bus by a
      // bounded curve (-2.5 dB at 0 → +1.5 dB at 1) ON TOP of the density trim;
      // the alimiter below keeps true-peak safety. No energy → 0 dB, exactly
      // the old bus.
      const energyGain = Math.pow(10, sectionEnergyGainDb(sec.energy) / 20);
      const sectionGain = busTrim * energyGain;
      const safety = `,volume=${sectionGain.toFixed(3)},alimiter=level=false:limit=0.891:attack=2:release=80`;
      const filter =
        active.length === 1
          ? chains[0]!.replace(/\[l0\]$/, `${safety}[out]`)
          : `${chains.join(';')};${labels.join('')}amix=inputs=${active.length}:duration=longest:normalize=0${safety}[out]`;
      await runFfmpeg([...inputs, '-filter_complex', filter, '-map', '[out]', '-t', renderDur.toFixed(3), '-ar', '44100', '-ac', '2', outPath]);
      sectionFiles.push(outPath);
      totalDurS += secDur;
    }
    if (!sectionFiles.length) throw new Error('assembly produced no sections');
    // Join the sections into the full beat with short crossfades (fix 4) —
    // never the concat demuxer's butt-splice. The final -t trims the last
    // section's pad tail so the record is exactly its planned length.
    const outPath = join(dir, 'beat.wav');
    if (sectionFiles.length === 1) {
      await runFfmpeg(['-i', sectionFiles[0]!, '-t', totalDurS.toFixed(3), '-ar', '44100', '-ac', '2', outPath]);
    } else {
      const joinInputs = sectionFiles.flatMap((f) => ['-i', f]);
      await runFfmpeg([
        ...joinInputs,
        '-filter_complex', buildCrossfadeJoinGraph(sectionFiles.length),
        '-map', '[a]',
        '-t', totalDurS.toFixed(3),
        '-ar', '44100', '-ac', '2', outPath,
      ]);
    }
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface MixPreset {
  /** filter applied to the vocal before mixing */
  vocalChain: string;
  /** relative weights beat/vocal in the final sum */
  weights: [number, number];
}

/**
 * Preset chains, deliberately conservative — the goal is a listenable demo,
 * not a radio master. Tune per-genre once real material flows through.
 */
export const MIX_PRESETS: Record<string, MixPreset> = {
  radio: {
    vocalChain: 'highpass=f=90,acompressor=threshold=-18dB:ratio=3:attack=10:release=120,aecho=0.6:0.3:60:0.25',
    weights: [1.0, 1.1],
  },
  club: {
    vocalChain: 'highpass=f=100,acompressor=threshold=-16dB:ratio=4:attack=5:release=100',
    weights: [1.2, 1.0],
  },
  tiktok: {
    vocalChain: 'highpass=f=110,acompressor=threshold=-14dB:ratio=4:attack=5:release=80',
    weights: [0.9, 1.3],
  },
  youtube: {
    vocalChain: 'highpass=f=90,acompressor=threshold=-18dB:ratio=3',
    weights: [1.0, 1.1],
  },
  acapella: { vocalChain: 'highpass=f=90', weights: [0.0, 1.0] },
  instrumental: { vocalChain: 'volume=0', weights: [1.0, 0.0] },
};

/** LUFS targets per master preset. */
export const MASTER_TARGETS: Record<string, { lufs: number; tp: number }> = {
  // LOUDNESS LAW v2 (the "masters sound weak" postmortem): commercial Afrobeats
  // ships at -8.5..-11 LUFS; our defaults conformed everything to -16.5/-14 AND
  // the old ONE-PASS dynamic loudnorm undershot even that by 1-3 LU while
  // pumping. The crush the first HEADROOM LAW blamed on "-9" was that one-pass
  // implementation, not the number. Default is now afro_stream_-9 through the
  // two-pass drive chain; breathe_-16.5 stays as the dynamics-first OPT-IN
  // (streaming platforms normalize, but a weak master loses every A/B first).
  'afro_stream_-9': { lufs: -9, tp: -1.0 }, // DEFAULT — commercial Afro loudness, -1.0 dBTP so it stays safe on lossy transcode (unlike club_-9's -0.3)
  'breathe_-16.5': { lufs: -16.5, tp: -1.2 }, // dynamics-first opt-in (Suno's own measured range)
  'streaming_lufs_-14': { lufs: -14, tp: -1.0 },
  'club_-9': { lufs: -9, tp: -0.3 },
  'reels_-16': { lufs: -16, tp: -1.0 },
  'cd_-9': { lufs: -9, tp: -0.3 },
};

/** Measured loudness of a program — loudnorm pass-1 numbers, verbatim. */
export interface LoudnormStats {
  input_i: number; // integrated LUFS
  input_tp: number; // dBTP
  input_lra: number; // LU
  input_thresh: number; // LUFS
}

/**
 * TWO-PASS loudnorm, pass 1: run (optional upstream chain +) loudnorm in
 * analysis mode (-f null) and parse the JSON block ffmpeg prints at the END of
 * stderr. These input_* numbers are what let pass 2 run loudnorm LINEAR —
 * a constant gain that lands ON target — instead of the one-pass dynamic mode
 * that undershot 1-3 LU and pumped. Returns null when the block never printed
 * (decode error, pure silence → "-inf"); callers fall back to dynamic mode.
 */
export async function measureLoudnorm(
  input: string,
  target: { lufs: number; tp: number },
  preChain?: string
): Promise<LoudnormStats | null> {
  let staged: StagedFfmpegInput | null = null;
  try {
    staged = await stageFfmpegInput(input);
    const af = `${preChain ? `${preChain},` : ''}loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=11:print_format=json`;
    const capture = await ffmpegCapture(['-i', staged.path, '-af', af, '-f', 'null', '-']);
    if (capture.failure !== null || capture.exitCode !== 0) return null;
    const err = capture.stderr;
    const open = err.lastIndexOf('{');
    const close = err.lastIndexOf('}');
    if (open < 0 || close <= open) return null;
    const j = JSON.parse(err.slice(open, close + 1)) as Record<string, string>;
    const num = (k: string): number | null => {
      const v = parseFloat(j[k] ?? '');
      return Number.isFinite(v) ? v : null; // "-inf" (silence) is unusable
    };
    const input_i = num('input_i');
    const input_tp = num('input_tp');
    const input_lra = num('input_lra');
    const input_thresh = num('input_thresh');
    if (input_i === null || input_tp === null || input_lra === null || input_thresh === null) return null;
    return { input_i, input_tp, input_lra, input_thresh };
  } catch {
    return null;
  } finally {
    await staged?.cleanup();
  }
}

/**
 * DRIVE LAW: push the program ~1 LU ABOVE target into the limiter so the final
 * linear trim only ever trims DOWN — a positive trim needs peak headroom the
 * limiter already spent and kicks loudnorm back into dynamic (pumping) mode.
 * Clamped to +12 dB so a whisper-quiet take is never dragged up into its own
 * noise floor.
 */
const driveGainDb = (targetLufs: number, measuredI: number): number =>
  Math.min(12, Math.max(0, targetLufs - measuredI + 1));

/**
 * Final trim — pass 2 of the two-pass loudnorm, LINEAR mode. The measured_*
 * values MUST describe the signal at THIS point in the chain (post drive/
 * limiter, from a pass-1 run of the same upstream chain) — feed it the raw
 * take's numbers and the drive gain gets applied twice. linear=true only
 * engages when measured_LRA <= LRA and the offset respects TP, hence the
 * generous LRA and the drive law's +1 overshoot. No measurement → the old
 * dynamic one-pass, kept strictly as a lifeboat, never the default path.
 */
export function loudnormTrim(
  target: { lufs: number; tp: number },
  lraFloor: number,
  m: LoudnormStats | null
): string {
  if (!m) return `loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=${lraFloor}`;
  const lra = Math.min(50, Math.max(lraFloor, Math.ceil(m.input_lra) + 1));
  return (
    `loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=${lra}` +
    `:measured_I=${m.input_i.toFixed(2)}:measured_TP=${m.input_tp.toFixed(2)}` +
    `:measured_LRA=${m.input_lra.toFixed(2)}:measured_thresh=${m.input_thresh.toFixed(2)}` +
    `:linear=true`
  );
}

/**
 * GENRE TONE CURVES (owner-approved mastering upgrade, 2026-07): ONE fixed EQ
 * used to master every lane — amapiano's log-drum low-mids and afrobeats'
 * percussion top got the identical curve, so neither sounded like its lane's
 * commercial references. Declarative per-genre curves, each a list of ffmpeg
 * EQ stages; anything unmapped (afro_fusion included, deliberately) falls back
 * to the proven default curve — graceful, never a failure.
 */
const MASTER_TONE_CURVES: Record<string, string[]> = {
  amapiano: [
    'equalizer=f=225:width_type=q:width=1.2:g=-1.5', // low-mid control — the 200-250 Hz build-up where stacked log drums go woolly
    'bass=g=1.5:f=45', // sub shelf — the log-drum foundation the lane is named for
    'equalizer=f=4000:width_type=q:width=1.5:g=1', // presence so the top of the kit reads over the sub weight
  ],
  afrobeats: [
    'equalizer=f=3500:width_type=q:width=1.5:g=1.5', // percussion presence — shaker/conga articulation
    'equalizer=f=350:width_type=q:width=1.4:g=-1', // boxiness cut
    'treble=g=1:f=11000', // air
  ],
};
/** The pre-upgrade curve, unchanged — the default for every unmapped lane. */
const DEFAULT_TONE_CURVE = [
  'bass=g=1.2:f=110', // low-end warmth
  'equalizer=f=3000:width_type=q:width=1.5:g=1', // vocal/lead presence
  'treble=g=1.8:f=9000', // air
];

/**
 * Automated mastering chain — now a real LOUDNESS chain, not a polite one:
 *   1. subsonic high-pass (kill rumble that steals headroom)
 *   2. per-genre tonal shaping (MASTER_TONE_CURVES; default curve when unmapped)
 *   3. glue bus compression (2:1, slow) to round the whole thing together
 *   4. 3-band multiband compression (180 Hz / 3.5 kHz crossovers, gentle 2:1) —
 *      densifies the low end WITHOUT the wideband glue pumping the mids every
 *      time the sub hits; the stage commercial Afro masters have.
 *   5. stereo bus: modest mid-side width (+15% side) then MONO below 120 Hz —
 *      wide highs, anchored lows, mono-safe sub (club systems sum the lows).
 *   6. DRIVE (loud targets only): measured volume push + tanh soft-clip INTO the
 *      limiter — the density stage commercial Afrobeats masters have and the old
 *      chain never did; loudnorm alone cannot create it.
 *   7. brickwall limiter as the hard ceiling
 *   8. two-pass LINEAR loudnorm trim landing on the exact preset target — the
 *      old ONE-PASS dynamic loudnorm undershot 1-3 LU and pumped; THAT was the
 *      "crusher"/"weak" defect, not the -9 number.
 * Everything before the trim (steps 1-7) lives in masterPreChain so pass 1 can
 * measure EXACTLY the signal the trim will receive — the two-pass discipline is
 * untouched: pass 1b re-measures WHATEVER pre-chain exists, multiband included.
 *
 * NOTE on the graph shape: the multiband/mono-low stages use labeled acrossover
 * splits, so the returned string is a multi-chain filtergraph ("a;b;c"), not a
 * flat filter list. That stays legal everywhere this string goes (-af and the
 * `${preChain},loudnorm` composition) because the graph keeps exactly one open
 * input at the front and one open output at the end. Bands recombine with
 * amix=normalize=0 — the sample-accurate SUM that reconstructs a crossover.
 * (amerge would CONCATENATE the channels: three stereo bands become six
 * channels, and the later -ac 2 downmix would recombine them at non-unity
 * coefficients — measurably wrong, so we deliberately don't use it.)
 */
export function masterPreChain(
  target: { lufs: number; tp: number },
  rawI: number | null,
  genre?: string,
  matchEq?: string | null,
): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4); // dBTP → linear amplitude
  const tone = MASTER_TONE_CURVES[genre ?? ''] ?? DEFAULT_TONE_CURVE;
  const head = [
    'highpass=f=28',
    ...tone,
    // CLAMPED MATCH-EQ (reference seam): a measured, ±3 dB-clamped per-octave
    // correction toward the lane's rights-cleared reference tilt, computed by
    // masterMatchEqCorrection() from the RAW take's octave read. It sits after
    // the genre curve and BEFORE the glue/multiband stages so the compressors
    // react to the corrected balance. Absent references → absent filter — the
    // chain string is byte-identical to the pre-match-EQ chain (provable no-op).
    ...(matchEq ? [matchEq] : []),
    'acompressor=threshold=-16dB:ratio=2:attack=20:release=200:makeup=1.5', // wideband glue
  ].join(',');
  // 3-BAND MULTIBAND — gentle 2:1 per band; the low band gets the deepest
  // threshold + slowest attack so the bass densifies while mids/highs are
  // barely touched (no pumping), then the bands SUM back (see NOTE above).
  const multiband = [
    `${head},acrossover=split=180|3500:order=4th[mb_lo][mb_mid][mb_hi]`,
    '[mb_lo]acompressor=threshold=-21dB:ratio=2:attack=25:release=180[mb_lo_c]',
    '[mb_mid]acompressor=threshold=-18dB:ratio=2:attack=20:release=200[mb_mid_c]',
    '[mb_hi]acompressor=threshold=-18dB:ratio=2:attack=10:release=120[mb_hi_c]',
    '[mb_lo_c][mb_mid_c][mb_hi_c]amix=inputs=3:normalize=0',
  ].join(';');
  // STEREO BUS — width first (so the widener never touches what we then mono),
  // then crossover at 120 Hz, fold the low band to dual-mono, sum back.
  const stereo = [
    'stereotools=slev=1.15,acrossover=split=120:order=4th[st_lo][st_hi]',
    '[st_lo]pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1[st_lo_m]',
    '[st_lo_m][st_hi]amix=inputs=2:normalize=0',
  ].join(';');
  const tail: string[] = [];
  // Loud targets get DRIVEN into the ceiling; quiet ("breathe") targets don't —
  // saturating a dynamics-first master defeats its whole point.
  const gain = rawI === null ? 0 : driveGainDb(target.lufs, rawI);
  if (target.lufs >= -11 && gain > 0.05) {
    tail.push(`volume=${gain.toFixed(2)}dB`); // measured drive, never a blind boost
    tail.push('asoftclip=type=tanh:threshold=0.85'); // analog-style density before the wall
  }
  tail.push(`alimiter=level=false:limit=${tpLinear}:attack=2:release=80`); // brickwall ceiling
  return `${multiband},${stereo},${tail.join(',')}`;
}

/** Full mastering filtergraph: pre-chain + two-pass linear trim (see above). */
export function masterChain(
  target: { lufs: number; tp: number },
  m?: { raw: LoudnormStats | null; driven: LoudnormStats | null },
  genre?: string,
): string {
  return [masterPreChain(target, m?.raw?.input_i ?? null, genre), loudnormTrim(target, 11, m?.driven ?? null)].join(',');
}

// ---------------------------------------------------------------------------
// REFERENCE SEAM — measured deltas against rights-cleared reference masters.
//
// CONTRACT: reference vectors hold ONLY measured NUMBERS taken from rights-
// cleared reference masters — per-genre loudness, tilt, correlation, octave
// RMS vectors. NEVER audio, never a fingerprint that could reconstruct audio.
//
// TWO SOURCES, DB FIRST: the fixture file (apps/worker/py/fixtures/
// master-references.json) is baked into the worker image and read-only at
// runtime, so operator-supplied references land in the DATABASE instead — the
// SystemSetting JSON key 'master.references.v1', written by the admin
// reference-ingestion path (numbers + rights attestation, per genre). The
// loader reads the DB snapshot first and falls back to the fixture; while BOTH
// are absent this seam no-ops cleanly (null). A reference delta is a REPORT
// line, never a gate — it must not and cannot fail a render.
// ---------------------------------------------------------------------------

export interface MasterReferenceVector {
  lufs?: number;
  truePeakDb?: number;
  loudnessRangeLra?: number;
  crestFactorDb?: number;
  spectralTiltDbPerOct?: number;
  stereoCorrelation?: number;
  octaveRmsDb?: number[];
}

/** The SystemSetting key holding operator-ingested reference vectors. */
export const MASTER_REFERENCES_SETTING_KEY = 'master.references.v1';

/** One measured, rights-attested reference track inside the DB store. */
export interface MasterReferenceTrack {
  title: string;
  rightsAttestation: string;
  measuredAt: string;
  vector: MasterReferenceVector;
}

/**
 * Collapse the DB store ({ version, genres: { g: { tracks: [...] } } }) into
 * per-genre AGGREGATE vectors: the element-wise MEAN over every track that
 * measured that axis (3 tracks per genre by doctrine — the mean is the lane's
 * commercial center, not any single record). Octave vectors average only when
 * their lengths agree with the measurement bank. Pure + exported so the merge
 * is assertable without a database.
 */
export function masterReferenceStoreToVectors(store: unknown): Record<string, MasterReferenceVector> {
  const out: Record<string, MasterReferenceVector> = {};
  if (!store || typeof store !== 'object' || Array.isArray(store)) return out;
  const genres = (store as { genres?: unknown }).genres;
  if (!genres || typeof genres !== 'object' || Array.isArray(genres)) return out;
  const scalarKeys = [
    'lufs', 'truePeakDb', 'loudnessRangeLra', 'crestFactorDb',
    'spectralTiltDbPerOct', 'stereoCorrelation',
  ] as const;
  for (const [genre, entry] of Object.entries(genres as Record<string, unknown>)) {
    const tracks = (entry as { tracks?: unknown })?.tracks;
    if (!Array.isArray(tracks) || !tracks.length) continue;
    const vectors = tracks
      .map((t) => (t as { vector?: unknown })?.vector)
      .filter((v): v is MasterReferenceVector => !!v && typeof v === 'object' && !Array.isArray(v));
    if (!vectors.length) continue;
    const agg: MasterReferenceVector = {};
    for (const key of scalarKeys) {
      const values = vectors
        .map((v) => v[key])
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
      if (values.length) {
        agg[key] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
      }
    }
    const octaves = vectors
      .map((v) => v.octaveRmsDb)
      .filter((a): a is number[] =>
        Array.isArray(a) && a.length === OCTAVE_CENTERS_HZ.length && a.every((n) => Number.isFinite(n)));
    if (octaves.length) {
      agg.octaveRmsDb = OCTAVE_CENTERS_HZ.map((_hz, i) =>
        Math.round((octaves.reduce((a, v) => a + v[i]!, 0) / octaves.length) * 10) / 10);
    }
    if (Object.keys(agg).length) out[genre] = agg;
  }
  return out;
}

/** Memoized fixture load — the baked file can't change within a process
 *  lifetime, and a missing/corrupt file is an honest empty map, never a throw. */
let _masterRefsCache: Record<string, MasterReferenceVector> | null = null;
function loadMasterReferences(): Record<string, MasterReferenceVector> {
  if (_masterRefsCache) return _masterRefsCache;
  // dist/lib/ffmpeg.js -> package root; src/lib/ffmpeg.ts -> package root (both ../../).
  const candidates = [
    join(__dirname, '..', '..', 'py', 'fixtures', 'master-references.json'),
    join(process.cwd(), 'py', 'fixtures', 'master-references.json'),
    join(process.cwd(), 'apps', 'worker', 'py', 'fixtures', 'master-references.json'),
  ];
  let refs: Record<string, MasterReferenceVector> = {};
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        refs = parsed as Record<string, MasterReferenceVector>;
      }
      break;
    } catch {
      break; // corrupt manifest → empty map; the delta is honorably absent
    }
  }
  _masterRefsCache = refs;
  return refs;
}

// DB snapshot state. `undefined` override = live mode; a test-set override
// (even null) BOTH replaces the snapshot and disables DB reads, so the test
// suite never touches (or hangs on) a database.
let _masterRefsDbSnapshot: Record<string, MasterReferenceVector> | null = null;
let _masterRefsDbCheckedAt = 0;
let _masterRefsDbOverride: Record<string, MasterReferenceVector> | null | undefined;

/** TEST SEAM: inject a DB snapshot (null = "DB has none"; undefined = restore
 *  live behavior). Never used by production code paths. */
export function _setMasterReferenceDbSnapshotForTest(
  snapshot?: Record<string, MasterReferenceVector> | null,
): void {
  _masterRefsDbOverride = snapshot;
}

/**
 * DB-FIRST refresh: read the SystemSetting reference store into the in-process
 * snapshot, TTL-bounded so render loops don't hammer the DB. Best-effort by
 * contract — no DB, no row, or a corrupt store leaves the previous snapshot
 * (and the fixture fallback) in place; this can never fail a render. The
 * dynamic import keeps this module DB-free for the offline test suite.
 */
export async function refreshMasterReferences(ttlMs = 5 * 60_000): Promise<void> {
  if (_masterRefsDbOverride !== undefined) return; // test override — no DB
  const now = Date.now();
  if (_masterRefsDbCheckedAt && now - _masterRefsDbCheckedAt < ttlMs) return;
  try {
    const { prisma } = await import('@afrohit/db');
    const row = await prisma.systemSetting.findUnique({
      where: { key: MASTER_REFERENCES_SETTING_KEY },
    });
    _masterRefsDbSnapshot = row ? masterReferenceStoreToVectors(JSON.parse(row.value)) : null;
    _masterRefsDbCheckedAt = now;
  } catch {
    // Unreachable DB / corrupt JSON: keep whatever we last knew; the fixture
    // fallback (or an honest null) still answers. Stamp the check time so a
    // dead DB is retried on the TTL, not on every render.
    _masterRefsDbCheckedAt = now;
  }
}

/** The genre's reference vector — DB snapshot first, fixture fallback, else null. */
export function masterReferenceVectorFor(genre: string | undefined): MasterReferenceVector | null {
  if (!genre) return null;
  const db = _masterRefsDbOverride !== undefined ? _masterRefsDbOverride : _masterRefsDbSnapshot;
  const fromDb = db?.[genre];
  if (fromDb && Object.keys(fromDb).length) return fromDb;
  return loadMasterReferences()[genre] ?? null;
}

/** Per-band clamp for the match-EQ correction — a reference is a compass, not
 *  an autopilot; ±3 dB is the most a nightly chain may push any octave. */
export const MASTER_MATCH_EQ_CLAMP_DB = 3;
/** Corrections under this magnitude are dropped — sub-quarter-dB EQ moves are
 *  measurement noise, and every band we don't touch is honesty preserved. */
const MATCH_EQ_DEADBAND_DB = 0.25;

/**
 * CLAMPED MATCH-EQ toward the reference tilt: translate the per-octave delta
 * (reference − measured raw take) into an equalizer-bank correction. Mean-
 * removed first — overall LEVEL belongs to the loudnorm passes; this corrects
 * SHAPE only. Each band clamps to ±MASTER_MATCH_EQ_CLAMP_DB. Returns null
 * whenever either octave vector is absent/malformed or every corrected band
 * lands in the deadband — the provable no-op while references are absent.
 */
export function masterMatchEqCorrection(
  measuredOctaveRmsDb: number[] | null | undefined,
  reference: MasterReferenceVector | null | undefined,
): { filter: string; bandsDb: number[] } | null {
  const ref = reference?.octaveRmsDb;
  if (
    !Array.isArray(measuredOctaveRmsDb) || !Array.isArray(ref)
    || measuredOctaveRmsDb.length !== OCTAVE_CENTERS_HZ.length
    || ref.length !== OCTAVE_CENTERS_HZ.length
    || !measuredOctaveRmsDb.every((n) => Number.isFinite(n))
    || !ref.every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  const rawDelta = ref.map((r, i) => r - measuredOctaveRmsDb[i]!);
  const mean = rawDelta.reduce((a, b) => a + b, 0) / rawDelta.length;
  const bandsDb = rawDelta.map((d) => {
    const shaped = d - mean; // shape correction only — level is loudnorm's job
    const clamped = Math.max(-MASTER_MATCH_EQ_CLAMP_DB, Math.min(MASTER_MATCH_EQ_CLAMP_DB, shaped));
    const rounded = Math.round(clamped * 10) / 10;
    return Math.abs(rounded) < MATCH_EQ_DEADBAND_DB ? 0 : rounded;
  });
  if (bandsDb.every((g) => g === 0)) return null;
  const filter = OCTAVE_CENTERS_HZ
    .map((hz, i) => (bandsDb[i] === 0 ? null : `equalizer=f=${hz}:width_type=o:width=1:g=${bandsDb[i]!.toFixed(1)}`))
    .filter(Boolean)
    .join(',');
  return { filter, bandsDb };
}

/**
 * Delta of a measured master vs its genre's reference vector. Null whenever the
 * manifest, the genre entry, or a comparable measured value is absent — the
 * caller records "no reference" honestly instead of a fabricated comparison.
 * Positive delta = the render is ABOVE the reference on that axis.
 */
export function masterReferenceDelta(
  genre: string | undefined,
  measured: AudioQuality,
): { genre: string; reference: MasterReferenceVector; delta: Record<string, number | number[]> } | null {
  if (!genre) return null;
  try {
    const reference = masterReferenceVectorFor(genre);
    if (!reference) return null;
    const delta: Record<string, number | number[]> = {};
    const diff = (key: string, ours: number | null | undefined, theirs: number | undefined) => {
      if (typeof ours === 'number' && Number.isFinite(ours) && typeof theirs === 'number' && Number.isFinite(theirs)) {
        delta[key] = Math.round((ours - theirs) * 100) / 100;
      }
    };
    diff('lufs', measured.integratedLufs, reference.lufs);
    diff('truePeakDb', measured.truePeakDb, reference.truePeakDb);
    diff('loudnessRangeLra', measured.loudnessRangeLra, reference.loudnessRangeLra);
    diff('crestFactorDb', measured.crestFactorDb, reference.crestFactorDb);
    diff('spectralTiltDbPerOct', measured.spectralTiltDbPerOct, reference.spectralTiltDbPerOct);
    diff('stereoCorrelation', measured.stereoCorrelation, reference.stereoCorrelation);
    if (
      Array.isArray(measured.octaveRmsDb) && Array.isArray(reference.octaveRmsDb)
      && measured.octaveRmsDb.length === reference.octaveRmsDb.length
      && reference.octaveRmsDb.every((v) => Number.isFinite(v))
    ) {
      delta.octaveRmsDb = measured.octaveRmsDb.map((v, i) => Math.round((v - reference.octaveRmsDb![i]!) * 10) / 10);
    }
    if (!Object.keys(delta).length) return null;
    return { genre, reference, delta };
  } catch {
    return null; // the report line disappears; the render never does
  }
}

/**
 * Light-touch CONFORM for engines that already hand back a FINISHED, loudness-
 * maximised master (MiniMax/Suno). NO EQ and NO glue compression — re-EQing +
 * re-compressing an already-balanced, already-limited master ("mastering a
 * master") recolours it and dulls the transients. What it DOES do now: a
 * measured volume drive up to target (tanh soft-clip only when boosting hard,
 * >2 dB), the true-peak ceiling on the +1 dBTP overshoot these models ship
 * with, then the two-pass LINEAR trim. LRA floor 20 so loudnorm never touches
 * the engine's own dynamics — match loudness, tame peaks, nothing else.
 */
export function conformPreChain(target: { lufs: number; tp: number }, rawI: number | null): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4);
  const parts: string[] = [];
  const gain = rawI === null ? 0 : driveGainDb(target.lufs, rawI);
  if (gain > 0.05) {
    parts.push(`volume=${gain.toFixed(2)}dB`); // measured drive up to the commercial target
    if (gain > 2) parts.push('asoftclip=type=tanh:threshold=0.85'); // only when boosting hard
  }
  parts.push(`alimiter=level=false:limit=${tpLinear}:attack=2:release=80`); // true-peak ceiling on the provider's hot render
  return parts.join(',');
}

/** Full conform filtergraph: light-touch pre-chain + two-pass linear trim. */
export function conformChain(
  target: { lufs: number; tp: number },
  m?: { raw: LoudnormStats | null; driven: LoudnormStats | null }
): string {
  return [conformPreChain(target, m?.raw?.input_i ?? null), loudnormTrim(target, 20, m?.driven ?? null)].join(',');
}

/**
 * LOUDNESS-MATCH filtergraph — conform a separated stem back to ITS OWN source's
 * integrated loudness (the TRUE INSTRUMENTAL law: voice out, everything else at
 * the same level the finished song played at). Deliberately narrower than
 * conformPreChain: a measured volume drive + the true-peak ceiling, NO soft-clip
 * and NO EQ — we're matching a stem, not densifying a master. LRA floor 20 so
 * the linear trim never touches the source's own dynamics. Exported separately
 * from the renderer so the chain is assertable without an ffmpeg binary.
 */
export function loudnessMatchPreChain(target: { lufs: number; tp: number }, rawI: number | null): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4);
  const parts: string[] = [];
  const gain = rawI === null ? 0 : driveGainDb(target.lufs, rawI);
  if (gain > 0.05) parts.push(`volume=${gain.toFixed(2)}dB`); // measured drive up to the source's loudness
  parts.push(`alimiter=level=false:limit=${tpLinear}:attack=2:release=80`); // true-peak ceiling
  return parts.join(',');
}

/** Full loudness-match filtergraph: drive+ceiling pre-chain, then the two-pass
 *  LINEAR trim (LRA floor 20) — never the dynamic pump. */
export function loudnessMatchChain(
  target: { lufs: number; tp: number },
  rawI: number | null,
  driven: LoudnormStats | null
): string {
  return [loudnessMatchPreChain(target, rawI), loudnormTrim(target, 20, driven)].join(',');
}

/**
 * Loudness-match a stem to the SOURCE song's measured integrated LUFS (two-pass:
 * measure raw → measure through the drive/limiter → render once with the linear
 * trim). Remote input is downloaded with fixed bounds before ffmpeg sees it;
 * output is 44.1k
 * stereo WAV bytes — the caller decides what lossy encodes to derive from it.
 */
export async function loudnessMatchToSource(
  input: Buffer | string,
  sourceLufs: number,
  tp = -1.0
): Promise<Buffer> {
  // loudnorm only accepts I in [-70,-5] — clamp a pathological measurement
  // rather than letting the whole job die on a filter arg error.
  const target = { lufs: Math.min(-5, Math.max(-70, sourceLufs)), tp };
  const dir = await mkdtemp(join(tmpdir(), 'lmatch-'));
  let staged: StagedFfmpegInput | null = null;
  try {
    let src: string;
    if (typeof input === 'string') {
      staged = await stageFfmpegInput(input);
      src = staged.path;
    } else {
      src = join(dir, 'in.bin');
      await writeFile(src, input);
    }
    // PASS 1 — the raw stem sets the drive; PASS 1b — the driven signal sets the
    // trim's measured_* numbers (same law as master(): the trim must know its
    // OWN input or the drive gets applied twice).
    const raw = await measureLoudnorm(src, target);
    const pre = loudnessMatchPreChain(target, raw?.input_i ?? null);
    const driven = raw ? await measureLoudnorm(src, target, pre) : null;
    const outPath = join(dir, 'matched.wav');
    await runFfmpeg(['-i', src, '-af', loudnessMatchChain(target, raw?.input_i ?? null, driven), '-ar', '44100', '-ac', '2', outPath]);
    return await readFile(outPath);
  } finally {
    await staged?.cleanup();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Encode any decodable audio to 320k mp3 (same libmp3lame settings master() ships). */
export async function encodeMp3320(input: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mp3-'));
  try {
    const inPath = join(dir, 'in.bin');
    const outPath = join(dir, 'out.mp3');
    await writeFile(inPath, input);
    await runFfmpeg(['-i', inPath, '-codec:a', 'libmp3lame', '-b:a', '320k', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Mix a beat + lead vocal into one WAV. Inputs are raw bytes; output is WAV bytes.
 */
export async function mixdown(opts: {
  beat: Buffer;
  vocal: Buffer;
  preset: string;
}): Promise<Buffer> {
  const preset = MIX_PRESETS[opts.preset] ?? MIX_PRESETS.radio!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-mix-'));
  try {
    const beatPath = join(dir, 'beat.bin');
    const vocalPath = join(dir, 'vocal.bin');
    const outPath = join(dir, 'mix.wav');
    await writeFile(beatPath, opts.beat);
    await writeFile(vocalPath, opts.vocal);
    const [wb, wv] = preset.weights;
    await runFfmpeg([
      '-i', beatPath,
      '-i', vocalPath,
      '-filter_complex',
      `[1:a]${preset.vocalChain}[v];[0:a][v]amix=inputs=2:duration=first:normalize=0:weights=${wb} ${wv}[out]`,
      '-map', '[out]',
      '-ar', '44100',
      '-ac', '2',
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// VOCAL-FORWARD SUNG MIX (SOUNDWAVE2 — "I can't hear the voice"): the sung
// path used static 1.0/1.1 amix weights on a separated stem that arrived at an
// ARBITRARY level, no ducking, a dated fixed 60ms slapback, and the result
// never met the master chain. This block is the cure, in three measured moves:
//   A1 loudness-match — the caller measures bed + vocal LUFS (the existing
//      ebur128/loudnorm pass) and vocalGainDbFromLufs() computes the gain that
//      puts the vocal a FIXED offset ABOVE the bed (AFROONE_VOCAL_OFFSET_DB,
//      default +2 dB — in front, not on top);
//   A2 duck — sidechaincompress on the bed KEYED BY THE VOCAL (gentle 2.8:1,
//      ~2-3 dB of ducking at the matched level, fast attack, musical release)
//      so the bed breathes around the voice instead of fighting it;
//   A3 the slapback is replaced by a short dense early-reflection cluster
//      (23/41/59 ms taps at low decay — plate-ish, subtle), and the CALLER
//      routes the finished mix through the SAME two-pass master() chain the
//      instrumental beds get. Un-mastered demos stop shipping.
// All pure graph builders exported for the offline gate suite.
// ---------------------------------------------------------------------------

export const AFROONE_VOCAL_OFFSET_DB_DEFAULT = 2;

/** Env-tunable vocal-over-bed offset (dB). Clamped -3..+8 — a typo can make
 *  the voice a touch shy or bold, never absent or screaming. */
export function afroOneVocalOffsetDb(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AFROONE_VOCAL_OFFSET_DB?.trim();
  if (!raw) return AFROONE_VOCAL_OFFSET_DB_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return AFROONE_VOCAL_OFFSET_DB_DEFAULT;
  return Math.min(8, Math.max(-3, parsed));
}

/** A1 — the loudness-match math: gain (dB) that lands the vocal at
 *  bedLufs + offsetDb. Unmeasurable input → 0 dB and matched:false (fail-open,
 *  the caller records the honest note). Clamped ±12 dB so a near-silent or
 *  blazing stem is never dragged past its own noise floor / into distortion. */
export function vocalGainDbFromLufs(
  bedLufs: number | null | undefined,
  vocalLufs: number | null | undefined,
  offsetDb: number,
): { gainDb: number; matched: boolean } {
  if (
    typeof bedLufs !== 'number' || !Number.isFinite(bedLufs)
    || typeof vocalLufs !== 'number' || !Number.isFinite(vocalLufs)
  ) {
    return { gainDb: 0, matched: false };
  }
  const raw = bedLufs + offsetDb - vocalLufs;
  return { gainDb: Math.round(Math.min(12, Math.max(-12, raw)) * 10) / 10, matched: true };
}

/** A2 — the duck, tuned for a loudness-MATCHED vocal (that's why A1 comes
 *  first: with the vocal at a known level over the bed, threshold 0.1
 *  (≈ -20 dBFS) with ratio 2.8 yields the intended ~2-3 dB of gain reduction
 *  while the vocal is active). Attack fast enough to catch phrase onsets,
 *  release musical (~200 ms) so the bed swells back between lines. */
export const VOCAL_FORWARD_DUCK = Object.freeze({
  threshold: 0.1,
  ratio: 2.8,
  attackMs: 8,
  releaseMs: 200,
});

/** The vocal treatment chain: measured gain FIRST (so the fixed-threshold
 *  compressor below sees a predictable level), the radio preset's proven
 *  highpass + compressor, then the subtle early-reflection cluster that
 *  replaces the 60ms slapback. */
export function vocalForwardVocalChain(vocalGainDb: number): string {
  return [
    `volume=${vocalGainDb.toFixed(1)}dB`,
    'highpass=f=90',
    'acompressor=threshold=-18dB:ratio=3:attack=10:release=120',
    'aecho=0.7:0.22:23|41|59:0.18|0.13|0.09',
  ].join(',');
}

/** Full vocal-forward filtergraph: input 0 = bed, input 1 = vocal. The vocal
 *  splits into the mix voice and the sidechain KEY; the bed ducks under the
 *  key; the honest sum (normalize=0) rides the house -1 dB safety limiter. */
export function buildVocalForwardMixGraph(vocalGainDb: number): string {
  const d = VOCAL_FORWARD_DUCK;
  return [
    `[1:a]${vocalForwardVocalChain(vocalGainDb)},asplit=2[vmix][vkey]`,
    `[0:a][vkey]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attackMs}:release=${d.releaseMs}[bed]`,
    '[bed][vmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=level=false:limit=0.891:attack=2:release=80[out]',
  ].join(';');
}

/** Render the vocal-forward sung mix (bed + isolated vocal → one WAV). The
 *  caller supplies the MEASURED vocal gain (vocalGainDbFromLufs) and then
 *  masters the result — this function only mixes. */
export async function mixdownVocalForward(opts: {
  beat: Buffer;
  vocal: Buffer;
  vocalGainDb: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-vfmix-'));
  try {
    const beatPath = join(dir, 'beat.bin');
    const vocalPath = join(dir, 'vocal.bin');
    const outPath = join(dir, 'mix.wav');
    await writeFile(beatPath, opts.beat);
    await writeFile(vocalPath, opts.vocal);
    await runFfmpeg([
      '-i', beatPath,
      '-i', vocalPath,
      '-filter_complex', buildVocalForwardMixGraph(opts.vocalGainDb),
      '-map', '[out]',
      '-ar', '44100',
      '-ac', '2',
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ConsoleTrack {
  path: string;
  gainDb: number;
  pan: number; // -1 (L) .. 1 (R)
  mute: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number };
  comp: { on: boolean; threshold: number; ratio: number };
  reverb: number; // 0..1
}

const clampNum = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;

/** Build the per-track filter chain for the mixer console. */
function channelChain(t: ConsoleTrack): string {
  const gainLin = Math.pow(10, clampNum(t.gainDb, -24, 12) / 20).toFixed(4);
  const low = clampNum(t.eq.low, -12, 12);
  const mid = clampNum(t.eq.mid, -12, 12);
  const high = clampNum(t.eq.high, -12, 12);
  const pan = clampNum(t.pan, -1, 1);
  const lGain = (pan <= 0 ? 1 : 1 - pan).toFixed(3);
  const rGain = (pan >= 0 ? 1 : 1 + pan).toFixed(3);

  const parts = [
    'aformat=channel_layouts=stereo',
    `volume=${gainLin}`,
    `bass=g=${low}:f=110`,
    `equalizer=f=1500:width_type=o:width=1.4:g=${mid}`,
    `treble=g=${high}:f=8000`,
  ];
  if (t.comp.on) {
    parts.push(
      `acompressor=threshold=${clampNum(t.comp.threshold, -40, 0)}dB:ratio=${clampNum(t.comp.ratio, 1, 20)}:attack=10:release=120`
    );
  }
  const verb = clampNum(t.reverb, 0, 1);
  if (verb > 0.02) {
    parts.push(`aecho=0.8:${(0.3 + 0.4 * verb).toFixed(2)}:${Math.round(40 + 60 * verb)}:${(0.2 + 0.3 * verb).toFixed(2)}`);
  }
  parts.push(`pan=stereo|c0=${lGain}*c0|c1=${rGain}*c1`);
  return parts.join(',');
}

/**
 * Console mixdown — the hands-on mixer. Each track carries its own
 * gain/pan/EQ/comp/reverb; solo overrides mute. Sums to one WAV (pre-master).
 */
export async function mixdownConsole(tracks: ConsoleTrack[]): Promise<Buffer> {
  const anySolo = tracks.some((t) => t.solo);
  const active = tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  if (active.length === 0) throw new Error('mixer: every track is muted');

  const dir = await mkdtemp(join(tmpdir(), 'afrohit-console-'));
  try {
    const inputs: string[] = [];
    const chains: string[] = [];
    const labels: string[] = [];
    active.forEach((t, i) => {
      inputs.push('-i', t.path);
      chains.push(`[${i}:a]${channelChain(t)}[c${i}]`);
      labels.push(`[c${i}]`);
    });
    const outPath = join(dir, 'console.wav');
    const filter =
      active.length === 1
        ? `${chains[0]!.replace(/\[c0\]$/, '[out]')}`
        : `${chains.join(';')};${labels.join('')}amix=inputs=${active.length}:duration=longest:normalize=0[out]`;
    try {
      await runFfmpeg([
        ...inputs,
        '-filter_complex', filter,
        '-map', '[out]',
        '-ar', '44100',
        '-ac', '2',
        outPath,
      ]);
    } catch (e) {
      const msg = (e as Error).message;
      if (/Invalid data|does not contain any stream|could not find codec/i.test(msg)) {
        throw new Error('A track is not valid audio (corrupt or empty upload). Remove/re-upload it, then render again.');
      }
      throw e;
    }
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Commercial Afro masters sit ~LRA 6-8; above this ceiling the -9 preset earns
 *  its single extra density pass (see master() below). */
export const MASTER_LRA_DENSITY_CEILING = 8.5;

/** One loudness measurement inside the mastering run — verbatim numbers. */
export interface MasterDrivePass {
  pass: number;
  /** raw = untouched program; drive = after the pass-1 pre-chain; density =
   *  after the single extra LRA pass. */
  stage: 'raw' | 'drive' | 'density';
  /** measured drive applied by the stage's chain, dB (0 = chain drove nothing). */
  driveDb?: number;
  /** why the density stage ran (or why its render was skipped). */
  reason?: string;
  /** loudnorm pass-1 numbers of the signal at this point; null = unmeasurable. */
  measured: { lufs: number; truePeakDb: number; lra: number } | null;
}

/** What the mastering run DID — measured passes + the match-EQ it applied.
 *  Every field is measurement or a faithful record of the chain; never a guess. */
export interface MasterRenderReport {
  drivePasses: MasterDrivePass[];
  appliedMatchEq: { bandsDb: number[]; clampDb: number; referenceGenre: string } | null;
}

/**
 * Master a mix — real TWO-PASS loudness. Pass 1 measures (raw take → sets the
 * drive gain; then the driven pre-chain → sets the trim's measured_* numbers),
 * pass 2 renders once with a LINEAR trim that lands ON the preset target. The
 * old one-pass dynamic loudnorm undershot 1-3 LU and pumped — the "masters
 * sound weak" defect, now retired to a fallback for unmeasurable input.
 *
 * LRA DENSITY ITERATION (afro_stream_-9 only): when the driven re-measure still
 * reads LRA above MASTER_LRA_DENSITY_CEILING, ONE additional gentle drive pass
 * (measured, clamped 0.5-2.5 dB, re-measured) densifies toward the commercial
 * LRA 6-8 window. Never looped more than once — chasing LRA harder than one
 * extra pass is how masters get crushed; whatever dynamics survive pass 2 are
 * the record's own, reported honestly.
 *
 * Encodes both WAV and 320k MP3. Returns both plus the measured render report.
 */
export async function master(opts: {
  mix: Buffer;
  preset: string;
  /**
   * The source is ALREADY a finished, loudness-maximised master (MiniMax/Suno):
   * conform loudness + true-peak only (conformChain) instead of the full EQ/glue-
   * comp masterChain, which would recolour and dull it. Raw mixes/engines and the
   * user Re-master path omit this flag and keep the full chain they need.
   */
  finished?: boolean;
  /**
   * Lane for the per-genre tonal curve (MASTER_TONE_CURVES) and the reference
   * match-EQ. Only the FULL mastering path uses it — the finished/conform path
   * stays tone-neutral by doctrine. Absent/unmapped → the default curve, never
   * a failure.
   */
  genre?: string;
}): Promise<{ wav: Buffer; mp3: Buffer; report: MasterRenderReport }> {
  const presetName = MASTER_TARGETS[opts.preset] ? opts.preset : 'afro_stream_-9';
  const target = MASTER_TARGETS[presetName]!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-master-'));
  try {
    const inPath = join(dir, 'in.bin');
    const wavPath = join(dir, 'master.wav');
    const mp3Path = join(dir, 'master.mp3');
    await writeFile(inPath, opts.mix);
    // PASS 1 — measure the raw program; its integrated loudness sets the drive.
    const raw = await measureLoudnorm(inPath, target);
    const asPass = (m: LoudnormStats | null) =>
      m ? { lufs: m.input_i, truePeakDb: m.input_tp, lra: m.input_lra } : null;
    const drivePasses: MasterDrivePass[] = [{ pass: 0, stage: 'raw', measured: asPass(raw) }];

    // MATCH-EQ (full chain only): measure the RAW take's octave balance and
    // build the clamped correction toward the genre's reference vector. DB-first
    // reference load rides a TTL'd best-effort refresh; no reference (today's
    // state) → null → the chain is provably identical to the uncorrected one.
    let appliedMatchEq: MasterRenderReport['appliedMatchEq'] = null;
    let matchEqFilter: string | null = null;
    if (!opts.finished && opts.genre) {
      await refreshMasterReferences().catch(() => undefined);
      const reference = masterReferenceVectorFor(opts.genre);
      if (reference?.octaveRmsDb) {
        const spectral = await measureSpectralAndStereo(inPath);
        const correction = masterMatchEqCorrection(spectral.octaveRmsDb, reference);
        if (correction) {
          matchEqFilter = correction.filter;
          appliedMatchEq = {
            bandsDb: correction.bandsDb,
            clampDb: MASTER_MATCH_EQ_CLAMP_DB,
            referenceGenre: opts.genre,
          };
        }
      }
    }

    const rawI = raw?.input_i ?? null;
    const pre = opts.finished
      ? conformPreChain(target, rawI)
      : masterPreChain(target, rawI, opts.genre, matchEqFilter);
    // Record the drive the pass-1 chain ACTUALLY applies (same conditions the
    // chain builders use) — the report states what happened, never a formula.
    const pass1Gain = rawI === null ? 0 : driveGainDb(target.lufs, rawI);
    const pass1DriveDb = (opts.finished ? pass1Gain > 0.05 : target.lufs >= -11 && pass1Gain > 0.05)
      ? Math.round(pass1Gain * 100) / 100
      : 0;
    // PASS 1b — measure the signal as it LEAVES the drive/limiter stage: the
    // trim must know its OWN input, not the raw take, or the drive gain gets
    // applied twice. Same deterministic pre-chain as the render below.
    const driven = raw ? await measureLoudnorm(inPath, target, pre) : null;
    if (driven) drivePasses.push({ pass: 1, stage: 'drive', driveDb: pass1DriveDb, measured: asPass(driven) });

    // LRA DENSITY ITERATION — one extra gentle pass, afro_stream_-9 only.
    let renderPre = pre;
    let renderDriven = driven;
    if (
      !opts.finished
      && presetName === 'afro_stream_-9'
      && driven
      && driven.input_lra > MASTER_LRA_DENSITY_CEILING
    ) {
      // Gentle by construction: half a dB per LU above the LRA-8 anchor,
      // clamped 0.5-2.5 dB — enough to close a 1-3 LU gap, never a crusher.
      const extraDb = Math.min(2.5, Math.max(0.5, Math.round((driven.input_lra - 8) * 5) / 10));
      const tpLinear = Math.pow(10, target.tp / 20).toFixed(4);
      const pre2 = `${pre},volume=${extraDb.toFixed(2)}dB,asoftclip=type=tanh:threshold=0.85,alimiter=level=false:limit=${tpLinear}:attack=2:release=80`;
      const driven2 = await measureLoudnorm(inPath, target, pre2);
      if (driven2) {
        renderPre = pre2;
        renderDriven = driven2;
        drivePasses.push({
          pass: 2,
          stage: 'density',
          driveDb: extraDb,
          reason: `measured LRA ${driven.input_lra.toFixed(1)} > ${MASTER_LRA_DENSITY_CEILING} after pass 1 (commercial Afro sits ~6-8)`,
          measured: asPass(driven2),
        });
      } else {
        // The extra stage could not be measured — rendering through it would
        // hand the trim wrong measured_* numbers, so pass 1's chain ships.
        drivePasses.push({
          pass: 2,
          stage: 'density',
          driveDb: 0,
          reason: 'second-pass measurement failed — pass 1 chain shipped unchanged',
          measured: null,
        });
      }
    }

    // PASS 2 — the real render: pre-chain + linear trim (dynamic fallback only
    // when measurement failed; a master job should never die on analysis).
    const filter = [renderPre, loudnormTrim(target, opts.finished ? 20 : 11, renderDriven)].join(',');
    await runFfmpeg(['-i', inPath, '-af', filter, '-ar', '44100', '-ac', '2', wavPath]);
    await runFfmpeg(['-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '320k', mp3Path]);
    return {
      wav: await readFile(wavPath),
      mp3: await readFile(mp3Path),
      report: { drivePasses, appliedMatchEq },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Build a vertical 9:16 shareable snippet (TikTok/Reels/Shorts) from a clip of
 * the finished track: cover art centered on a dark canvas, an animated waveform,
 * and the hook burned in as a caption. Cover + caption are optional (graceful
 * fallback if no cover art or no font is available).
 */
export async function buildSnippet(opts: {
  audio: Buffer;
  cover?: Buffer;
  captionText?: string; // pre-wrapped; rendered from a textfile to avoid escaping
  fontPath?: string;
  startS: number;
  durS: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-snip-'));
  try {
    const dur = Math.max(5, Math.min(opts.durS, 40));
    const audioPath = join(dir, 'a.bin');
    await writeFile(audioPath, opts.audio);

    const inputs: string[] = ['-ss', String(Math.max(0, opts.startS)), '-t', String(dur), '-i', audioPath];
    const chains: string[] = [`color=c=0x0B0B12:s=1080x1920:d=${dur}[bg]`];
    let base = '[bg]';

    if (opts.cover) {
      const coverPath = join(dir, 'c.bin');
      await writeFile(coverPath, opts.cover);
      inputs.push('-loop', '1', '-i', coverPath);
      chains.push('[1:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,setsar=1[cov]');
      chains.push(`${base}[cov]overlay=(W-w)/2:120[b1]`);
      base = '[b1]';
    }

    chains.push('[0:a]showwaves=s=1080x240:mode=cline:rate=25:colors=0xF97316|0xE23E8C[wave]');
    chains.push(`${base}[wave]overlay=0:1560[b2]`);
    base = '[b2]';

    if (opts.captionText && opts.fontPath) {
      const capPath = join(dir, 'cap.txt');
      await writeFile(capPath, opts.captionText);
      chains.push(
        `${base}drawtext=fontfile=${opts.fontPath}:textfile=${capPath}:fontcolor=white:fontsize=54:line_spacing=14:box=1:boxcolor=0x000000AA:boxborderw=28:x=(w-text_w)/2:y=1250[out]`
      );
    } else {
      chains[chains.length - 1] = chains[chains.length - 1]!.replace(/\[b2\]$/, '[out]');
    }

    const outPath = join(dir, 'snippet.mp4');
    await runFfmpeg([
      ...inputs,
      '-filter_complex', chains.join(';'),
      '-map', '[out]', '-map', '0:a',
      '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Tempo/pitch transform on a finished record. tempo is a speed multiplier
 *  (0.5–1.5, pitch-preserving via atempo); semitones shifts pitch (−6..+6)
 *  using asetrate + a compensating atempo so DURATION follows only `tempo`.
 *  Output: 44.1k stereo WAV (master-grade, ready to re-master). */
export interface TransformAudioOptions {
  tempo?: number;
  semitones?: number;
  /** Measured corrective gain on the complete bus, after all layer/fill balance. */
  gainDb?: number;
  /** Linear peak limiter ceiling; omitted for transforms that do not need it. */
  peakLimit?: number;
}

export async function transformAudio(input: Buffer, opts: TransformAudioOptions): Promise<Buffer> {
  const tempo = Math.min(1.5, Math.max(0.5, opts.tempo ?? 1));
  const semis = Math.min(6, Math.max(-6, opts.semitones ?? 0));
  const dir = await mkdtemp(join(tmpdir(), 'xform-'));
  const inPath = join(dir, 'in');
  const outPath = join(dir, 'out.wav');
  try {
    await writeFile(inPath, input);
    const sr = 44100;
    const pitch = Math.pow(2, semis / 12);
    const filters: string[] = [];
    if (semis !== 0) filters.push(`asetrate=${Math.round(sr * pitch)}`, `aresample=${sr}`);
    // net speed after the pitch trick must equal `tempo` → compensate by tempo/pitch,
    // chaining atempo stages to stay inside ffmpeg's 0.5–2.0 per-stage bounds.
    let net = tempo / (semis !== 0 ? pitch : 1);
    while (net < 0.5) { filters.push('atempo=0.5'); net /= 0.5; }
    while (net > 2.0) { filters.push('atempo=2.0'); net /= 2.0; }
    if (Math.abs(net - 1) > 0.001) filters.push(`atempo=${net.toFixed(4)}`);
    const gainDb = Math.min(12, Math.max(-24, opts.gainDb ?? 0));
    if (Math.abs(gainDb) > 0.01) filters.push(`volume=${gainDb.toFixed(2)}dB`);
    if (opts.peakLimit !== undefined) {
      const limit = Math.min(1, Math.max(0.1, opts.peakLimit));
      filters.push(`alimiter=level=false:limit=${limit.toFixed(3)}:attack=2:release=80`);
    }
    const af = filters.length ? filters.join(',') : 'anull';
    await runFfmpeg(['-i', inPath, '-af', af, '-ac', '2', '-ar', String(sr), outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Pure filtergraph for mixBuffers (exported for the offline gate suite).
 *  normalize=0 is LOAD-BEARING (SOUNDWAVE1 fix 5): amix defaults to scaling
 *  every input by 1/inputs, so mixing the melody/trained layer over the bed
 *  silently dropped BOTH ~6 dB — the "melody take ships quiet" defect. The
 *  raw sum is kept honest and the alimiter (level=false, -1 dB ceiling — the
 *  house bus discipline) catches the summed peaks instead of a blind rescale. */
export function buildMixBuffersGraph(layerGain: number): string {
  return `[1:a]volume=${layerGain}[l];[0:a][l]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=level=false:limit=0.891:attack=2:release=80[a]`;
}

/** Mix two audio buffers (bed + layer) into one WAV; layer gain 0-1. */
export async function mixBuffers(bed: Buffer, layer: Buffer, layerGain = 0.85): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mix2-'));
  const a = join(dir, 'a'); const b = join(dir, 'b'); const outPath = join(dir, 'out.wav');
  try {
    await writeFile(a, bed); await writeFile(b, layer);
    await runFfmpeg(['-i', a, '-i', b, '-filter_complex', buildMixBuffersGraph(layerGain), '-map', '[a]', '-ac', '2', '-ar', '44100', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MUSIC-VIDEO ASSEMBLY (Wave 9) — rendered shots + the mastered song become
// ONE release file, entirely local ffmpeg (zero provider spend; the shots were
// already billed per-shot when they rendered). ADDITIVE ONLY: nothing above
// this line changed. The pure gating/EDL law lives in
// @afrohit/shared/video-assembly; these helpers are the hands.
// ---------------------------------------------------------------------------

/** One CFR timebase for mixed AI renders (providers ship 24/25/30fps): 30fps
 *  plays native on socials + web players and derives cleanly for broadcast;
 *  xfade requires identical fps on both sides, so everything conforms here. */
export const ASSEMBLY_FPS = 30;
/** 15-frame crossfades at sequence boundaries — the owner's law. */
export const ASSEMBLY_XFADE_FRAMES = 15;
export const ASSEMBLY_XFADE_S = ASSEMBLY_XFADE_FRAMES / ASSEMBLY_FPS; // 0.5s

/** THE TWO DELIVERABLES: 'full' = 1920x1080 landscape (YouTube/TV master),
 *  letterboxed via scale+pad so no rendered pixel is ever cropped away;
 *  'teaser' = 1080x1920 vertical (TikTok/Reels/Shorts), center-crop cover so
 *  the frame is FULL — social feeds punish pillarboxed verticals. */
export const ASSEMBLY_TARGETS = {
  full: { width: 1920, height: 1080, fit: 'pad' as const },
  teaser: { width: 1080, height: 1920, fit: 'crop' as const },
};

/** Shared encode settings for every assembly pass — H.264/yuv420p is the one
 *  combination every player, CDN and TV ingest accepts; veryfast+CRF19 keeps a
 *  3-minute 1080p multi-pass assembly inside the worker's render timeout. */
const ASSEMBLY_ENCODE = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
];

/** Bounded fan-out width for per-clip normalization. Every normalizeVideoClip
 *  is an INDEPENDENT full re-encode with NO cross-clip dependency, so the
 *  timeline's shots conform in ~ceil(N/width) waves instead of N serial
 *  re-encodes — the dominant assembly cost. ~4 keeps CPU/RAM sane on the
 *  worker host; override via VIDEO_NORMALIZE_CONCURRENCY. */
const VIDEO_NORMALIZE_CONCURRENCY = Math.max(
  1,
  Number(process.env.VIDEO_NORMALIZE_CONCURRENCY ?? 4) || 4
);

/** A bounded-concurrency pool — mirrors the forge fan-out helper in
 *  processors/own-engine.ts, kept local so this lib never imports a processor.
 *  Runs `fn` over `items` at most `concurrency` at a time; the caller awaits
 *  ALL of them. Deterministic COMPLETION is NOT guaranteed — order-sensitive
 *  callers write each result into a pre-sized, index-keyed slot INSIDE `fn`
 *  (never push-on-complete), so the downstream stage still consumes items in
 *  the original order regardless of which unit finishes first. */
async function forEachPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const width = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

/** ffprobe duration in PRECISE seconds (float, no rounding) — the assembly
 *  math (xfade offsets, min(video,audio) law) needs sub-second truth, unlike
 *  probeDurationS above which rounds for display. Local paths only; 0 = unknown. */
export async function probeMediaDurationPreciseS(path: string): Promise<number> {
  const result = await runBoundedProcess({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    timeoutMs: NATIVE_AUDIO_LIMITS.probeTimeoutMs,
    outputLimitBytes: NATIVE_AUDIO_LIMITS.probeOutputLimitBytes,
    captureStdout: true,
    captureStderr: true,
  });
  if (result.failure !== null || result.exitCode !== 0) return 0;
  const durationS = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
}

/**
 * Conform ONE rendered shot to the assembly timeline: common size (pad or
 * crop), CFR ASSEMBLY_FPS, silent (-an — the ONLY sound on a music video is
 * the mastered song; provider clips sometimes carry stray audio), and trimmed
 * to `trimS`.
 *
 * THE TRIM LAW: the treatment's claimed duration is the edit decision list.
 * Rendered shots run 5-10s while treatment slots claim 2-8s — the slot wins,
 * so the timeline matches the treatment the user approved. A render SHORTER
 * than its slot yields a shorter clip (never looped, never frozen — the
 * covered duration is reported honestly downstream).
 */
export async function normalizeVideoClip(opts: {
  input: string;
  output: string;
  width: number;
  height: number;
  fit: 'pad' | 'crop';
  trimS: number;
}): Promise<void> {
  const { width, height } = opts;
  const geometry =
    opts.fit === 'pad'
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  await runFfmpeg([
    '-i', opts.input,
    '-t', Math.max(0.1, opts.trimS).toFixed(3),
    '-vf', `${geometry},setsar=1,fps=${ASSEMBLY_FPS}`,
    '-an',
    ...ASSEMBLY_ENCODE,
    opts.output,
  ]);
}

/** Concat already-normalized clips (same codec/size/fps by construction) with
 *  a RE-ENCODE — mixed provider sources make stream-copy concat a timestamp
 *  minefield; one more CPU pass is free and deterministic. */
export async function concatVideoClips(paths: string[], output: string): Promise<void> {
  if (!paths.length) throw new Error('video concat needs at least one clip');
  const dir = await mkdtemp(join(tmpdir(), 'vconcat-'));
  try {
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, paths.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
    await runFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-an', ...ASSEMBLY_ENCODE,
      output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Crossfade two normalized videos: b starts at offsetS, blending for
 *  ASSEMBLY_XFADE_S. Both inputs share size/fps/pixfmt by construction. */
export async function xfadeVideos(
  a: string,
  b: string,
  output: string,
  opts: { offsetS: number },
): Promise<void> {
  await runFfmpeg([
    '-i', a, '-i', b,
    '-filter_complex',
    `[0:v][1:v]xfade=transition=fade:duration=${ASSEMBLY_XFADE_S.toFixed(3)}:offset=${Math.max(0, opts.offsetS).toFixed(3)}[v]`,
    '-map', '[v]',
    ...ASSEMBLY_ENCODE,
    output,
  ]);
}

/** Mux the mastered song over the assembled timeline: audio starts at
 *  audioStartS into the master (teaser hook law; 0 for the full cut), total
 *  duration is the min(video, audio) law, and the last fadeOutS seconds fade
 *  the audio so a truncated record never ends on a cliff. */
export async function muxTimelineAudio(opts: {
  video: string;
  audio: string;
  output: string;
  audioStartS: number;
  durationS: number;
  fadeOutS?: number;
}): Promise<void> {
  const durationS = Math.max(0.5, opts.durationS);
  const fadeOutS = Math.min(Math.max(0.1, opts.fadeOutS ?? 1), durationS / 2);
  const fadeStartS = Math.max(0, durationS - fadeOutS);
  await runFfmpeg([
    '-i', opts.video,
    ...(opts.audioStartS > 0 ? ['-ss', opts.audioStartS.toFixed(3)] : []),
    '-i', opts.audio,
    '-filter_complex',
    `[1:a]atrim=0:${durationS.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=out:st=${fadeStartS.toFixed(3)}:d=${fadeOutS.toFixed(3)},` +
      'aformat=sample_rates=44100:channel_layouts=stereo[a]',
    '-map', '0:v', '-map', '[a]',
    '-t', durationS.toFixed(3),
    ...ASSEMBLY_ENCODE,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    opts.output,
  ]);
}

/** Best-effort display font for on-video text (cached across jobs). The
 *  snippet engine's own graceful law: no font → the caller skips the text
 *  honestly rather than failing the job. */
export async function ensureDisplayFont(): Promise<string | undefined> {
  const cached = join(tmpdir(), 'afrohit-anton.ttf');
  try {
    const existing = await readFile(cached);
    if (existing.length > 10_000) return cached;
  } catch {
    // not cached yet
  }
  try {
    const res = await fetch('https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf');
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(cached, buf);
    return cached;
  } catch {
    return undefined;
  }
}

/** The opening credit's cue window (seconds) ON THE ASSEMBLED TIMELINE — it
 *  lights up 0.8s in and holds to 5.2s. When a logo splash rides in FRONT of
 *  the cut, the window is shifted by the splash length (see
 *  overlayCreditsAndWatermark) so the credit still cues 0.8s into the FIRST
 *  SCENE, exactly as it did when it was burned before the splash. */
export const CREDIT_CUE_START_S = 0.8;
export const CREDIT_CUE_END_S = 5.2;

/** PURE (no ffmpeg): the three credit lines — TITLE / artist / producer — with
 *  their frame-relative font sizes and vertical offsets. Producer is optional
 *  (older concepts carry no producer). Split out so the credit can be folded
 *  into other drawtext passes without duplicating the layout law. */
export function buildVideoCreditLines(opts: {
  title: string;
  artist: string;
  producer?: string;
  height: number;
}): Array<{ text: string; size: number; dy: number }> {
  return [
    { text: opts.title.toUpperCase(), size: Math.round(opts.height * 0.052), dy: 0 },
    { text: opts.artist, size: Math.round(opts.height * 0.034), dy: Math.round(opts.height * 0.066) },
    ...(opts.producer
      ? [{ text: `Prod. ${opts.producer}`, size: Math.round(opts.height * 0.024), dy: Math.round(opts.height * 0.112) }]
      : []),
  ];
}

/** PURE (unit-testable): the drawtext filter per credit line, given already-
 *  written textfile paths (text rides textfiles so titles with quotes/colons
 *  can never break the filter). The cue window is a parameter so the SAME
 *  builder serves the standalone credit pass (0.8-5.2) and the folded brand
 *  pass (shifted by the splash in front of it). */
export function buildVideoCreditFilters(opts: {
  lines: Array<{ text: string; size: number; dy: number }>;
  textPaths: string[];
  fontPath: string;
  width: number;
  height: number;
  enableStartS: number;
  enableEndS: number;
}): string[] {
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = escape(opts.fontPath);
  const cue = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const x = Math.round(opts.width * 0.055);
  const enable = `enable='between(t,${cue(opts.enableStartS)},${cue(opts.enableEndS)})'`;
  const filters: string[] = [];
  for (let i = 0; i < opts.lines.length; i++) {
    const line = opts.lines[i]!;
    const y = Math.round(opts.height * 0.7) + line.dy;
    filters.push(
      `drawtext=fontfile='${font}':textfile='${escape(opts.textPaths[i]!)}'` +
        `:fontcolor=white:fontsize=${line.size}:x=${x}:y=${y}` +
        `:shadowcolor=black@0.75:shadowx=2:shadowy=2:${enable}`
    );
  }
  return filters;
}

/**
 * VIDEO NAMING LAW ("name the video — name and producer" — owner): burn a
 * broadcast-style opening credit into an assembled cut. Lower-left, three
 * lines — TITLE / artist / producer — visible ~0.8s-5.2s with a drop shadow.
 * One extra encode pass; the input file is left untouched (the native-master
 * law applies to finished cuts too). NOTE: the shipping assembler folds this
 * credit INTO the watermark pass (overlayCreditsAndWatermark) to save a
 * re-encode; this standalone pass is kept for any caller that needs the credit
 * alone and shares the exact builders, so both paths are pixel-identical.
 */
export async function overlayVideoCredits(opts: {
  input: string;
  output: string;
  title: string;
  artist: string;
  producer?: string;
  fontPath: string;
  width: number;
  height: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'credits-'));
  try {
    const lines = buildVideoCreditLines({
      title: opts.title,
      artist: opts.artist,
      producer: opts.producer,
      height: opts.height,
    });
    const textPaths: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const textPath = join(dir, `line-${i}.txt`);
      await writeFile(textPath, lines[i]!.text);
      textPaths.push(textPath);
    }
    const filters = buildVideoCreditFilters({
      lines,
      textPaths,
      fontPath: opts.fontPath,
      width: opts.width,
      height: opts.height,
      enableStartS: CREDIT_CUE_START_S,
      enableEndS: CREDIT_CUE_END_S,
    });
    await runFfmpeg([
      '-i', opts.input,
      '-vf', filters.join(','),
      '-c:a', 'copy',
      ...ASSEMBLY_ENCODE,
      '-movflags', '+faststart',
      opts.output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// BRAND WAVE (2026-07-20) — the logo splash + the persistent "afro" watermark.
// ---------------------------------------------------------------------------

/** LOGO SPLASH LAW ("show our logo at the start of the video — then it
 *  disappears after a splash" — owner): every assembled cut opens on ~1.8s of
 *  the AfroHits mark on a dark frame, fading in and out, before the first
 *  scene (and therefore before the opening credit's 0.8s cue). Best-effort by
 *  the same doctrine as the credit: a missing logo or a failed encode ships
 *  the un-splashed cut honestly — branding never fails paid work. */
export const SPLASH_DURATION_S = 1.8;
export const SPLASH_FADE_IN_S = 0.25;
export const SPLASH_FADE_OUT_S = 0.35;
/** Logo height as a fraction of the frame height (centered). */
export const SPLASH_LOGO_HEIGHT_RATIO = 0.35;

/** The official AfroHits logo shipped as a repo asset (apps/worker/assets/).
 *  The Docker build copies the whole monorepo, so the file rides into the
 *  image untouched; resolution covers both the compiled layout (dist/lib →
 *  ../../assets) and every realistic cwd (apps/worker or the repo root). */
export function resolveBrandLogoPath(): string | undefined {
  const candidates = [
    join(__dirname, '..', '..', 'assets', 'afrohits-logo.png'),
    join(process.cwd(), 'assets', 'afrohits-logo.png'),
    join(process.cwd(), 'apps', 'worker', 'assets', 'afrohits-logo.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Pure builder (unit-testable without ffmpeg): the full argv that prepends
 *  the branded splash to a finished cut. One invocation: a lavfi black frame
 *  carries the logo (fade in 0.25s / hold / fade out 0.35s), a silent
 *  anullsrc keeps A/V concat in sync, and both segments re-encode with the
 *  exact ASSEMBLY_ENCODE + AAC settings the pipeline already uses. */
export function buildLogoSplashArgs(opts: {
  input: string;
  output: string;
  logoPath: string;
  width: number;
  height: number;
  fps?: number;
}): string[] {
  const fps = opts.fps ?? ASSEMBLY_FPS;
  // Even pixel count — yuv420p subsampling dislikes odd overlay geometry.
  const logoHeight = Math.max(
    2,
    Math.round((opts.height * SPLASH_LOGO_HEIGHT_RATIO) / 2) * 2
  );
  const fadeOutStartS = SPLASH_DURATION_S - SPLASH_FADE_OUT_S;
  const audioFormat =
    'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
  const filter =
    `[1:v]scale=-2:${logoHeight}[logo];` +
    `[0:v][logo]overlay=(W-w)/2:(H-h)/2,` +
    `fade=t=in:st=0:d=${SPLASH_FADE_IN_S.toFixed(2)},` +
    `fade=t=out:st=${fadeOutStartS.toFixed(2)}:d=${SPLASH_FADE_OUT_S.toFixed(2)},` +
    `format=yuv420p,fps=${fps},setsar=1[sv];` +
    `[2:a]atrim=0:${SPLASH_DURATION_S.toFixed(2)},asetpts=PTS-STARTPTS,${audioFormat}[sa];` +
    `[3:v]format=yuv420p,fps=${fps},setsar=1[mv];` +
    `[3:a]${audioFormat}[ma];` +
    `[sv][sa][mv][ma]concat=n=2:v=1:a=1[v][a]`;
  return [
    '-f', 'lavfi',
    '-i', `color=c=black:s=${opts.width}x${opts.height}:r=${fps}:d=${SPLASH_DURATION_S.toFixed(2)}`,
    '-i', opts.logoPath,
    '-f', 'lavfi', '-t', SPLASH_DURATION_S.toFixed(2),
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-i', opts.input,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    ...ASSEMBLY_ENCODE,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    opts.output,
  ];
}

/** Prepend the branded splash to a finished cut (see buildLogoSplashArgs). */
export async function prependLogoSplash(opts: {
  input: string;
  output: string;
  logoPath: string;
  width: number;
  height: number;
  fps?: number;
}): Promise<void> {
  await runFfmpeg(buildLogoSplashArgs(opts));
}

/** PERSISTENT WATERMARK LAW (owner, VEVO reference): a small lowercase "afro"
 *  wordmark rides the bottom-RIGHT corner of the WHOLE video — splash, credit
 *  and every scene — at ~4.5% frame height, white at 75% opacity, 2.5% frame
 *  width off both edges. The first 3 seconds ALSO carry a bigger fully-opaque
 *  bottom-LEFT "afro" (~8.5% height) so paused/preview frames read like a
 *  VEVO thumbnail — the pipeline generates no poster image today, so the
 *  opening frames stand in honestly. Same font mechanism as the credit. */
export const WATERMARK_TEXT = 'afro';
export const WATERMARK_HEIGHT_RATIO = 0.045;
export const WATERMARK_MARGIN_RATIO = 0.025;
export const WATERMARK_OPACITY = 0.75;
export const WATERMARK_THUMB_HEIGHT_RATIO = 0.085;
export const WATERMARK_THUMB_WINDOW_S = 3;

/** Pure builder (unit-testable): the two drawtext filters — persistent
 *  bottom-right + first-3s bottom-left. Text rides a textfile exactly like
 *  the credit so the filter can never be broken by escaping. */
export function buildBrandWatermarkFilters(opts: {
  fontPath: string;
  textPath: string;
  width: number;
  height: number;
}): string[] {
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = escape(opts.fontPath);
  const text = escape(opts.textPath);
  const margin = Math.round(opts.width * WATERMARK_MARGIN_RATIO);
  const smallSize = Math.round(opts.height * WATERMARK_HEIGHT_RATIO);
  const thumbSize = Math.round(opts.height * WATERMARK_THUMB_HEIGHT_RATIO);
  return [
    // Persistent bottom-right — the whole runtime, no enable window.
    `drawtext=fontfile='${font}':textfile='${text}'` +
      `:fontcolor=white@${WATERMARK_OPACITY}:fontsize=${smallSize}` +
      `:x=W-text_w-${margin}:y=H-text_h-${margin}`,
    // Thumbnail-style bottom-left — first WATERMARK_THUMB_WINDOW_S seconds only.
    `drawtext=fontfile='${font}':textfile='${text}'` +
      `:fontcolor=white:fontsize=${thumbSize}` +
      `:x=${margin}:y=H-text_h-${margin}` +
      `:enable='between(t,0,${WATERMARK_THUMB_WINDOW_S})'`,
  ];
}

/** Burn the "afro" watermark pair into a finished cut — one encode pass,
 *  audio stream copied, same encode settings as every other assembly pass. */
export async function overlayBrandWatermark(opts: {
  input: string;
  output: string;
  fontPath: string;
  width: number;
  height: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'watermark-'));
  try {
    const textPath = join(dir, 'wordmark.txt');
    await writeFile(textPath, WATERMARK_TEXT);
    const filters = buildBrandWatermarkFilters({
      fontPath: opts.fontPath,
      textPath,
      width: opts.width,
      height: opts.height,
    });
    await runFfmpeg([
      '-i', opts.input,
      '-vf', filters.join(','),
      '-c:a', 'copy',
      ...ASSEMBLY_ENCODE,
      '-movflags', '+faststart',
      opts.output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * FOLDED BRAND PASS (vidspeed 2026-07-20): the opening credit and the
 * persistent "afro" watermark are BOTH drawtext on the identical frame, so
 * they need ONE decode/encode — not two. This collapses the credit pass and
 * the watermark pass into a SINGLE full-length re-encode (the logo splash
 * stays its own structural concat, since it is different frames prepended).
 *
 * PIXEL-IDENTICAL to the old two-pass order (credit → splash → watermark):
 *  - the credit filters draw FIRST, the watermark filters ON TOP, matching the
 *    old z-order (the watermark pass always ran last, over the credit);
 *  - the credit's cue window is shifted by `creditOffsetS` — the splash seconds
 *    now sitting in front of the cut — so it lights up at the same wall-clock
 *    moment it did when it was burned before the splash was prepended;
 *  - the watermark's own timing is unchanged: persistent 0s→end + the first-3s
 *    thumbnail, measured from the FINAL frame 0 (splash included), exactly as
 *    when it ran as the last pass over the splashed cut.
 *
 * `credit: null` (no bound song) drops the credit and still burns the
 * watermark, mirroring the old independent credit skip. Fail-soft is the
 * CALLER's job (its try/catch ships the splashed cut and records each
 * feature's applied/skip receipt); this throws on any ffmpeg failure.
 */
export async function overlayCreditsAndWatermark(opts: {
  input: string;
  output: string;
  width: number;
  height: number;
  fontPath: string;
  /** null → no bound song: the credit is skipped, the watermark still burns. */
  credit: { title: string; artist: string; producer?: string } | null;
  /** Seconds the credit cue is delayed by the splash now in front of it
   *  (SPLASH_DURATION_S when the splash shipped, 0 when it was skipped). */
  creditOffsetS: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'branded-'));
  try {
    const filters: string[] = [];
    // Credit drawtext FIRST — under the watermark (old z-order preserved).
    if (opts.credit) {
      const lines = buildVideoCreditLines({
        title: opts.credit.title,
        artist: opts.credit.artist,
        producer: opts.credit.producer,
        height: opts.height,
      });
      const textPaths: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const textPath = join(dir, `credit-${i}.txt`);
        await writeFile(textPath, lines[i]!.text);
        textPaths.push(textPath);
      }
      filters.push(
        ...buildVideoCreditFilters({
          lines,
          textPaths,
          fontPath: opts.fontPath,
          width: opts.width,
          height: opts.height,
          enableStartS: CREDIT_CUE_START_S + opts.creditOffsetS,
          enableEndS: CREDIT_CUE_END_S + opts.creditOffsetS,
        })
      );
    }
    // Watermark drawtext ON TOP — persistent bottom-right + first-3s thumbnail.
    const wordmarkPath = join(dir, 'wordmark.txt');
    await writeFile(wordmarkPath, WATERMARK_TEXT);
    filters.push(
      ...buildBrandWatermarkFilters({
        fontPath: opts.fontPath,
        textPath: wordmarkPath,
        width: opts.width,
        height: opts.height,
      })
    );
    await runFfmpeg([
      '-i', opts.input,
      '-vf', filters.join(','),
      '-c:a', 'copy',
      ...ASSEMBLY_ENCODE,
      '-movflags', '+faststart',
      opts.output,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// AUTO-CLIP (Phase 2, 2026-07-21) — cut the ONE assembled master music video
// into ~10 vertical shorts by ffmpeg EDIT (trim + 9:16 crop + scale + caption +
// watermark), NEVER a re-render. HARD ECONOMIC RULE: no new video generation,
// no provider call, no charge — each clip is a few CPU seconds off the master
// mp4 the assembler already produced ("generate once, repurpose many"). Every
// clip is ONE ffmpeg invocation: one filtergraph, one re-encode, the same
// ASSEMBLY_ENCODE preset + Anton font mechanism the credit/watermark already use.
// ---------------------------------------------------------------------------

/** The vertical target every clip conforms to (9:16 for TikTok/Reels/Shorts). */
export const CLIP_WIDTH = 1080;
export const CLIP_HEIGHT = 1920;
/** Loop-friendly declick: a fast 0.2s in/out so cuts never pop (video + audio).
 *  Small enough that the clip still STARTS on the action — no slow intro. */
export const CLIP_FADE_S = 0.2;
/** Caption height as a fraction of frame height — large, sound-off-legible. */
export const CLIP_CAPTION_FONT_RATIO = 0.045; // ~86px on a 1920-tall frame

/** 9:16 CENTER-CROP from the 16:9 master then scale to 1080x1920 — subject
 *  centered, frame FULL (feeds punish pillarboxed verticals). Pure filter, one
 *  pass. The spec recipe verbatim: crop=ih*9/16:ih; x=(iw-ow)/2 centers the
 *  strip (ow is the just-computed crop width, so NO comma sneaks into the
 *  filtergraph — a comma inside crop's args would be read as a filter separator).
 *  We only ever clip the assembled 'full' master, which is always 16:9, so the
 *  crop width (0.5625·ih) is always <= iw and never exceeds the frame. */
export function buildClipCropScale(width = CLIP_WIDTH, height = CLIP_HEIGHT): string {
  return `crop=ih*9/16:ih:(iw-ow)/2:0,scale=${width}:${height},setsar=1`;
}

/** The burned-in caption (sound-off viewing): the hook line, large, bottom-third,
 *  high contrast (semi-opaque box + shadow), safe side margins. SAME font +
 *  textfile mechanism as the credit/watermark — the text rides a textfile so a
 *  lyric with a quote/colon can never break the filter. Pure/unit-testable. */
export function buildClipCaptionFilter(opts: {
  fontPath: string;
  textPath: string;
  width: number;
  height: number;
}): string {
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = escape(opts.fontPath);
  const text = escape(opts.textPath);
  const size = Math.round(opts.height * CLIP_CAPTION_FONT_RATIO);
  const y = Math.round(opts.height * 0.66); // bottom third, above the watermark
  return (
    `drawtext=fontfile='${font}':textfile='${text}'` +
    `:fontcolor=white:fontsize=${size}:line_spacing=12` +
    `:box=1:boxcolor=black@0.5:boxborderw=${Math.round(size * 0.35)}` +
    `:x=(w-text_w)/2:y=${y}` +
    `:shadowcolor=black@0.6:shadowx=2:shadowy=2`
  );
}

/** The exact seconds a clip covers on the master. */
export interface ClipRenderSpec {
  startS: number;
  durationS: number;
  width?: number;
  height?: number;
  /** 0.2s in/out declick; pass false to cut hard (no fade). */
  fade?: boolean;
}

/** PURE (unit-testable without ffmpeg): the FULL single-invocation argv that
 *  cuts ONE vertical clip off the master — trim + 9:16 crop/scale + optional
 *  fade + caption + the persistent "afro" watermark, ALL in one filtergraph,
 *  encoded with the exact ASSEMBLY_ENCODE preset. There is exactly ONE input
 *  (`-i`) and one re-encode: a single pass per clip, an EDIT off the master —
 *  never a regeneration. `-ss` BEFORE `-i` is accurate-seek when transcoding
 *  (ffmpeg decodes+discards to the exact point), so the clip starts ON the
 *  intended hook moment while the seek stays fast. */
export function buildClipArgs(opts: {
  input: string;
  output: string;
  fontPath: string;
  captionTextPath: string;
  watermarkTextPath: string;
  spec: ClipRenderSpec;
}): string[] {
  const width = opts.spec.width ?? CLIP_WIDTH;
  const height = opts.spec.height ?? CLIP_HEIGHT;
  const dur = Math.max(0.5, opts.spec.durationS);
  const filters = [buildClipCropScale(width, height)];
  const withFade = opts.spec.fade !== false;
  if (withFade) {
    const outStart = Math.max(0, dur - CLIP_FADE_S);
    filters.push(
      `fade=t=in:d=${CLIP_FADE_S.toFixed(2)}`,
      `fade=t=out:st=${outStart.toFixed(2)}:d=${CLIP_FADE_S.toFixed(2)}`
    );
  }
  filters.push(
    buildClipCaptionFilter({
      fontPath: opts.fontPath,
      textPath: opts.captionTextPath,
      width,
      height,
    }),
    // Brand consistency: keep the "afro" watermark on clips exactly like the
    // master (the same pure builder the assembler burns into the full cut).
    ...buildBrandWatermarkFilters({
      fontPath: opts.fontPath,
      textPath: opts.watermarkTextPath,
      width,
      height,
    })
  );
  const audioFade = withFade
    ? `,afade=t=in:d=${CLIP_FADE_S.toFixed(2)},afade=t=out:st=${Math.max(0, dur - CLIP_FADE_S).toFixed(2)}:d=${CLIP_FADE_S.toFixed(2)}`
    : '';
  return [
    '-ss', Math.max(0, opts.spec.startS).toFixed(3),
    '-i', opts.input,
    '-t', dur.toFixed(3),
    '-vf', filters.join(','),
    // The master always carries AAC audio; the optional map keeps a rare
    // audioless master from failing the whole invocation.
    '-af', `aformat=sample_rates=44100:channel_layouts=stereo${audioFade}`,
    '-map', '0:v:0', '-map', '0:a:0?',
    ...ASSEMBLY_ENCODE,
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    opts.output,
  ];
}

/** Cut ONE clip (see buildClipArgs): write the caption + wordmark textfiles, run
 *  one ffmpeg invocation, leave the file at `output` for the caller to upload. */
export async function renderClip(opts: {
  input: string;
  output: string;
  fontPath: string;
  /** Pre-wrapped caption text (the hook line). Empty → a blank caption box. */
  caption: string;
  spec: ClipRenderSpec;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'clip-cut-'));
  try {
    const captionTextPath = join(dir, 'caption.txt');
    const watermarkTextPath = join(dir, 'wordmark.txt');
    await writeFile(captionTextPath, opts.caption?.trim() ? opts.caption : ' ');
    await writeFile(watermarkTextPath, WATERMARK_TEXT);
    await runFfmpeg(
      buildClipArgs({
        input: opts.input,
        output: opts.output,
        fontPath: opts.fontPath,
        captionTextPath,
        watermarkTextPath,
        spec: opts.spec,
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface CutClipRequest {
  spec: ClipRenderSpec;
  caption: string;
}
export interface CutClipOk {
  index: number;
  spec: ClipRenderSpec;
  caption: string;
  path: string;
  width: number;
  height: number;
}
export interface CutClipFailure {
  index: number;
  error: string;
}

/** FAIL-SOFT BATCH: cut every requested clip off the master, one cheap pass
 *  each, collecting the successes and the failures. A single clip that errors
 *  (bad seek, decode hiccup) NEVER kills the batch — the rest still come back.
 *  Serial by design: each clip is a few CPU seconds, so ordered + bounded beats
 *  a fan-out that could spike the worker host. */
export async function cutClips(opts: {
  input: string;
  workDir: string;
  fontPath: string;
  clips: CutClipRequest[];
}): Promise<{ ok: CutClipOk[]; failed: CutClipFailure[] }> {
  const ok: CutClipOk[] = [];
  const failed: CutClipFailure[] = [];
  for (let i = 0; i < opts.clips.length; i++) {
    const c = opts.clips[i]!;
    const output = join(opts.workDir, `clip-${i}.mp4`);
    try {
      await renderClip({
        input: opts.input,
        output,
        fontPath: opts.fontPath,
        caption: c.caption,
        spec: c.spec,
      });
      ok.push({
        index: i,
        spec: c.spec,
        caption: c.caption,
        path: output,
        width: c.spec.width ?? CLIP_WIDTH,
        height: c.spec.height ?? CLIP_HEIGHT,
      });
    } catch (err) {
      failed.push({ index: i, error: (err as Error).message.slice(0, 200) });
    }
  }
  return { ok, failed };
}

export interface AssemblyTimelineClip {
  /** LOCAL path to the downloaded rendered shot. */
  path: string;
  /** The treatment's claimed duration — the EDL slot (see TRIM LAW). */
  slotS: number;
  sequenceIndex: number;
  shotIndex: number;
}

export interface AssemblyTimelineResult {
  /** LOCAL path of the finished muxed mp4 (inside workDir). */
  path: string;
  /** Measured duration of the assembled VIDEO timeline (before the audio min-law). */
  coveredS: number;
  /** Measured duration of the FINAL muxed output. */
  durationS: number;
  width: number;
  height: number;
  fps: number;
  crossfadeCount: number;
  /** FULL-SONG COVERAGE provenance: how many times the rendered timeline
   *  plays in the final cut (1 = no looping). */
  loopedCycles: number;
}

/**
 * THE ASSEMBLER — local files in, one finished mp4 out. Shared verbatim by the
 * worker processor (downloads first) and the proof harness (synthetic clips),
 * so what is proven is what ships.
 *
 * Timeline law:
 *  - clips play in the given order, each trimmed to its treatment slot;
 *  - 'full': 15-frame crossfades at SEQUENCE boundaries only, hard cuts within
 *    a sequence. HANDLE LAW: the last clip of each non-final sequence keeps an
 *    extra ASSEMBLY_XFADE_S of its RENDERED material beyond the slot (renders
 *    run 5-10s vs 2-8s slots, so the material exists) and the crossfade
 *    consumes exactly that handle — so every sequence still starts at its EDL
 *    time and the total equals the sum of the slots, not sum minus fades;
 *  - 'teaser': hard cuts only (a 15/30s social cut wants punch), center-crop
 *    vertical;
 *  - audio: the master from audioStartS, total = min(video, audio,
 *    maxDurationS), 1s audio fade-out at the end.
 * Nothing loops, nothing freezes, nothing is synthesized to fill gaps — a
 * timeline shorter than the song ships at its honest covered length.
 */
export async function assembleMusicVideoTimeline(opts: {
  workDir: string;
  kind: 'full' | 'teaser';
  clips: AssemblyTimelineClip[];
  audioPath: string;
  audioStartS: number;
  maxDurationS?: number | null;
  /** FULL-SONG COVERAGE LAW (2026-07-17, owner: "the song and the video go
   *  together — it covers the full length so we can put out on socials").
   *  When set, the cut runs the WHOLE record: if the rendered timeline is
   *  shorter than the song, the scenes CYCLE to fill it (free local CPU,
   *  standard music-video practice). Honest provenance: loopedCycles rides
   *  the result and the assembly meta; coveredS still reports the length of
   *  UNIQUE visuals. */
  coverAudio?: boolean;
  onStage?: (stage: 'normalizing' | 'concatenating' | 'muxing') => void | Promise<void>;
}): Promise<AssemblyTimelineResult> {
  if (!opts.clips.length) throw new Error('assembly has no clips');
  const target = ASSEMBLY_TARGETS[opts.kind];
  const crossfade = opts.kind === 'full';

  // Group clips into sequences, preserving play order.
  const groups: AssemblyTimelineClip[][] = [];
  for (const clip of opts.clips) {
    const current = groups[groups.length - 1];
    if (current && current[0]!.sequenceIndex === clip.sequenceIndex) current.push(clip);
    else groups.push([clip]);
  }

  // 1) NORMALIZE — common geometry/fps, slot trims (+ crossfade handle on the
  //    last clip of each non-final sequence; see HANDLE LAW above).
  //
  //    PARALLEL NORMALIZE (vidspeed 2026-07-20): every clip's conform is an
  //    INDEPENDENT full re-encode, so flatten ALL (group,clip) units into one
  //    task list and fan them out through a bounded pool instead of the old
  //    N serial re-encodes. ORDER is preserved deterministically: each result
  //    is written into a pre-sized slot by its (g,c) coordinate — never
  //    push-on-complete — so the concat/xfade below still consumes clips in
  //    strict EDL order no matter which unit finishes first.
  await opts.onStage?.('normalizing');
  const normalized: string[][] = groups.map(group => new Array<string>(group.length));
  const normalizeTasks: Array<{
    g: number;
    c: number;
    input: string;
    output: string;
    trimS: number;
  }> = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!;
    for (let c = 0; c < group.length; c++) {
      const clip = group[c]!;
      const handleS =
        crossfade && groups.length > 1 && g < groups.length - 1 && c === group.length - 1
          ? ASSEMBLY_XFADE_S
          : 0;
      normalizeTasks.push({
        g,
        c,
        input: clip.path,
        output: join(opts.workDir, `norm-${g}-${c}.mp4`),
        trimS: clip.slotS + handleS,
      });
    }
  }
  await forEachPool(normalizeTasks, VIDEO_NORMALIZE_CONCURRENCY, async task => {
    await normalizeVideoClip({
      input: task.input,
      output: task.output,
      width: target.width,
      height: target.height,
      fit: target.fit,
      trimS: task.trimS,
    });
    normalized[task.g]![task.c] = task.output;
  });

  // 2) CONCAT within each sequence (hard cuts), then crossfade the sequences
  //    together ('full'); the teaser is one hard-cut reel.
  await opts.onStage?.('concatenating');
  const sequenceFiles: string[] = [];
  for (let g = 0; g < normalized.length; g++) {
    const files = normalized[g]!;
    if (files.length === 1) {
      sequenceFiles.push(files[0]!);
      continue;
    }
    const output = join(opts.workDir, `seq-${g}.mp4`);
    await concatVideoClips(files, output);
    sequenceFiles.push(output);
  }

  let timeline: string;
  let crossfadeCount = 0;
  if (!crossfade || sequenceFiles.length === 1) {
    if (sequenceFiles.length === 1) {
      timeline = sequenceFiles[0]!;
    } else {
      timeline = join(opts.workDir, 'timeline.mp4');
      await concatVideoClips(sequenceFiles, timeline);
    }
  } else {
    timeline = sequenceFiles[0]!;
    for (let g = 1; g < sequenceFiles.length; g++) {
      const currentDurationS = await probeMediaDurationPreciseS(timeline);
      if (!currentDurationS) throw new Error('assembled sequence has no measurable duration');
      const output = join(opts.workDir, `xfade-${g}.mp4`);
      await xfadeVideos(timeline, sequenceFiles[g]!, output, {
        offsetS: Math.max(0, currentDurationS - ASSEMBLY_XFADE_S),
      });
      timeline = output;
      crossfadeCount += 1;
    }
  }

  const coveredS = await probeMediaDurationPreciseS(timeline);
  if (!coveredS) throw new Error('assembled timeline has no measurable duration');

  // 3) MUX — min(video, audio, teaser cap) with the 1s audio fade-out.
  await opts.onStage?.('muxing');
  const audioTotalS = await probeMediaDurationPreciseS(opts.audioPath);
  const audioAvailableS = audioTotalS - Math.max(0, opts.audioStartS);
  if (audioAvailableS < 1) {
    throw new Error('the song audio is shorter than the requested start offset');
  }
  const capS =
    typeof opts.maxDurationS === 'number' && Number.isFinite(opts.maxDurationS) && opts.maxDurationS > 0
      ? opts.maxDurationS
      : Number.POSITIVE_INFINITY;

  // FULL-SONG COVERAGE: cycle the timeline until it reaches the song's end.
  // The record leads; the visuals follow. Without coverAudio the historic
  // min-law stands (the cut is as long as its shortest truth).
  let muxSource = timeline;
  let loopedCycles = 1;
  const songTargetS = Math.min(audioAvailableS, capS);
  if (opts.coverAudio && songTargetS > coveredS + 0.5) {
    loopedCycles = Math.ceil(songTargetS / coveredS);
    const looped = join(opts.workDir, 'looped-timeline.mp4');
    await concatVideoClips(Array.from({ length: loopedCycles }, () => timeline), looped);
    muxSource = looped;
  }
  const durationS = Math.min(coveredS * loopedCycles, audioAvailableS, capS);

  const output = join(opts.workDir, `assembled-${opts.kind}.mp4`);
  await muxTimelineAudio({
    video: muxSource,
    audio: opts.audioPath,
    output,
    audioStartS: Math.max(0, opts.audioStartS),
    durationS,
    fadeOutS: 1,
  });
  const measuredS = await probeMediaDurationPreciseS(output);
  return {
    path: output,
    coveredS: Math.round(coveredS * 1000) / 1000,
    durationS: Math.round((measuredS || durationS) * 1000) / 1000,
    width: target.width,
    height: target.height,
    fps: ASSEMBLY_FPS,
    crossfadeCount,
    loopedCycles,
  };
}

// ===========================================================================
// LIP-SYNC SUPPORT (2026-07-17). The sync engine takes ONE clip + the EXACT
// slice of the record that plays under it — these two helpers provide the
// slice and the math that finds it.
// ===========================================================================

/** PURE: each clip's start offset (seconds) inside the assembled timeline.
 *  Hard cuts within a sequence accumulate slots; each sequence boundary in a
 *  crossfaded ('full') cut overlaps by xfadeS. Mirrors the assembler's own
 *  timeline construction — pinned by test so they can never drift apart. */
export function computeClipAudioOffsets(
  clips: Array<{ slotS: number; sequenceIndex: number }>,
  xfadeS: number
): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    if (i > 0 && clips[i]!.sequenceIndex !== clips[i - 1]!.sequenceIndex) {
      cursor = Math.max(0, cursor - xfadeS);
    }
    offsets.push(Math.round(cursor * 1000) / 1000);
    cursor += clips[i]!.slotS;
  }
  return offsets;
}

/** Slice [startS, startS+durS) of an audio file to a mono-compatible WAV
 *  (the sync engine's safest format; <5MB for a 6s slice by construction). */
export async function sliceAudioWav(
  input: string,
  startS: number,
  durS: number,
  output: string
): Promise<void> {
  await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', Math.max(0, startS).toFixed(3),
    '-t', Math.max(0.5, durS).toFixed(3),
    '-i', input,
    '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
    output,
  ]);
}

export interface AudioTempoConformPlan {
  sourceBpm: number;
  foldedSourceBpm: number;
  targetBpm: number;
  deviation: number;
  tempoRatio: number;
  needsConform: boolean;
  supported: boolean;
}

/** Build a pitch-preserving tempo plan for a measured melody layer. Exact
 * half/double-time equivalents are accepted first; otherwise a safe direct
 * FFmpeg ratio wins before octave-folded alternatives are considered. */
export function audioTempoConformPlan(
  sourceBpm: number,
  targetBpm: number,
  tolerance = 0.05
): AudioTempoConformPlan | null {
  if (
    !Number.isFinite(sourceBpm) ||
    sourceBpm <= 0 ||
    !Number.isFinite(targetBpm) ||
    targetBpm <= 0
  ) {
    return null;
  }

  const candidates = [sourceBpm, sourceBpm / 2, sourceBpm * 2];
  const octaveEquivalent = candidates.find(
    candidate => Math.abs(candidate - targetBpm) / targetBpm <= tolerance
  );
  const directRatio = targetBpm / sourceBpm;
  const foldedSourceBpm = octaveEquivalent ??
    (directRatio >= 0.5 && directRatio <= 1.5
      ? sourceBpm
      : candidates
          .filter(candidate => {
            const ratio = targetBpm / candidate;
            return ratio >= 0.5 && ratio <= 1.5;
          })
          .sort(
            (left, right) =>
              Math.abs(left - targetBpm) - Math.abs(right - targetBpm)
          )[0] ?? sourceBpm);
  const deviation = Math.abs(foldedSourceBpm - targetBpm) / targetBpm;
  const needsConform = deviation > tolerance;
  const tempoRatio = needsConform ? targetBpm / foldedSourceBpm : 1;
  return {
    sourceBpm,
    foldedSourceBpm,
    targetBpm,
    deviation,
    tempoRatio,
    needsConform,
    supported: tempoRatio >= 0.5 && tempoRatio <= 1.5,
  };
}

/**
 * POST-CONFORM tempo tolerance. Once a lead has been time-stretched by the EXACT
 * pitch-preserving ratio derived from its measured source tempo, its grid is
 * correct BY CONSTRUCTION — the re-measure is only a sanity check on noisy
 * melodic content (a generative topping has sparse, ambiguous onsets a detector
 * reads ±5-8% off routinely). This wider octave-folded tolerance passes a
 * genuinely-conformed-but-noisy render while a gridless reading (off at EVERY
 * octave) still fails. Deliberately looser than the 5% pre-conform gate: that
 * one decides IF to stretch; this one only confirms the stretch didn't miss by
 * an octave. */
export const POST_CONFORM_TEMPO_TOLERANCE = 0.12;

/** Smallest octave-folded deviation of `bpm` from `gridBpm` (0 = on grid).
 *  Detectors are octave-ambiguous, so half/double-time readings fold onto the
 *  grid before the distance is taken — the same fold the honesty gate uses. */
export function octaveFoldedTempoDeviation(bpm: number, gridBpm: number): number {
  if (!(bpm > 0) || !(gridBpm > 0)) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...[bpm, bpm * 2, bpm / 2].map(c => Math.abs(c - gridBpm) / gridBpm)
  );
}

export interface PostConformTempoVerdict {
  pass: boolean;
  verifiedBpm: number | null;
  reason: string;
}

/**
 * Decide whether an EXACT-ratio tempo conform LANDED, given only the re-measured
 * post-conform BPM (null = the detector could not read the stretched audio) and
 * the grid. The stretch is exact math from the measured source, so:
 *   - re-measure UNREADABLE → TRUST the applied ratio (MusicGen melodic content
 *     frequently can't be re-measured after a stretch); the source WAS measured
 *     and the math is exact, so the audio is on grid — PASS, verifiedBpm null
 *     (we never fabricate a measurement we didn't take);
 *   - re-measure READABLE and within POST_CONFORM_TEMPO_TOLERANCE (octave-folded)
 *     → PASS;
 *   - re-measure READABLE but off at EVERY octave → the source reading was so
 *     wrong even the exact ratio left the audio gridless → REJECT (honest skip).
 * This is the "stretch by the ratio, not the re-measure" fix: a good trained
 * render at a slightly-off tempo now lands; genuine garbage still skips.
 */
export function postConformTempoVerdict(
  verifiedBpm: number | null,
  gridBpm: number
): PostConformTempoVerdict {
  if (verifiedBpm == null || !(verifiedBpm > 0)) {
    return {
      pass: true,
      verifiedBpm: null,
      reason:
        "post-conform re-measure unavailable — trusting the applied exact ratio",
    };
  }
  const dev = octaveFoldedTempoDeviation(verifiedBpm, gridBpm);
  if (dev <= POST_CONFORM_TEMPO_TOLERANCE) {
    return {
      pass: true,
      verifiedBpm,
      reason: `re-measured ~${Math.round(verifiedBpm)} BPM, ${Math.round(dev * 100)}% off (octave-folded) — within the ${Math.round(POST_CONFORM_TEMPO_TOLERANCE * 100)}% post-conform tolerance`,
    };
  }
  return {
    pass: false,
    verifiedBpm,
    reason: `measured ~${Math.round(verifiedBpm)} BPM, ${Math.round(dev * 100)}% off at every octave — no stable grid`,
  };
}

// ---------------------------------------------------------------------------
// AUTO-VISUALS (Phase 3, 2026-07-21) — a lyric video, an audio-reactive
// visualizer, and 3-5 thumbnails, ALL cheap ffmpeg/image EDITS off the EXISTING
// master audio + lyrics + cover. HARD ECONOMIC RULE: no new song/video render,
// no provider call, no charge — "generate once, repurpose many", users charged
// $0. Each asset is a SINGLE ffmpeg invocation reusing the exact ASSEMBLY_ENCODE
// preset + Anton font + "afro" watermark the video pipeline already uses.
// ---------------------------------------------------------------------------

/** The vertical target the lyric video + visualizer conform to (9:16 primary —
 *  social feeds punish anything else). */
export const VISUAL_WIDTH = 1080;
export const VISUAL_HEIGHT = 1920;
/** The thumbnail target — 16:9 1280x720, the YouTube CTR still. */
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

/** drawtext file-path escape — the exact rule the credit/watermark/clip builders
 *  use (backslashes → forward, colons escaped) so a Windows path or a lyric with
 *  a colon can never break the filtergraph. Text always rides a textfile. */
function escVisualPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/** Tasteful dark 2-stop gradients per genre for the NO-COVER fallback — a song
 *  with no cover still ships a branded backdrop, never a black void. Unmapped
 *  lanes fall back to the default (deep indigo). Colors are ffmpeg 0xRRGGBB. */
const VISUAL_GRADIENTS: Record<string, [string, string]> = {
  afrobeats: ['0x2A1A08', '0x0B0B12'],
  afro_fusion: ['0x1A0B2E', '0x0B0B12'],
  amapiano: ['0x2A1206', '0x0B0B12'],
  afro_dancehall: ['0x06222A', '0x0B0B12'],
  gospel: ['0x2A2410', '0x0B0B12'],
  afro_rnb: ['0x101836', '0x0B0B12'],
  street_pop: ['0x2A2206', '0x0B0B12'],
  hip_hop: ['0x161616', '0x000000'],
};
const DEFAULT_VISUAL_GRADIENT: [string, string] = ['0x101828', '0x0B0B12'];

/** The genre's gradient pair (see VISUAL_GRADIENTS); default when unmapped. */
export function resolveVisualGradient(genre: string | null | undefined): [string, string] {
  const key = (genre ?? '').toLowerCase().trim();
  return VISUAL_GRADIENTS[key] ?? DEFAULT_VISUAL_GRADIENT;
}

/** Background input flags for a visual: a still cover looped for the whole song,
 *  or the genre gradient from lavfi when there is no cover. Input 0 either way. */
function visualBackgroundInput(opts: {
  coverPath: string | null;
  gradient: [string, string];
  width: number;
  height: number;
  fps: number;
  durationS: number;
  /** A single frame (thumbnails) needs no -t/-loop timing. */
  still?: boolean;
}): string[] {
  const dur = opts.durationS.toFixed(3);
  if (opts.coverPath) {
    return opts.still
      ? ['-i', opts.coverPath]
      : ['-loop', '1', '-framerate', String(opts.fps), '-t', dur, '-i', opts.coverPath];
  }
  const grad =
    `gradients=s=${opts.width}x${opts.height}:c0=${opts.gradient[0]}:c1=${opts.gradient[1]}` +
    `:x0=0:y0=0:x1=0:y1=${opts.height}` +
    (opts.still ? '' : `:r=${opts.fps}:d=${dur}:speed=0.006`);
  return opts.still ? ['-f', 'lavfi', '-i', grad] : ['-f', 'lavfi', '-t', dur, '-i', grad];
}

/** The audio tail chain shared by the lyric video + visualizer: trim to the
 *  song length and fade the last ~1.2s so a bounded cut never ends on a cliff. */
function visualAudioChain(label: string, durationS: number, outLabel: string): string {
  const dur = Math.max(0.5, durationS);
  const fadeDur = Math.min(1.2, dur / 2);
  const fadeStart = Math.max(0, dur - fadeDur);
  return (
    `[${label}]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeDur.toFixed(3)},` +
    `aformat=sample_rates=44100:channel_layouts=stereo[${outLabel}]`
  );
}

// --- 1) LYRIC VIDEO --------------------------------------------------------

/** Font size / spacing law for the lyric video (fractions of frame height). */
export const LYRIC_FONT_RATIO = 0.05; // ~96px on a 1920-tall frame

/**
 * PURE (unit-testable): the FULL single-invocation argv for the lyric video —
 * the master audio + a ken-burns-zoomed cover (or the genre gradient) + the
 * lyrics EVENLY PAGED as large centered text + the "afro" watermark, all in one
 * filtergraph, encoded with the exact ASSEMBLY_ENCODE preset.
 *
 * HONEST TIMING: the pages tile the song on a FIXED cadence (see visuals-plan's
 * planLyricPages) — this is NOT karaoke sync, and it is not pretending to be.
 * True per-line sync needs a forced-alignment timing pass (owner follow-up).
 *
 * The lyrics ride textfiles (one per page) so a line with a quote/colon can
 * never break the filter — the same mechanism as the credit/caption builders.
 */
export function buildLyricVideoArgs(opts: {
  output: string;
  audioPath: string;
  fontPath: string;
  coverPath: string | null;
  gradient: [string, string];
  /** One written textfile per page (the page's verbatim wrapped lines). */
  pageTextPaths: string[];
  /** The even-paced window for each page (same length as pageTextPaths). */
  pageWindows: Array<{ startS: number; endS: number }>;
  watermarkTextPath: string;
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
}): string[] {
  const W = opts.width ?? VISUAL_WIDTH;
  const H = opts.height ?? VISUAL_HEIGHT;
  const fps = opts.fps ?? ASSEMBLY_FPS;
  const dur = Math.max(1, opts.durationS);
  const font = escVisualPath(opts.fontPath);

  // Ken-burns: oversize to 110% then slowly zoom in to 112% over the whole
  // record (gentle, ≤12% travel). No cover → a static gradient (already WxH).
  const big = (n: number) => Math.round((n * 1.1) / 2) * 2;
  const kb = opts.coverPath
    ? `scale=${big(W)}:${big(H)}:force_original_aspect_ratio=increase,crop=${big(W)}:${big(H)},` +
      `zoompan=z='min(1.0+0.00016*on,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps},setsar=1`
    : `scale=${W}:${H},setsar=1`;

  const size = Math.round(H * LYRIC_FONT_RATIO);
  const boxBorder = Math.round(size * 0.4);
  const filters: string[] = [
    kb,
    // Legibility scrim so white lyrics read over any cover.
    `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.42:t=fill`,
  ];
  for (let i = 0; i < opts.pageTextPaths.length; i++) {
    const win = opts.pageWindows[i]!;
    filters.push(
      `drawtext=fontfile='${font}':textfile='${escVisualPath(opts.pageTextPaths[i]!)}'` +
        `:fontcolor=white:fontsize=${size}:line_spacing=${Math.round(size * 0.28)}` +
        `:x=(w-text_w)/2:y=(h-text_h)/2` +
        `:box=1:boxcolor=black@0.38:boxborderw=${boxBorder}` +
        `:shadowcolor=black@0.65:shadowx=2:shadowy=2` +
        `:enable='between(t,${win.startS.toFixed(3)},${win.endS.toFixed(3)})'`
    );
  }
  filters.push(
    ...buildBrandWatermarkFilters({ fontPath: opts.fontPath, textPath: opts.watermarkTextPath, width: W, height: H })
  );

  const filterComplex =
    `[0:v]${filters.join(',')}[v];` + visualAudioChain('1:a', dur, 'a');
  return [
    ...visualBackgroundInput({ coverPath: opts.coverPath, gradient: opts.gradient, width: W, height: H, fps, durationS: dur }),
    '-i', opts.audioPath,
    '-filter_complex', filterComplex,
    '-map', '[v]', '-map', '[a]',
    '-t', dur.toFixed(3),
    ...ASSEMBLY_ENCODE,
    '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    opts.output,
  ];
}

/** Render the lyric video (see buildLyricVideoArgs): write one textfile per page
 *  + the wordmark, run ONE ffmpeg invocation, leave the mp4 at `output`. */
export async function renderLyricVideo(opts: {
  output: string;
  audioPath: string;
  fontPath: string;
  coverPath: string | null;
  gradient: [string, string];
  pages: Array<{ text: string; startS: number; endS: number }>;
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'lyricvid-'));
  try {
    const pageTextPaths: string[] = [];
    for (let i = 0; i < opts.pages.length; i++) {
      const p = join(dir, `page-${i}.txt`);
      await writeFile(p, opts.pages[i]!.text?.trim() ? opts.pages[i]!.text : ' ');
      pageTextPaths.push(p);
    }
    const watermarkTextPath = join(dir, 'wordmark.txt');
    await writeFile(watermarkTextPath, WATERMARK_TEXT);
    await runFfmpeg(
      buildLyricVideoArgs({
        output: opts.output,
        audioPath: opts.audioPath,
        fontPath: opts.fontPath,
        coverPath: opts.coverPath,
        gradient: opts.gradient,
        pageTextPaths,
        pageWindows: opts.pages.map((p) => ({ startS: p.startS, endS: p.endS })),
        watermarkTextPath,
        durationS: opts.durationS,
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- 2) VISUALIZER (audio-reactive) ---------------------------------------

/**
 * PURE (unit-testable): the FULL single-invocation argv for the audio-reactive
 * visualizer — the master audio drives an ffmpeg showwaves waveform composited
 * over the cover (or the genre gradient) with the "afro" watermark. This is the
 * shareable visual for INSTRUMENTALS (which carry no lyrics) and an alt for any
 * song. The waveform is keyed onto the cover with lumakey+overlay so the cover's
 * own color is preserved (a screen blend would tint the whole frame).
 */
export function buildVisualizerArgs(opts: {
  output: string;
  audioPath: string;
  fontPath: string;
  coverPath: string | null;
  gradient: [string, string];
  watermarkTextPath: string;
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
}): string[] {
  const W = opts.width ?? VISUAL_WIDTH;
  const H = opts.height ?? VISUAL_HEIGHT;
  const fps = opts.fps ?? ASSEMBLY_FPS;
  const dur = Math.max(1, opts.durationS);

  const bgChain = opts.coverPath
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,eq=brightness=-0.08:saturation=1.05`
    : `scale=${W}:${H},setsar=1`;
  const watermark = buildBrandWatermarkFilters({
    fontPath: opts.fontPath,
    textPath: opts.watermarkTextPath,
    width: W,
    height: H,
  }).join(',');

  const filterComplex =
    `[1:a]asplit=2[aw][ao];` +
    `[0:v]${bgChain},format=yuv420p[bg];` +
    // showwaves → a centered waveform on black; lumakey drops the black to
    // transparent so overlay draws ONLY the waveform over the untouched cover.
    `[aw]showwaves=s=${W}x${H}:mode=cline:rate=${fps}:colors=white:draw=full,` +
    `format=yuva420p,lumakey=threshold=0.08:tolerance=0.06[wav];` +
    `[bg][wav]overlay=0:0:shortest=1[mix];` +
    `[mix]${watermark}[v];` +
    visualAudioChain('ao', dur, 'a');
  return [
    ...visualBackgroundInput({ coverPath: opts.coverPath, gradient: opts.gradient, width: W, height: H, fps, durationS: dur }),
    '-i', opts.audioPath,
    '-filter_complex', filterComplex,
    '-map', '[v]', '-map', '[a]',
    '-t', dur.toFixed(3),
    ...ASSEMBLY_ENCODE,
    '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    opts.output,
  ];
}

/** Render the visualizer (see buildVisualizerArgs): write the wordmark, run ONE
 *  ffmpeg invocation, leave the mp4 at `output`. */
export async function renderVisualizer(opts: {
  output: string;
  audioPath: string;
  fontPath: string;
  coverPath: string | null;
  gradient: [string, string];
  durationS: number;
  width?: number;
  height?: number;
  fps?: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'visualizer-'));
  try {
    const watermarkTextPath = join(dir, 'wordmark.txt');
    await writeFile(watermarkTextPath, WATERMARK_TEXT);
    await runFfmpeg(
      buildVisualizerArgs({
        output: opts.output,
        audioPath: opts.audioPath,
        fontPath: opts.fontPath,
        coverPath: opts.coverPath,
        gradient: opts.gradient,
        watermarkTextPath,
        durationS: opts.durationS,
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- 3) THUMBNAILS (images) ------------------------------------------------

export type ThumbnailCrop = 'center' | 'top' | 'bottom';
export type ThumbnailTextPos = 'bottom' | 'top' | 'center' | 'none';

/** Title font size for a thumbnail (fraction of the 720-tall frame). */
export const THUMB_FONT_RATIO = 0.11; // ~79px

// ---------------------------------------------------------------------------
// BRANDED POSTER MARK (owner, 2026-07-21, VEVO reference) — the PERMANENT brand
// mark baked onto the POSTER/THUMBNAIL still people see BEFORE a video plays,
// like the VEVO logo on a feed thumbnail. This is DISTINCT from the in-video
// watermark (buildBrandWatermarkFilters, untouched): that small ~4.5% wordmark
// rides the moving video; THIS is a big, prominent mark on the still image that
// becomes the poster/OG/social image. Same 'afro' identity + same Anton font as
// the watermark, just MUCH bigger (~11% frame height vs 4.5%) and on the poster.
// ---------------------------------------------------------------------------

/** The poster's brand text — the SAME 'afro' identity as the in-video watermark,
 *  set in the display caps the mark reads best in (VEVO-style, prominent). */
export const POSTER_MARK_TEXT = 'AFRO';
/** Poster mark height as a fraction of the frame — ~11%, comfortably bigger than
 *  the in-video watermark's 4.5% so it reads at feed-thumbnail size. */
export const POSTER_MARK_HEIGHT_RATIO = 0.11;
/** Poster mark inset from the bottom-left corner (fraction of frame width). */
export const POSTER_MARK_MARGIN_RATIO = 0.045;

/**
 * PURE (unit-testable): the drawtext filter(s) for the big bottom-LEFT "AFRO"
 * poster mark. White, bold, with a strong drop shadow and a subtle backing box
 * so it reads on ANY cover — dark or bright — while still looking like a logo,
 * not a caption. Bottom-LEFT deliberately: the in-video watermark owns the
 * bottom-RIGHT, so a poster reusing this mark never collides with it. The text
 * rides a textfile exactly like the watermark/credit builders, so escaping can
 * never break the filtergraph.
 */
export function buildPosterBrandFilters(opts: {
  fontPath: string;
  /** A written textfile whose content is POSTER_MARK_TEXT ('AFRO'). */
  textPath: string;
  width: number;
  height: number;
}): string[] {
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  const font = escape(opts.fontPath);
  const text = escape(opts.textPath);
  const margin = Math.round(opts.width * POSTER_MARK_MARGIN_RATIO);
  const size = Math.round(opts.height * POSTER_MARK_HEIGHT_RATIO);
  const boxBorder = Math.round(size * 0.22);
  return [
    `drawtext=fontfile='${font}':textfile='${text}'` +
      `:fontcolor=white:fontsize=${size}` +
      `:x=${margin}:y=H-text_h-${margin}` +
      `:box=1:boxcolor=black@0.28:boxborderw=${boxBorder}` +
      `:shadowcolor=black@0.65:shadowx=3:shadowy=3`,
  ];
}

/**
 * PURE (unit-testable): the FULL single-invocation argv for ONE thumbnail image
 * — the cover (or gradient) cropped at the variant's anchor, a legibility scrim,
 * a bold title/hook overlay at the variant's position, and the small "afro"
 * wordmark bottom-right. One frame out (-frames:v 1), JPEG. An EDIT off the
 * cover, never a render.
 */
export function buildThumbnailArgs(opts: {
  output: string;
  coverPath: string | null;
  gradient: [string, string];
  fontPath: string;
  /** null / textPos 'none' → the text-free clean-cover variant. */
  titleTextPath: string | null;
  /** A written textfile: the mark's content — 'afro' (small watermark) for a
   *  normal thumbnail, 'AFRO' (POSTER_MARK_TEXT) when `poster` is set. */
  watermarkTextPath: string;
  crop: ThumbnailCrop;
  textPos: ThumbnailTextPos;
  accent: boolean;
  /** POSTER variant (the branded still shown before playback): the big VEVO-
   *  style "AFRO" mark bottom-LEFT instead of the small bottom-right wordmark,
   *  and NO title (a clean cover + brand). */
  poster?: boolean;
  width?: number;
  height?: number;
}): string[] {
  const W = opts.width ?? THUMB_WIDTH;
  const H = opts.height ?? THUMB_HEIGHT;
  const font = escVisualPath(opts.fontPath);
  const cropXY: Record<ThumbnailCrop, string> = {
    center: '(iw-ow)/2:(ih-oh)/2',
    top: '(iw-ow)/2:0',
    bottom: '(iw-ow)/2:(ih-oh)',
  };
  const filters: string[] = [
    opts.coverPath
      ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:${cropXY[opts.crop]},setsar=1`
      : `scale=${W}:${H},setsar=1`,
  ];
  // BRANDED POSTER: the clean cover + the big "AFRO" mark, no title clutter —
  // the permanent still that stands in for the video in every feed. It carries
  // ONLY the prominent poster mark (bottom-left), never the small wordmark.
  if (opts.poster) {
    filters.push(
      ...buildPosterBrandFilters({
        fontPath: opts.fontPath,
        textPath: opts.watermarkTextPath,
        width: W,
        height: H,
      }),
    );
    return [
      ...visualBackgroundInput({
        coverPath: opts.coverPath,
        gradient: opts.gradient,
        width: W,
        height: H,
        fps: ASSEMBLY_FPS,
        durationS: 1,
        still: true,
      }),
      '-frames:v', '1',
      '-vf', filters.join(','),
      '-q:v', '3',
      opts.output,
    ];
  }
  const hasText = !!opts.titleTextPath && opts.textPos !== 'none';
  if (hasText) {
    if (opts.textPos === 'bottom') {
      filters.push(`drawbox=x=0:y=${Math.round(H * 0.58)}:w=${W}:h=${Math.round(H * 0.42)}:color=black@0.5:t=fill`);
    } else if (opts.textPos === 'top') {
      filters.push(`drawbox=x=0:y=0:w=${W}:h=${Math.round(H * 0.42)}:color=black@0.5:t=fill`);
    } else {
      filters.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.3:t=fill`);
    }
    const size = Math.round(H * THUMB_FONT_RATIO);
    const pad = Math.round(H * 0.08);
    const y =
      opts.textPos === 'bottom' ? `h-text_h-${pad}` : opts.textPos === 'top' ? `${pad}` : '(h-text_h)/2';
    const box = opts.accent
      ? `:box=1:boxcolor=0xE0512D@0.85:boxborderw=${Math.round(size * 0.28)}`
      : `:box=1:boxcolor=black@0.35:boxborderw=${Math.round(size * 0.3)}`;
    filters.push(
      `drawtext=fontfile='${font}':textfile='${escVisualPath(opts.titleTextPath!)}'` +
        `:fontcolor=white:fontsize=${size}:line_spacing=${Math.round(size * 0.2)}` +
        `:x=(w-text_w)/2:y=${y}${box}:shadowcolor=black@0.6:shadowx=2:shadowy=2`
    );
  }
  // The small persistent "afro" mark only (bottom-right) — NOT the video's
  // first-3s bottom-left thumbnail mark, which would clash with the title.
  const margin = Math.round(W * WATERMARK_MARGIN_RATIO);
  const wmSize = Math.round(H * WATERMARK_HEIGHT_RATIO);
  filters.push(
    `drawtext=fontfile='${font}':textfile='${escVisualPath(opts.watermarkTextPath)}'` +
      `:fontcolor=white@${WATERMARK_OPACITY}:fontsize=${wmSize}` +
      `:x=W-text_w-${margin}:y=H-text_h-${margin}`
  );

  return [
    ...visualBackgroundInput({
      coverPath: opts.coverPath,
      gradient: opts.gradient,
      width: W,
      height: H,
      fps: ASSEMBLY_FPS,
      durationS: 1,
      still: true,
    }),
    '-frames:v', '1',
    '-vf', filters.join(','),
    '-q:v', '3',
    opts.output,
  ];
}

/** One thumbnail's variant spec (from visuals-plan.planThumbnailVariants). */
export interface ThumbnailRenderRequest {
  id: string;
  text: string;
  crop: ThumbnailCrop;
  textPos: ThumbnailTextPos;
  accent: boolean;
  /** The BRANDED POSTER variant: the clean cover + the big "AFRO" mark, no
   *  title — the permanent still shown before playback (used as the canonical
   *  poster/OG/social image). Exactly one variant carries this. */
  poster?: boolean;
}
export interface ThumbnailOk {
  id: string;
  path: string;
  request: ThumbnailRenderRequest;
}
export interface ThumbnailFailure {
  id: string;
  error: string;
}

/** Render ONE thumbnail (see buildThumbnailArgs): write the title + wordmark
 *  textfiles, run one ffmpeg invocation, leave the jpg at `output`. */
export async function renderThumbnail(opts: {
  output: string;
  coverPath: string | null;
  gradient: [string, string];
  fontPath: string;
  request: ThumbnailRenderRequest;
  width?: number;
  height?: number;
}): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'thumb-'));
  try {
    // The mark textfile: the big 'AFRO' brand for a poster, else the small
    // 'afro' wordmark — the SAME identity as the in-video watermark either way.
    const watermarkTextPath = join(dir, 'wordmark.txt');
    await writeFile(watermarkTextPath, opts.request.poster ? POSTER_MARK_TEXT : WATERMARK_TEXT);
    let titleTextPath: string | null = null;
    if (!opts.request.poster && opts.request.text?.trim() && opts.request.textPos !== 'none') {
      titleTextPath = join(dir, 'title.txt');
      await writeFile(titleTextPath, opts.request.text);
    }
    await runFfmpeg(
      buildThumbnailArgs({
        output: opts.output,
        coverPath: opts.coverPath,
        gradient: opts.gradient,
        fontPath: opts.fontPath,
        titleTextPath,
        watermarkTextPath,
        crop: opts.request.crop,
        textPos: opts.request.textPos,
        accent: opts.request.accent,
        poster: opts.request.poster,
        width: opts.width,
        height: opts.height,
      })
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** FAIL-SOFT BATCH: render every requested thumbnail, one cheap pass each,
 *  collecting the successes + failures. A single thumbnail that errors NEVER
 *  kills the batch — the rest still come back (mirrors cutClips). */
export async function renderThumbnails(opts: {
  workDir: string;
  coverPath: string | null;
  gradient: [string, string];
  fontPath: string;
  requests: ThumbnailRenderRequest[];
  width?: number;
  height?: number;
}): Promise<{ ok: ThumbnailOk[]; failed: ThumbnailFailure[] }> {
  const ok: ThumbnailOk[] = [];
  const failed: ThumbnailFailure[] = [];
  for (let i = 0; i < opts.requests.length; i++) {
    const request = opts.requests[i]!;
    const output = join(opts.workDir, `thumb-${i}-${request.id}.jpg`);
    try {
      await renderThumbnail({
        output,
        coverPath: opts.coverPath,
        gradient: opts.gradient,
        fontPath: opts.fontPath,
        request,
        width: opts.width,
        height: opts.height,
      });
      ok.push({ id: request.id, path: output, request });
    } catch (err) {
      failed.push({ id: request.id, error: (err as Error).message.slice(0, 200) });
    }
  }
  return { ok, failed };
}
