/**
 * FFmpeg helpers — spawn the system ffmpeg binary directly (no wrapper dep).
 * Railway worker image includes ffmpeg via nixpacks (see apps/worker/railway.json).
 * Locally, install ffmpeg or mixes/masters will fail with a clear error.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 500)}`))
    );
  });
}

/**
 * Read the real duration (seconds) of an audio file or URL via ffprobe.
 * Providers that stream results back through a poll (MiniMax, Suno) can't
 * report duration up front, so we probe the rendered file. Returns 0 on any
 * failure — callers treat 0 as "unknown", never crash on it.
 */
export async function probeDurationS(input: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      input,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(0));
    p.on('exit', () => {
      const s = Math.round(parseFloat(out.trim()));
      resolve(Number.isFinite(s) && s > 0 ? s : 0);
    });
  });
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

/** Run ffmpeg capturing stderr (where filter summaries print). Never throws. */
function ffmpegCapture(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', () => resolve(err));
    p.on('exit', () => resolve(err));
  });
}

const numAfter = (s: string, re: RegExp): number | null => {
  const m = s.match(re);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
};

/**
 * Measure the ACTUAL quality of a rendered track — fast, free, deterministic
 * (one ffmpeg pass, reads http URLs directly, no re-download). This is the first
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
export async function measureAudioQuality(input: string): Promise<AudioQuality> {
  const durationS = await probeDurationS(input);
  const fallback = (): AudioQuality => ({
    durationS,
    integratedLufs: null, loudnessRangeLra: null, truePeakDb: null, crestFactorDb: null, flatFactor: null,
    flags: [], verdict: durationS >= 12 ? 'pass' : 'fail', ok: durationS >= 12,
  });
  try {
    if (!(await ffmpegAvailable())) return fallback();
    // ebur128 → loudness/LRA/true-peak summary; astats → crest/flat factor. One pass.
    const out = await ffmpegCapture([
      '-i', input,
      '-af', 'ebur128=peak=true,astats=metadata=0',
      '-f', 'null', '-',
    ]);
    // ebur128 prints a Summary block at the end with "I:", "LRA:", "Peak:".
    // CRITICAL: ebur128 prints PER-FRAME "I:"/"LRA:" lines throughout playback —
    // and those start near -70 LUFS / 0 LU before they accumulate. The REAL values
    // are in the final "Summary:" block. Parse ONLY the summary; if there is NO
    // summary (partial/errored decode — ffmpegCapture doesn't check exit code),
    // treat ebur128 metrics as unavailable rather than reading a bogus first frame.
    const summaryIdx = out.lastIndexOf('Summary:');
    const hasSummary = summaryIdx >= 0;
    const summary = hasSummary ? out.slice(summaryIdx) : '';
    const integratedLufs = hasSummary ? numAfter(summary, /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/) : null;
    const loudnessRangeLra = hasSummary ? numAfter(summary, /LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/) : null;
    // ebur128's summary prints both "Sample peak" and "True peak" as "Peak: X dBFS"
    // — take the highest so clipping detection uses the true (inter-sample) peak.
    const peaks = hasSummary
      ? [...summary.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].map((m) => parseFloat(m[1]!)).filter((n) => Number.isFinite(n))
      : [];
    const truePeakDb = peaks.length ? Math.max(...peaks) : null;
    // astats prints per-channel blocks first, then the pooled "Overall" block LAST.
    // Read crest/flat from the Overall slice so a STEREO master isn't judged by one
    // channel (else a hard-panned / low-crest channel false-flags a fine mix).
    const overallIdx = out.lastIndexOf('Overall');
    const astatsOverall = overallIdx >= 0 ? out.slice(overallIdx) : out;
    // Crest factor (dB) = Peak - RMS. Derive it from the Overall block's "Peak
    // level dB" / "RMS level dB" (both ALWAYS present there) instead of astats'
    // own "Crest factor:" line — that line is per-channel-only in some ffmpeg
    // builds and prints "inf" on silence, so live QC read it back as null.
    const peakLevelDb = numAfter(astatsOverall, /Peak level dB:\s*(-?\d+(?:\.\d+)?)/);
    const rmsLevelDb = numAfter(astatsOverall, /RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
    const crestFactorDb = peakLevelDb !== null && rmsLevelDb !== null ? Math.round((peakLevelDb - rmsLevelDb) * 10) / 10 : null;
    const flatFactor = numAfter(astatsOverall, /Flat factor:\s*(-?\d+(?:\.\d+)?)/);

    const flags: string[] = [];
    if (integratedLufs !== null && integratedLufs < -23) flags.push('too_quiet');
    if (truePeakDb !== null && truePeakDb > 0.5) flags.push('clipping');
    // Low dynamic movement = the "flat / no depth / same-y" complaint, measured.
    // BUT a loud, heavily-limited master (e.g. -9 LUFS club/cd) legitimately has a
    // low LRA — only flag "flat" when the track isn't simply loud-mastered.
    const loudMaster = integratedLufs !== null && integratedLufs > -11;
    if (loudnessRangeLra !== null && loudnessRangeLra < 3 && !loudMaster) flags.push('flat');
    if (crestFactorDb !== null && crestFactorDb < 6) flags.push('squashed');
    if (durationS > 0 && durationS < 20) flags.push('short');

    // durationS === 0 means UNKNOWN (poll-streamed providers ffprobe can't read up
    // front), NOT "too short" — don't hard-fail a clean render on unknown duration.
    const hard = flags.some((f) => f === 'too_quiet' || f === 'clipping') || (durationS > 0 && durationS < 8);
    const soft = flags.some((f) => f === 'flat' || f === 'squashed');
    const verdict: AudioQuality['verdict'] = hard ? 'fail' : soft ? 'weak' : 'pass';
    // If we couldn't read a single metric, don't pretend — fall back to duration.
    if (integratedLufs === null && loudnessRangeLra === null && crestFactorDb === null) return fallback();
    return { durationS, integratedLufs, loudnessRangeLra, truePeakDb, crestFactorDb, flatFactor, flags, verdict, ok: verdict !== 'fail' };
  } catch {
    return fallback();
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
        chains.push(`[${i}:a]aformat=channel_layouts=stereo,atempo=${ratio.toFixed(4)},volume=${l.gain.toFixed(2)}[l${i}]`);
        labels.push(`[l${i}]`);
      });
      const outPath = join(dir, `sec${s}.wav`);
      const filter =
        active.length === 1
          ? `${chains[0]!.replace(/\[l0\]$/, '[out]')}`
          : `${chains.join(';')};${labels.join('')}amix=inputs=${active.length}:duration=longest:normalize=0[out]`;
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
  'streaming_lufs_-14': { lufs: -14, tp: -1.0 },
  // Competitive Afrobeats/Afropop delivery — loud like commercial records
  // (~-8 to -10 LUFS) but a -1.0 dBTP ceiling so it stays safe on lossy transcode
  // (unlike club_-9's -0.3). This is the auto-master target for FINISHED engines.
  'afro_stream_-9': { lufs: -9, tp: -1.0 },
  'club_-9': { lufs: -9, tp: -0.3 },
  'reels_-16': { lufs: -16, tp: -1.0 },
  'cd_-9': { lufs: -9, tp: -0.3 },
};

/**
 * Automated mastering chain — the pieces a mastering engineer reaches for first,
 * applied conservatively so it flatters most Afro/Afro-fusion material without
 * mangling it:
 *   1. subsonic high-pass (kill rumble that steals headroom)
 *   2. gentle tonal shaping — low warmth, vocal presence, top-end air
 *   3. glue bus compression (2:1, slow) to round the whole thing together
 *   4. loudnorm to the preset LUFS + true-peak target (loudness maximisation)
 *   5. true-peak brickwall limiter as a hard ceiling so nothing clips on export
 * It is a strong, release-ready loudness master — not a replacement for a human
 * mastering engineer on a flagship single.
 */
