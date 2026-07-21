/**
 * THE AFROHIT ENGINE v1 — composed, not rented. One job chains the four layers:
 *
 *  L1 RHYTHM (owned):   ensure a signature kit (synth-forge any missing role),
 *                       pick real material, assemble on a locked grid via the
 *                       existing Phase-5 renderer. In-lane BY CONSTRUCTION.
 *  L2 MELODY (conditioned): optional — MusicGen (open weights, Replicate) with
 *                       OUR assembled groove as input_audio, so the melodic
 *                       layer honors the exact beat. Fail-open: skipped with a
 *                       disclosed reason, never fatal.
 *  L3 VOICE:            the artist's uploaded vocal rides the existing
 *                       /vocals/upload -> mixer path over this instrumental.
 *  L4 PROOF:            measured QC + lane compliance (existing lane-assess) +
 *                       blueprint skeleton verification. Receipts, not vibes.
 *
 * Rights-classified by construction: user, code-generated, licensed, or
 * connected-provider material; unknown provenance is blocked.
 */
import { openSecret, prisma } from "@afrohit/db";
import {
  blueprintFromMeasured,
  AFROONE_ONTOLOGY_VERSION,
  AFROONE_RENDER_SPEC_VERSION,
  applyAfroOneDirection,
  forgeKitFor,
  structureMatch,
  genreSignature,
  influenceDirective,
  synthKitFor,
  isMaterialRole,
  jobOf,
  parseLyricSections,
  sectionKindOf,
  composeMelody,
  laneFeel,
  pickHomeKey,
  seedFrom,
  selectMaterialRows,
  materialCoverage,
  materialGenreMatches,
  estimateComposedMelodyDurationS,
  fitMelodySectionsToDuration,
  melodyScoreDurationS,
  planAutoForge,
  type SongBlueprint,
  type AfroOneDirection,
  type AfroOneRenderSpecification,
  type MeasuredAnalysis,
  type MelodyScore,
  withCoarseMaterialRoles,
  hasExactMaterialRoleEvidence,
  missingExactRequestedMaterialRoles,
  REQUESTED_MATERIAL_ROLES_VERSION,
  requestedMaterialRoleContract,
  laneSampleKit,
  sampleKitFloorRows,
  type MaterialRole,
  type RequestedMaterialRoleProvenance,
} from "@afrohit/shared";
import {
  afroOneSingingJobContract,
  createAfroOneSingingManifest,
  melodyBrain,
  getSoundDNA,
  musicAdapter,
  planProduction,
  renderTrainedMusicLayer,
  trainedLayerDecision,
  TRAINED_MUSIC_LAYER_COST_USD,
  type RenderOutcome,
} from "@afrohit/ai";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "../lib/storage";
import {
  audioTempoConformPlan,
  measureAudioBufferQuality,
  mixBuffers,
  transformAudio,
  postConformTempoVerdict,
  POST_CONFORM_TEMPO_TOLERANCE,
} from "../lib/ffmpeg";
import {
  LOOP_LOUDNESS_TARGET,
  normalizeLoopLoudness,
} from "../lib/material-inspection";
import { certifyAudioBytes } from "../lib/certified-assets";
import { deleteUnreferencedAssetRefs } from "./asset-cleanup";
import { renderMelodyGuide, renderMelodyLead, leadVoiceFor } from "../lib/melody-guide";
import { overlayFills } from "../lib/fills";
import {
  resolveActiveMusicModelRef,
  resolveTrainedAdapterRefForRender,
} from "../lib/training-flywheel";
import { measureAudio, dspAvailable } from "../lib/dsp";
import { markRunning, markSucceeded, markFailed, emitJobEvent } from "../lib/jobs";
import { runSynthBedPreview } from "../lib/bed-first-stream";
import { assessLaneCompliance } from "../lib/lane-assess";
import { processSynthMaterial } from "./synth-material";
import { processAssembleBeat, processForgeMaterial } from "./material";
import { forgePromptFor } from "../lib/forge-prompts";
import { replicateToken } from "@afrohit/ai";
import { processAfroOneSinging } from "./afroone-singing";

export interface OwnEnginePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string | null;
  genre: string;
  bpm?: number;
  /** Full-song target length (s). Callers pass the lane's genreSignature
   *  durationS; absent → the lane default. The audit's "own renders are
   *  short" fix: length is now a CONTRACT, not an accident of a 64-bar table. */
  durationS?: number;
  melody?: boolean;
  melodyPrompt?: string;
  /** The owner's REFERENCE steering, threaded from the enqueue sites so the
   *  DEFAULT (own) renderer honors it instead of dropping it: an artist
   *  production lane ("feel like Dre" — style only, never a voice clone), the
   *  song's mood, and any free-text vibe. `melodyPrompt` above is already the
   *  ENRICHED prompt built from these (enrichedOwnMelodyPrompt); these raw
   *  fields let the Producer Brain steer on mood + lane as STRUCTURED cues. */
  mood?: string;
  influence?: string;
  vibePrompt?: string;
  blueprint?: SongBlueprint | null;
  requestedRoles?: MaterialRole[];
  requestedRoleProvenance?: RequestedMaterialRoleProvenance;
  renderSeed?: number;
  direction?: AfroOneDirection;
  deterministicMode?: boolean;
  renderSpec?: AfroOneRenderSpecification;
  /** Exact prior material receipt for replay. No forge/substitution is allowed. */
  lockedMaterialIds?: string[];
  withStems?: boolean;
  withVocals?: boolean;
  lyrics?: string;
  language?: string | null;
  voiceProfileId?: string | null;
  /** Exact score carried by a replay receipt. */
  melodyScore?: MelodyScore | null;
  trainingUsage?: {
    referenceIds?: string[];
    pinnedReferenceId?: string | null;
    genre?: string;
    measured?: number;
    inferredOnly?: number;
  };
}

async function pickKit(
  workspaceId: string,
  genre: string,
  bpm: number,
  key: string,
  varietySeed: number,
  requestedRoles: readonly MaterialRole[] = [],
  lockedMaterialIds: readonly string[] = [],
  // BED-FIRST STREAMING isolation: preview-only synth loops (synth-material.ts,
  // previewOnly:true) exist ONLY to carry the fast synth preview bed. Every
  // real-bed pick EXCLUDES them (default), so the forged bed is byte-identical
  // to today — no synth primitive is ever layered under the real instruments.
  // The preview's own pick opts in with includePreviewOnly=true. When the flag
  // is off no such loops exist, so this filter is a no-op on the current path.
  includePreviewOnly = false
) {
  // GENRE MATCHING IN JS (source-truth wave item 8): the Prisma exact-equality
  // `genre` filter hid 'Afrobeats'-tagged material from an 'afrobeats' lane —
  // the shelf looked empty while the loops sat right there. Fetch a wider
  // window (600 vs 240, so other-genre rows can't crowd the lane out of it),
  // compare canonically with materialGenreMatches, and keep the original
  // budget after filtering. Genre-null rows stay EXCLUDED — exactly what the
  // old equality did: the kit is lane identity, untagged rows don't qualify.
  const shelf = await prisma.materialAsset.findMany({
    where: {
      workspaceId,
      readiness: { not: "rejected" },
      qualityState: { notIn: ["failed", "duplicate"] },
      rightsBasis: { not: "unknown" },
    },
    orderBy: { createdAt: "desc" },
    take: 600,
  });
  const locked = new Set(lockedMaterialIds);
  const rows = shelf
    .filter((row: { genre: string | null }) => materialGenreMatches(row.genre, genre))
    .filter((row: { id: string }) => !locked.size || locked.has(row.id))
    // Exclude preview-only synth loops from the real forged bed (see param note).
    .filter(
      (row: { meta?: unknown }) =>
        includePreviewOnly ||
        !(row.meta as { previewOnly?: boolean } | null)?.previewOnly
    )
    .slice(0, 240);
  const exactRequested = new Set<string>(requestedRoles);
  const eligibleRows = rows.filter(
    (row: { role: string; roleEvidence?: string | null }) =>
      !exactRequested.has(row.role) || hasExactMaterialRoleEvidence(row)
  );
  // L1-SAMPLE FLOOR (SOUNDCORE item 5): licensed REAL instruments are the
  // instrument floor and must be preferred over synth primitives for the same
  // role. Resolved FIRST — before the synth backfill in processOwnEngine — so a
  // real licensed shekere wins over a math shaker the instant licensed loops
  // land. laneSampleKit() returns [] today (packages/shared/src/lane-sample-kit.ts,
  // a documented stub the sample-kit agent fills), so licensedFloor is [] and the
  // selection below is byte-for-byte the current synth path.
  // OTHER-AGENT-FILLS: populate laneSampleKit(genre) with the lane's licensed
  // loops; sampleKitFloorRows prepends them here as rights-clean, auto-assemblable
  // 'licensed' rows that selectMaterialRows prefers over the synth primitive.
  const licensedFloor = sampleKitFloorRows(laneSampleKit(genre));
  // Rich signature roles lead; deterministic synth primitives remain the
  // controllable foundation when a lane's collected shelf is still shallow.
  const roles = withCoarseMaterialRoles([
    ...requestedRoles,
    ...forgeKitFor(genre, 12),
    ...synthKitFor(genre),
  ]);
  return selectMaterialRows(
    licensedFloor.length ? [...licensedFloor, ...eligibleRows] : eligibleRows,
    roles,
    bpm,
    key,
    { varietySeed }
  );
}

/** Hard ceiling on CONCURRENT roles in one section. The collected+forged kit
 *  can be 12+ roles; twelve loops at once is a wall of sound no producer would
 *  print — density comes from the ARRANGEMENT, not from stacking everything. */
const SECTION_ROLE_CAP = 7;

/** Trained-layer mix level: TEXTURE, never the groove anchor. The lane-material
 *  gain doctrine keeps rhythm/low-end at the top of the bus (drums 1.0) and
 *  colour under it (chords ~0.7); the fills ride at 0.5. The trained topping is
 *  melody colour — 0.6 sits it audibly IN the record without burying anchors,
 *  below the 0.85 the stock musicgen mix used. */
const TRAINED_LAYER_GAIN = 0.6;

/** Melody-lead mix level (SOUNDCORE item 1): the composed topline sits ABOVE the
 *  bed color and UNDER where the vocal lands — clearly the melody of the record,
 *  but never louder than the voice that will ride on top. Between chords (~0.7)
 *  and the old stock-musicgen topping (0.85). */
const MELODY_LEAD_GAIN = 0.7;

/** Bounded fan-out width for the two forge loops (SOUNDCORE item 3). Forge
 *  renders are I/O-bound Replicate polls (submit → prefer:wait → poll), NOT CPU
 *  work — the same profile as the video shot lane, which already runs at 12. At
 *  width 4 a fresh-lane song forges 8 instruments in 2 slow waves (~2-6 min);
 *  width 8 collapses those 8 forges into ONE wave, halving the single biggest
 *  wall-clock sink of a first-in-lane song. The 429 backoff inside
 *  processForgeMaterial still absorbs Replicate's ~6/min creation throttle.
 *  Override via OWN_ENGINE_FORGE_CONCURRENCY (bump toward 12 if throttle allows). */
const FORGE_FANOUT_CONCURRENCY = Math.max(
  1,
  Number(process.env.OWN_ENGINE_FORGE_CONCURRENCY ?? 8) || 8
);

/** A bounded-concurrency pool: run `fn` over `items` at most `concurrency` at a
 *  time. Independent units fan out; the caller awaits ALL of them before the
 *  verification barrier (re-pickKit/coverage). Deterministic completion is NOT
 *  guaranteed — callers that need order rebuild it from `items`. */
async function forEachPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const width = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

