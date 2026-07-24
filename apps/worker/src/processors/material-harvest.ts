/**
 * Rebuild AfroOne's material shelf from the rights-clean song catalog.
 *
 * The source songs and their audio are immutable inputs here. This processor
 * only separates eligible song audio, cuts bar-aligned loops, and creates
 * derived MaterialAsset rows with exact song and asset lineage.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@afrohit/db";
import { separateStemsRouted } from "../lib/demucs-local";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  uploadBytes,
} from "../lib/storage";
import { runFfmpeg } from "../lib/ffmpeg";

const STEM_ROLE: Record<string, string> = {
  drums: "drums",
  bass: "bass",
  other: "chords",
};

const LOOP_BARS = 8;
const LOOPS_PER_STEM = 2;
const MIN_LOOP_RMS_DB = -45;
const CLEAN_RIGHTS_BASES = new Set([
  "code-generated",
  "self-generated",
  "user-attested",
  "licensed",
]);
const OWN_BEAT_PROVIDERS = new Set(["afrohit-own", "material"]);
const UPLOAD_BEAT_PROVIDERS = new Set([
  "upload",
  "import",
  "artist_upload",
]);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface SongHarvestCandidateInput {
  songId: string;
  workspaceId: string;
  title: string;
  genre: string | null;
  projectBpm: number | null;
  projectKeySignature: string | null;
  beat: {
    id: string;
    url: string;
    provider: string;
    bpm: number | null;
    keySignature: string | null;
    qualityState: string;
    meta: unknown;
  };
}

export interface SongHarvestCandidate {
  songId: string;
  workspaceId: string;
  title: string;
  genre: string;
  bpm: number;
  keySignature: string | null;
  assetId: string;
  assetKind: "beat";
  url: string;
  source: "artist_stem" | "self_stem";
  rightsBasis: "user-attested" | "self-generated";
  marker: string;
}

export type SongHarvestCandidateDecision =
  | { accepted: true; candidate: SongHarvestCandidate }
  | { accepted: false; reason: string };

/**
 * Accept artist-owned upload/import audio. AfroOne/material renders are
 * accepted only when every assembled ingredient has clean rights and any
 * melody layer was produced locally. Opaque or provider-derived audio fails
 * closed and cannot enter the material or training corpus.
 */
export function classifySongHarvestCandidate(
  input: SongHarvestCandidateInput
): SongHarvestCandidateDecision {
  const { beat } = input;
  if (!input.songId) return { accepted: false, reason: "missing song id" };
  if (!beat.url) return { accepted: false, reason: "missing playable audio" };
  if (beat.qualityState === "failed")
    return { accepted: false, reason: "audio quality failed" };

  const genre = input.genre?.trim().toLowerCase();
  if (!genre) return { accepted: false, reason: "missing song genre" };
  const bpm = beat.bpm ?? input.projectBpm;
  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 220)
    return { accepted: false, reason: "missing measured song tempo" };

  const provider = beat.provider.trim().toLowerCase();
  const marker = `song:${input.songId}:beat:${beat.id}`;
  const meta = objectValue(beat.meta);
  const base = {
    songId: input.songId,
    workspaceId: input.workspaceId,
    title: input.title,
    genre,
    bpm,
    keySignature: beat.keySignature ?? input.projectKeySignature,
    assetId: beat.id,
    assetKind: "beat" as const,
    url: beat.url,
    marker,
  };

  if (UPLOAD_BEAT_PROVIDERS.has(provider)) {
    const sourceMeta = objectValue(meta.sourceMeta);
    const attested =
      meta.rightsBasis === "user-attested" ||
      sourceMeta.rightsBasis === "user-attested";
    if (!attested) {
      return {
        accepted: false,
        reason: "upload/import has no explicit user-attested rights receipt",
      };
    }
    return {
      accepted: true,
      candidate: {
        ...base,
        source: "artist_stem",
        rightsBasis: "user-attested",
      },
    };
  }
  if (!OWN_BEAT_PROVIDERS.has(provider)) {
    return {
      accepted: false,
      reason: `provider ${provider || "unknown"} is not a rights-clean song source`,
    };
  }

  const assemblyLog = Array.isArray(meta.assemblyLog) ? meta.assemblyLog : [];
  if (!assemblyLog.length) {
    return {
      accepted: false,
      reason: "own render has no complete ingredient receipt",
    };
  }
  const badIngredient = assemblyLog.find(entry => {
    const rightsBasis = String(objectValue(entry).rightsBasis ?? "")
      .trim()
      .toLowerCase();
    return !CLEAN_RIGHTS_BASES.has(rightsBasis);
  });
  if (badIngredient) {
    return {
      accepted: false,
      reason: `ingredient rights ${String(
        objectValue(badIngredient).rightsBasis ?? "unknown"
      )} are not training-safe`,
    };
  }

  const melodyLayer = objectValue(meta.melodyLayer);
  const melodyEngine = String(melodyLayer.engine ?? "").trim().toLowerCase();
  if (
    melodyEngine &&
    !["afroone", "local", "score-synth", "code-generated"].includes(
      melodyEngine
    )
  ) {
    return {
      accepted: false,
      reason: `third-party melody layer ${melodyEngine} is not training-safe`,
    };
  }

  return {
    accepted: true,
    candidate: {
      ...base,
      source: "self_stem",
      rightsBasis: "self-generated",
    },
  };
}

