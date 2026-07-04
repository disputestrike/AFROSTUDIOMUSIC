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
    await runFfmpeg([
      ...inputs,
      '-filter_complex', filter,
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

/**
 * Master a mix: two-pass style loudnorm in one pass (dynamic mode) to the
 * preset target, encode both WAV and MP3. Returns both.
 */
export async function master(opts: {
  mix: Buffer;
  preset: string;
}): Promise<{ wav: Buffer; mp3: Buffer }> {
  const target = MASTER_TARGETS[opts.preset] ?? MASTER_TARGETS['streaming_lufs_-14']!;
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-master-'));
  try {
    const inPath = join(dir, 'in.bin');
    const wavPath = join(dir, 'master.wav');
    const mp3Path = join(dir, 'master.mp3');
    await writeFile(inPath, opts.mix);
    const filter = masterChain(target);
    await runFfmpeg(['-i', inPath, '-af', filter, '-ar', '44100', '-ac', '2', wavPath]);
    await runFfmpeg(['-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '320k', mp3Path]);
    return { wav: await readFile(wavPath), mp3: await readFile(mp3Path) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