function sectionsFrom(
  blueprint: SongBlueprint | null | undefined,
  roles: string[]
) {
  const bed = [...new Set(roles.filter(r => r !== "fill"))];
  // CRAFT LAW at the grid level: textures EVOLVE — no section repeats unchanged.
  const roleJob = (role: string) =>
    isMaterialRole(role)
      ? jobOf(role)
      : (
          {
            drums: "rhythm",
            percussion: "rhythm",
            bass: "low_end",
            log_drum: "low_end",
            chords: "harmony",
          } as Record<string, string>
        )[role];
  // FAMILY PRIORITY (the cap's pecking order): rhythm anchors + low end are the
  // groove and can never be the roles a cap drops; harmony carries the record;
  // melody colour / vocal layers / fx are texture — first in, first cut.
  const jobRank: Record<string, number> = {
    rhythm: 0,
    low_end: 1,
    harmony: 2,
    melody: 3,
    vocal: 4,
    transition: 5,
  };
  const rank = (role: string) => jobRank[roleJob(role) ?? ""] ?? 3;
  // Stable sort on a deduped copy → deterministic: same kit in, same arrangement
  // out, with roles of equal priority keeping their pick order.
  const prioritized = [...bed].sort((a, b) => rank(a) - rank(b));
  const cap = (list: string[]) =>
    list.length <= SECTION_ROLE_CAP
      ? list
      : [...list].sort((a, b) => rank(a) - rank(b)).slice(0, SECTION_ROLE_CAP);
  const byJob = (job: string) => prioritized.filter(role => roleJob(role) === job);
  const rhythm = byJob("rhythm");
  const harmony = byJob("harmony");
  const texture = prioritized.filter(role => {
    const job = roleJob(role);
    return job !== "rhythm" && job !== "low_end" && job !== "harmony";
  });

  // The section densities. `lite` used to equal `noBass` (both "everything but
  // low end") — a 10-role "sparse intro" that was a no-op wall of sound
  // (confirmed 2026-07). Now:
  //   lite = 2 rhythm roles + 1 harmony role — a real sparse open/close;
  //   mid  = the bed minus its 2-3 least-essential texture roles, anchors kept;
  //   full = the bed, capped — the hook's arrival.
  const full = cap(prioritized);
  const litePick = [...rhythm.slice(0, 2), ...harmony.slice(0, 1)];
  const lite = litePick.length ? litePick : full;
  const textureDrop = texture.slice(-Math.min(3, texture.length));
  const midPick = prioritized.filter(role => !textureDrop.includes(role));
  const mid = midPick.length >= 2 ? cap(midPick) : full;

  if (blueprint?.sections?.length) {
    // A measured blueprint carries bar counts but NO kind labels (structure is
    // measured, kinds are not) — derive the producer arc positionally instead
    // of mapping every section to the full bed (the old no-op): first/last =
    // sparse intro/outro, interior alternates verse (mid) → hook (full). A
    // single interior section is the record's core — it gets the full band.
    const n = blueprint.sections.length;
    return blueprint.sections.map((s, i) => {
      let sectionRoles = full;
      // Positional energy (fix 3): density and level tell the same story —
      // sparse open/close sits back, mid sections carry, full stacks lift.
      let energy = 0.85;
      if (n >= 3 && (i === 0 || i === n - 1)) {
        sectionRoles = lite;
        energy = 0.45;
      } else if (n === 2) {
        sectionRoles = i === 0 ? mid : full;
        energy = i === 0 ? 0.65 : 0.85;
      } else if (n >= 4 && (i - 1) % 2 === 0) {
        sectionRoles = mid;
        energy = 0.65;
      }
      return {
        name: `S${i + 1}`,
        bars: Math.max(2, s.bars ?? 8),
        roles: sectionRoles,
        energy,
      };
    });
  }
  const noBassPick = cap(prioritized.filter(role => roleJob(role) !== "low_end"));
  const strip = cap(
    prioritized.filter(
      role => roleJob(role) === "harmony" || roleJob(role) === "melody"
    )
  );
  // Template energies (fix 3): the arc the arrangement was already SHAPED as —
  // now it reaches the bus gain instead of only the role lists.
  return [
    { name: "intro", bars: 4, roles: lite, energy: 0.42 }, // real sparse open — 2 rhythm + 1 harmony
    { name: "verse", bars: 16, roles: noBassPick.length >= 2 ? noBassPick : full, energy: 0.62 }, // bass held back
    { name: "hook", bars: 8, roles: full, energy: 0.85 }, // full band arrives
    { name: "verse2", bars: 16, roles: full, energy: 0.68 }, // fuller than verse 1
    { name: "bridge", bars: 8, roles: strip.length ? strip : lite, energy: 0.5 }, // energy flip: strip-back
    { name: "hook2", bars: 8, roles: full, energy: 0.9 },
    { name: "outro", bars: 4, roles: lite, energy: 0.38 },
  ];
}

/** EVERYTHING FEEDS THE ENGINE (owner 2026-07-19): compact production lessons
 *  from the workspace's Listen/Zap studies (SoundReference recipes — the deep
 *  reads of the artist's OWN references). Facts from the data lake reach the
 *  Producer Brain's plan; the audio itself never does (rights law unchanged).
 *  Fail-open: any error returns [] and the plan proceeds without them. */
async function learnedListeningLessons(
  workspaceId: string,
  genre: string,
  preferredReferenceIds: readonly string[] = []
): Promise<string[]> {
  try {
    const refs = await prisma.soundReference.findMany({
      where: {
        workspaceId,
        active: true,
        analysisState: { not: "failed" },
        rightsBasis: { not: "unknown" },
        NOT: { sourceUrl: { startsWith: "lyric:" } },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, genre: true, summary: true, recipe: true },
    });
    const lessons: string[] = [];
    const preferred = new Map(preferredReferenceIds.map((id, index) => [id, index]));
    const laneFirst = refs
      .filter(ref => materialGenreMatches(ref.genre, genre))
      .sort((a, b) => {
        const ap = preferred.get(a.id);
        const bp = preferred.get(b.id);
        if (ap !== undefined || bp !== undefined) {
          return (ap ?? Number.MAX_SAFE_INTEGER) - (bp ?? Number.MAX_SAFE_INTEGER);
        }
        return 0;
      });
    for (const ref of laneFirst) {
      const recipe = ref.recipe && typeof ref.recipe === "object" && !Array.isArray(ref.recipe)
        ? (ref.recipe as Record<string, unknown>)
        : null;
      if (!recipe) continue;
      const parts: string[] = [];
      if (ref.summary?.trim()) parts.push(ref.summary.trim().slice(0, 180));
      for (const key of ["whatToLearn", "vibe", "groove", "arrangement", "production", "productionNotes", "drums", "energy"]) {
        const value = recipe[key];
        if (typeof value === "string" && value.trim()) parts.push(value.trim().slice(0, 160));
      }
      if (Array.isArray(recipe.craft)) {
        const craft = recipe.craft
          .filter((value): value is string => typeof value === "string" && !!value.trim())
          .slice(0, 4)
          .join("; ")
          .slice(0, 220);
        if (craft) parts.push(craft);
      }
      const measured = recipe.measured && typeof recipe.measured === "object"
        ? (recipe.measured as Record<string, unknown>)
        : null;
      const measuredValue = (field: unknown): number | null => {
        if (typeof field === "number" && Number.isFinite(field)) return field;
        if (!field || typeof field !== "object") return null;
        const value = (field as { value?: unknown }).value;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      };
      const measuredBpm = measuredValue(measured?.tempoBpm) ?? measuredValue(recipe.bpm);
      const measuredSwing = measuredValue(measured?.swingRatio);
      if (measuredBpm) parts.push(`measured tempo ${Math.round(measuredBpm)} BPM`);
      if (measuredSwing) parts.push(`measured swing ${Math.round(measuredSwing * 10) / 10}`);
      if (parts.length) lessons.push(parts.join(" — ").slice(0, 320));
      if (lessons.length >= 3) break;
    }
    return lessons;
  } catch {
    return [];
  }
}

/** P2 FEEDBACK LOOP (read side): what this workspace's last planned renders
 *  MEASURED like — plan intent + the ear's verdict + the A&R hit score. The
 *  Producer Brain receives these as LAST_OUTCOMES so each plan learns from the
 *  previous render's receipts instead of repeating them. Fail-open: any error
 *  returns [] and the plan simply starts fresh. (V1 scopes to the workspace's
 *  most recent planned renders — one artist works one lane at a time; a
 *  per-genre index can sharpen this later.) */
async function recentRenderOutcomes(
  workspaceId: string,
  _genre: string
): Promise<RenderOutcome[]> {
  try {
    const beats = await prisma.beatAsset.findMany({
      where: { project: { workspaceId }, provider: { in: ["material", "afrohit-own"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { songId: true, qualityState: true, meta: true },
    });
    const planned = beats
      .filter(b => {
        const meta = b.meta as Record<string, unknown> | null;
        return !!meta?.productionPlan || !!meta?.qc;
      })
      .slice(0, 2);
    const outcomes: RenderOutcome[] = [];
    for (const b of planned) {
      const meta = (b.meta ?? {}) as Record<string, unknown>;
      const plan = (meta.productionPlan ?? null) as Record<string, unknown> | null;
      const qc = (meta.qc ?? null) as Record<string, unknown> | null;
      let hitScore: number | null = null;
      if (b.songId) {
        const song = await prisma.song.findUnique({
          where: { id: b.songId },
          select: { hitRead: true },
        });
        const read = (song?.hitRead ?? null) as Record<string, unknown> | null;
        const score = Number(read?.bestScore);
        hitScore = Number.isFinite(score) ? score : null;
      }
      outcomes.push({
        intent: typeof plan?.intent === "string" ? plan.intent : undefined,
        earVerdict:
          typeof qc?.verdict === "string" ? qc.verdict : b.qualityState,
        flags: Array.isArray(qc?.flags)
          ? (qc.flags as unknown[]).filter((f): f is string => typeof f === "string")
          : undefined,
        integratedLufs:
          typeof qc?.integratedLufs === "number" ? qc.integratedLufs : null,
        hitScore,
      });
    }
    return outcomes;
  } catch {
    return [];
  }
}

/** Minimal direct MusicGen call (Replicate, Prefer:wait) with OUR groove as the
 *  melody condition. Returns an audio URL or null (reason logged) — fail-open. */
export async function melodyLayer(
  groove: string,
  prompt: string,
  durationS: number,
  workspaceToken?: string
): Promise<{ url: string | null; note: string }> {
  const token = workspaceToken || process.env.REPLICATE_API_TOKEN;
  if (!token)
    return { url: null, note: "melody skipped: no REPLICATE_API_TOKEN" };
  try {
    const providerGroove = await resolveAssetForProvider(groove);
    let version = process.env.REPLICATE_MUSIC_VERSION;
    if (!version) {
      const mres = await fetch(
        "https://api.replicate.com/v1/models/meta/musicgen",
        { headers: { authorization: `Bearer ${token}` } }
      );
      version = ((await mres.json()) as { latest_version?: { id?: string } })
        .latest_version?.id;
    }
    if (!version)
      return { url: null, note: "melody skipped: no model version" };
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        prefer: "wait=60",
      },
      body: JSON.stringify({
        version,
        input: {
          prompt,
          duration: Math.min(30, Math.max(8, Math.round(durationS))),
          input_audio: providerGroove,
          continuation: false,
          model_version: "melody-large",
          output_format: "wav",
        },
      }),
    });
    let data = (await res.json()) as {
      id?: string;
      status?: string;
      output?: string | string[];
      error?: string;
    };
    // prefer:wait only holds 60s — a slower render comes back 'processing' while
    // Replicate keeps working. POLL it out (up to ~5 min) instead of dropping a
    // render we already paid for.
    const deadline = Date.now() + 5 * 60_000;
    while (
      data.id &&
      (data.status === "starting" || data.status === "processing") &&
      Date.now() < deadline
    ) {
      await new Promise(r => setTimeout(r, 5_000));
      const poll = await fetch(
        `https://api.replicate.com/v1/predictions/${data.id}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      data = (await poll.json()) as typeof data;
    }
    const out = Array.isArray(data.output) ? data.output[0] : data.output;
    if (data.status === "succeeded" && out)
      return { url: out, note: "melody: musicgen conditioned on our groove" };
    return {
      url: null,
      note: `melody skipped: ${data.error ?? data.status ?? "no output"}`,
    };
  } catch (err) {
    return {
      url: null,
      note: `melody skipped: ${(err as Error)?.message?.slice(0, 120)}`,
    };
  }
}

/** Enharmonic pitch classes for the melody key check — flats and sharps land on
 *  the same class so "Db" and "C#" never read as a mismatch. */
const PITCH_CLASSES: Record<string, number> = {
  "b#": 0, c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, fb: 4,
  "e#": 5, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10,
  bb: 10, b: 11, cb: 11,
};

function parseKeySignature(s: string): { pc: number; minor: boolean } | null {
  const match = /^\s*([A-Ga-g][#b]?)\s*(major|minor|maj|min|m)?\s*$/i.exec(s);
  if (!match) return null;
  const pc = PITCH_CLASSES[match[1]!.toLowerCase()];
  if (pc == null) return null;
  return { pc, minor: /^m(in(or)?)?$/i.test(match[2] ?? "major") };
}

/** True = same key or a directly-compatible pair; false = HARD mismatch; null =
 *  one side unparseable (unknown is honorable — never skip on a guess).
 *  Compatible by design: same tonic in either mode (parallel keys share the
 *  tonic and borrow freely) and the relative major/minor pair (identical pitch
 *  set). Anything else is a hard mismatch worth skipping a 0.85-gain lead over. */
function keysCompatible(a: string, b: string): boolean | null {
  const ka = parseKeySignature(a);
  const kb = parseKeySignature(b);
  if (!ka || !kb) return null;
  if (ka.pc === kb.pc) return true; // same tonic (parallel major/minor included)
  if (ka.minor !== kb.minor) {
    const minor = ka.minor ? ka : kb;
    const major = ka.minor ? kb : ka;
    return minor.pc === (major.pc + 9) % 12; // relative pair (A minor ↔ C major)
  }
  return false;
}

/**
 * HONESTY GATE for the conditioned melody layer (diagnosis 2026-07: a MusicGen
 * render was mixed in at 0.85 gain with ZERO tempo/key verification against the
 * bed — conditioning STEERS the model, it guarantees nothing). Measure the lead
 * with the same DSP ear the material shelf uses:
 *   - tempo: skip when the detected BPM deviates >5% from the grid. Detectors
 *     are octave-ambiguous, so half/double-time readings fold back onto the
 *     grid first — a half-time lead over the groove IS the same grid.
 *   - key: skip only on a HARD mismatch (see keysCompatible) when both keys
 *     measured; an unreadable key never skips.
 * Fail-open stays the law: when the DSP ear is unavailable we measure at least
 * duration/energy with ffmpeg and disclose that tempo/key went unverified.
 */
async function verifyMelodyAgainstGrid(
  lead: Buffer,
  gridBpm: number,
  homeKey: string
): Promise<{ ok: boolean; note: string; reason?: "tempo" | "key" }> {
  const mval = <T>(
    field: { value?: T | null; source?: string } | undefined
  ): T | null =>
    field && field.source !== "unknown" && field.value != null
      ? field.value
      : null;
  if (await dspAvailable().catch(() => false)) {
    const measured = await measureAudio(lead).catch(() => null);
    const leadBpm = measured?.engineOk ? mval(measured.tempoBpm) : null;
    if (leadBpm && leadBpm > 0) {
      const folded = [leadBpm, leadBpm * 2, leadBpm / 2];
      const deviation = Math.min(
        ...folded.map(c => Math.abs(c - gridBpm) / gridBpm)
      );
      if (deviation > 0.05) {
        return {
          ok: false,
          reason: "tempo",
          note: `melody fights the grid: measured ~${Math.round(leadBpm)} BPM vs ${gridBpm} BPM (${Math.round(deviation * 100)}% off, >5% tolerance)`,
        };
      }
      const leadKeyName = mval(measured!.key);
      const leadMode = mval(measured!.mode);
      if (leadKeyName && leadMode) {
        const leadKey = `${leadKeyName} ${leadMode}`;
        if (keysCompatible(homeKey, leadKey) === false) {
          return {
            ok: false,
            reason: "key",
            note: `melody key mismatch: measured ${leadKey} against the bed's ${homeKey}`,
          };
        }
        return {
          ok: true,
          note: `melody grid check: ~${Math.round(leadBpm)} BPM / ${leadKey} vs ${gridBpm} BPM / ${homeKey} — within tolerance`,
        };
      }
      return {
        ok: true,
        note: `melody grid check: ~${Math.round(leadBpm)} BPM vs ${gridBpm} BPM — within tolerance (key unmeasured)`,
      };
    }
    return {
      ok: true,
      note: "melody grid check: tempo unmeasurable — mixed fail-open, disclosed",
    };
  }
  const qc = await measureAudioBufferQuality(lead).catch(() => null);
  return {
    ok: true,
    note: qc
      ? `melody grid check unavailable (no DSP ear): ${qc.durationS}s at ${qc.integratedLufs ?? "?"} LUFS — tempo/key unverified`
      : "melody grid check unavailable (no DSP ear, ffmpeg QC failed) — tempo/key unverified",
  };
}

