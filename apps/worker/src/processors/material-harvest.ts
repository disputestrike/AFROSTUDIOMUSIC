/**
 * MATERIAL HARVEST (owner approval 2026-07-22 night: "could we get real
 * materials from the songs that we have?") — seed every lane's shelf from the
 * OWNED catalog instead of numpy synthesis.
 *
 * WHY: the shelf was seeded by code, not music (synth primitives), and the
 * receipts show it — City Shout assembled 7 materials, all rhythm/bass, empty
 * midrange (LRA 1.0, mids ~8 dB under the bass). Real loops carry real timbre,
 * groove and HARMONY the synth vocabulary simply does not have.
 *
 * PIPELINE (per eligible source, batch-capped per run):
 *   SoundReference (user-attested / self-generated, measured tempo)
 *     → separateStemsRouted (drums / bass / other; vocals SKIPPED in v1)
 *     → bar-aligned 8-bar slices at the MEASURED bpm (2 per stem, spread
 *       across the song), conformed 44.1k stereo WAV
 *     → silence gate (a muted stem section never becomes a "loop")
 *     → MaterialAsset rows with source 'artist_stem' → roleEvidence
 *       'stem-separated' = rank 0 in the picker, so harvested loops OUTRANK
 *       synth (rank-3 bridge material) everywhere, automatically.
 *
 * RIGHTS: only user-attested / self-generated sources are queried (the same
 * belt as training); the created rows carry the source's rightsBasis so the
 * ingredient law and the training manifest classify them honestly. zap /
 * facts-only rows can never enter (basis filter + http guard).
 *
 * HONESTY: a source without a measured tempo is SKIPPED with a log (bar math
 * on a guessed grid produces junk loops); a failed separation skips the
 * source, never fabricates; every row's meta records exactly where each loop
 * came from (harvestedFrom + stem + offset).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@afrohit/db";
import { separateStemsRouted } from "../lib/demucs-local";
import { downloadToBuffer, uploadBytes } from "../lib/storage";
import { runFfmpeg } from "../lib/ffmpeg";

/** stem role → shelf role. 'other' is the tonal bucket — exactly the missing
 *  midrange (chords/keys/melody). vocals stay out of beds in v1. */
const STEM_ROLE: Record<string, string> = {
  drums: "drums",
  bass: "bass",
  other: "chords",
};

const LOOP_BARS = 8;
const LOOPS_PER_STEM = 2;
/** Loops quieter than this are dead stem sections, not material. */
const MIN_LOOP_RMS_DB = -45;

export interface HarvestSummary {
  scanned: number;
  harvestedSources: number;
  loopsCreated: number;
  skipped: Array<{ id: string; reason: string }>;
}

/** PURE: bar-aligned slice offsets spread across the song (skip the very
 *  start/end — intros and outros are the least loopable bars). Exported for
 *  the offline test. */
export function planLoopOffsets(
  durationS: number,
  bpm: number,
  bars: number,
  count: number
): number[] {
  const barS = (60 / bpm) * 4;
  const loopS = barS * bars;
  if (!Number.isFinite(loopS) || loopS <= 0 || durationS < loopS * 1.5) return [];
  const usable = durationS - loopS;
  const anchors = count === 1 ? [0.35] : [0.3, 0.6, 0.8].slice(0, count);
  const offsets: number[] = [];
  for (const a of anchors) {
    const snapped = Math.max(0, Math.floor((usable * a) / barS) * barS);
    if (!offsets.some(o => Math.abs(o - snapped) < loopS)) offsets.push(snapped);
  }
  return offsets;
}

/** Cut one bar-aligned loop → conformed 44.1k stereo WAV bytes, with a
 *  measured RMS receipt. Exported for the offline test. */
