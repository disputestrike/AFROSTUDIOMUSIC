/**
 * FFmpeg helpers — spawn the system ffmpeg binary directly (no wrapper dep).
 * Railway worker image includes ffmpeg via nixpacks (see apps/worker/railway.json).
 * Locally, install ffmpeg or mixes/masters will fail with a clear error.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grooveOffsetMs, parseStorageUri } from '@afrohit/shared';
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
    flags,
    verdict,
    ok: verdict !== 'fail',
  };
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
    return audioQualityFromFfmpegCapture(durationS, capture);
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

/** Trim raw audio to an exact N-bar loop at the given BPM (4/4), gentle edges. */
export async function trimToLoop(input: Buffer, bpm: number, bars: number, startS = 0.5): Promise<Buffer> {
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
}

/**
 * Assemble a full beat from real material: each section loops its layers to the
 * section length (time-stretched to the target BPM), mixes them, then sections
 * concat into one continuous WAV. Deterministic — the exact beat, every time.
 */
export async function assembleBeat(opts: {
  layers: AssemblyLayer[];
  sections: AssemblySection[];
  targetBpm: number;
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'assemble-'));
  try {
    const sectionFiles: string[] = [];
    for (let s = 0; s < opts.sections.length; s++) {
      const sec = opts.sections[s]!;
      const secDur = (60 / opts.targetBpm) * 4 * sec.bars;
      const active = sec.layerIdx.map((i) => opts.layers[i]).filter(Boolean) as AssemblyLayer[];
      if (!active.length) continue;
      const inputs: string[] = [];
      const chains: string[] = [];
      const labels: string[] = [];
      active.forEach((l, i) => {
        // -stream_loop -1 + -t: loop the material to the section length.
        inputs.push('-stream_loop', '-1', '-t', (secDur + 1).toFixed(3), '-i', l.path);
        // Time-stretch to the target tempo (atempo valid 0.5–2.0 per stage).
        const ratio = Math.min(Math.max(opts.targetBpm / l.sourceBpm, 0.5), 2.0);
        // PAN (producer doctrine): shakers wide, congas/bells off-center, low end
        // center — the width that makes a layered kit read as a real mix.
        const pan = Math.max(-1, Math.min(1, l.pan ?? 0));
        const panF = pan !== 0 ? `,stereotools=balance_out=${pan.toFixed(2)}` : '';
        // GROOVE (the PDF's law: "Afrobeats doesn't sit perfectly on the grid"):
        // timekeepers stay dead-on, hand percussion sits a few ms behind —
        // deterministic per role, ≤10ms, so layered kits breathe like players,
        // never like a sequencer.
        const groove = l.role ? Math.min(10, Math.max(0, grooveOffsetMs(l.role))) : 0;
        const grooveF = groove > 0 ? `,adelay=${groove}|${groove}` : '';
        chains.push(`[${i}:a]aformat=channel_layouts=stereo,atempo=${ratio.toFixed(4)},volume=${l.gain.toFixed(2)}${panF}${grooveF}[l${i}]`);
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
      const safety = `,volume=${busTrim.toFixed(3)},alimiter=level=false:limit=0.891:attack=2:release=80`;
      const filter =
        active.length === 1
          ? chains[0]!.replace(/\[l0\]$/, `${safety}[out]`)
          : `${chains.join(';')};${labels.join('')}amix=inputs=${active.length}:duration=longest:normalize=0${safety}[out]`;
      await runFfmpeg([...inputs, '-filter_complex', filter, '-map', '[out]', '-t', secDur.toFixed(3), '-ar', '44100', '-ac', '2', outPath]);
      sectionFiles.push(outPath);
    }
    if (!sectionFiles.length) throw new Error('assembly produced no sections');
    // Concat the sections into the full beat.
    const listPath = join(dir, 'list.txt');
    await writeFile(listPath, sectionFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
    const outPath = join(dir, 'beat.wav');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-ar', '44100', '-ac', '2', outPath]);
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
 * Automated mastering chain — now a real LOUDNESS chain, not a polite one:
 *   1. subsonic high-pass (kill rumble that steals headroom)
 *   2. gentle tonal shaping — low warmth, vocal presence, top-end air
 *   3. glue bus compression (2:1, slow) to round the whole thing together
 *   4. DRIVE (loud targets only): measured volume push + tanh soft-clip INTO the
 *      limiter — the density stage commercial Afrobeats masters have and the old
 *      chain never did; loudnorm alone cannot create it.
 *   5. brickwall limiter as the hard ceiling
 *   6. two-pass LINEAR loudnorm trim landing on the exact preset target — the
 *      old ONE-PASS dynamic loudnorm undershot 1-3 LU and pumped; THAT was the
 *      "crusher"/"weak" defect, not the -9 number.
 * Everything before the trim (steps 1-5) lives in masterPreChain so pass 1 can
 * measure EXACTLY the signal the trim will receive.
 */
export function masterPreChain(target: { lufs: number; tp: number }, rawI: number | null): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4); // dBTP → linear amplitude
  const parts = [
    'highpass=f=28',
    'bass=g=1.2:f=110', // low-end warmth
    'equalizer=f=3000:width_type=q:width=1.5:g=1', // vocal/lead presence
    'treble=g=1.8:f=9000', // air
    'acompressor=threshold=-16dB:ratio=2:attack=20:release=200:makeup=1.5', // glue
  ];
  // Loud targets get DRIVEN into the ceiling; quiet ("breathe") targets don't —
  // saturating a dynamics-first master defeats its whole point.
  const gain = rawI === null ? 0 : driveGainDb(target.lufs, rawI);
  if (target.lufs >= -11 && gain > 0.05) {
    parts.push(`volume=${gain.toFixed(2)}dB`); // measured drive, never a blind boost
    parts.push('asoftclip=type=tanh:threshold=0.85'); // analog-style density before the wall
  }
  parts.push(`alimiter=level=false:limit=${tpLinear}:attack=2:release=80`); // brickwall ceiling
  return parts.join(',');
}

/** Full mastering filtergraph: pre-chain + two-pass linear trim (see above). */
export function masterChain(
  target: { lufs: number; tp: number },
  m?: { raw: LoudnormStats | null; driven: LoudnormStats | null }
): string {
  return [masterPreChain(target, m?.raw?.input_i ?? null), loudnormTrim(target, 11, m?.driven ?? null)].join(',');
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

/**
 * Master a mix — real TWO-PASS loudness. Pass 1 measures (raw take → sets the
 * drive gain; then the driven pre-chain → sets the trim's measured_* numbers),
 * pass 2 renders once with a LINEAR trim that lands ON the preset target. The
 * old one-pass dynamic loudnorm undershot 1-3 LU and pumped — the "masters
 * sound weak" defect, now retired to a fallback for unmeasurable input.
 * Encodes both WAV and 320k MP3. Returns both.
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
}): Promise<{ wav: Buffer; mp3: Buffer }> {
  const target = MASTER_TARGETS[opts.preset] ?? MASTER_TARGETS['afro_stream_-9']!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-master-'));
  try {
    const inPath = join(dir, 'in.bin');
    const wavPath = join(dir, 'master.wav');
    const mp3Path = join(dir, 'master.mp3');
    await writeFile(inPath, opts.mix);
    // PASS 1 — measure the raw program; its integrated loudness sets the drive.
    const raw = await measureLoudnorm(inPath, target);
    const pre = opts.finished
      ? conformPreChain(target, raw?.input_i ?? null)
      : masterPreChain(target, raw?.input_i ?? null);
    // PASS 1b — measure the signal as it LEAVES the drive/limiter stage: the
    // trim must know its OWN input, not the raw take, or the drive gain gets
    // applied twice. Same deterministic pre-chain as the render below.
    const driven = raw ? await measureLoudnorm(inPath, target, pre) : null;
    // PASS 2 — the real render: pre-chain + linear trim (dynamic fallback only
    // when measurement failed; a master job should never die on analysis).
    const filter = [pre, loudnormTrim(target, opts.finished ? 20 : 11, driven)].join(',');
    await runFfmpeg(['-i', inPath, '-af', filter, '-ar', '44100', '-ac', '2', wavPath]);
    await runFfmpeg(['-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '320k', mp3Path]);
    return { wav: await readFile(wavPath), mp3: await readFile(mp3Path) };
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
export async function transformAudio(input: Buffer, opts: { tempo?: number; semitones?: number }): Promise<Buffer> {
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
    const af = filters.length ? filters.join(',') : 'anull';
    await runFfmpeg(['-i', inPath, '-af', af, '-ac', '2', '-ar', String(sr), outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Mix two audio buffers (bed + layer) into one WAV; layer gain 0-1. */
export async function mixBuffers(bed: Buffer, layer: Buffer, layerGain = 0.85): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mix2-'));
  const a = join(dir, 'a'); const b = join(dir, 'b'); const outPath = join(dir, 'out.wav');
  try {
    await writeFile(a, bed); await writeFile(b, layer);
    await runFfmpeg(['-i', a, '-i', b, '-filter_complex', `[1:a]volume=${layerGain}[l];[0:a][l]amix=inputs=2:duration=first:dropout_transition=0[a]`, '-map', '[a]', '-ac', '2', '-ar', '44100', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