export interface MelodyTempoConformReceipt {
  sourceBpm: number | null;
  foldedSourceBpm: number | null;
  targetBpm: number;
  tempoRatio: number;
  tempoConformed: boolean;
  verifiedBpm: number | null;
}

/** Put a trained melody on the song grid before the honesty gate. This is a
 * local, pitch-preserving FFmpeg transform; no provider call or new audio is
 * introduced. A performed transform must be re-measured before it may mix. */
export async function conformMelodyTempoToGrid(
  lead: Buffer,
  gridBpm: number
): Promise<{ bytes: Buffer; receipt: MelodyTempoConformReceipt }> {
  const emptyReceipt: MelodyTempoConformReceipt = {
    sourceBpm: null,
    foldedSourceBpm: null,
    targetBpm: gridBpm,
    tempoRatio: 1,
    tempoConformed: false,
    verifiedBpm: null,
  };
  if (!(await dspAvailable().catch(() => false))) {
    return { bytes: lead, receipt: emptyReceipt };
  }
  const measured = await measureAudio(lead).catch(() => null);
  const sourceBpm =
    measured?.engineOk &&
    measured.tempoBpm.source !== "unknown" &&
    typeof measured.tempoBpm.value === "number"
      ? measured.tempoBpm.value
      : null;
  if (!sourceBpm) return { bytes: lead, receipt: emptyReceipt };

  const plan = audioTempoConformPlan(sourceBpm, gridBpm);
  if (!plan) return { bytes: lead, receipt: emptyReceipt };
  const baseReceipt: MelodyTempoConformReceipt = {
    sourceBpm,
    foldedSourceBpm: plan.foldedSourceBpm,
    targetBpm: gridBpm,
    tempoRatio: plan.tempoRatio,
    tempoConformed: false,
    verifiedBpm: sourceBpm,
  };
  if (!plan.needsConform) return { bytes: lead, receipt: baseReceipt };
  if (!plan.supported) {
    throw new Error(
      `trained melody tempo cannot conform safely: ${Math.round(sourceBpm)} BPM to ${gridBpm} BPM`
    );
  }

  const bytes = await transformAudio(lead, { tempo: plan.tempoRatio });
  const verified = await measureAudio(bytes).catch(() => null);
  const verifiedBpm =
    verified?.engineOk &&
    verified.tempoBpm.source !== "unknown" &&
    typeof verified.tempoBpm.value === "number"
      ? verified.tempoBpm.value
      : null;
  // THE STRETCH IS EXACT MATH from the measured source, so the bytes are on grid
  // BY CONSTRUCTION — the re-measure only guards against a source reading so
  // wrong the audio is gridless. The OLD gate re-measured and rejected at a 5%
  // tolerance, so a good trained render whose stretched melodic content simply
  // re-read a few % off (or unreadable at all) was skipped with "could not be
  // verified against N BPM". Now we trust the applied ratio when the re-measure
  // is unavailable and pass an octave-folded post-conform tolerance otherwise;
  // only a reading off at EVERY octave (genuinely gridless) still skips.
  const verdict = postConformTempoVerdict(verifiedBpm, gridBpm);
  if (!verdict.pass) {
    throw new Error(
      `trained melody tempo conform could not be verified against ${gridBpm} BPM: ${verdict.reason}`
    );
  }
  return {
    bytes,
    receipt: {
      ...baseReceipt,
      tempoConformed: true,
      verifiedBpm: verdict.verifiedBpm,
    },
  };
}