export function masterChain(target: { lufs: number; tp: number }): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4); // dBTP → linear amplitude
  return [
    'highpass=f=28',
    'bass=g=1.2:f=110', // low-end warmth
    'equalizer=f=3000:width_type=q:width=1.5:g=1', // vocal/lead presence
    'treble=g=1.8:f=9000', // air
    'acompressor=threshold=-16dB:ratio=2:attack=20:release=200:makeup=1.5', // glue
    `loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=11`,
    `alimiter=level=false:limit=${tpLinear}`, // true-peak brickwall ceiling
  ].join(',');
}

/**
 * Light-touch CONFORM for engines that already hand back a FINISHED, loudness-
 * maximised master (MiniMax/Suno). It only conforms loudness to target and puts a
 * true-peak ceiling on the inter-sample overshoot these models ship with — NO EQ
 * and NO glue compression, because re-EQing + re-compressing an already-balanced,
 * already-limited master ("mastering a master") recolours it and dulls the
 * transients. LRA is set high so loudnorm does NOT compress the engine's own
 * dynamics — we're taming the +1 dBTP peak and matching loudness, nothing else.
 */
export function conformChain(target: { lufs: number; tp: number }): string {
  const tpLinear = Math.pow(10, target.tp / 20).toFixed(4);
  return [
    `loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=20`,
    `alimiter=level=false:limit=${tpLinear}`, // true-peak ceiling on the provider's hot render
  ].join(',');
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
 * Master a mix: two-pass style loudnorm in one pass (dynamic mode) to the
 * preset target, encode both WAV and MP3. Returns both.
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
  const target = MASTER_TARGETS[opts.preset] ?? MASTER_TARGETS['streaming_lufs_-14']!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-master-'));
  try {
    const inPath = join(dir, 'in.bin');
    const wavPath = join(dir, 'master.wav');
    const mp3Path = join(dir, 'master.mp3');
    await writeFile(inPath, opts.mix);
    const filter = opts.finished ? conformChain(target) : masterChain(target);
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
