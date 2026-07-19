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
  forgeKitFor,
  structureMatch,
  genreSignature,
  synthKitFor,
  isMaterialRole,
  jobOf,
  parseLyricSections,
  laneFeel,
  seedFrom,
  selectMaterialRows,
  materialCoverage,
  materialGenreMatches,
  type SongBlueprint,
  type MeasuredAnalysis,
  type MelodyScore,
  withCoarseMaterialRoles,
  hasExactMaterialRoleEvidence,
  missingExactRequestedMaterialRoles,
  REQUESTED_MATERIAL_ROLES_VERSION,
  requestedMaterialRoleContract,
  type MaterialRole,
  type RequestedMaterialRoleProvenance,
} from "@afrohit/shared";
import { melodyBrain, getSoundDNA } from "@afrohit/ai";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  resolveAssetForProvider,
  uploadBytes,
} from "../lib/storage";
import { measureAudioBufferQuality, mixBuffers } from "../lib/ffmpeg";
import { certifyAudioBytes } from "../lib/certified-assets";
import { deleteUnreferencedAssetRefs } from "./asset-cleanup";
import { renderMelodyGuide } from "../lib/melody-guide";
import { measureAudio, dspAvailable } from "../lib/dsp";
import { markRunning, markSucceeded, markFailed } from "../lib/jobs";
import { assessLaneCompliance } from "../lib/lane-assess";
import { processSynthMaterial } from "./synth-material";
import { processAssembleBeat, processForgeMaterial } from "./material";
import { forgePromptFor } from "../lib/forge-prompts";
import { replicateToken } from "@afrohit/ai";

export interface OwnEnginePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string | null;
  genre: string;
  bpm?: number;
  melody?: boolean;
  melodyPrompt?: string;
  blueprint?: SongBlueprint | null;
  requestedRoles?: MaterialRole[];
  requestedRoleProvenance?: RequestedMaterialRoleProvenance;
}

async function pickKit(
  workspaceId: string,
  genre: string,
  bpm: number,
  key: string,
  varietySeed: number,
  requestedRoles: readonly MaterialRole[] = []
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
  const rows = shelf
    .filter((row: { genre: string | null }) => materialGenreMatches(row.genre, genre))
    .slice(0, 240);
  const exactRequested = new Set<string>(requestedRoles);
  const eligibleRows = rows.filter(
    (row: { role: string; roleEvidence?: string | null }) =>
      !exactRequested.has(row.role) || hasExactMaterialRoleEvidence(row)
  );
  // Rich signature roles lead; deterministic synth primitives remain the
  // controllable foundation when a lane's collected shelf is still shallow.
  const roles = withCoarseMaterialRoles([
    ...requestedRoles,
    ...forgeKitFor(genre, 12),
    ...synthKitFor(genre),
  ]);
  return selectMaterialRows(eligibleRows, roles, bpm, key, { varietySeed });
}

/** Hard ceiling on CONCURRENT roles in one section. The collected+forged kit
 *  can be 12+ roles; twelve loops at once is a wall of sound no producer would
 *  print — density comes from the ARRANGEMENT, not from stacking everything. */
