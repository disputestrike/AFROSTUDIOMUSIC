/**
 * LANE SAMPLE KIT — the seam for LICENSED REAL INSTRUMENTS (the instrument floor).
 *
 * Owner order 2026-07-20 ("not our instruments"): a default full-length AfroOne
 * render lands ~4 numpy SYNTH primitives and no real instruments, because the
 * only cost-free path is the synth backfill. This module is the RAIL for licensed
 * real loops: when a lane has licensed instrument audio, those loops are the
 * INSTRUMENT FLOOR and must be selected BEFORE any synth primitive fills the same
 * role — a real shekere over a math shaker.
 *
 * DIVISION OF LABOUR (this file is the seam, another agent implements the body):
 *  - RAILS (here, done): the SampleKitRef type, the laneSampleKit(genre) stub
 *    (returns [] today), and sampleKitFloorRows() — the pure mapper that turns
 *    refs into selectable rows the kit picker already understands. pickKit calls
 *    laneSampleKit FIRST so, the instant refs exist, they lead selection.
 *  - BODY (the sample-kit agent): populate laneSampleKit(genre) with the licensed
 *    loops (URL + role + measured bpm/key + license basis) once the audio is
 *    cleared and hosted. Nothing else changes — the rail is already wired.
 *
 * NO-OP TODAY: laneSampleKit returns [] for every genre, so sampleKitFloorRows
 * returns [] and pickKit's selection is byte-for-byte the current synth path.
 */
import type { SelectableMaterial } from "./material-select";

/** A pointer to ONE licensed real-instrument loop for a lane. The audio itself
 *  lives at `url` (already licensed + hosted by the body implementation); the
 *  metadata is what the deterministic kit selector needs to place it on the grid
 *  in the right role, tempo and key. */
export interface SampleKitRef {
  /** Material role this loop serves (e.g. 'shekere', 'log_drum', 'chords'). Must
   *  be a role the selector/assembler knows — a MaterialRole or a coarse role. */
  role: string;
  /** Playable audio URL for the licensed loop. */
  url: string;
  /** Measured tempo of the loop (BPM). Absent → treated as tempo-unknown, which
   *  the selector only allows for non-tempo-critical (fx/vocal) roles. */
  bpm?: number | null;
  /** Musical key of the loop (e.g. 'A minor'). Absent → key-unknown (fine for
   *  drums/percussion; keyed roles prefer a matching key). */
  keySignature?: string | null;
  /** Bar length of the loop, when known. */
  bars?: number;
  /** The licensing basis carried onto the material row's `rightsBasis`. Defaults
   *  to 'licensed' — never 'unknown' (an unknown-rights loop can never assemble). */
  license?: string;
  /** Stable id for the row; defaults to a deterministic id derived from the url. */
  id?: string;
}

/**
 * The lane's licensed sample kit. STUB: returns [] for every genre today — the
 * body (licensed loops) is landed by the sample-kit agent. When it returns refs,
 * pickKit prepends them as the instrument floor (see sampleKitFloorRows) so a
 * real licensed instrument is selected before the synth primitive for its role.
 *
 * Deterministic and side-effect-free by contract: same genre → same refs.
 */
export function laneSampleKit(_genre: string): SampleKitRef[] {
  // OTHER-AGENT-FILLS: return the lane's licensed loops here (role + url +
  // measured bpm/key + license). Keep it deterministic per genre. Until then the
  // engine falls through to the collected shelf + synth floor exactly as today.
  return [];
}

/**
 * Turn licensed sample-kit refs into selectable material rows — the instrument
 * FLOOR the kit picker prefers over synth primitives. `source:'licensed'` +
 * `rightsBasis:'licensed'` make each row rights-clean and, via
 * effectiveMaterialRoleEvidence, 'licensed-metadata' evidence (auto-assemblable
 * family evidence, ranked ABOVE synth-code). Rows are `readiness:'ready'` /
 * `qualityState:'passed'` so they pass the selection gates.
 *
 * PURE + no-op safe: an empty kit yields [] and pickKit's selection is unchanged.
 */
export function sampleKitFloorRows(kit: readonly SampleKitRef[]): SelectableMaterial[] {
  return kit.map((ref, index) => ({
    id: ref.id ?? `sample-kit:${ref.role}:${index}:${ref.url}`,
    url: ref.url,
    role: ref.role,
    bpm: ref.bpm ?? null,
    keySignature: ref.keySignature ?? null,
    source: "licensed",
    readiness: "ready",
    qualityState: "passed",
    rightsBasis: ref.license?.trim() || "licensed",
    // Leave roleEvidence unset → effectiveMaterialRoleEvidence derives
    // 'licensed-metadata' from source:'licensed' (family evidence, auto-assembles).
    roleEvidence: null,
  }));
}
