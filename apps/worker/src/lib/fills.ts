/**
 * PHASE 5 — fill insertion. Lays a drum-fill sample into a rendered take at the
 * placement points from planFills (one bar before each section). The fill is mixed
 * UNDER the track at a moderate gain so it accents the transition, never overwhelms
 * it, and the result is peak-limited so nothing clips.
 *
 * The ffmpeg filter graph is built by a PURE function (buildFillFilterGraph) so the
 * command logic is unit-testable without executing ffmpeg or needing audio.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FillOverlayOpts {
  /** Level of the fill relative to the track (0–1). Keep subtle so it accents. */
  fillGain?: number;
  /** Ceiling for the peak limiter (0–1). */
  limit?: number;
  /**
   * Target-grid tempo. When present, the fill input is trimmed to exactly ONE
   * bar ((60/bpm)*4 s) inside the filtergraph BEFORE the delays — a fill is a
   * one-bar transition accent by definition (planFills places it one bar before
   * each boundary). Without the trim, an 8-bar forged fill sample kept playing
   * 7 bars PAST every section boundary at -6 dB, smearing every transition (the
   * "scattered" diagnosis, 2026-07). Optional for back-compat: absent → the old
   * untrimmed behavior, so existing callers/tests are unchanged until wired.
   */
  bpm?: number;
  /**
   * TRANSITION DUCK (SOUNDWAVE2 — "the beat is not Afrobeats"): dB to duck the
   * FULL BAND during each fill bar so the transition is finally AUDIBLE (the
   * old 0.5-gain fill under the un-ducked band was half-buried at every
   * boundary). Requires bpm (the duck window is exactly the fill's one bar).
   * Deterministic timeline volume automation — no sidechain latency, replays
   * byte-identical. Optional for back-compat: absent → no duck (old graph).
   */
  duckDb?: number;
}

/** The owner-audible transition doctrine: fill at 0.8 rides OVER a band ducked
 *  4 dB for exactly the fill bar. Exported so the assembler and the gate suite
 *  share one truth. */
export const FILL_TRANSITION_GAIN = 0.8;
export const FILL_BAND_DUCK_DB = 4;

/**
 * Build the `-filter_complex` graph: (optionally) trim the fill (input 1) to one
 * bar, split it into N copies, delay each to its placement, mix them under the
 * track (input 0), then peak-limit.
 * Returns null when there are no placements (caller skips the overlay entirely).
 */
export function buildFillFilterGraph(placements: number[], opts?: FillOverlayOpts): string | null {
  const pts = placements.filter((t) => Number.isFinite(t) && t >= 0);
  if (!pts.length) return null;
  const gain = Math.max(0, Math.min(1, opts?.fillGain ?? 0.5));
  // -1 dB ceiling, same as the assembly bus — NOT 0.97, which left no true-peak
  // headroom and tripped the QC clipping gate.
  const limit = Math.max(0.1, Math.min(1, opts?.limit ?? 0.891));
  // ONE-BAR LAW (see FillOverlayOpts.bpm): atrim to a single bar at the target
  // tempo, with a 15 ms declick fade-out so the cut never pops (same edge
  // treatment trimToLoop uses).
  const bpm = Number.isFinite(opts?.bpm) && (opts!.bpm as number) > 0 ? (opts!.bpm as number) : null;
  const barS = bpm ? (60 / bpm) * 4 : null;
  const trim = barS
    ? `atrim=0:${barS.toFixed(3)},afade=t=out:st=${Math.max(0, barS - 0.015).toFixed(3)}:d=0.015,`
    : '';
  const n = pts.length;
  const labels = Array.from({ length: n }, (_, i) => `[f${i}]`).join('');
  const parts = [`[1:a]${trim}volume=${gain},asplit=${n}${labels}`];
  const delayed: string[] = [];
  pts.forEach((t, i) => {
    const ms = Math.round(t * 1000);
    parts.push(`[f${i}]adelay=${ms}|${ms}[d${i}]`);
    delayed.push(`[d${i}]`);
  });
  // TRANSITION DUCK (see FillOverlayOpts.duckDb): one timeline-enabled volume
  // stage per fill bar drops the band by duckDb for exactly [atS, atS+bar] —
  // the fill reads, the band breathes, the downbeat slams back at unity.
  const duckDb = Number.isFinite(opts?.duckDb) && (opts!.duckDb as number) > 0 ? (opts!.duckDb as number) : null;
  let trackPad = '[0:a]';
  if (duckDb && barS) {
    const stages = pts
      .map((t) => `volume=${Math.pow(10, -duckDb / 20).toFixed(4)}:enable='between(t,${t.toFixed(3)},${(t + barS).toFixed(3)})'`)
      .join(',');
    parts.push(`[0:a]${stages}[trk]`);
    trackPad = '[trk]';
  }
  parts.push(`${trackPad}${delayed.join('')}amix=inputs=${n + 1}:normalize=0:duration=first[mix]`);
  // level=false is LOAD-BEARING: alimiter defaults level=true, which AUTO-BOOSTS
  // the output up to the ceiling — it re-normalized every fill-overlaid take to
  // -0.26 dB, defeating the assembly bus's -1 dB headroom AND the ×0.6 clipping
  // retry (the boost undid the trim), so dense takes failed QC twice and the
  // whole own-engine render died ("grid assembly failed", hit live 2026-07-12).
  parts.push(`[mix]alimiter=level=false:limit=${limit}:attack=2:release=80[out]`);
  return parts.join(';');
}

/**
 * Overlay `fill` onto `song` at the given times → returns the new audio bytes.
 * Best-effort: on any ffmpeg failure the caller should keep the original take.
 */
export async function overlayFills(song: Buffer, fill: Buffer, placements: number[], opts?: FillOverlayOpts): Promise<Buffer> {
  const graph = buildFillFilterGraph(placements, opts);
  if (!graph) return song; // nothing to place
  const dir = await mkdtemp(join(tmpdir(), 'afrohit-fills-'));
  const songPath = join(dir, 'song.wav');
  const fillPath = join(dir, 'fill.wav');
  const outPath = join(dir, 'out.wav');
  try {
    await writeFile(songPath, song);
    await writeFile(fillPath, fill);
    await new Promise<void>((resolve, reject) => {
      // 44.1kHz STEREO GUARANTEE (African-singing wave item 4): pin the output to
      // 44.1k/stereo so a fill overlay — the one pre-master mutation on the
      // ACE-Step path — can never silently downgrade the render's sample rate or
      // fold it to mono before mastering/delivery. Config only (output-stage
      // resample/upmix), never a DSP change to the fill graph itself; identity
      // for the common 44.1k stereo source.
      const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', songPath, '-i', fillPath, '-filter_complex', graph, '-map', '[out]', '-ar', '44100', '-ac', '2', outPath]);
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('error', (e) => reject(new Error(`ffmpeg spawn failed: ${e.message}`)));
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 300)}`))));
    });
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
