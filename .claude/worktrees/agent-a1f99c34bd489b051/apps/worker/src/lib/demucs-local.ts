/**
 * A3-4 — LOCAL DEMUCS (htdemucs on the worker's own CPU) + the mode router.
 *
 * The nightly deep-measure/backfill walkers were paying Replicate per track for
 * stem separation — the largest steady spend drain. Nightly work is not
 * latency-sensitive: local CPU separation costs ≈ $0 cash and runs while the
 * studio sleeps. User-facing stem requests stay on the fast paid path unless
 * DEMUCS_MODE=local forces everything local.
 *
 *   DEMUCS_MODE=local      — everything local (fallback to Replicate on failure)
 *   DEMUCS_MODE=replicate  — everything paid (the old behavior)
 *   unset (default)        — measure/backfill=local, user-facing=replicate
 *
 * Every run logs wall-clock + estimated cash cost, and writes an AnalyticsEvent
 * 'stems.run' row so /admin/economics can show stems spend by mode (A3-6).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@afrohit/db';
import {
  separateStems,
  type StemAudioContentType,
  type StemAudioFormat,
  type StemAudioOutput,
  type StemSeparationResult,
} from '@afrohit/ai';
import { downloadToBuffer, resolveAssetForProvider, uploadBytes } from './storage';

const PYTHON = process.env.PYTHON_BIN ?? 'python3';
// Replicate demucs ≈ $0.10/track (T4, ~1-2 min). Local = electricity.
const REPLICATE_STEM_COST = 0.1;
const MAX_STEM_BYTES = 640 * 1024 * 1024;

export interface DetectedStemAudio {
  format: StemAudioFormat;
  contentType: StemAudioContentType;
}

/** Container signatures are authoritative; provider labels and URL suffixes are not. */
export function sniffStemAudio(bytes: Uint8Array): DetectedStemAudio {
  const ascii = (from: number, length: number) =>
    Buffer.from(bytes.subarray(from, from + length)).toString('ascii');
  if (
    bytes.byteLength >= 12 &&
    (ascii(0, 4) === 'RIFF' || ascii(0, 4) === 'RF64') &&
    ascii(8, 4) === 'WAVE'
  ) {
    return { format: 'wav', contentType: 'audio/wav' };
  }
  if (bytes.byteLength >= 4 && ascii(0, 4) === 'fLaC') {
    return { format: 'flac', contentType: 'audio/flac' };
  }
  if (
    (bytes.byteLength >= 3 && ascii(0, 3) === 'ID3') ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)
  ) {
    return { format: 'mp3', contentType: 'audio/mpeg' };
  }
  throw new Error('stem audio has an unsupported or unrecognized container');
}

/** Re-host a separator/provider stem under an extension and MIME derived from its bytes. */
export async function materializeStemAudio(opts: {
  workspaceId: string;
  stem: StemAudioOutput;
}): Promise<StemAudioOutput> {
  const bytes = await downloadToBuffer(opts.stem.url, { maxBytes: MAX_STEM_BYTES });
  const detected = sniffStemAudio(bytes);
  const url = await uploadBytes({
    workspaceId: opts.workspaceId,
    kind: 'stems',
    bytes,
    contentType: detected.contentType,
    ext: detected.format,
  });
  return { ...opts.stem, ...detected, url };
}

let _localCache: Promise<boolean> | null = null;
export function localDemucsAvailable(): Promise<boolean> {
  if (_localCache) return _localCache;
  _localCache = new Promise<boolean>((resolve) => {
    const p = spawn(PYTHON, ['-c', 'import demucs, torch']);
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(false); }, 20_000);
    p.on('error', () => { clearTimeout(timer); resolve(false); });
    p.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
  return _localCache;
}

async function logStemsRun(workspaceId: string | undefined, mode: string, purpose: string, wallMs: number, estCostUsd: number, ok: boolean) {
  console.log(`[stems] mode=${mode} purpose=${purpose} wall=${(wallMs / 1000).toFixed(1)}s est$=${estCostUsd.toFixed(3)} ok=${ok}`);
  if (!workspaceId) return;
  await prisma.analyticsEvent.create({
    data: { workspaceId, name: 'stems.run', properties: { mode, purpose, wallMs, estCostUsd, ok } as never },
  }).catch(() => undefined);
}

