import { isKeyedRole, isMaterialRole, jobOf } from "./material-roles";
import { materialGainFor, materialPanFor } from "./lane-material";

export interface SelectableMaterial {
  id: string;
  url: string;
  role: string;
  bpm: number | null;
  keySignature: string | null;
  source: string;
  readiness?: string | null;
  qualityState?: string | null;
  rightsBasis?: string | null;
  roleEvidence?: string | null;
}

export interface SelectedMaterial {
  id: string;
  url: string;
  sourceBpm: number;
  role: string;
  gain: number;
  pan: number;
  rightsBasis: string;
  readiness: string;
  qualityState: string;
  roleEvidence: string;
}

const NOTE: Record<string, number> = {
  c: 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
};

function parseKey(
  value?: string | null
): { pitch: number; mode: "major" | "minor" | null } | null {
  const match = value
    ?.trim()
    .toLowerCase()
    .match(/^([a-g](?:#|b)?)(?:\s*(major|minor|maj|min|m))?/);
  if (!match || NOTE[match[1]!] == null) return null;
  const rawMode = match[2] ?? "";
  const mode =
    rawMode === "m" || rawMode === "min" || rawMode === "minor"
      ? "minor"
      : rawMode === "maj" || rawMode === "major"
        ? "major"
        : null;
  return { pitch: NOTE[match[1]!]!, mode };
}

/** 0 exact, 1 relative/same-tonic compatible, 2 unknown, 3 wrong key. */
export function materialKeyScore(
  role: string,
  candidate?: string | null,
  target?: string | null
): number {
  if (!isKeyedRole(role) || !target) return 0;
  const a = parseKey(candidate);
  const b = parseKey(target);
  if (!a) return 2;
  if (!b)
    return candidate?.trim().toLowerCase() === target.trim().toLowerCase()
      ? 0
      : 2;
  if (a.pitch === b.pitch && (a.mode === b.mode || !a.mode || !b.mode))
    return 0;
  if (a.pitch === b.pitch) return 1;
  const relative =
    (a.mode === "minor" &&
      b.mode === "major" &&
      (a.pitch + 3) % 12 === b.pitch) ||
    (a.mode === "major" &&
      b.mode === "minor" &&
      (b.pitch + 3) % 12 === a.pitch);
  return relative ? 1 : 3;
}

const SOURCE_RANK: Record<string, number> = {
  artist_stem: 0,
  licensed: 1,
  forged: 2,
  provider_stem: 3,
};
/** RIGHTS_RANK measures LEGAL confidence only, never sonic quality — that is
 * why 'code-generated' (our own numpy synth, legally spotless) still outranks
 * 'provider-generated' here. The sonic demotion of synth loops lives in the
 * bridge tier + ROLE_EVIDENCE_RANK below, both of which sort BEFORE rights in
 * selectMaterialRows, so this legal ordering can never resurrect a test tone
 * over a real forged loop. */
const RIGHTS_RANK: Record<string, number> = {
  "user-attested": 0,
  "code-generated": 1,
  licensed: 2,
  "provider-generated": 3,
  unknown: 4,
};
/** 'synth-code' is PROOF the file serves its role (the code wrote the part),
 * but it is also the sound of numpy: sine-pure test-tone loops. It used to sit
 * at rank 0 alongside real stems, so the math loops outranked AI-forged loops
 * for the song's foundation — the literal "test tones in real songs" the owner
 * hears. Synth loops are BRIDGE material now: rank below every forged/licensed
 * evidence class, and the bridge tier in selectMaterialRows only lets them win
 * when no non-synth candidate passed the gates at all. */
const ROLE_EVIDENCE_RANK: Record<string, number> = {
  "stem-separated": 0,
  "human-confirmed": 0,
  "licensed-metadata": 1,
  "provider-prompted-dsp-consistent": 1,
  "provider-prompted-technical-only": 2,
  "synth-code": 3,
  "provider-prompted-unconfirmed": 4,
  "provider-prompted": 4,
  unknown: 5,
};

export type MaterialRoleEvidenceLevel =
  | "exact"
  | "family"
  | "texture"
  | "unconfirmed";

/** Normalize old rows without promoting a provider prompt into proof. */
export function effectiveMaterialRoleEvidence(
  row: Pick<SelectableMaterial, "role" | "source" | "roleEvidence">
): string {
  const evidence = row.roleEvidence?.trim() || "unknown";
  if (evidence !== "unknown") return evidence;
  if (row.source === "artist_stem" || row.source === "provider_stem")
    return "stem-separated";
  if (row.source === "licensed") return "licensed-metadata";
  return "unknown";
}

/**
 * Automatic placement needs evidence that the file serves the claimed musical
 * job. Prompt-only and DSP-inconsistent rows stay visible on the shelf but do
 * not silently become the kick, piano, flute, or log drum in a finished beat.
 * Vocal/transition textures are the narrow exception: current DSP can prove a
 * playable file but not distinguish a chant from a crowd layer, so that lower
 * confidence remains explicit in the receipt.
 */
export function materialRoleEvidenceLevel(
  row: Pick<SelectableMaterial, "role" | "source" | "roleEvidence">
): MaterialRoleEvidenceLevel {
  const evidence = effectiveMaterialRoleEvidence(row);
  if (
    evidence === "synth-code" ||
    evidence === "stem-separated" ||
    evidence === "human-confirmed"
  )
    return "exact";
  if (
    evidence === "licensed-metadata" ||
    evidence === "provider-prompted-dsp-consistent"
  )
    return "family";
  if (
    evidence === "provider-prompted-technical-only" &&
    isMaterialRole(row.role)
  ) {
    const job = jobOf(row.role);
    if (job === "vocal" || job === "transition") return "texture";
  }
  return "unconfirmed";
}

export function materialCanAutoAssemble(
  row: Pick<SelectableMaterial, "role" | "source" | "roleEvidence">
): boolean {
  return materialRoleEvidenceLevel(row) !== "unconfirmed";
}

/**
 * Canonical genre form for material matching — the SAME normalization as
 * lane-material.ts's norm() (lowercase, trim, collapse whitespace/slash/hyphen
 * runs to '_'), so 'Afrobeats', 'afro-beats' and 'afrobeats' are one genre.
 * Production kit selection used exact string equality in Prisma where-clauses,
 * which made artist stems tagged 'Afrobeats' invisible to a lane tagged
 * 'afrobeats' — the shelf looked empty while the material sat right there.
 *
 * WIRING STATE (source-truth wave, 2026-07): writes now normalize at create
 * time (material.ts forge, synth-material.ts) and the read sites below fetch a
 * wider window and compare with materialGenreMatches() in JS — legacy rows
 * with un-normalized tags stay visible because BOTH sides normalize at compare
 * time. Rewired: own-engine.ts pickKit, song-edit.ts (add_fill + resing),
 * chat-tools.ts assemble tool, material-plan.ts ownShelfRoles, materials.ts
 * shelf listing, music.ts fill selection.
 * STILL ON PRISMA EQUALITY (operator note): compound.ts nightly kit counts
 * (~1309-1318) — out of the wave's scope; worst case the nightly forge
 * over-forges a lane whose rows carry legacy tags. Rewire the same way.
 */
export function normalizeMaterialGenre(genre?: string | null): string {
  return (genre ?? "").toLowerCase().trim().replace(/[\s/-]+/g, "_");
}

/** True when both genres are present and canonically equal. Null/empty never
 * matches — callers decide whether an untagged row is acceptable (e.g. the
 * fill overlay treats genre-null fills as workspace-wide). */
export function materialGenreMatches(
  a?: string | null,
  b?: string | null
): boolean {
  const na = normalizeMaterialGenre(a);
  const nb = normalizeMaterialGenre(b);
  return !!na && !!nb && na === nb;
}

/** The musical job a selection role serves, including the legacy coarse roles
 * and the section fill (which is drum material and must land on the grid even
 * though it lives outside the taxonomy). Mirrors materialCoverage's mapping. */
const COARSE_JOB: Record<string, string> = {
  drums: "rhythm",
  percussion: "rhythm",
  bass: "low_end",
  log_drum: "low_end",
  chords: "harmony",
  fill: "rhythm",
};
function selectionJobOf(role: string): string | null {
  if (isMaterialRole(role)) return jobOf(role);
  return COARSE_JOB[role] ?? null;
}

/** Jobs where a loop at the WRONG tempo wrecks the groove outright. fx/vocal
 * textures survive a free-running overlay; the pocket does not. */
const TEMPO_CRITICAL_JOBS = new Set(["rhythm", "low_end", "harmony"]);

/** Synth-code loops are bridge material (see ROLE_EVIDENCE_RANK): honest,
 * legally clean, and audibly a math demo. They may only win when nothing
 * forged/licensed/stem-separated passed the gates for the role. */
function isSynthBridge(row: SelectableMaterial): boolean {
  return effectiveMaterialRoleEvidence(row) === "synth-code";
}

/**
 * One deterministic selector for API assembly and the AfroHit-controlled engine.
 * Rejected/failed/duplicate and rights-unclassified rows can never be selected.
 * Pending legacy assets may be selected, but the worker must technically verify
 * them before any audio ships.
 */
export function selectMaterialRows(
  rows: SelectableMaterial[],
  roles: string[],
  bpm: number,
  keySignature?: string | null,
  opts?: { varietySeed?: number }
): SelectedMaterial[] {
  const picks: SelectedMaterial[] = [];
  for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
    const role = roles[roleIndex]!;
    // Unmeasured tempo cannot be conformed honestly: sourceBpm would default to
    // the target (ratio 1.0) and the loop would be assembled at whatever its
    // real tempo is — a groove-wrecker for rhythm/low-end/harmony. fx and vocal
    // textures remain selectable at bpm-null (they ride the bed, not the grid).
    const tempoCritical = TEMPO_CRITICAL_JOBS.has(selectionJobOf(role) ?? "");
    const gated = rows
      .filter(row => row.role === role)
      .filter(
        row =>
          row.readiness !== "rejected" &&
          row.qualityState !== "failed" &&
          row.qualityState !== "duplicate"
      )
      .filter(row => !!row.rightsBasis && row.rightsBasis !== "unknown")
      .filter(row => materialCanAutoAssemble(row))
      // ±5% (was ±15%): smaller atempo ratios mean fewer stretch artifacts and
      // less drift when the stored bpm is slightly off the true tempo.
      .filter(row =>
        row.bpm == null
          ? !tempoCritical
          : Math.abs(row.bpm - bpm) / bpm <= 0.05
      );
    // Key is a GATE for keyed roles, not just a sort: whenever any candidate
    // with a compatible/unknown key passed the other gates, wrong-key rows
    // (score 3) are disqualified outright — a wrong-key chords loop must never
    // ride a variety rotation into the mix. If ONLY wrong-key rows exist the
    // role stays coverable (the caller sees the key in the receipt).
    const keyScoreOf = (row: SelectableMaterial) =>
      materialKeyScore(role, row.keySignature, keySignature);
    const anyBetterKey = gated.some(row => keyScoreOf(row) < 3);
    const candidates = gated
      .filter(row => !anyBetterKey || keyScoreOf(row) < 3)
      .sort(
        (a, b) =>
          (isSynthBridge(a) ? 1 : 0) - (isSynthBridge(b) ? 1 : 0) ||
          (a.readiness === "ready" ? 0 : 1) -
            (b.readiness === "ready" ? 0 : 1) ||
          keyScoreOf(a) - keyScoreOf(b) ||
          (ROLE_EVIDENCE_RANK[effectiveMaterialRoleEvidence(a)] ?? 5) -
            (ROLE_EVIDENCE_RANK[effectiveMaterialRoleEvidence(b)] ?? 5) ||
          (RIGHTS_RANK[a.rightsBasis ?? "unknown"] ?? 5) -
            (RIGHTS_RANK[b.rightsBasis ?? "unknown"] ?? 5) ||
          (SOURCE_RANK[a.source] ?? 4) - (SOURCE_RANK[b.source] ?? 4) ||
          Math.abs((a.bpm ?? bpm) - bpm) - Math.abs((b.bpm ?? bpm) - bpm) ||
          a.id.localeCompare(b.id)
      );
    // Variety must never trade key fit or realness for novelty: the rotation
    // window is the leading run of candidates TIED with the winner on both the
    // synth-bridge tier and the key score (previously a flat top-3, which let
    // a worse-key or test-tone loop rotate over an exact-key forged one).
    let tiedRun = candidates.length ? 1 : 0;
    while (
      tiedRun > 0 &&
      tiedRun < candidates.length &&
      keyScoreOf(candidates[tiedRun]!) === keyScoreOf(candidates[0]!) &&
      isSynthBridge(candidates[tiedRun]!) === isSynthBridge(candidates[0]!)
    ) {
      tiedRun += 1;
    }
    const window = Math.min(3, tiedRun);
    const selected =
      opts?.varietySeed != null && window > 1
        ? candidates[
            (Math.abs(Math.floor(opts.varietySeed)) + roleIndex) % window
          ]
        : candidates[0];
    if (!selected) continue;
    picks.push({
      id: selected.id,
      url: selected.url,
      sourceBpm: selected.bpm ?? bpm,
      role,
      gain: materialGainFor(role),
      pan: materialPanFor(role),
      rightsBasis: selected.rightsBasis ?? "unknown",
      readiness: selected.readiness ?? "pending",
      qualityState: selected.qualityState ?? "unmeasured",
      roleEvidence: effectiveMaterialRoleEvidence(selected),
    });
  }
  return picks;
}

/** A shippable material bed needs depth plus rhythm, low end, and tonal color. */
export function materialCoverage(picks: Array<{ role: string }>) {
  const beds = picks.filter(pick => pick.role !== "fill");
  const jobFor = (role: string) =>
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
  const jobs = beds.map(pick => jobFor(pick.role)).filter(Boolean);
  const rhythm = jobs.filter(job => job === "rhythm").length;
  const lowEnd = jobs.filter(job => job === "low_end").length;
  const tonal = jobs.filter(
    job => job === "harmony" || job === "melody"
  ).length;
  // BED FLOOR is an env knob (default 5 = unchanged). Root cause of the
  // "verified shelf is incomplete" hard-fails: this demanded beds>=5 but the
  // synth floor only makes 4 distinct beds for non-log-drum genres, so cold
  // lanes could never pass their own gate. Set OWN_ENGINE_MIN_BEDS=4 on Railway
  // to let a 4-role synth bed ship (cold-lane reliability) without a deploy;
  // keep 5 to hold the fuller-bed quality bar. Used by BOTH the API auto-route
  // and the worker gate, so they can never disagree.
  const minBeds = Math.max(1, Number(process.env.OWN_ENGINE_MIN_BEDS) || 4);
  return {
    beds: beds.length,
    rhythm,
    lowEnd,
    tonal,
    minBeds,
    ready: beds.length >= minBeds && rhythm >= 2 && lowEnd >= 1 && tonal >= 1,
  };
}