export async function processOwnEngine(p: OwnEnginePayload): Promise<void> {
  // TIME-TO-FIRST-AUDIO metric anchor: seconds from here to the bed_preview emit
  // is the headline number the synth-bed-first stream is optimizing (logged +
  // put on the receipt). markRunning also emits the 'running' JobEvent.
  const jobStartedAt = Date.now();
  await markRunning(p.jobId);
  // FLAG-GATED, DEFAULT OFF (SONG_BED_FIRST_STREAMING). When off, the render is
  // byte-identical to today: the forge/synth barrier, then ONE terminal
  // bed_ready with no `stage` field. When on, the fast synth-only preview bed is
  // emitted up front (bed_preview) and the terminal bed_ready carries stage:'forged'.
  const bedFirstStreaming = process.env.SONG_BED_FIRST_STREAMING === "1";
  const notes: string[] = [];
  try {
    const bpm = p.bpm ?? genreSignature(p.genre).bpm ?? 112;
    const varietySeed = p.renderSeed ?? seedFrom(p.jobId, bpm);
    // KEY VARIETY (SOUNDWAVE1 fix 7): commonKeys[0] made every afrobeats render
    // B minor forever. The home key is now a deterministic seeded pick from the
    // lane's common keys — seeded by the STORED renderSpec seed (replays and
    // deterministicMode reproduce the exact key; keySeed === the seed written
    // into the child renderSpec below), varied across fresh renders.
    const keySeed = p.renderSpec?.seed ?? varietySeed;
    const homeKey = pickHomeKey(getSoundDNA(p.genre)?.commonKeys, keySeed);
    notes.push(`home key: ${homeKey} (seeded pick from ${p.genre} common keys)`);

    const rawRequestedRoles = p.requestedRoles ?? [];
    const invalidRequestedRoles = rawRequestedRoles.filter(
      role => !isMaterialRole(role)
    );
    if (invalidRequestedRoles.length) {
      throw new Error(
        `own-engine: invalid requested material roles (${invalidRequestedRoles.join(", ")})`
      );
    }
    const requestedRoles = [...new Set(rawRequestedRoles)] as MaterialRole[];
    const requestedRoleProvenance = p.requestedRoleProvenance;
    if (requestedRoles.length || requestedRoleProvenance?.instruments.length) {
      const derivedRequest = requestedMaterialRoleContract(
        requestedRoleProvenance?.instruments
      );
      const mappedRoles = new Set(
        requestedRoleProvenance?.mappings?.map(mapping => mapping.role) ?? []
      );
      if (
        requestedRoleProvenance?.version !== REQUESTED_MATERIAL_ROLES_VERSION ||
        requestedRoleProvenance.source !== "user-instrument-selection" ||
        derivedRequest.unsupportedInstruments.length > 0 ||
        derivedRequest.requestedRoles.length !== requestedRoles.length ||
        derivedRequest.requestedRoles.some(
          role => !requestedRoles.includes(role)
        ) ||
        mappedRoles.size !== requestedRoles.length ||
        requestedRoles.some(role => !mappedRoles.has(role))
      ) {
        throw new Error(
          "own-engine: requested material roles are missing server-derived provenance"
        );
      }
    }

    // L1a — consume the rich collected shelf, then synthesize only missing
    // controllable foundation roles. Signature uploads/loops remain preferred.
    let picks = await pickKit(
      p.workspaceId,
      p.genre,
      bpm,
      homeKey,
      varietySeed,
      requestedRoles,
      p.lockedMaterialIds ?? []
    );
    const replayLocked = Boolean(p.lockedMaterialIds?.length);
    if (replayLocked) {
      const pickedIds = new Set(picks.map(pick => pick.id));
      const unavailable = p.lockedMaterialIds!.filter(id => !pickedIds.has(id));
      if (unavailable.length) {
        throw new Error(
          `own-engine replay refused: ${unavailable.length} locked material(s) are missing or no longer eligible`
        );
      }
      notes.push(`replay: locked ${p.lockedMaterialIds!.length} material receipt(s)`);
    }

    // ── STAGE 1: SYNTH-BED-FIRST PREVIEW (flag-gated, fail-soft) ──────────────
    // The default render forges 8 real instruments (2-6 min) and BLOCKS on all
    // of them before assembling, so the user hears NOTHING for minutes. When
    // SONG_BED_FIRST_STREAMING is on, run the FAST synth-only bed UP FRONT — for
    // the full kit, not as a post-forge gap-filler — assemble a provisional bed,
    // upload it, and emit `bed_preview {stage:'synth'}` so the player streams it
    // in ~15-20s. Then the existing forge fan-out + real-bed assembly + master
    // run exactly as before, and the player hot-swaps synth -> forged -> master.
    //
    // ISOLATION: the preview synth loops are stamped previewOnly (excluded from
    // every real-bed pickKit), so the FORGED bed is byte-identical to today — no
    // synth primitive is ever layered under the real instruments. Replay-locked
    // renders never preview (they must reproduce exactly). NEVER fatal: any
    // failure falls straight back to the barrier path with a disclosed note.
    if (bedFirstStreaming && !replayLocked) {
      let previewPicks: Awaited<ReturnType<typeof pickKit>> = [];
      const preview = await runSynthBedPreview(jobStartedAt, {
        synthFullKit: async () => {
          // WARM-LANE FAST PATH + shelf hygiene: if the REAL shelf already covers
          // a bed (a lane that has forged/collected material from prior renders),
          // skip the synth pass entirely — the preview assembles straight from the
          // real material (faster, and no preview-only rows accumulate). Only a
          // thin/cold lane synthesizes a starter kit for the preview.
          const realNow = await pickKit(
            p.workspaceId,
            p.genre,
            bpm,
            homeKey,
            varietySeed,
            requestedRoles,
            p.lockedMaterialIds ?? []
          );
          if (materialCoverage(realNow).ready) return;
          const synthJob = await prisma.providerJob.create({
            data: {
              workspaceId: p.workspaceId,
              kind: "material",
              provider: "synth",
              status: "QUEUED",
              inputJson: {
                genre: p.genre,
                auto: "own-engine-bed-preview",
              } as never,
            },
            select: { id: true },
          });
          await processSynthMaterial({
            jobId: synthJob.id,
            workspaceId: p.workspaceId,
            genre: p.genre,
            bpm,
            keySignature: homeKey,
            // FULL synth kit up front (+ any synthable requested role) so the
            // preview bed is a real groove, not one loop. Per-job material ids
            // (the dedicated synthJob) keep these distinct from the lane's
            // persistent gap-fill synth, and previewOnly keeps them off the
            // forged bed.
            roles: [...new Set([...synthKitFor(p.genre), ...requestedRoles])],
            previewOnly: true,
          });
        },
        pickPreviewKit: async () => {
          previewPicks = await pickKit(
            p.workspaceId,
            p.genre,
            bpm,
            homeKey,
            varietySeed,
            requestedRoles,
            [],
            true // include previewOnly loops for the provisional bed
          );
          return previewPicks;
        },
        assemblePreview: async () => {
          const previewSections = sectionsFrom(
            p.blueprint ?? null,
            previewPicks.map(pick => pick.role)
          );
          const previewChild = await prisma.providerJob.create({
            data: {
              workspaceId: p.workspaceId,
              projectId: p.projectId,
              kind: "music",
              provider: "material",
              status: "QUEUED",
              inputJson: {
                ownEngineChild: p.jobId,
                assemble: true,
                bedPreview: true,
              } as never,
            },
            select: { id: true },
          });
          await processAssembleBeat({
            jobId: previewChild.id,
            workspaceId: p.workspaceId,
            projectId: p.projectId,
            songId: undefined, // provisional bed — never tied to the song
            bpm,
            genre: p.genre,
            picks: previewPicks,
            sections: previewSections,
            withStems: false,
          } as never);
          const previewDone = await prisma.providerJob.findUnique({
            where: { id: previewChild.id },
            select: { status: true, outputJson: true },
          });
          const previewOut = (previewDone?.outputJson ?? {}) as {
            beatId?: string;
            url?: string;
          };
          if (
            previewDone?.status !== "SUCCEEDED" ||
            !previewOut.beatId ||
            !previewOut.url
          )
            return null;
          return { beatId: previewOut.beatId, url: previewOut.url };
        },
        emit: (phase, payload) => emitJobEvent(p.jobId, phase, payload),
        now: () => Date.now(),
        log: message => console.warn(message),
      });
      if (preview.note) notes.push(preview.note);
      if (preview.emitted)
        console.log(
          `[own-engine] ${p.genre} bed_preview — time-to-first-audio ~${preview.ttfaS}s`
        );
    }

    let haveRoles = new Set(picks.map(x => x.role));
    // REAL-INSTRUMENT FORGING IS THE AUTOMATIC DEFAULT NOW (owner order
    // 2026-07-20, explicit + emphatic: "Turn on the forging. Let it forge
    // always automatically ... Make REAL-INSTRUMENT forging the AUTOMATIC
    // DEFAULT"). The old gate was OPT-IN (OWN_ENGINE_REAL_FORGE=1 required) and
    // only forged missing REQUESTED roles, so the $0 synth backfill filled the
    // shelf FIRST — coverage went ready before any forge stage ran and every
    // render shipped 4 synth primitives ("one sound"). Now: whenever a forge
    // engine is REACHABLE — the house Replicate token (replicateToken(), the
    // owner HAS it) OR a workspace's own Replicate key — the engine forges the
    // LANE'S CORE REAL KIT (forgeKitFor: talking drum / shekere / bass guitar /
    // rhodes / …) up to a per-render cap BEFORE the synth backfill, so real
    // MusicGen loops become the instrument floor and synth only fills the JOBS
    // forging could not land. This is the SAME forgeLoopAdapter/MusicGen route
    // processForgeMaterial already uses (house token or workspace key), so a
    // reachable check here never files a dead job.
    //
    // GATING: default ON — disable real forging with OWN_ENGINE_REAL_FORGE=0
    // (inverts the old opt-in), or kill ALL forging with the master switch
    // OWN_ENGINE_AUTOFORGE=0. Replay-locked renders NEVER forge (reproduce
    // exactly). COST SHAPE: forged loops PERSIST per lane (once per lane, not
    // per render — a role already on the shelf is never re-forged), so a lane
    // pays its forge cost ONCE then reuses; the SPEND is the operator's
    // authorized Replicate credits and the USER is charged $0 (own engine free
    // by owner order — these provider jobs carry no _charge). Fail-open: a
    // failed/unreachable forge falls to the synth floor with an honest note.
    const workspaceForgeKey = await (async () => {
      const ws = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      return ws?.musicProvider === "replicate"
        ? openSecret(ws.musicApiKey) || undefined
        : undefined;
    })();
    // A forge engine is reachable when forgeLoopAdapter can route to MusicGen:
    // the operator's house token OR the workspace's own Replicate key.
    const forgeReachable = Boolean(replicateToken()) || Boolean(workspaceForgeKey);
    const engineConnected =
      !replayLocked &&
      process.env.OWN_ENGINE_AUTOFORGE !== "0" &&
      process.env.OWN_ENGINE_REAL_FORGE !== "0" &&
      forgeReachable;
    const forgeCap = Math.max(
      0,
      Number(process.env.OWN_ENGINE_ONDEMAND_FORGE ?? 8) || 8
    );
    const realForged: string[] = [];
    if (engineConnected && forgeCap > 0) {
      // THE LANE'S CORE REAL KIT — requested roles first (an explicit ask leads),
      // then forgeKitFor priority (signature instruments before extra
      // percussion). Only beds the shelf does NOT already hold (no double-forge —
      // persisted loops are reused), only forgeable roles, 'fill' excluded (a
      // transition the synth floor still makes), capped per render. This is the
      // SAME candidate list pickKit re-selects with, so every landed loop is
      // immediately pickable.
      const richMissing = [...requestedRoles, ...forgeKitFor(p.genre, 12)]
        .filter((role, i, arr) => arr.indexOf(role) === i)
        .filter(r => r !== "fill")
        .filter(r => !haveRoles.has(r))
        .filter(r => Boolean(forgePromptFor(r, p.genre, bpm, homeKey)))
        .slice(0, forgeCap);
      // FORGE FAN-OUT (SOUNDCORE item 3): each role is an independent multi-minute
      // provider render — run them through a bounded pool instead of strictly
      // serially, honoring the 429 backoff inside processForgeMaterial. BARRIER:
      // the pool fully settles before coverage/re-pickKit below. realForged is
      // rebuilt in richMissing order for a deterministic note.
      const realForgedSet = new Set<string>();
      await forEachPool(richMissing, FORGE_FANOUT_CONCURRENCY, async role => {
        try {
          const forgeJob = await prisma.providerJob.create({
            data: {
              workspaceId: p.workspaceId,
              kind: "material",
              provider: "replicate",
              status: "QUEUED",
              inputJson: {
                genre: p.genre,
                role,
                bpm,
                keySignature: homeKey,
                auto: "own-engine-ondemand",
              } as never,
            },
            select: { id: true },
          });
          await processForgeMaterial({
            jobId: forgeJob.id,
            workspaceId: p.workspaceId,
            genre: p.genre,
            role,
            bpm,
            keySignature: homeKey,
          });
          // RECEIPTS, NOT VIBES: processForgeMaterial marks its own job and
          // never rethrows (a QC/role-purity/tempo rejection is a soft fail), so
          // read the job row to know whether the loop actually LANDED — only a
          // SUCCEEDED forge counts as a real instrument on the shelf (keeps the
          // cost-visibility note honest).
          const forged = await prisma.providerJob.findUnique({
            where: { id: forgeJob.id },
            select: { status: true },
          });
          if (forged?.status === "SUCCEEDED") {
            realForgedSet.add(role);
            haveRoles.add(role);
          }
        } catch (err) {
          // Real forge unavailable/throttled/failed for this role → it falls
          // to the synth floor below. Never fatal.
          console.warn(
            `[own-engine] real forge skipped for ${role}:`,
            (err as Error)?.message
          );
        }
      });
      realForged.push(...richMissing.filter(role => realForgedSet.has(role)));
      if (realForged.length) notes.push(`kit: forged real ${realForged.join("+")}`);
    }
    // RE-PICK AFTER THE REAL FORGE so the synth backfill sees what LANDED and
    // fills only the gaps (job-aware, below). A no-op when nothing forged.
    if (realForged.length) {
      picks = await pickKit(
        p.workspaceId,
        p.genre,
        bpm,
        homeKey,
        varietySeed,
        requestedRoles,
        p.lockedMaterialIds ?? []
      );
      haveRoles = new Set(picks.map(x => x.role));
    }
    // THE SYNTH FLOOR IS THE GAP-FILLER NOW, NOT THE DEFAULT (owner order
    // 2026-07-20). The coarse synth roles (drums/percussion/bass/chords) are a
    // DIFFERENT namespace than the fine forged/collected roles (talking_drum/
    // shekere/bass_guitar/rhodes), so a plain role match would re-add a synth
    // primitive on top of every real loop — exactly the "one sound" the owner
    // heard. Suppress synth per JOB: a coarse target is synth-forged only when
    // the REAL shelf is still BELOW the floor for that job (rhythm<2 / low-end<1
    // / harmony<1) — real instruments carry the bed, synth tops up only what
    // forging could not land. A requested role that never landed is still
    // floored by its exact role (it was explicitly asked for). 'fill' is a
    // job-less transition and always kept. When forge was disabled/unreachable
    // or landed nothing, EVERY job reads below the floor → the full $0 synth
    // floor runs exactly as before (never ships thinner than the baseline).
    const realCoverage = materialCoverage(picks);
    const coarseJobOf = (role: string): string | null =>
      isMaterialRole(role)
        ? jobOf(role)
        : (
            {
              drums: "rhythm",
              percussion: "rhythm",
              bass: "low_end",
              log_drum: "low_end",
              chords: "harmony",
            } as Record<string, string>
          )[role] ?? null;
    const jobBelowFloor = (job: string | null): boolean => {
      if (job === "rhythm") return realCoverage.rhythm < 2;
      if (job === "low_end") return realCoverage.lowEnd < 1;
      if (job === "harmony" || job === "melody") return realCoverage.tonal < 1;
      return true; // job-less / unknown → keep (never drop a floor the gate needs)
    };
    const requestedSet = new Set<string>(requestedRoles);
    const synthTargets = [
      ...new Set([...synthKitFor(p.genre), ...requestedRoles]),
    ];
    const missing = replayLocked
      ? []
      : synthTargets.filter(role => {
          if (haveRoles.has(role)) return false; // already on the shelf (forged/collected)
          if (role === "fill") return true; // transition floor — always
          if (requestedSet.has(role)) return true; // explicit ask → exact-role floor
          return jobBelowFloor(coarseJobOf(role)); // real shelf short in this job
        });
    if (missing.length) {
      notes.push(`kit: synth-forged ${missing.join("+")}`);
      await processSynthMaterial({
        workspaceId: p.workspaceId,
        genre: p.genre,
        bpm,
        keySignature: homeKey,
        roles: missing,
      });
      picks = await pickKit(
        p.workspaceId,
        p.genre,
        bpm,
        homeKey,
        varietySeed,
        requestedRoles,
        p.lockedMaterialIds ?? []
      );
    }
    // COST VISIBILITY (owner order 2026-07-20 item 6): the operator sees, on
    // every render, how many REAL instrument loops were forged vs synth
    // gap-fillers — and why real forging did or did not run.
    const forgeOffReason =
      process.env.OWN_ENGINE_AUTOFORGE === "0"
        ? "all forging disabled (OWN_ENGINE_AUTOFORGE=0)"
        : process.env.OWN_ENGINE_REAL_FORGE === "0"
          ? "real forge disabled (OWN_ENGINE_REAL_FORGE=0)"
          : replayLocked
            ? "replay-locked (renders reproduce exactly, never forge)"
            : !forgeReachable
              ? "no Replicate token reachable — set REPLICATE_API_TOKEN to forge real instruments"
              : null;
    notes.push(
      `forge floor: ${realForged.length} real instrument loop(s) forged + ${missing.length} synth gap-filler(s)` +
        (engineConnected
          ? " — real-instrument forging is the automatic default (operator Replicate spend; user charged $0)"
          : forgeOffReason
            ? ` — ${forgeOffReason}`
            : "")
    );
    let coverage = materialCoverage(picks);
    // AUTO-FORGE (owner order 2026-07-19 night): when a user picks AfroOne on a
    // shelf BELOW the material floor, the engine FORGES the missing starter
    // material first, then assembles — the new-user path becomes slow-but-real
    // instead of synthesizing from nothing and dying with "assembled take
    // failed QC (flat)". Bounded: only the roles needed to reach the floor
    // (planAutoForge, hard cap 8 loops), reusing the SAME kit-driven forge the
    // shelf already trusts (processForgeMaterial: QC'd, downbeat-trimmed,
    // loudness-normalized, rights stamped exactly as every forged loop —
    // source 'forged', rightsBasis 'provider-generated'; no classifier is
    // touched). Candidates come from forgeKitFor(genre, 12) — the SAME list
    // pickKit selects with — so every landed loop is re-selectable. The loops
    // PERSIST on the shelf (once per lane, not per render), and the USER is
    // never charged: these provider jobs carry no _charge/chargeLedgerId, the
    // own engine stays free by owner order. Kill switch: OWN_ENGINE_AUTOFORGE=0.
    // Disabled, replay-locked, no engine connected, or every forge failing →
    // the existing honest thin-shelf path below (fb9bb78) stays the fallback.
    const autoForgedRoles: string[] = [];
    if (
      !coverage.ready &&
      !replayLocked &&
      process.env.OWN_ENGINE_AUTOFORGE !== "0"
    ) {
      const forgeTargets = planAutoForge({
        coverage,
        coveredRoles: picks.map(pick => pick.role),
        // Rich kit first, then the coarse synth-kit roles as fallback — the
        // SAME tonal guarantee synthKitFor gives the $0 synth pass (a lane
        // whose top-12 rich kit has no harmony/melody, e.g. gqom, still gets
        // a forgeable 'chords' bed). Both lists are inside pickKit's role
        // selection, so every landed loop is re-selectable.
        candidateRoles: [
          ...forgeKitFor(p.genre, 12),
          ...synthKitFor(p.genre),
        ].filter(role => Boolean(forgePromptFor(role, p.genre, bpm, homeKey))),
      });
      if (forgeTargets.length) {
        // Pre-flight the SAME engine resolution processForgeMaterial uses, so
        // a disconnected studio skips cleanly instead of filing N dead jobs.
        const forgeWs = await prisma.workspace.findUnique({
          where: { id: p.workspaceId },
          select: { musicProvider: true, musicApiKey: true },
        });
        const forgeAdapter = musicAdapter(
          forgeWs?.musicProvider ?? undefined,
          openSecret(forgeWs?.musicApiKey)
        );
        if (forgeAdapter.name === "unavailable") {
          notes.push(
            `auto-forge unavailable: ${forgeTargets.length} starter loop(s) needed but no music engine is connected — upload a kit or connect an engine, then create again`
          );
        } else {
          // FORGE FAN-OUT (SOUNDCORE item 3): the starter loops are independent
          // provider renders — a bounded pool replaces the strictly-serial loop
          // (the #1 wall-clock sink), honoring the 429 backoff inside
          // processForgeMaterial. BARRIER PRESERVED: the pool fully settles before
          // the re-pickKit/coverage recompute below (CrucibAI proof-gated pattern:
          // fan out, then a verification barrier). autoForgedRoles is reordered to
          // the forgeTargets sequence for a deterministic disclosure note.
          const attempted: string[] = [...forgeTargets];
          await forEachPool(forgeTargets, FORGE_FANOUT_CONCURRENCY, async role => {
            try {
              const forgeJob = await prisma.providerJob.create({
                data: {
                  workspaceId: p.workspaceId,
                  kind: "material",
                  provider: "workspace-music",
                  status: "QUEUED",
                  inputJson: {
                    genre: p.genre,
                    role,
                    bpm,
                    keySignature: homeKey,
                    auto: "own-engine-autoforge",
                  } as never,
                },
                select: { id: true },
              });
              await processForgeMaterial({
                jobId: forgeJob.id,
                workspaceId: p.workspaceId,
                genre: p.genre,
                role,
                bpm,
                keySignature: homeKey,
              });
              // processForgeMaterial marks its own job and never rethrows —
              // read the receipt to know whether the loop actually landed.
              const forged = await prisma.providerJob.findUnique({
                where: { id: forgeJob.id },
                select: { status: true },
              });
              if (forged?.status === "SUCCEEDED") autoForgedRoles.push(role);
            } catch (err) {
              // One failed loop never kills the pass — the floor re-check
              // below decides whether we reached real coverage.
              console.warn(
                `[own-engine] auto-forge skipped for ${role}:`,
                (err as Error)?.message
              );
            }
          });
          autoForgedRoles.sort(
            (a, b) => forgeTargets.indexOf(a) - forgeTargets.indexOf(b)
          );
          if (autoForgedRoles.length) {
            picks = await pickKit(
              p.workspaceId,
              p.genre,
              bpm,
              homeKey,
              varietySeed,
              requestedRoles,
              p.lockedMaterialIds ?? []
            );
            coverage = materialCoverage(picks);
            notes.push(
              `auto-forge: shelf was below the floor — forged ${autoForgedRoles.length} starter loop(s) for ${p.genre} first (${autoForgedRoles.join("+")}) — upload your own kit to make it yours${
                attempted.length > autoForgedRoles.length
                  ? ` (${attempted.length - autoForgedRoles.length} of ${attempted.length} forge(s) did not land)`
                  : ""
              }`
            );
          } else {
            notes.push(
              `auto-forge failed: ${attempted.length} starter loop(s) attempted for ${p.genre}, none landed — falling back to the thin-shelf path`
            );
          }
        }
      }
    }
    // Requested-role strip/disclose runs on the FINAL picks (after any
    // auto-forge landed), so a role the rescue just forged is never wrongly
    // disclosed as "rendered without".
    const missingRequestedRoles = missingExactRequestedMaterialRoles(
      picks,
      requestedRoles
    );
    // OWNER DOCTRINE (2026-07-19, live kill: "synth_pad" failed its synth dedup
    // and this throw died the WHOLE paid render): a create never dead-ends over
    // one instrument. The unavailable role is DROPPED from the ask and the
    // record renders from everything that IS proven — with the honest note
    // riding the render. Same strip+disclose law as the API pre-flight, applied
    // at render depth where forge/synth failures actually surface.
    let provenRequestedRoles: MaterialRole[] = requestedRoles;
    if (missingRequestedRoles.length) {
      const missingSet = new Set<string>(missingRequestedRoles);
      provenRequestedRoles = requestedRoles.filter(
        role => !missingSet.has(role)
      );
      notes.push(
        `requested role(s) unavailable, rendered without: ${missingRequestedRoles.join("+")} (no proven material — upload or forge it and it joins future renders)`
      );
    }
    if (provenRequestedRoles.length) {
      notes.push(
        `requested roles: ${provenRequestedRoles.join("+")} (exact evidence)`
      );
    }
    if (!coverage.ready) {
      // OWNER DOCTRINE (2026-07-19, live kill #3: "verified shelf is incomplete
      // (beds=1, rhythm=1, low-end=0, tonal=0)" died the whole paid render): a
      // thin shelf renders a thin-but-real record WITH AN HONEST NOTE — it
      // never dies. The shelf grows with every synth pass / upload / nightly
      // forge, so early renders in a fresh lane are sparse by nature, not
      // broken. The ONLY hard stop left is literally zero usable material.
      if (!picks.length) {
        throw new Error(
          "own-engine: the shelf has no usable material at all for this lane — synth pass produced nothing"
        );
      }
      notes.push(
        `sparse shelf: rendered from ${picks.length} proven loop(s) (beds=${coverage.beds}, rhythm=${coverage.rhythm}, low-end=${coverage.lowEnd}, tonal=${coverage.tonal}) — the lane fills as material lands; re-render later for a fuller bed`
      );
    }

    // L1b — THE PRODUCER BRAIN (owner directive 2026-07-19: "dynamically
    // deterministic, not rigid heuristic laws"; audit receipt: 39 render
    // decisions, 0 LLM-judged, one hardcoded form for every song). Precedence:
    //   measured blueprint (Listen & recreate ground truth)
    //     > producer-brain plan (LLM taste over the ACTUAL shelf, bulk tier $0)
    //       > deterministic template (the fail-open floor — never worse than before).
    // The plan is refereed in code (roles must exist, bars/energy clamped) and
    // the assembler executes it EXACTLY. Kill switch: OWN_ENGINE_PRODUCER_BRAIN=0.
    // LENGTH IS A CONTRACT (audit 2026-07-19: the 64-bar template rendered
    // ~148s vs 185-200s lane targets, and nothing ever passed a duration).
    const requestedLaneDurationS =
      p.durationS ?? genreSignature(p.genre).durationS ?? 180;
    const parsedSingingSections = p.withVocals && p.lyrics?.trim()
      ? parseLyricSections(p.lyrics)
          .filter(section => section.lines.length > 0)
          .map(section => ({
            name: section.name,
            kind: section.kind,
            lines: section.lines,
          }))
      : [];
    const unfittedSingingDurationS = parsedSingingSections.length
      ? estimateComposedMelodyDurationS({ bpm, sections: parsedSingingSections })
      : 0;
    const fittedSingingSections = parsedSingingSections.length
      ? fitMelodySectionsToDuration(
          { bpm, sections: parsedSingingSections },
          240
        )
      : [];
    const singingDurationFloorS = p.withVocals
      ? p.melodyScore
        ? melodyScoreDurationS(p.melodyScore)
        : fittedSingingSections.length
          ? estimateComposedMelodyDurationS({
              bpm,
              sections: fittedSingingSections,
            })
          : 0
      : 0;
    if (unfittedSingingDurationS > singingDurationFloorS) {
      notes.push(
        `singing fit: preserved all lyric sections and reduced bar padding from ${Math.ceil(unfittedSingingDurationS)}s to ${Math.ceil(singingDurationFloorS)}s`
      );
    }
    if (singingDurationFloorS > 240) {
      throw new Error(
        `own-engine singing lyrics require ${Math.ceil(singingDurationFloorS)}s; the verified singer supports up to 240s`
      );
    }
    const laneDurationS = Math.max(requestedLaneDurationS, singingDurationFloorS);
    if (p.withVocals && laneDurationS > 240) {
      throw new Error(
        `own-engine singing target is ${Math.ceil(laneDurationS)}s; the verified singer supports up to 240s`
      );
    }
    const targetBars = Math.max(
      24,
      Math.min(160, Math.round((laneDurationS * bpm) / 240))
    );
    let plannedSections: Array<{ name: string; bars: number; roles: string[]; energy?: number }> | null = null;
    let productionPlanMeta: Record<string, unknown> | null = null;
    if (
      !p.blueprint?.sections?.length &&
      !p.deterministicMode &&
      process.env.OWN_ENGINE_PRODUCER_BRAIN !== "0"
    ) {
      const shelfCounts = new Map<string, number>();
      for (const pick of picks)
        shelfCounts.set(pick.role, (shelfCounts.get(pick.role) ?? 0) + 1);
      const lastOutcomes = await recentRenderOutcomes(p.workspaceId, p.genre);
      // EVERYTHING FEEDS THE ENGINE (owner 2026-07-19: "all the zaps, all the
      // listen-and-learn, all the measurements — bring them into our engine").
      const dna = getSoundDNA(p.genre);
      const laneDna = dna
        ? `${dna.groove.feel}. Arrangement wisdom: ${dna.arrangement
            .slice(0, 6)
            .map(a => `${a.section}[${a.bars}]: ${a.whatHappens}`)
            .join(" | ")}`
        : null;
      const learnedLessons = await learnedListeningLessons(
        p.workspaceId,
        p.genre,
        p.trainingUsage?.referenceIds ?? []
      );
      if (learnedLessons.length) {
        notes.push(
          `producer brain: ${learnedLessons.length} rights-safe Listen/Zap lesson(s) applied${p.trainingUsage?.referenceIds?.length ? " (selected references first)" : ""}`
        );
      }
      const plan = await planProduction({
        genre: p.genre,
        // MOOD as STRUCTURAL steering (owner: "heartbreak should feel like
        // heartbreak"): the brain biases the energy arc / density / bpm-key
        // lean WITHIN the lane. Was a declared-but-never-filled param.
        mood: p.mood ?? null,
        // ARTIST/PRODUCTION LANE ("feel like Dre" — style only, never a voice
        // clone; the guard rides inside the directive string).
        influenceLane: influenceDirective(p.influence),
        theme: p.melodyPrompt ?? null,
        bpmHint: bpm,
        keyHint: homeKey,
        targetBars,
        laneDna,
        learnedLessons,
        shelf: [...shelfCounts.entries()].map(([role, count]) => ({ role, count })),
        requestedRoles,
        lastOutcomes,
      });
      if (plan) {
        // HOOK LIFT (SOUNDWAVE1 fix 3): the plan's validated energy used to be
        // DROPPED right here — the arc now rides through to the assembly bus.
        plannedSections = plan.sections.map(s => ({
          name: s.name,
          bars: s.bars,
          roles: s.roles,
          energy: s.energy,
        }));
        productionPlanMeta = {
          intent: plan.intent ?? null,
          sections: plan.sections,
          suggestedBpm: plan.bpm ?? null,
          suggestedKey: plan.keySignature ?? null,
          fedOutcomes: lastOutcomes.length,
        };
        notes.push(
          `producer brain: ${plan.intent ?? "planned arrangement"} (${plan.sections.length} sections${lastOutcomes.length ? `, learned from ${lastOutcomes.length} prior render(s)` : ""})`
        );
      } else {
        notes.push("producer brain: no usable plan this run — deterministic template");
      }
    }
    let sections =
      plannedSections ??
      sectionsFrom(
        p.blueprint,
        picks.map(x => x.role)
      );
    const direction = p.direction ?? "commercial_safe";
    if (p.direction || p.deterministicMode) {
      sections = applyAfroOneDirection(
        sections,
        direction,
        picks.map(pick => pick.role)
      );
      notes.push(`direction: ${direction} (seed ${varietySeed})`);
    }
    // Template/fallback sections scale to the lane's length contract too — a
    // measured blueprint keeps its own bars (ground truth), everything else
    // meets the target. (The plan is already budget-clamped by the referee.)
    if (!p.blueprint?.sections?.length) {
      const total = sections.reduce((a, s) => a + s.bars, 0);
      if (total > 0 && Math.abs(total - targetBars) / targetBars > 0.15) {
        const scale = targetBars / total;
        sections = sections.map(s => ({
          ...s,
          bars: Math.min(32, Math.max(2, Math.round(s.bars * scale))),
        }));
        notes.push(
          `length contract: ${sections.reduce((a, s) => a + s.bars, 0)} bars ≈ ${Math.round((sections.reduce((a, s) => a + s.bars, 0) * 240) / bpm)}s (lane target ${laneDurationS}s)`
        );
      }
    }
    const child = await prisma.providerJob.create({
      data: {
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        kind: "music",
        provider: "material",
        status: "QUEUED",
        inputJson: {
          ownEngineChild: p.jobId,
          assemble: true,
          renderSpec:
            p.renderSpec ?? {
              version: AFROONE_RENDER_SPEC_VERSION,
              ontologyVersion: AFROONE_ONTOLOGY_VERSION,
              seed: varietySeed,
              direction,
              genre: p.genre,
              bpm,
              durationS: laneDurationS,
            },
          ...(requestedRoles.length
            ? { requestedRoles, requestedRoleProvenance }
            : {}),
        } as never,
      },
    });
    await processAssembleBeat({
      jobId: child.id,
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      songId: p.songId ?? undefined,
      bpm,
      genre: p.genre,
      picks,
      sections,
      withStems: p.withStems,
    } as never);
    const done = await prisma.providerJob.findUnique({
      where: { id: child.id },
      select: { status: true, outputJson: true, errorJson: true },
    });
    const out = (done?.outputJson ?? {}) as { beatId?: string; url?: string };
    if (done?.status !== "SUCCEEDED" || !out.beatId || !out.url) {
      // Surface the CHILD's real reason (material bed incomplete / role purity /
      // synth render fail…) instead of a blind "see child job", so the next
      // failure names its own cause.
      const childErr = (done?.errorJson as { message?: string } | null)?.message;
      const message = `own-engine: grid assembly failed${childErr ? ` — ${childErr}` : " (see child job)"}`;
      // NO WASTED RETRIES (live 2026-07-19 evening: an empty-shelf failure was
      // re-queued twice and failed identically each time — the shelf cannot
      // change between attempts). A SHELF-CLASS failure is deterministic:
      // mark it failed terminally instead of throwing into the retry loop.
      // Every other failure class keeps the existing throw-and-retry behavior.
      const shelfClass = /shelf is too thin|no bed material|no material picked|forge (drums|some loops|starter material)/i;
      if (childErr && shelfClass.test(childErr)) {
        await markFailed(p.jobId, `own_engine_failed: ${message}`);
        return;
      }
      throw new Error(message);
    }
    notes.push(
      `rhythm: assembled ${picks.map(x => x.role).join("+")} across ${sections.length} sections`
    );

    // BED-FIRST STREAMING (the handoff the streaming build waits for): the
    // instrumental bed is a certified playable asset RIGHT HERE, minutes before
    // the vocal/master finish. Emit it so the player streams it immediately and
    // hot-swaps to the master when the job completes. Fail-soft — emitJobEvent
    // never throws into the render.
    //
    // STAGE 2 of the three-stage stream: when SONG_BED_FIRST_STREAMING is on this
    // is the REAL-instrument bed (the player upgrades from the synth bed_preview
    // to this forged bed), so it carries stage:'forged'. Flag OFF → the payload
    // is exactly {url, beatId} as today (no preview ever fired; this is the one
    // terminal bed_ready), and the player treats a stage-less bed_ready as forged.
    await emitJobEvent(p.jobId, "bed_ready", {
      url: out.url,
      beatId: out.beatId,
      ...(bedFirstStreaming ? { stage: "forged" as const } : {}),
    });

    // P2 FEEDBACK LOOP (write side): the plan + its measured outcome live on
    // the beat, so the NEXT render's Producer Brain reads what this one
    // actually sounded like (LAST_OUTCOMES). Fail-open — a meta stamp never
    // breaks a finished render.
    if (productionPlanMeta) {
      try {
        const beatRow = await prisma.beatAsset.findUnique({
          where: { id: out.beatId },
          select: { meta: true },
        });
        await prisma.beatAsset.update({
          where: { id: out.beatId },
          data: {
            meta: {
              ...((beatRow?.meta ?? {}) as Record<string, unknown>),
              productionPlan: productionPlanMeta,
            } as never,
          },
        });
      } catch (err) {
        notes.push(
          `plan stamp skipped: ${(err as Error)?.message?.slice(0, 80)}`
        );
      }
    }

    // MELODY BRAIN (Own Singer piece 3) — the studio COMPOSES the vocal melody
    // itself when this render belongs to a song with a lyric: explicit notes
    // per syllable from the lane's DNA (home key + Afro pentatonic bias + the
    // prosody/hook-cell laws), the taste layer only picks phrasing parameters,
    // code emits every note. The score rides the beat's meta (the OWN-VOICE
    // seam below sings it once a trained voice is READY) and the guide WAV is
    // filed as audible evidence. ALL fail-open — a melody failure never breaks
    // the beat, it just leaves an honest note.
    let melodyScore: MelodyScore | null = p.melodyScore ?? null;
    let melodyGuideUrl: string | null = null;
    if (!melodyScore) {
      try {
        // LYRICS DECIDE THE PATH. A song with a lyric draft composes the SUNG
        // vocal melody (unchanged). A pure instrumental (no lyric) STILL gets a
        // tune — an instrumental topline over the arrangement — so it never ships
        // as drums+bass+chords with no lead. Only a song has a draft to read.
        let draft: Awaited<
          ReturnType<typeof prisma.lyricDraft.findUnique>
        > = null;
        let lyricSections: typeof fittedSingingSections = [];
        if (p.songId) {
          draft = await prisma.lyricDraft.findUnique({
            where: { songId: p.songId },
          });
          const lyricBody = p.lyrics?.trim() || draft?.body?.trim() || "";
          const parsedLyricSections = lyricBody
            ? parseLyricSections(lyricBody).filter(s => s.lines.length > 0)
            : [];
          lyricSections =
            p.lyrics?.trim() === lyricBody && fittedSingingSections.length
              ? fittedSingingSections
              : parsedLyricSections.length
                ? fitMelodySectionsToDuration(
                    {
                      bpm,
                      sections: parsedLyricSections.map(s => ({
                        name: s.name || s.kind,
                        kind: s.kind,
                        lines: s.lines,
                      })),
                    },
                    240
                  )
                : [];
        }
        if (lyricSections.length) {
          // Anchors come from the Writing Brain's craft object (same read the
          // singing pipeline does) — absent on old drafts, and that's fine.
          const craft = (draft?.craftJson ?? null) as {
            anchors?: unknown;
          } | null;
          const anchors = Array.isArray(craft?.anchors)
            ? (craft!.anchors as unknown[]).filter(
                (a): a is string => typeof a === "string" && !!a.trim()
              )
            : [];
          const feel = laneFeel(p.genre);
          melodyScore = await melodyBrain({
            genre: p.genre,
            bpm,
            key: homeKey,
            seed:
              p.renderSpec?.seed ??
              p.renderSeed ??
              seedFrom(p.songId ?? p.jobId, bpm),
            swing: feel.swing,
            syncopation: feel.syncopation,
            sections: lyricSections.map(s => ({
              name: s.name || s.kind,
              kind: s.kind,
              lines: s.lines,
              ...(anchors.length ? { anchors } : {}),
            })),
          });
          const noteCount = melodyScore.sections.reduce(
            (a, s) => a + s.notes.length,
            0
          );
          notes.push(
            `melody score: composed ${noteCount} notes across ${melodyScore.sections.length} sections in ${homeKey}`
          );
          // AUDIBLE EVIDENCE — a score guide attached to this beat, never
          // mislabeled as a reusable instrument material.
          try {
            const wav = await renderMelodyGuide(melodyScore);
            melodyGuideUrl = await uploadBytes({
              workspaceId: p.workspaceId,
              kind: "melody-guides",
              bytes: wav,
              contentType: "audio/wav",
              ext: "wav",
            });
            notes.push("melody guide: rendered and attached to the beat proof");
          } catch (err) {
            notes.push(
              `melody guide skipped: ${(err as Error)?.message?.slice(0, 100)}`
            );
          }
        } else if (!p.withVocals) {
          // INSTRUMENTAL TOPLINE (no lyric — instrumental-only). Build melody
          // sections from the SAME arrangement sections the bed was assembled on
          // (name → SectionKind, empty lines → composeMelody's instrumental
          // branch), so the SOUNDCORE lead-mix path below renders a real melodic
          // topline INTO the bed instead of leaving it lead-less. NEVER runs when
          // withVocals — there the vocal IS the topline. Deterministic per the
          // render seed (replay reproduces); pure code, no LLM, no provider call.
          const feel = laneFeel(p.genre);
          melodyScore = composeMelody({
            genre: p.genre,
            bpm,
            key: homeKey,
            seed:
              p.renderSpec?.seed ??
              p.renderSeed ??
              seedFrom(p.songId ?? p.jobId, bpm),
            swing: feel.swing,
            syncopation: feel.syncopation,
            sections: sections.map(s => ({
              name: s.name,
              kind: sectionKindOf(s.name),
              lines: [] as string[],
              bars: Math.max(2, Math.min(32, Math.round(s.bars))),
            })),
          });
          const noteCount = melodyScore.sections.reduce(
            (a, s) => a + s.notes.length,
            0
          );
          notes.push(
            `instrumental topline: composed ${noteCount} notes across ${melodyScore.sections.length} sections in ${homeKey} (no lyric — instrumental lead)`
          );
          // AUDIBLE EVIDENCE — same score guide the sung path files.
          try {
            const wav = await renderMelodyGuide(melodyScore);
            melodyGuideUrl = await uploadBytes({
              workspaceId: p.workspaceId,
              kind: "melody-guides",
              bytes: wav,
              contentType: "audio/wav",
              ext: "wav",
            });
            notes.push("melody guide: rendered and attached to the beat proof");
          } catch (err) {
            notes.push(
              `melody guide skipped: ${(err as Error)?.message?.slice(0, 100)}`
            );
          }
        } else {
          notes.push("melody score skipped: no lyric draft for this song");
        }
      } catch (err) {
        melodyScore = null;
        notes.push(
          `melody score skipped: ${(err as Error)?.message?.slice(0, 100)}`
        );
      }
    }

    // L2 — melody, conditioned on OUR groove (optional, fail-open).
    let finalUrl = out.url;
    const finalBeatId = out.beatId;
    const totalS =
      p.blueprint?.totalDurationS ??
      sections.reduce((a, s) => a + s.bars, 0) * (240 / bpm);

    // L1c — MELODY LEAD INTO THE FULL-LENGTH INSTRUMENTAL (SOUNDCORE item 1, the
    // highest-impact fix). melodyBrain already composed a real note-level score
    // for this song, but it only ever became a separate 'melody-guides' WAV — it
    // was NEVER summed into the bed, and the MusicGen topping is hard-gated to
    // <=30s. So a full-length AfroOne bed shipped as percussion + bass + block
    // chords with ZERO topline: a beat skeleton, not a song. Now the composed
    // score is rendered to a MUSICAL, lane-appropriate lead voice (EP / kalimba /
    // guitar / synth per genre — NOT a bare sine) and MIXED INTO THE BED as a lead
    // layer at MELODY_LEAD_GAIN — ABOVE the beds, UNDER where the vocal will sit —
    // for FULL-LENGTH songs, not just <=30s. Deterministic per seed (the score is
    // seeded; the lead is a pure ffmpeg synth of it). The updated bed becomes
    // out.url/finalUrl so the trained-layer + topping downstream build on the bed
    // that actually ships. FAIL-OPEN: any failure leaves the bed untouched with an
    // honest note (no lead), the render proceeds exactly as before.
    if (melodyScore) {
      let leadCertUrl: string | null = null;
      try {
        const leadWav = await renderMelodyLead(melodyScore, { genre: p.genre });
        const bed = await downloadToBuffer(finalUrl);
        const mixed = await mixBuffers(bed, leadWav, MELODY_LEAD_GAIN);
        const certified = await certifyAudioBytes({
          workspaceId: p.workspaceId,
          kind: "beats",
          bytes: mixed,
          contentType: "audio/wav",
          ext: "wav",
        });
        leadCertUrl = certified.url;
        const assembled = await prisma.beatAsset.findUnique({
          where: { id: finalBeatId },
          select: { url: true, meta: true },
        });
        if (!assembled || assembled.url !== finalUrl) {
          throw new Error("assembled beat changed before melody-lead certification");
        }
        const priorUrl = finalUrl;
        const updated = await prisma.beatAsset.updateMany({
          where: { id: finalBeatId, url: finalUrl },
          data: {
            url: certified.url,
            provider: "afrohit-own",
            duration: certified.qc.durationS,
            qualityState: certified.qualityState,
            contentHash: certified.contentHash,
            verifiedAt: certified.verifiedAt,
            meta: {
              ...((assembled.meta ?? {}) as Record<string, unknown>),
              melodyLead: {
                voice: leadVoiceFor(p.genre).name,
                gain: MELODY_LEAD_GAIN,
                sourceUrl: priorUrl,
                qc: certified.qc,
                contentHash: certified.contentHash,
                verifiedAt: certified.verifiedAt.toISOString(),
              },
            } as never,
          },
        });
        if (updated.count !== 1) {
          throw new Error("assembled beat changed during melody-lead certification");
        }
        finalUrl = certified.url;
        out.url = certified.url;
        leadCertUrl = null;
        notes.push(
          `melody lead: composed topline rendered as a ${leadVoiceFor(p.genre).name} voice and mixed into the full-length bed at ${MELODY_LEAD_GAIN} gain (${Math.round(totalS)}s)`
        );
        try {
          await deleteUnreferencedAssetRefs(p.workspaceId, [priorUrl]);
        } catch (retireError) {
          notes.push(
            `old lead bed retained for cleanup: ${(retireError as Error)?.message?.slice(0, 80)}`
          );
        }
      } catch (err) {
        if (leadCertUrl) {
          await deleteObjectByUrl(leadCertUrl).catch(() => {});
        }
        notes.push(
          `melody lead skipped: ${(err as Error)?.message?.slice(0, 120)}`
        );
      }
    }

    // L2-TRAINED — THE TRAINING IN THE SOUND (owner order 2026-07-20: "where is
    // all the training? we trained — where is it?"). Promotion used to write a
    // pointer NOTHING read — training was invisible in the sound by
    // construction. Now: when a candidate has been PROMOTED (measured win,
    // music.training.activeModel.v1) this render carries ONE topping layer from
    // OUR trained model — our weights (the fine-tune lives in the owner's
    // Replicate account, trained ONLY on the rights-clean corpus), stamped
    // engine 'lora' so the topped bed stays OWN-ORIGIN trainable fuel (stock
    // musicgen toppings keep their 'musicgen' stamp and stay third-party).
    // Flag OWN_ENGINE_TRAINED_LAYER: default ON when a ref exists; '0' kills
    // it. COST HONESTY: this is a PAID Replicate call (~$0.08/render) on the
    // house token — the promoted model is private to our account, a workspace
    // key cannot run it — so the receipt (estimatedCostUsd) rides the take AND
    // the job row. FAIL-OPEN THROUGHOUT: any failure leaves an honest "trained
    // layer skipped: <reason>" note and the render proceeds exactly as today.
    let trainedLayerReceipt: {
      trainedModelRef: string;
      layerRole: string;
      estimatedCostUsd: number;
      /** SOUNDWAVE2 Target D: measured gain applied to tame a hot fine-tune
       *  render to the loop shelf level before the QC gate (0 = untouched). */
      normalizedDb: number;
      sourceBpm: number | null;
      foldedSourceBpm: number | null;
      targetBpm: number;
      tempoRatio: number;
      tempoConformed: boolean;
      verifiedBpm: number | null;
    } | null = null;
    {
      // LICENSE-LANE-GATED base pointer (trainlegal): resolveActiveMusicModelRef
      // now returns ONLY a production-lane (commercially-licensed) promotion —
      // a cc-by-nc MusicGen fine-tune parses into the dev lane and can no
      // longer back this paid commercial render.
      const baseTrainedModelRef = await resolveActiveMusicModelRef().catch(
        () => null
      );
      // PER-GENRE/LANGUAGE ADAPTER ROUTE (flag-gated OFF by default via
      // MUSIC_ADAPTER_ROUTES_ENABLED): route this render's genre to its
      // matching production-lane adapter, base fallback otherwise.
      const activeModelRef = await resolveTrainedAdapterRefForRender({
        genre: p.genre,
        fallback: baseTrainedModelRef,
      }).catch(() => baseTrainedModelRef);
      const trainedDecision = trainedLayerDecision({
        modelRef: activeModelRef,
        flag: process.env.OWN_ENGINE_TRAINED_LAYER ?? null,
      });
      if (!trainedDecision.attempt) {
        notes.push(`trained layer skipped: ${trainedDecision.reason}`);
      } else {
        const trainedModelRef = activeModelRef!;
        const layerRole = "melody-topping";
        // Conditioned on THIS render: the caller's melody prompt (or the
        // lane's), the genre, the grid tempo, and the home key.
        const trainedPrompt = [
          p.melodyPrompt?.trim() || genreSignature(p.genre).melodyPrompt,
          `${p.genre} melodic topping over a locked groove`,
          `${bpm} BPM`,
          `in ${homeKey}`,
        ].join(", ");
        const layer = await renderTrainedMusicLayer({
          modelRef: trainedModelRef,
          prompt: trainedPrompt,
          durationS: totalS,
        });
        if (!layer.url) notes.push(layer.note);
        if (layer.url) {
          let certifiedUrl: string | null = null;
          try {
            const [bed, leadRaw] = await Promise.all([
              downloadToBuffer(out.url),
              downloadToBuffer(layer.url),
            ]);
            // TAME THE HOT RENDER (SOUNDWAVE2 Target D, live evidence
            // 2026-07-20: the promoted fine-tune FIRED for the first time and
            // was skipped with "audio_qc_failed: audio: clipping" — its output
            // arrives loudness-maximised). Normalize the layer to the SAME
            // loop shelf level every forge loop gets (-18 LUFS) BEFORE the
            // honesty gates and the mix, so a hot-but-good trained render is
            // tamed into the take instead of skipped. The gates below still
            // run on what actually ships — truly broken audio still skips
            // honestly (the fail-open catch keeps its note).
            const leadLevel = await normalizeLoopLoudness(leadRaw);
            let lead = leadLevel.bytes;
            const normalizedDb =
              leadLevel.applied && leadLevel.preLufs != null
                ? Math.round(
                    (LOOP_LOUDNESS_TARGET.lufs - leadLevel.preLufs) * 10
                  ) / 10
                : 0;
            // TEMPO-CONFORM: a generative fine-tune renders at ITS tempo, not the
            // render's grid ("melody fights the grid: ~138 vs 103 BPM"), so the
            // promoted layer kept being skipped. Time-stretch it onto the grid
            // (pitch-preserving atempo) BEFORE the honesty gate so a good-but-off-
            // tempo trained render MIXES IN. Fail-open. (SOUNDWAVE3 impl kept —
            // supersedes SOUNDCORE's conformLeadToGrid, same fix, richer receipt.)
            const tempoConform = await conformMelodyTempoToGrid(lead, bpm);
            lead = tempoConform.bytes;
            if (tempoConform.receipt.tempoConformed) {
              notes.push(
                `trained layer tempo-conformed: ${Math.round(tempoConform.receipt.sourceBpm ?? 0)} BPM to ${bpm} BPM (ratio ${tempoConform.receipt.tempoRatio.toFixed(4)})${tempoConform.receipt.verifiedBpm == null ? " (verified by the applied ratio; re-measure unavailable)" : ""}`
              );
            }
            // SAME HONESTY GATE as the stock topping: a fine-tune is still a
            // generative model — measure tempo/key against the grid BEFORE the
            // bed can be touched. A hard mismatch throws into the fail-open
            // catch below; the measured reason rides the record.
            const grid = await verifyMelodyAgainstGrid(lead, bpm, homeKey);
            if (!grid.ok) {
              // A LANDED exact-ratio conform is the AUTHORITATIVE tempo gate (it
              // stretched by the exact ratio, then confirmed the result within an
              // octave-folded post-conform tolerance). Re-measuring the SAME bytes
              // here only re-introduces detector noise on melodic content, so a
              // tempo-only rejection after a successful conform is accepted and
              // disclosed. A KEY mismatch — or a gridless lead the conform never
              // touched — still hard-fails into the fail-open catch below.
              if (grid.reason === "tempo" && tempoConform.receipt.tempoConformed) {
                notes.push(
                  `trained layer grid: tempo verified by the conform within ${Math.round(POST_CONFORM_TEMPO_TOLERANCE * 100)}% (verify re-measure noise disclosed: ${grid.note})`
                );
              } else {
                throw new Error(grid.note);
              }
            } else {
              notes.push(grid.note);
            }
            // PLACEMENT (fill-overlay pattern): the topping lands at the first
            // hook/chorus/drop arrival — where melody colour belongs — at a
            // modest UNDER-the-bed gain, peak-limited by the same graph the
            // section fills use, so the groove anchors are never buried. No
            // hook in the plan (or a hook past the topping window) → placed at
            // 0: the whole take is the window.
            const barSec = 240 / bpm;
            let placementS = 0;
            let cursorS = 0;
            for (const s of sections) {
              if (/hook|chorus|drop/i.test(s.name)) {
                placementS = cursorS;
                break;
              }
              cursorS += s.bars * barSec;
            }
            if (placementS >= Math.max(0, totalS - 8)) placementS = 0;
            const mixed = await overlayFills(bed, lead, [placementS], {
              fillGain: TRAINED_LAYER_GAIN,
            });
            const certified = await certifyAudioBytes({
              workspaceId: p.workspaceId,
              kind: "beats",
              bytes: mixed,
              contentType: "audio/wav",
              ext: "wav",
            });
            certifiedUrl = certified.url;

            const assembled = await prisma.beatAsset.findUnique({
              where: { id: finalBeatId },
              select: { url: true, meta: true },
            });
            if (!assembled || assembled.url !== out.url) {
              throw new Error(
                "assembled beat changed before trained-layer certification"
              );
            }
            const estimatedCostUsd =
              layer.estimatedCostUsd ?? TRAINED_MUSIC_LAYER_COST_USD;
            const updated = await prisma.beatAsset.updateMany({
              where: { id: finalBeatId, url: out.url },
              data: {
                url: certified.url,
                provider: "afrohit-own",
                duration: certified.qc.durationS,
                qualityState: certified.qualityState,
                contentHash: certified.contentHash,
                verifiedAt: certified.verifiedAt,
                meta: {
                  ...((assembled.meta ?? {}) as Record<string, unknown>),
                  // PROVENANCE STAMP: 'lora' is in OWN_ENGINES
                  // (training-corpus.ts) — output of OUR OWN trained model is
                  // own-origin trainable fuel, and beatToProvenance lets an
                  // own-engine topping fall through to the ingredient law
                  // (never a downgrade, never a launder).
                  melodyLayer: {
                    engine: "lora",
                    trainedModelRef,
                    layerRole,
                    estimatedCostUsd,
                    placementS,
                    // Target D receipts: measured pre-level + the shelf gain
                    // that tamed it (0 = arrived at level / unmeasurable).
                    normalizedDb,
                    sourceBpm: tempoConform.receipt.sourceBpm,
                    foldedSourceBpm: tempoConform.receipt.foldedSourceBpm,
                    targetBpm: tempoConform.receipt.targetBpm,
                    tempoRatio: tempoConform.receipt.tempoRatio,
                    tempoConformed: tempoConform.receipt.tempoConformed,
                    verifiedBpm: tempoConform.receipt.verifiedBpm,
                    preLufs: leadLevel.preLufs,
                    sourceUrl: out.url,
                    qc: certified.qc,
                    contentHash: certified.contentHash,
                    verifiedAt: certified.verifiedAt.toISOString(),
                  },
                } as never,
              },
            });
            if (updated.count !== 1) {
              throw new Error(
                "assembled beat changed during trained-layer certification"
              );
            }

            finalUrl = certified.url;
            certifiedUrl = null;
            trainedLayerReceipt = {
              trainedModelRef,
              layerRole,
              estimatedCostUsd,
              normalizedDb,
              sourceBpm: tempoConform.receipt.sourceBpm,
              foldedSourceBpm: tempoConform.receipt.foldedSourceBpm,
              targetBpm: tempoConform.receipt.targetBpm,
              tempoRatio: tempoConform.receipt.tempoRatio,
              tempoConformed: tempoConform.receipt.tempoConformed,
              verifiedBpm: tempoConform.receipt.verifiedBpm,
            };
            notes.push(
              `trained layer mixed: ${trainedModelRef} rendered this take's ${layerRole} at ${TRAINED_LAYER_GAIN} gain (placed ${Math.round(placementS)}s, ~$${estimatedCostUsd.toFixed(2)}${normalizedDb ? `, leveled ${normalizedDb > 0 ? '+' : ''}${normalizedDb} dB to the loop shelf` : ''})`
            );
            try {
              await deleteUnreferencedAssetRefs(p.workspaceId, [out.url]);
            } catch (retireError) {
              notes.push(
                `old trained-layer bed retained for cleanup: ${(retireError as Error)?.message?.slice(0, 80)}`
              );
            }
          } catch (err) {
            if (certifiedUrl) {
              await deleteObjectByUrl(certifiedUrl).catch(() => {});
            }
            notes.push(
              `trained layer skipped: ${(err as Error)?.message?.slice(0, 120)}`
            );
          }
        }
      }
    }

    if (trainedLayerReceipt) {
      // ONE topping per take: the promoted OWN model already rendered it — the
      // stock third-party musicgen call never runs on a trained take.
      if (p.melody === true) {
        notes.push(
          "provider melody superseded: the trained layer is this take's topping"
        );
      }
    } else if (p.melody === true && totalS <= 30) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      const workspaceReplicateKey =
        workspace?.musicProvider === "replicate"
          ? openSecret(workspace.musicApiKey)
          : undefined;
      // COST GUARD (owner incident 2026-07-19: "WHY AM I BEING CHARGED — I HAVE
      // MY OWN ENGINE"): the melody topping is a PAID MusicGen call on Replicate
      // (~$0.07-0.08/render). With own-engine renders FREE to users, the house
      // token turned every free render into an operator bill — the same silent
      // money leak as the Cerebras/Claude ladder. The paid topping now runs ONLY
      // when (a) the WORKSPACE brought its own Replicate key (their bill), or
      // (b) the operator explicitly opts in: OWN_ENGINE_MELODY_MUSICGEN=1.
      // Default: pure own material/synth — actually OUR engine, and cleanly
      // trainable (no third-party audio in the bed).
      const melodyAllowed =
        !!workspaceReplicateKey || process.env.OWN_ENGINE_MELODY_MUSICGEN === "1";
      const mel = melodyAllowed
        ? await melodyLayer(
            out.url,
            p.melodyPrompt ?? genreSignature(p.genre).melodyPrompt,
            totalS,
            workspaceReplicateKey
          )
        : {
            url: null,
            note: "melody topping off (paid third-party call) — pure own material/synth; workspace key or OWN_ENGINE_MELODY_MUSICGEN=1 enables it",
          };
      notes.push(mel.note);
      if (mel.url) {
        let certifiedUrl: string | null = null;
        try {
          const [bed, lead] = await Promise.all([
            downloadToBuffer(out.url),
            downloadToBuffer(mel.url),
          ]);
          // HONESTY GATE — verify the render against the grid BEFORE it can
          // touch the bed. A hard tempo/key mismatch throws into the existing
          // fail-open catch below, which files the measured reason as the
          // note: the beat ships clean, the skip is on the record.
          const grid = await verifyMelodyAgainstGrid(lead, bpm, homeKey);
          if (!grid.ok) {
            console.warn(`[own-engine] melody layer skipped: ${grid.note}`);
            throw new Error(grid.note);
          }
          notes.push(grid.note);
          const mixed = await mixBuffers(bed, lead, 0.85);
          const certified = await certifyAudioBytes({
            workspaceId: p.workspaceId,
            kind: "beats",
            bytes: mixed,
            contentType: "audio/wav",
            ext: "wav",
          });
          certifiedUrl = certified.url;

          const assembled = await prisma.beatAsset.findUnique({
            where: { id: finalBeatId },
            select: { url: true, meta: true },
          });
          if (!assembled || assembled.url !== out.url) {
            throw new Error(
              "assembled beat changed before melody certification"
            );
          }

          const updated = await prisma.beatAsset.updateMany({
            where: { id: finalBeatId, url: out.url },
            data: {
              url: certified.url,
              provider: "afrohit-own",
              duration: certified.qc.durationS,
              qualityState: certified.qualityState,
              contentHash: certified.contentHash,
              verifiedAt: certified.verifiedAt,
              meta: {
                ...((assembled.meta ?? {}) as Record<string, unknown>),
                melodyLayer: {
                  engine: "musicgen",
                  sourceUrl: out.url,
                  qc: certified.qc,
                  contentHash: certified.contentHash,
                  verifiedAt: certified.verifiedAt.toISOString(),
                },
              } as never,
            },
          });
          if (updated.count !== 1) {
            throw new Error(
              "assembled beat changed during melody certification"
            );
          }

          finalUrl = certified.url;
          certifiedUrl = null;
          notes.push(
            "melody mix: PASS-certified bytes replaced the assembled bed"
          );
          try {
            await deleteUnreferencedAssetRefs(p.workspaceId, [out.url]);
          } catch (retireError) {
            notes.push(
              `old melody bed retained for cleanup: ${(retireError as Error)?.message?.slice(0, 80)}`
            );
          }
        } catch (err) {
          if (certifiedUrl) {
            await deleteObjectByUrl(certifiedUrl).catch(() => {});
          }
          notes.push(
            `melody mix rejected or skipped: ${(err as Error)?.message?.slice(0, 100)}`
          );
        }
      }
    } else if (p.melody === true) {
      notes.push(
        `provider melody skipped: requested duration ${Math.round(totalS)}s exceeds the verified 30s conditioning window`
      );
    } else {
      notes.push("provider melody off: controlled material arrangement only");
    }

    // L4 — PROOF: lane compliance (persists measured/compliance/laneRepair on the
    // beat) + blueprint skeleton verification, receipts on the row.
    const laneAssessment = await assessLaneCompliance({
      workspaceId: p.workspaceId,
      genre: p.genre,
      beatId: finalBeatId,
      audioUrl: finalUrl,
    });
    let blueprintMatch: number | null = null;
    if (p.blueprint && (await dspAvailable())) {
      const m: MeasuredAnalysis | null = await measureAudio(finalUrl).catch(
        () => null
      );
      blueprintMatch = m?.engineOk
        ? structureMatch(blueprintFromMeasured(m), p.blueprint)
        : null;
    }
    const beatRow = await prisma.beatAsset.findUnique({
      where: { id: finalBeatId },
      select: { meta: true },
    });
    await prisma.beatAsset.update({
      where: { id: finalBeatId },
      data: {
        meta: {
          ...((beatRow?.meta ?? {}) as Record<string, unknown>),
          ...(melodyScore ? { melodyScore } : {}),
          ...(melodyGuideUrl ? { melodyGuideUrl } : {}),
          ...(p.trainingUsage ? { trainingUsage: p.trainingUsage } : {}),
          laneAssessment,
          ownEngine: {
            v: 3,
            layers: notes,
            // TRAINED-MODEL RECEIPT: "training in the sound" is provable per
            // render — which promoted model, what role, what it cost.
            ...(trainedLayerReceipt ? { trainedLayer: trainedLayerReceipt } : {}),
            // AUTO-FORGE disclosure rides the beat's permanent record, not
            // just the render notes: which starter loops this lane forged.
            ...(autoForgedRoles.length
              ? {
                  autoForge: {
                    roles: autoForgedRoles,
                    disclosure: `forged ${autoForgedRoles.length} starter loop(s) for ${p.genre} first — upload your own kit to make it yours`,
                  },
                }
              : {}),
            blueprintMatch,
            withVocals: p.withVocals === true,
            voiceProfileId: p.voiceProfileId ?? null,
            language: p.language ?? null,
            renderSpec:
              p.renderSpec ?? {
                version: AFROONE_RENDER_SPEC_VERSION,
                ontologyVersion: AFROONE_ONTOLOGY_VERSION,
                seed: varietySeed,
                direction,
                genre: p.genre,
                bpm,
                durationS: laneDurationS,
              },
            ...(requestedRoles.length
              ? {
                  requestedRoles,
                  requestedRoleProvenance,
                  requestedRoleReceipts: picks
                    .filter(pick =>
                      requestedRoles.includes(pick.role as MaterialRole)
                    )
                    .map(pick => ({
                      materialId: pick.id,
                      role: pick.role,
                      roleEvidence: pick.roleEvidence,
                      rightsBasis: pick.rightsBasis,
                    })),
                }
              : {}),
          },
        } as never,
      },
    });

    const referenceIds = [
      ...new Set((p.trainingUsage?.referenceIds ?? []).filter(Boolean)),
    ];
    if (referenceIds.length) {
      const references = await prisma.soundReference.findMany({
        where: {
          workspaceId: p.workspaceId,
          id: { in: referenceIds },
          active: true,
          analysisState: { not: "failed" },
          rightsBasis: { not: "unknown" },
        },
        select: {
          id: true,
          title: true,
          analysisState: true,
          rightsBasis: true,
        },
      });
      const byId = new Map(references.map(reference => [reference.id, reference]));
      await prisma.referenceUsage.createMany({
        data: referenceIds.flatMap((referenceId, position) => {
          const reference = byId.get(referenceId);
          if (!reference) return [];
          return [
            {
              workspaceId: p.workspaceId,
              referenceId,
              providerJobId: p.jobId,
              beatId: finalBeatId,
              songId: p.songId ?? null,
              genre: p.trainingUsage?.genre || p.genre,
              position,
              pinned: p.trainingUsage?.pinnedReferenceId === referenceId,
              influence: {
                path: "afroone-producer-brain+measured-lane-tags",
                title: reference.title,
                analysisState: reference.analysisState,
                rightsBasis: reference.rightsBasis,
                renderSeed: p.renderSpec?.seed ?? varietySeed,
                direction,
              } as never,
            },
          ];
        }),
        skipDuplicates: true,
      });
      notes.push(`training lineage: ${references.length} eligible reference receipt(s)`);
    }

    let singing: Record<string, unknown> | null = null;
    if (p.withVocals) {
      const lyricBody = p.lyrics?.trim();
      if (!lyricBody) {
        throw new Error("own-engine singing requested without lyrics");
      }
      if (!melodyScore) {
        throw new Error("own-engine singing requested without a valid melody score");
      }
      const singingTargetDurationS = Math.max(
        totalS,
        melodyScoreDurationS(melodyScore)
      );
      const manifest = createAfroOneSingingManifest({
        lyrics: lyricBody,
        melodyScore,
        genre: p.genre,
        language: p.language,
        targetDurationS: singingTargetDurationS,
      });
      const singingContract = afroOneSingingJobContract(
        manifest,
        p.voiceProfileId
      );
      const singingJob = await prisma.providerJob.create({
        data: {
          workspaceId: p.workspaceId,
          projectId: p.projectId,
          kind: "voice",
          provider: "afroone-singing",
          status: "QUEUED",
          idempotencyKey: `${p.jobId}:sing`,
          inputJson: {
            ...singingContract,
            parentJobId: p.jobId,
            beatId: finalBeatId,
            renderSpec: p.renderSpec ?? null,
          } as never,
        },
      });
      await processAfroOneSinging({
        jobId: singingJob.id,
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        songId: p.songId,
        voiceProfileId: p.voiceProfileId,
        lyrics: lyricBody,
        melodyScore,
        genre: p.genre,
        language: p.language,
        targetDurationS: singingTargetDurationS,
        instrumentalBeatId: finalBeatId,
        instrumentalUrl: finalUrl,
      });
      const completedSinging = await prisma.providerJob.findUnique({
        where: { id: singingJob.id },
        select: { status: true, outputJson: true, errorJson: true, cost: true },
      });
      if (completedSinging?.status !== "SUCCEEDED") {
        const message = (completedSinging?.errorJson as { message?: string } | null)
          ?.message;
        throw new Error(
          `own-engine singing failed${message ? `: ${message}` : ""}`
        );
      }
      const singingOutput = (completedSinging.outputJson ?? {}) as Record<
        string,
        unknown
      >;
      if (singingOutput.approved !== true) {
        throw new Error(
          "own-engine singing failed: vocal or finished mix did not pass approval gates"
        );
      }
      singing = {
        jobId: singingJob.id,
        costUsd: completedSinging.cost?.toString() ?? null,
        ...singingOutput,
      };
      notes.push("singing: genuine vocal generated, verified, and mixed over the owned bed");
    }

    await markSucceeded(p.jobId, {
      engine: "afrohit-own-v1",
      beatId: finalBeatId,
      instrumentalUrl: finalUrl,
      url:
        singing && typeof singing.url === "string" ? singing.url : finalUrl,
      blueprintMatch,
      laneAssessment,
      layers: notes,
      ...(trainedLayerReceipt ? { trainedLayer: trainedLayerReceipt } : {}),
      ...(autoForgedRoles.length
        ? {
            autoForge: {
              roles: autoForgedRoles,
              disclosure: `forged ${autoForgedRoles.length} starter loop(s) for ${p.genre} first — upload your own kit to make it yours`,
            },
          }
        : {}),
      renderSpec:
        p.renderSpec ?? {
          version: AFROONE_RENDER_SPEC_VERSION,
          ontologyVersion: AFROONE_ONTOLOGY_VERSION,
          seed: varietySeed,
          direction,
          genre: p.genre,
          bpm,
          durationS: laneDurationS,
        },
      ...(requestedRoles.length
        ? {
            requestedRoles,
            requestedRoleProvenance,
            requestedRoleReceipts: picks
              .filter(pick =>
                requestedRoles.includes(pick.role as MaterialRole)
              )
              .map(pick => ({
                materialId: pick.id,
                role: pick.role,
                roleEvidence: pick.roleEvidence,
                rightsBasis: pick.rightsBasis,
              })),
          }
        : {}),
      ...(singing
        ? { singing }
        : {
            // CAPABILITY-AWARE (owner 2026-07-20: "it's still saying bring your
            // own lyrics" — this stored note outlived the singing wave and kept
            // telling users the engine couldn't sing). When the singing route is
            // armed, a bed-only take names the real unlock; the upload path
            // stays as the alternative, never the only option.
            voice:
              process.env.AFROONE_SINGING_ENABLED === "1"
                ? "AfroOne sings: create with vocals on and it writes AND sings the song; paste lyrics and it sings them word-for-word. Or upload your own lead."
                : "record/upload a sung lead, or convert an existing performance with POST /voices/:voiceId/sing",
          }),
    },
    // COST EVIDENCE: the trained topping is the only PAID call this processor
    // makes on the house token — when it rendered, its estimate rides the job
    // row like every other adapter's estimatedCostUsd.
    trainedLayerReceipt ? trainedLayerReceipt.estimatedCostUsd : undefined);
    console.log(
      `[own-engine] ${p.genre} done — ${notes.join(" | ")}${blueprintMatch != null ? ` | skeleton ${Math.round(blueprintMatch * 100)}%` : ""}`
    );
  } catch (err) {
    await markFailed(
      p.jobId,
      `own_engine_failed: ${(err as Error)?.message ?? "unknown"}`
    );
    console.warn("[own-engine] failed:", (err as Error)?.message);
  }
}
