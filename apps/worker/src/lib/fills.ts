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
}

/**
 * Build the `-filter_complex` graph: split the fill (input 1) into N copies, delay
 * each to its placement, mix them under the track (input 0), then peak-limit.
 * Returns null when there are no placements (caller skips the overlay entirely).
 */
export function buildFillFilterGraph(placements: number[], opts?: FillOverlayOpts): string | null {
  const pts = placements.filter((t) => Number.isFinite(t) && t >= 0);
  if (!pts.length) return null;
  const gain = Math.max(0, Math.min(1, opts?.fillGain ?? 0.5));
  const limit = Math.max(0.1, Math.min(1, opts?.limit ?? 0.97));
  const n = pts.length;
  const labels = Array.from({ length: n }, (_, i) => `[f${i}]`).join('');
  const parts = [`[1:a]volume=${gain},asplit=${n}${labels}`];
  const delayed: string[] = [];
  pts.forEach((t, i) => {
    const ms = Math.round(t * 1000);
    parts.push(`[f${i}]adelay=${ms}|${ms}[d${i}]`);
    delayed.push(`[d${i}]`);
  });
  parts.push(`[0:a]${delayed.join('')}amix=inputs=${n + 1}:normalize=0:duration=first[mix]`);
  parts.push(`[mix]alimiter=limit=${limit}[out]`);
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
      const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', songPath, '-i', fillPath, '-filter_complex', graph, '-map', '[out]', outPath]);
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
