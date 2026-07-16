/**
 * THE EAR — Node <-> Python DSP bridge (Phase 0).
 *
 * Spawns `python3 analyze_dsp.py <localAudioPath>` and parses the single JSON line
 * it prints into a MeasuredAnalysis. Every path here is failure-tolerant: if Python
 * is missing, librosa can't load, the analysis errors, or it times out, we return an
 * honest all-'unknown' analysis (engineOk:false) — we NEVER throw into the render
 * pipeline and we NEVER fabricate a measurement.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { unknownAnalysis, type MeasuredAnalysis } from '@afrohit/shared';
import { downloadToBuffer } from './storage';

const PYTHON = process.env.PYTHON_BIN ?? 'python3';
const DSP_TIMEOUT_MS = Number(process.env.DSP_TIMEOUT_MS ?? 180_000);

function scriptPath(): string {
  const candidates = [
    process.env.DSP_SCRIPT,
    // dist/lib/dsp.js -> package root; src/lib/dsp.ts -> package root (both ../../).
    join(__dirname, '..', '..', 'analyze_dsp.py'),
    join(process.cwd(), 'analyze_dsp.py'),
    join(process.cwd(), 'apps', 'worker', 'analyze_dsp.py'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? candidates[1] ?? 'analyze_dsp.py';
}

/** Is the DSP engine actually installed? (python3 + librosa importable)
 * Memoized — the answer can't change within a process lifetime, so we probe ONCE
 * instead of spawning a python import on every analyze/render (that added seconds
 * of latency to each job). */
let _dspCache: Promise<boolean> | null = null;
export function dspAvailable(): Promise<boolean> {
  if (_dspCache) return _dspCache;
  _dspCache = new Promise<boolean>((resolve) => {
    const p = spawn(PYTHON, ['-c', 'import librosa, numpy, soundfile']);
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => { p.kill('SIGKILL'); done(false); }, 15_000); // never hang on the probe
    p.on('error', () => { clearTimeout(timer); done(false); });
    p.on('exit', (code) => { clearTimeout(timer); done(code === 0); });
  });
  return _dspCache;
}

/** The log-drum TRUTH-GATE status (from py/fixtures/logdrum_calibration.json). */
export interface LogdrumStatus { calibrated: boolean; reason?: string | null; separationMargin?: number | null; calibratedOn?: string | null }
export function logdrumCalibrationStatus(): Promise<LogdrumStatus> {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, [scriptPath(), '--calibration-status']);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve({ calibrated: false, reason: 'dsp-unavailable' }));
    p.on('exit', () => {
      try { resolve(JSON.parse(out.trim().split('\n').filter(Boolean).pop() || '{}')); }
      catch { resolve({ calibrated: false, reason: 'status-parse-failed' }); }
    });
  });
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Capped math threads — a measurement must never starve the render lane.
    const p = spawn(PYTHON, args, { env: { ...process.env, OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`dsp timeout after ${DSP_TIMEOUT_MS}ms`));
    }, DSP_TIMEOUT_MS);
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`python exit ${code}: ${err.slice(0, 400)}`));
    });
  });
}

function extFromUrl(url: string): string {
  try {
    const e = extname(new URL(url).pathname).toLowerCase();
    return /^\.(mp3|wav|m4a|flac|ogg|aac)$/.test(e) ? e : '.mp3';
  } catch {
    return '.mp3';
  }
}

/** Demucs stems (URLs or local paths) — let the stem-dependent detectors (log-drum,
 * shaker, kick, clap) run at full confidence instead of the full-mix fallback. */
export interface StemInputs {
  bass?: string;
  drums?: string;
  other?: string;
  vocals?: string;
}

/**
 * Measure a rendered track. `input` is a URL (R2/http) or an already-loaded Buffer;
 * `stems` are optional Demucs outputs (URLs or local paths). Always resolves — an
 * honest all-'unknown' analysis on any failure.
 */
export async function measureAudio(input: string | Buffer, stems?: StemInputs): Promise<MeasuredAnalysis> {
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-dsp-'));
  const isUrl = typeof input === 'string' && /^https?:\/\//.test(input);
  const isLocalPath = typeof input === 'string' && !isUrl;
  try {
    let audioPath: string;
    if (isLocalPath) {
      audioPath = input as string; // acceptance harness passes local wav paths directly
    } else {
      const ext = typeof input === 'string' ? extFromUrl(input) : '.mp3';
      audioPath = join(dir, `audio${ext}`);
      const buf = typeof input === 'string' ? await downloadToBuffer(input) : input;
      await writeFile(audioPath, buf);
    }

    // Materialize any provided stems locally (a stem may already be a local path —
    // pass it through unchanged; a URL gets downloaded). Best-effort per stem.
    const args = [scriptPath(), audioPath];
    for (const role of ['bass', 'drums', 'other', 'vocals'] as const) {
      const src = stems?.[role];
      if (!src) continue;
      try {
        let stemPath = src;
        if (/^https?:\/\//.test(src)) {
          stemPath = join(dir, `${role}${extFromUrl(src)}`);
          await writeFile(stemPath, await downloadToBuffer(src));
        }
        args.push(`--${role}`, stemPath);
      } catch (e) {
        console.warn(`[dsp] stem ${role} unavailable, using full-mix fallback:`, (e as Error).message);
      }
    }

    const stdout = await runPython(args);
    const line = stdout.trim().split('\n').filter(Boolean).pop();
    if (!line) return unknownAnalysis('engine:no-output');

    const parsed = JSON.parse(line) as Partial<MeasuredAnalysis> & { engineOk?: boolean; error?: string };
    if (!parsed || parsed.engineOk === false) {
      return unknownAnalysis(parsed?.error ? `engine:${parsed.error.slice(0, 80)}` : 'engine:failed');
    }
    (parsed as MeasuredAnalysis).analyzedAt = new Date().toISOString();
    return parsed as MeasuredAnalysis;
  } catch (e) {
    return unknownAnalysis(`bridge-error:${(e as Error).message.slice(0, 120)}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