/** Run htdemucs locally; returns the SAME shape as the paid separateStems. */
export async function separateStemsLocal(opts: {
  audioUrl: string;
  mode?: 'instrumental' | 'full';
  workspaceId?: string;
}): Promise<StemSeparationResult> {
  const dir = await mkdtemp(join(tmpdir(), 'demucs-'));
  try {
    const src = join(dir, 'input.wav');
    await writeFile(src, await downloadToBuffer(opts.audioUrl));
    const args = ['-m', 'demucs', '-n', 'htdemucs', '-o', dir, '--filename', '{stem}.{ext}'];
    if (opts.mode === 'instrumental') args.push('--two-stems', 'vocals');
    args.push(src);
    await new Promise<void>((resolve, reject) => {
      // Cap math threads: htdemucs on torch grabs every core otherwise and
      // starves the render lane sharing this container.
      const p = spawn(PYTHON, args, { env: { ...process.env, OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' } });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString().slice(0, 4000)));
      p.on('error', reject);
      // CPU separation of a 3-min track ≈ 2-6 min on a modest box — cap at 20.
      const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('local demucs timed out (20 min)')); }, 20 * 60_000);
      p.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`demucs exit ${code}: ${err.slice(-300)}`));
      });
    });
    // Output lands in <dir>/htdemucs/<stem>.wav (per --filename).
    const outDir = join(dir, 'htdemucs');
    const files = await readdir(outDir);
    const stems: StemAudioOutput[] = [];
    for (const f of files) {
      if (!f.endsWith('.wav')) continue;
      const stemName = f.replace(/\.wav$/, '');
      // Match the paid contract: two-stems yields vocals + no_vocals; the lone
      // non-vocals stem IS the instrumental.
      const role = stemName === 'no_vocals' ? 'instrumental' : stemName;
      const bytes = await readFile(join(outDir, f));
      const url = await uploadBytes({
        workspaceId: opts.workspaceId ?? 'system',
        kind: 'stems',
        bytes,
        contentType: 'audio/wav',
        ext: 'wav',
      });
      stems.push({ role, url, format: 'wav', contentType: 'audio/wav' });
    }
    if (!stems.length) throw new Error('local demucs produced no stems');
    return { instrumentalUrl: stems.find((s) => s.role === 'instrumental')?.url, stems };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * THE ROUTER — one door for every stem separation. Purpose decides the default
 * mode; DEMUCS_MODE overrides; local failures fall back to the paid path so a
 * broken torch install can never kill a user request or a nightly walk.
 */
export interface RoutedStemSeparationOptions {
  audioUrl: string;
  apiKey?: string;
  mode?: 'instrumental' | 'full';
  purpose: 'measure' | 'user';
  workspaceId?: string;
  /** Run local htdemucs FIRST even for purpose:'user' (the paid path stays as
   * fallback). The TRUE INSTRUMENTAL path sets this: local keeps the split at
   * full WAV quality where the paid default re-encodes to mp3. DEMUCS_MODE=
   * replicate still overrides — operator config beats a caller preference. */
  preferLocal?: boolean;
}

export async function separateStemsRouted(
  opts: RoutedStemSeparationOptions,
): Promise<StemSeparationResult & { engine?: 'local' | 'replicate' }> {
  const configured = (process.env.DEMUCS_MODE ?? '').toLowerCase();
  const wantLocal =
    configured === 'local' ||
    (configured !== 'replicate' && (opts.purpose === 'measure' || opts.preferLocal === true));
  const started = Date.now();
  if (wantLocal && (await localDemucsAvailable())) {
    try {
      const res = await separateStemsLocal({
        audioUrl: opts.audioUrl,
        mode: opts.mode,
        workspaceId: opts.workspaceId,
      });
      await logStemsRun(opts.workspaceId, 'local', opts.purpose, Date.now() - started, 0, true);
      return { ...res, engine: 'local' };
    } catch (err) {
      console.warn('[stems] local demucs failed — falling back to the paid path:', (err as Error)?.message);
    }
  } else if (wantLocal) {
    console.warn('[stems] DEMUCS_MODE wants local but torch/demucs not importable in this image — paid path');
  }
  const paidStart = Date.now();
  try {
    const res = await separateStems({
      audioUrl: await resolveAssetForProvider(opts.audioUrl),
      apiKey: opts.apiKey,
      mode: opts.mode,
    });
    await logStemsRun(opts.workspaceId, 'replicate', opts.purpose, Date.now() - paidStart, REPLICATE_STEM_COST, true);
    return { ...res, engine: 'replicate' };
  } catch (error) {
    await logStemsRun(opts.workspaceId, 'replicate', opts.purpose, Date.now() - paidStart, REPLICATE_STEM_COST, false);
    throw error;
  }
}

type RoutedStemSeparator = (
  opts: RoutedStemSeparationOptions,
) => Promise<StemSeparationResult & { engine?: 'local' | 'replicate' }>;

export interface MusicStemResolution {
  stems: StemAudioOutput[];
  source: 'provider' | 'canonical-separation' | 'none';
}

/** Resolve the stem source before a music job can become terminal-successful. */
export async function resolveMusicStemSources(
  opts: {
    withStems: boolean;
    providerStems?: StemAudioOutput[];
    canonicalSourceUrl: string;
    apiKey?: string;
    workspaceId: string;
  },
  separate: RoutedStemSeparator = separateStemsRouted,
): Promise<MusicStemResolution> {
  if (opts.providerStems?.length) {
    return { stems: opts.providerStems, source: 'provider' };
  }
  if (!opts.withStems) return { stems: [], source: 'none' };

  const result = await separate({
    audioUrl: opts.canonicalSourceUrl,
    apiKey: opts.apiKey,
    mode: 'full',
    purpose: 'user',
    workspaceId: opts.workspaceId,
  });
  if (!result.stems.length) {
    throw new Error('music_generation_failed: stem separation returned no audio for the certified source');
  }
  return { stems: result.stems, source: 'canonical-separation' };
}

/** Final database postcondition for a music request that promised stems. */
export function enforceMusicStemPersistence(withStems: boolean, persistedStemCount: number): number {
  if (withStems && !(persistedStemCount > 0)) {
    throw new Error('music_generation_failed: requested stems were not persisted');
  }
  return persistedStemCount;
}