export interface HarvestSummary {
  scanned: number;
  harvestedSources: number;
  loopsCreated: number;
  skipped: Array<{ id: string; reason: string }>;
}

export function planLoopOffsets(
  durationS: number,
  bpm: number,
  bars: number,
  count: number
): number[] {
  const barS = (60 / bpm) * 4;
  const loopS = barS * bars;
  if (!Number.isFinite(loopS) || loopS <= 0 || durationS < loopS * 1.5)
    return [];
  const usable = durationS - loopS;
  const anchors = count === 1 ? [0.35] : [0.3, 0.6, 0.8].slice(0, count);
  const offsets: number[] = [];
  for (const anchor of anchors) {
    const snapped = Math.max(
      0,
      Math.floor((usable * anchor) / barS) * barS
    );
    if (!offsets.some(offset => Math.abs(offset - snapped) < loopS))
      offsets.push(snapped);
  }
  return offsets;
}

async function runFfmpegCapture(args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", ...args],
      { maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error && !stderr) reject(error);
        else resolve(String(stderr ?? ""));
      }
    );
  });
}

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
      "-ss",
      opts.offsetS.toFixed(4),
      "-t",
      durationS.toFixed(4),
      "-i",
      opts.sourcePath,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-af",
      "astats=measure_overall=RMS_level:measure_perchannel=none:metadata=1",
      out,
    ]);
    const bytes = await readFile(out);
    let rmsDb: number | null = null;
    try {
      const probe = await runFfmpegCapture([
        "-i",
        out,
        "-af",
        "astats=measure_overall=RMS_level:measure_perchannel=none",
        "-f",
        "null",
        "-",
      ]);
      const match = probe.match(/RMS level dB:\s*(-?[0-9.]+)/);
      rmsDb = match ? Number(match[1]) : null;
    } catch {
      // The audio cut is still valid when the optional RMS receipt fails.
    }
    return { bytes, durationS, rmsDb };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function processMaterialHarvest(opts?: {
  limit?: number;
}): Promise<HarvestSummary> {
  const limit = Math.max(1, Math.min(30, opts?.limit ?? 30));
  const summary: HarvestSummary = {
    scanned: 0,
    harvestedSources: 0,
    loopsCreated: 0,
    skipped: [],
  };

  const songs = await prisma.song.findMany({
    where: { deletedAt: null, quarantined: false },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      project: {
        select: { genre: true, bpm: true, keySignature: true },
      },
      beats: {
        where: { qualityState: { not: "failed" } },
        select: {
          id: true,
          url: true,
          provider: true,
          bpm: true,
          keySignature: true,
          qualityState: true,
          meta: true,
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  for (const song of songs) {
    if (summary.harvestedSources >= limit) break;
    summary.scanned += 1;

    let selected: SongHarvestCandidate | null = null;
    const rejected: string[] = [];
    for (const beat of song.beats) {
      const decision = classifySongHarvestCandidate({
        songId: song.id,
        workspaceId: song.workspaceId,
        title: song.title,
        genre: song.project.genre,
        projectBpm: song.project.bpm,
        projectKeySignature: song.project.keySignature,
        beat,
      });
      if (decision.accepted) {
        selected = decision.candidate;
        break;
      }
      rejected.push(decision.reason);
    }
    if (!selected) {
      summary.skipped.push({
        id: song.id,
        reason: rejected[0] ?? "song has no eligible rights-clean audio",
      });
      continue;
    }
    const src = selected;

    const already = await prisma.materialAsset.findFirst({
      where: { meta: { path: ["harvestedFrom"], equals: src.marker } },
      select: { id: true },
    });
    if (already) continue;

    let stems: Awaited<ReturnType<typeof separateStemsRouted>>;
    try {
      stems = await separateStemsRouted({
        audioUrl: src.url,
        mode: "full",
        workspaceId: src.workspaceId,
        purpose: "measure",
      });
    } catch (error) {
      summary.skipped.push({
        id: src.songId,
        reason: `stem separation failed: ${(error as Error).message.slice(
          0,
          80
        )}`,
      });
      continue;
    }

    let loopsForSource = 0;
    try {
      for (const stem of stems.stems ?? []) {
        const role = STEM_ROLE[stem.role?.toLowerCase?.() ?? ""];
        if (!role || !stem.url) continue;
        const dir = await mkdtemp(join(tmpdir(), "afh-stem-"));
        try {
          const stemBytes = await downloadToBuffer(stem.url);
          const stemPath = join(dir, "stem.bin");
          await writeFile(stemPath, stemBytes);
          const probe = await runFfmpegCapture([
            "-i",
            stemPath,
            "-f",
            "null",
            "-",
          ]);
          const durationMatch = probe.match(
            /Duration:\s*(\d+):(\d+):([\d.]+)/
          );
          const durationS = durationMatch
            ? Number(durationMatch[1]) * 3600 +
              Number(durationMatch[2]) * 60 +
              Number(durationMatch[3])
            : 0;

          for (const offsetS of planLoopOffsets(
            durationS,
            src.bpm,
            LOOP_BARS,
            LOOPS_PER_STEM
          )) {
            const loop = await cutLoopWav({
              sourcePath: stemPath,
              offsetS,
              bpm: src.bpm,
              bars: LOOP_BARS,
            });
            if (loop.rmsDb !== null && loop.rmsDb < MIN_LOOP_RMS_DB) continue;
            const contentHash = createHash("sha256")
              .update(loop.bytes)
              .digest("hex");
            const duplicate = await prisma.materialAsset.findFirst({
              where: { workspaceId: src.workspaceId, contentHash },
              select: { id: true },
            });
            if (duplicate) continue;

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
                genre: src.genre,
                bpm: src.bpm,
                keySignature: src.keySignature,
                bars: LOOP_BARS,
                durationS: loop.durationS,
                url,
                source: src.source,
                roleEvidence: "stem-separated",
                rightsBasis: src.rightsBasis,
                readiness: "ready",
                qualityState: "passed",
                contentHash,
                verifiedAt: new Date(),
                meta: {
                  harvestedFrom: src.marker,
                  fromSongId: src.songId,
                  fromAssetKind: src.assetKind,
                  fromAssetId: src.assetId,
                  sourceTitle: src.title,
                  stem: stem.role,
                  separationEngine: stems.engine ?? "unknown",
                  offsetS,
                  rmsDb: loop.rmsDb,
                },
              },
            });
            summary.loopsCreated += 1;
            loopsForSource += 1;
          }
        } catch (error) {
          console.warn(
            `[harvest] ${src.songId}/${stem.role}: ${(error as Error).message.slice(
              0,
              100
            )}`
          );
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(
            () => undefined
          );
        }
      }
    } finally {
      await Promise.all(
        (stems.stems ?? []).map(stem =>
          stem.url
            ? deleteObjectByUrl(stem.url).catch(() => undefined)
            : Promise.resolve()
        )
      );
    }

    if (loopsForSource > 0) {
      summary.harvestedSources += 1;
      console.log(
        `[harvest] "${src.title}" (${src.genre} @${src.bpm}) -> ${loopsForSource} song-derived loop(s)`
      );
    } else {
      summary.skipped.push({
        id: src.songId,
        reason: "separation returned no new usable stem audio",
      });
    }
  }

  console.log(
    `[harvest] done: ${summary.loopsCreated} loops from ${summary.harvestedSources} song(s) (scanned ${summary.scanned}, skipped ${summary.skipped.length})`
  );
  for (const skipped of summary.skipped.slice(0, 8))
    console.log(`[harvest] skipped ${skipped.id}: ${skipped.reason}`);
  return summary;
}
