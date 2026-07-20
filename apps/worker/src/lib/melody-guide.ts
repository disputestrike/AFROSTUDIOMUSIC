/**
 * MELODY GUIDE — AUDIBLE EVIDENCE for the Melody Brain (Own Singer piece 3).
 *
 * Renders a composed MelodyScore as a mono 44.1k WAV: one sine segment per
 * note (freq = 440·2^((midi-69)/12), duration from durBeats at the score's
 * bpm), 10ms fade in/out per note so segments never click, silence segments
 * for the gaps/breaths, everything concat'd on ONE ffmpeg pass. Same spawn
 * doctrine as lib/ffmpeg.ts (runFfmpeg) — the filtergraph goes through
 * -filter_complex_script so a full song's worth of notes never hits an argv
 * length ceiling. This is a GUIDE (for the ear and, later, the trained voice
 * to follow), not a master — no EQ, no loudness chain, just the melody.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MelodyScore } from '@afrohit/shared';
import { runFfmpeg } from './ffmpeg';

const SR = 44100;
const GAIN = 0.32; // sine level — audible, never hot
const FADE = 0.01; // 10ms declick per note edge

/** freq for a midi note — equal temperament, A4 = 440. */
const freqOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Flatten the score onto one absolute timeline (sections are back-to-back at
 * bar boundaries) and emit [silence|note] segments covering it end to end.
 */
export function melodyGuideSegments(score: MelodyScore): Array<{ kind: 'note' | 'gap'; durS: number; freq?: number }> {
  const spb = 60 / Math.max(1, score.bpm); // seconds per beat
  const segs: Array<{ kind: 'note' | 'gap'; durS: number; freq?: number }> = [];
  let cursorS = 0;
  let sectionOffsetBeats = 0;
  for (const sec of score.sections) {
    for (const n of sec.notes) {
      let startS = (sectionOffsetBeats + n.startBeat) * spb;
      let durS = n.durBeats * spb;
      if (startS < cursorS) {
        // defensive: a (theoretical) overlap trims the tail, never doubles audio
        durS -= cursorS - startS;
        startS = cursorS;
      }
      if (durS < 0.03) continue; // too short to fade cleanly — inaudible anyway
      if (startS > cursorS + 1e-4) segs.push({ kind: 'gap', durS: startS - cursorS });
      segs.push({ kind: 'note', durS, freq: freqOf(n.midi) });
      cursorS = startS + durS;
    }
    sectionOffsetBeats += sec.bars * 4;
  }
  const endS = sectionOffsetBeats * spb;
  if (endS > cursorS + 1e-4) segs.push({ kind: 'gap', durS: endS - cursorS }); // ring out the last bars
  return segs;
}

/**
 * LEAD VOICE (SOUNDCORE item 1): a MUSICAL lead timbre per lane — additive
 * harmonics + a plucked/sustained amplitude envelope, NOT a bare sine. This is
 * what turns the composed melodyScore from a separate guide WAV into an audible
 * TOPLINE mixed into the full-length bed. Every parameter is a pure function of
 * the note (freq/time), so a seeded score renders byte-identical on replay.
 */
export interface LeadVoice {
  /** Human-readable name for the render note / beat meta. */
  name: string;
  /** Partials as [frequency multiple, gain]; partial 1 is the fundamental. */
  partials: Array<[number, number]>;
  /** Amplitude-envelope attack (s) — the ramp up before decay. */
  attackS: number;
  /** Exponential decay rate (1/s) — higher = pluckier, lower = sustained. */
  decay: number;
  /** Overall voice gain before the per-note declick. Kept so the summed partials
   *  never clip inside the WAV (the mix bus limiter is the final safety net). */
  gain: number;
}

const EP_VOICE: LeadVoice = {
  name: "electric piano",
  partials: [[1, 1], [2, 0.42], [3, 0.16]],
  attackS: 0.006,
  decay: 3.0,
  gain: 0.34,
};
const GUITAR_VOICE: LeadVoice = {
  name: "guitar",
  partials: [[1, 1], [2, 0.55], [3, 0.28]],
  attackS: 0.004,
  decay: 3.6,
  gain: 0.32,
};
const KALIMBA_VOICE: LeadVoice = {
  // Kalimba's 2nd partial is famously inharmonic (~2.75×) — that shimmer is the
  // instrument's fingerprint.
  name: "kalimba",
  partials: [[1, 1], [2.76, 0.34]],
  attackS: 0.002,
  decay: 5.0,
  gain: 0.36,
};
const SYNTH_LEAD_VOICE: LeadVoice = {
  name: "synth lead",
  partials: [[1, 1], [2, 0.5]],
  attackS: 0.02,
  decay: 0.9,
  gain: 0.32,
};

/** Deterministic lane → lead voice. Coarse canonicalization (lowercase) so
 *  'Afrobeats'/'afrobeats' agree; unknown lanes get the electric piano (the
 *  safest, most broadly musical topline). */
