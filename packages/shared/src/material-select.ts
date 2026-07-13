import { isKeyedRole, isMaterialRole, jobOf } from './material-roles';
import { materialGainFor, materialPanFor } from './lane-material';

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
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4,
  f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9,
  'a#': 10, bb: 10, b: 11,
};

function parseKey(value?: string | null): { pitch: number; mode: 'major' | 'minor' | null } | null {
  const match = value?.trim().toLowerCase().match(/^([a-g](?:#|b)?)(?:\s*(major|minor|maj|min|m))?/);
  if (!match || NOTE[match[1]!] == null) return null;
  const rawMode = match[2] ?? '';
  const mode = rawMode === 'm' || rawMode === 'min' || rawMode === 'minor'
    ? 'minor'
    : rawMode === 'maj' || rawMode === 'major'
      ? 'major'
      : null;
  return { pitch: NOTE[match[1]!]!, mode };
}

/** 0 exact, 1 relative/same-tonic compatible, 2 unknown, 3 wrong key. */
export function materialKeyScore(role: string, candidate?: string | null, target?: string | null): number {
  if (!isKeyedRole(role) || !target) return 0;
  const a = parseKey(candidate);
  const b = parseKey(target);
  if (!a) return 2;
  if (!b) return candidate?.trim().toLowerCase() === target.trim().toLowerCase() ? 0 : 2;
  if (a.pitch === b.pitch && (a.mode === b.mode || !a.mode || !b.mode)) return 0;
  if (a.pitch === b.pitch) return 1;
  const relative =
    (a.mode === 'minor' && b.mode === 'major' && (a.pitch + 3) % 12 === b.pitch) ||
    (a.mode === 'major' && b.mode === 'minor' && (b.pitch + 3) % 12 === a.pitch);
  return relative ? 1 : 3;
}

const SOURCE_RANK: Record<string, number> = {
  artist_stem: 0,
  licensed: 1,
  forged: 2,
  provider_stem: 3,
};
const RIGHTS_RANK: Record<string, number> = {
  'user-attested': 0,
  'code-generated': 1,
  licensed: 2,
  'provider-generated': 3,
  unknown: 4,
};
const ROLE_EVIDENCE_RANK: Record<string, number> = {
  'synth-code': 0,
  'stem-separated': 0,
  'provider-prompted-dsp-consistent': 1,
  'provider-prompted-technical-only': 2,
  'provider-prompted-unconfirmed': 3,
  unknown: 4,
};

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
  opts?: { varietySeed?: number },
): SelectedMaterial[] {
  const picks: SelectedMaterial[] = [];
  for (let roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
    const role = roles[roleIndex]!;
    const candidates = rows
      .filter((row) => row.role === role)
      .filter((row) => row.readiness !== 'rejected' && row.qualityState !== 'failed' && row.qualityState !== 'duplicate')
      .filter((row) => !!row.rightsBasis && row.rightsBasis !== 'unknown')
      .filter((row) => row.bpm == null || Math.abs(row.bpm - bpm) / bpm <= 0.15)
      .sort((a, b) =>
        (a.readiness === 'ready' ? 0 : 1) - (b.readiness === 'ready' ? 0 : 1) ||
        materialKeyScore(role, a.keySignature, keySignature) - materialKeyScore(role, b.keySignature, keySignature) ||
        (ROLE_EVIDENCE_RANK[a.roleEvidence ?? 'unknown'] ?? 4) - (ROLE_EVIDENCE_RANK[b.roleEvidence ?? 'unknown'] ?? 4) ||
        (RIGHTS_RANK[a.rightsBasis ?? 'unknown'] ?? 5) - (RIGHTS_RANK[b.rightsBasis ?? 'unknown'] ?? 5) ||
        (SOURCE_RANK[a.source] ?? 4) - (SOURCE_RANK[b.source] ?? 4) ||
        Math.abs((a.bpm ?? bpm) - bpm) - Math.abs((b.bpm ?? bpm) - bpm) ||
        a.id.localeCompare(b.id),
      );
    const window = Math.min(3, candidates.length);
    const selected = opts?.varietySeed != null && window > 1
      ? candidates[(Math.abs(Math.floor(opts.varietySeed)) + roleIndex) % window]
      : candidates[0];
    if (!selected) continue;
    picks.push({
      id: selected.id,
      url: selected.url,
      sourceBpm: selected.bpm ?? bpm,
      role,
      gain: materialGainFor(role),
      pan: materialPanFor(role),
      rightsBasis: selected.rightsBasis ?? 'unknown',
      readiness: selected.readiness ?? 'pending',
      qualityState: selected.qualityState ?? 'unmeasured',
      roleEvidence: selected.roleEvidence ?? 'unknown',
    });
  }
  return picks;
}

/** A shippable material bed needs depth plus rhythm, low end, and tonal color. */
export function materialCoverage(picks: Array<{ role: string }>) {
  const beds = picks.filter((pick) => pick.role !== 'fill');
  const jobFor = (role: string) => isMaterialRole(role)
    ? jobOf(role)
    : ({ drums: 'rhythm', percussion: 'rhythm', bass: 'low_end', log_drum: 'low_end', chords: 'harmony' } as Record<string, string>)[role];
  const jobs = beds.map((pick) => jobFor(pick.role)).filter(Boolean);
  const rhythm = jobs.filter((job) => job === 'rhythm').length;
  const lowEnd = jobs.filter((job) => job === 'low_end').length;
  const tonal = jobs.filter((job) => job === 'harmony' || job === 'melody').length;
  return {
    beds: beds.length,
    rhythm,
    lowEnd,
    tonal,
    ready: beds.length >= 5 && rhythm >= 2 && lowEnd >= 1 && tonal >= 1,
  };
}