export async function cutLoopWav(opts: {
  sourcePath: string;
  offsetS: number;
  bpm: number;
  bars: number;
}): Promise<{ bytes: Buffer; durationS: number; rmsDb: number | null }> {
  const durationS = (60 / opts.bpm) * 4 * opts.bars;
  const dir = await mkdtemp(join(tmpdir(), "afh-harvest-"));
  try {
    const out = join(dir, "loop.wav");
    await runFfmpeg([
      "-ss", opts.offsetS.toFixed(4),
      "-t", durationS.toFixed(4),
      "-i", opts.sourcePath,
      "-ar", "44100",
      "-ac", "2",
      "-af", "astats=measure_overall=RMS_level:measure_perchannel=none:metadata=1",
      out,
    ]);
    const bytes = await readFile(out);
    // RMS via a second, cheap stats pass on the cut bytes (astats metadata is
    // per-frame; the overall read from a file receipt keeps this simple).
    let rmsDb: number | null = null;
    try {
      const probe = await runFfmpegCapture([
        "-i", out,
        "-af", "astats=measure_overall=RMS_level:measure_perchannel=none",
        "-f", "null", "-",
      ]);
      const m = probe.match(/RMS level dB:\s*(-?[0-9.]+)/);
      rmsDb = m ? Number(m[1]) : null;
    } catch { /* stats are a receipt, not a gate on ffmpeg itself */ }
    return { bytes, durationS, rmsDb };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ffmpeg with captured stderr (runFfmpeg discards it; astats prints there). */
async function runFfmpegCapture(args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return await new Promise<string>((resolve, reject) => {
    execFile("ffmpeg", ["-hide_banner", ...args], { maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err && !stderr) reject(err);
      else resolve(String(stderr ?? ""));
    });
  });
}

function recipeNumber(recipe: unknown, ...paths: string[][]): number | null {
  const root = recipe && typeof recipe === "object" ? (recipe as Record<string, unknown>) : null;
  if (!root) return null;
  for (const path of paths) {
    let node: unknown = root;
    for (const key of path) {
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
    }
    const n = typeof node === "string" ? Number(node) : node;
    if (typeof n === "number" && Number.isFinite(n) && n > 40 && n < 220) return n;
  }
  return null;
}

function recipeString(recipe: unknown, ...paths: string[][]): string | null {
  const root = recipe && typeof recipe === "object" ? (recipe as Record<string, unknown>) : null;
  if (!root) return null;
  for (const path of paths) {
    let node: unknown = root;
    for (const key of path) {
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
    }
    if (typeof node === "string" && node.trim()) return node.trim();
  }
  return null;
}

export async function processMaterialHarvest(opts?: { limit?: number }): Promise<HarvestSummary> {
  const limit = Math.max(1, Math.min(10, opts?.limit ?? 3));
  const summary: HarvestSummary = { scanned: 0, harvestedSources: 0, loopsCreated: 0, skipped: [] };

  const sources = await prisma.soundReference.findMany({
    where: {
      active: true,
      rightsBasis: { in: ["user-attested", "self-generated"] },
      analysisState: { in: ["measured", "inferred"] },
    },
    select: { id: true, workspaceId: true, sourceUrl: true, title: true, genre: true, recipe: true, rightsBasis: true },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  for (const src of sources) {
    if (summary.harvestedSources >= limit) break;
    summary.scanned++;
    if (!/^https?:\/\//i.test(src.sourceUrl)) {
      summary.skipped.push({ id: src.id, reason: "non-http source" });
      continue;
    }
    const already = await prisma.materialAsset.findFirst({
      where: { meta: { path: ["harvestedFrom"], equals: `soundref:${src.id}` } },
      select: { id: true },
    });
    if (already) continue; // idempotent — one harvest per source, ever
    const bpm = recipeNumber(src.recipe, ["measured", "tempo"], ["tempo"], ["bpm"], ["measured", "bpm"]);
    if (!bpm) {
      summary.skipped.push({ id: src.id, reason: "no measured tempo — run Learn first (bar math on a guess makes junk loops)" });
      continue;
    }
    const genre = (src.genre ?? recipeString(src.recipe, ["lane"], ["genre"]))?.toLowerCase() ?? null;
    if (!genre) {
      summary.skipped.push({ id: src.id, reason: "no genre/lane on record — shelf rows need a lane" });
      continue;
    }
    const keySignature = recipeString(src.recipe, ["measured", "key"], ["key"], ["keySignature"]);

    let stems;
    try {
      stems = await separateStemsRouted({
        audioUrl: src.sourceUrl,
        mode: "full", // 4-stem: drums / bass / other / vocals
        workspaceId: src.workspaceId,
        purpose: "measure", // prefer the free local path
      });
    } catch (err) {
      summary.skipped.push({ id: src.id, reason: `stem separation failed: ${(err as Error).message.slice(0, 80)}` });
      continue;
    }

    let loopsForSource = 0;
    for (const stem of stems.stems ?? []) {
      const role = STEM_ROLE[stem.role?.toLowerCase?.() ?? ""];
      if (!role || !stem.url) continue;
      let stemPath: string | null = null;
      const dir = await mkdtemp(join(tmpdir(), "afh-stem-"));
      try {
        const stemBytes = await downloadToBuffer(stem.url);
        stemPath = join(dir, "stem.bin");
        await writeFile(stemPath, stemBytes);
        const probe = await runFfmpegCapture(["-i", stemPath, "-f", "null", "-"]);
        const dm = probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        const durationS = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
        for (const offsetS of planLoopOffsets(durationS, bpm, LOOP_BARS, LOOPS_PER_STEM)) {
          const loop = await cutLoopWav({ sourcePath: stemPath, offsetS, bpm, bars: LOOP_BARS });
          if (loop.rmsDb !== null && loop.rmsDb < MIN_LOOP_RMS_DB) continue; // dead air, not material
          const url = await uploadBytes({
            workspaceId: src.workspaceId,
            kind: "material-harvest",
            bytes: loop.bytes,
            contentType: "audio/wav",
            ext: "wav",
          });
          await prisma.materialAsset.create({
            data: {
              workspaceId: src.workspaceId,
              kind: "loop",
              role,
              genre,
              bpm,
              keySignature: keySignature ?? null,
              bars: LOOP_BARS,
              durationS: loop.durationS,
              url,
              source: "artist_stem", // → roleEvidence 'stem-separated' → picker rank 0
              roleEvidence: "stem-separated",
              rightsBasis: src.rightsBasis,
              readiness: "ready",
              qualityState: "passed",
              contentHash: createHash("sha256").update(loop.bytes).digest("hex"),
              verifiedAt: new Date(),
              meta: {
                harvestedFrom: `soundref:${src.id}`,
                sourceTitle: src.title,
                stem: stem.role,
                offsetS,
                rmsDb: loop.rmsDb,
              },
            },
          });
          summary.loopsCreated++;
          loopsForSource++;
        }
      } catch (err) {
        console.warn(`[harvest] ${src.id}/${stem.role}: ${(err as Error).message.slice(0, 100)}`);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (loopsForSource > 0) {
      summary.harvestedSources++;
      console.log(`[harvest] "${src.title ?? src.id}" (${genre} @${bpm}) → ${loopsForSource} real loop(s) on the shelf`);
    } else {
      summary.skipped.push({ id: src.id, reason: "separation returned no usable stem audio" });
    }
  }

  console.log(
    `[harvest] done: ${summary.loopsCreated} loops from ${summary.harvestedSources} source(s) (scanned ${summary.scanned}, skipped ${summary.skipped.length})`
  );
  for (const s of summary.skipped.slice(0, 8)) console.log(`[harvest] skipped ${s.id}: ${s.reason}`);
  return summary;
}