export function leadVoiceFor(genre: string): LeadVoice {
  const g = (genre ?? "").toLowerCase();
  if (/(amapiano|afro_?house|gqom|3[\s_-]?step|afro_?tech)/.test(g)) return SYNTH_LEAD_VOICE;
  if (/(highlife|palm[\s_-]?wine|afro_?fusion|soukous|juju|benga)/.test(g)) return GUITAR_VOICE;
  if (/(afro_?gospel|praise|worship|spiritual|afro_?soul)/.test(g)) return EP_VOICE;
  if (/(afrobeat|afro_?pop|street_?pop|afro_?rnb|afro_?r&b|alte)/.test(g)) return EP_VOICE;
  if (/(bongo|singeli|kwaito|kizomba|traditional)/.test(g)) return KALIMBA_VOICE;
  return EP_VOICE;
}

/** aevalsrc expression for ONE note at `freq` with voice `v`: additive partials
 *  under an attack→exponential-decay envelope. Kept inside ffmpeg (no PCM math in
 *  JS) so it is deterministic and streams through -filter_complex_script. */
function leadNoteExpr(freq: number, v: LeadVoice): string {
  const env = `min(1,t/${v.attackS.toFixed(4)})*exp(-${v.decay.toFixed(3)}*t)`;
  const tone = v.partials
    .map(([mult, g]) => `${g.toFixed(3)}*sin(2*PI*${(freq * mult).toFixed(3)}*t)`)
    .join("+");
  return `${v.gain.toFixed(3)}*(${env})*(${tone})`;
}

/**
 * Render the composed score as an audible LEAD (mono 44.1k WAV) in the lane's
 * voice. Same segment flattening + one-pass concat doctrine as renderMelodyGuide,
 * but each note is a rich timbre with a musical envelope instead of a flat sine —
 * this is the buffer own-engine MIXES INTO THE BED as the topline. Throws when
 * ffmpeg is absent or the score has no notes → callers fail open (no lead, note).
 */
export async function renderMelodyLead(
  score: MelodyScore,
  opts: { genre: string }
): Promise<Buffer> {
  const voice = leadVoiceFor(opts.genre);
  const segs = melodyGuideSegments(score);
  if (!segs.length) throw new Error("melody lead: score has no renderable notes");
  const dir = await mkdtemp(join(tmpdir(), "melody-lead-"));
  try {
    const chains: string[] = [];
    const labels: string[] = [];
    segs.forEach((s, i) => {
      const d = s.durS.toFixed(4);
      if (s.kind === "gap") {
        chains.push(`aevalsrc=exprs=0:s=${SR}:d=${d}[s${i}]`);
      } else {
        const fadeOutSt = Math.max(0, s.durS - FADE).toFixed(4);
        chains.push(
          `aevalsrc=exprs='${leadNoteExpr(s.freq!, voice)}':s=${SR}:d=${d},afade=t=in:d=${FADE},afade=t=out:st=${fadeOutSt}:d=${FADE}[s${i}]`
        );
      }
      labels.push(`[s${i}]`);
    });
    const graph =
      segs.length === 1
        ? chains[0]!.replace(/\[s0\]$/, "[out]")
        : `${chains.join(";")};${labels.join("")}concat=n=${segs.length}:v=0:a=1[out]`;
    const scriptPath = join(dir, "graph.txt");
    const outPath = join(dir, "lead.wav");
    await writeFile(scriptPath, graph);
    await runFfmpeg(["-filter_complex_script", scriptPath, "-map", "[out]", "-ar", String(SR), "-ac", "1", outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Synthesize the melody guide WAV (mono, 44100). Throws when ffmpeg is absent — callers fail open. */
export async function renderMelodyGuide(score: MelodyScore): Promise<Buffer> {
  const segs = melodyGuideSegments(score);
  if (!segs.length) throw new Error('melody guide: score has no renderable notes');
  const dir = await mkdtemp(join(tmpdir(), 'melody-guide-'));
  try {
    const chains: string[] = [];
    const labels: string[] = [];
    segs.forEach((s, i) => {
      const d = s.durS.toFixed(4);
      if (s.kind === 'gap') {
        chains.push(`aevalsrc=exprs=0:s=${SR}:d=${d}[s${i}]`);
      } else {
        const fadeOutSt = Math.max(0, s.durS - FADE).toFixed(4);
        chains.push(
          `aevalsrc=exprs='${GAIN}*sin(2*PI*${s.freq!.toFixed(3)}*t)':s=${SR}:d=${d},afade=t=in:d=${FADE},afade=t=out:st=${fadeOutSt}:d=${FADE}[s${i}]`
        );
      }
      labels.push(`[s${i}]`);
    });
    const graph =
      segs.length === 1
        ? chains[0]!.replace(/\[s0\]$/, '[out]')
        : `${chains.join(';')};${labels.join('')}concat=n=${segs.length}:v=0:a=1[out]`;
    const scriptPath = join(dir, 'graph.txt');
    const outPath = join(dir, 'guide.wav');
    await writeFile(scriptPath, graph);
    await runFfmpeg(['-filter_complex_script', scriptPath, '-map', '[out]', '-ar', String(SR), '-ac', '1', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