const SECTION_ROLE_CAP = 7;

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
      if (n >= 3 && (i === 0 || i === n - 1)) sectionRoles = lite;
      else if (n === 2) sectionRoles = i === 0 ? mid : full;
      else if (n >= 4 && (i - 1) % 2 === 0) sectionRoles = mid;
      return {
        name: `S${i + 1}`,
        bars: Math.max(2, s.bars ?? 8),
        roles: sectionRoles,
      };
    });
  }
  const noBassPick = cap(prioritized.filter(role => roleJob(role) !== "low_end"));
  const strip = cap(
    prioritized.filter(
      role => roleJob(role) === "harmony" || roleJob(role) === "melody"
    )
  );
  return [
    { name: "intro", bars: 4, roles: lite }, // real sparse open — 2 rhythm + 1 harmony
    { name: "verse", bars: 16, roles: noBassPick.length >= 2 ? noBassPick : full }, // bass held back
    { name: "hook", bars: 8, roles: full }, // full band arrives
    { name: "verse2", bars: 16, roles: full }, // fuller than verse 1
    { name: "bridge", bars: 8, roles: strip.length ? strip : lite }, // energy flip: strip-back
    { name: "hook2", bars: 8, roles: full },
    { name: "outro", bars: 4, roles: lite },
  ];
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
): Promise<{ ok: boolean; note: string }> {
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

export async function processOwnEngine(p: OwnEnginePayload): Promise<void> {
  await markRunning(p.jobId);
  const notes: string[] = [];
  try {
    const bpm = p.bpm ?? genreSignature(p.genre).bpm ?? 112;
    const homeKey = getSoundDNA(p.genre)?.commonKeys?.[0] ?? "A minor";
    const varietySeed = seedFrom(p.jobId, bpm);

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
      requestedRoles
    );
    const haveRoles = new Set(picks.map(x => x.role));
    // MATERIALS FROM THE RICH FORGE FIRST, synth only as the floor (owner,
    // 2026-07-17: "use all African instruments — not a stand-in"). Two tiers,
    // same as the nightly kit-forge:
    //   Tier 1 (REAL): every missing REQUESTED role that has a real forge
    //     prompt (the 105-role African vocabulary) is rendered on the
    //     connected engine — a real shekere/djembe/talking-drum, not math.
    //   Tier 2 (FLOOR): base primitives + any role the real forge can't do
    //     are synth-forged (family-mapped so they never hard-fail).
    // On-demand real forging is bounded so one song can't spend the night;
    // the nightly kit-forge grows each lane so this rarely fires twice.
    // COST GUARD (owner order 2026-07-19: "using our own engine we don't wanna
    // pay a DIME"): each real-forge render is a PAID Replicate call — up to
    // forgeCap per song — and the house token used to count as "connected", so
    // every fresh-shelf render silently billed the operator (the receipts the
    // owner saw). The paid on-demand forge now runs ONLY when (a) the WORKSPACE
    // brought its own Replicate key (their bill), or (b) the operator opts in
    // via OWN_ENGINE_REAL_FORGE=1 (a deliberate shelf-stocking spend). Default:
    // the $0 synth floor covers every missing role (family-mapped, never
    // hard-fails); the operator-budgeted NIGHTLY forge remains the deliberate
    // way to stock shelves with real instruments.
    const engineConnected =
      (process.env.OWN_ENGINE_REAL_FORGE === "1" && Boolean(replicateToken())) ||
      (await (async () => {
        const ws = await prisma.workspace.findUnique({
          where: { id: p.workspaceId },
          select: { musicProvider: true, musicApiKey: true },
        });
        return (
          ws?.musicProvider === "replicate" && Boolean(openSecret(ws.musicApiKey))
        );
      })());
    const forgeCap = Math.max(
      0,
      Number(process.env.OWN_ENGINE_ONDEMAND_FORGE ?? 6) || 6
    );
    const realForged: string[] = [];
    if (engineConnected && forgeCap > 0) {
      const richMissing = requestedRoles
        .filter(r => !haveRoles.has(r))
        .filter(r => Boolean(forgePromptFor(r, p.genre, bpm, homeKey)))
        .slice(0, forgeCap);
      for (const role of richMissing) {
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
          realForged.push(role);
          haveRoles.add(role);
        } catch (err) {
          // Real forge unavailable/throttled/failed for this role → it falls
          // to the synth floor below. Never fatal.
          console.warn(
            `[own-engine] real forge skipped for ${role}:`,
            (err as Error)?.message
          );
        }
      }
      if (realForged.length) notes.push(`kit: forged real ${realForged.join("+")}`);
    }
    // The synth FLOOR: base primitives + any requested role the real forge
    // didn't cover. Family-mapped so it never hard-fails.
    const synthTargets = [
      ...new Set([...synthKitFor(p.genre), ...requestedRoles]),
    ];
    const missing = synthTargets.filter(r => !haveRoles.has(r));
    if (missing.length) {
      notes.push(`kit: synth-forged ${missing.join("+")}`);
      await processSynthMaterial({
        workspaceId: p.workspaceId,
        genre: p.genre,
        bpm,
        keySignature: homeKey,
        roles: missing,
      });
    }
    if (missing.length || realForged.length) {
      picks = await pickKit(
        p.workspaceId,
        p.genre,
        bpm,
        homeKey,
        varietySeed,
        requestedRoles
      );
    }
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
    const coverage = materialCoverage(picks);
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

    // L1b — assemble on the grid via the existing renderer (child job, called inline).
    const sections = sectionsFrom(
      p.blueprint,
      picks.map(x => x.role)
    );
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
      throw new Error(
        `own-engine: grid assembly failed${childErr ? ` — ${childErr}` : " (see child job)"}`
      );
    }
    notes.push(
      `rhythm: assembled ${picks.map(x => x.role).join("+")} across ${sections.length} sections`
    );

    // MELODY BRAIN (Own Singer piece 3) — the studio COMPOSES the vocal melody
    // itself when this render belongs to a song with a lyric: explicit notes
    // per syllable from the lane's DNA (home key + Afro pentatonic bias + the
    // prosody/hook-cell laws), the taste layer only picks phrasing parameters,
    // code emits every note. The score rides the beat's meta (the OWN-VOICE
    // seam below sings it once a trained voice is READY) and the guide WAV is
    // filed as audible evidence. ALL fail-open — a melody failure never breaks
    // the beat, it just leaves an honest note.
    let melodyScore: MelodyScore | null = null;
    let melodyGuideUrl: string | null = null;
    if (p.songId) {
      try {
        const draft = await prisma.lyricDraft.findUnique({
          where: { songId: p.songId },
        });
        const lyricSections = draft?.body
          ? parseLyricSections(draft.body).filter(s => s.lines.length > 0)
          : [];
        if (!lyricSections.length) {
          notes.push("melody score skipped: no lyric draft for this song");
        } else {
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
            seed: seedFrom(p.songId, bpm),
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
    if (p.melody === true && totalS <= 30) {
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
          laneAssessment,
          ownEngine: {
            v: 2,
            layers: notes,
            blueprintMatch,
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

    // Voice is an explicit verified handoff: RVC changes identity, but it does
    // not invent a sung performance from an instrumental or melody guide.
    await markSucceeded(p.jobId, {
      engine: "afrohit-own-v1",
      beatId: finalBeatId,
      url: finalUrl,
      blueprintMatch,
      laneAssessment,
      layers: notes,
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
      voice:
        "record/upload a sung lead, or convert an existing performance with POST /voices/:voiceId/sing",
    });
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
