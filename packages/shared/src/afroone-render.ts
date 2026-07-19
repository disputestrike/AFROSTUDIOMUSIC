import { isMaterialRole, jobOf } from "./material-roles";

export const AFROONE_DIRECTIONS = [
  "commercial_safe",
  "spacious_restrained",
  "energetic_hook_forward",
] as const;

export type AfroOneDirection = (typeof AFROONE_DIRECTIONS)[number];

export const AFROONE_RENDER_SPEC_VERSION = "afroone-render-v1";
export const AFROONE_ONTOLOGY_VERSION = "afroone-ontology-2026-07";

export interface AfroOneDirectionProfile {
  id: AfroOneDirection;
  label: string;
  sectionRoleCap: number;
  verseRoleCap: number;
  hookRoleCap: number;
  introRoleCap: number;
  energyBias: number;
  hookLift: number;
  fillIntensity: "restrained" | "balanced" | "assertive";
  intent: string;
}

export const AFROONE_DIRECTION_PROFILES: Record<
  AfroOneDirection,
  AfroOneDirectionProfile
> = {
  commercial_safe: {
    id: "commercial_safe",
    label: "Commercial-safe",
    sectionRoleCap: 6,
    verseRoleCap: 5,
    hookRoleCap: 6,
    introRoleCap: 3,
    energyBias: 0,
    hookLift: 0.12,
    fillIntensity: "balanced",
    intent: "Clear vocal space, familiar structure, and a controlled hook lift.",
  },
  spacious_restrained: {
    id: "spacious_restrained",
    label: "Spacious and restrained",
    sectionRoleCap: 4,
    verseRoleCap: 3,
    hookRoleCap: 4,
    introRoleCap: 2,
    energyBias: -0.15,
    hookLift: 0.14,
    fillIntensity: "restrained",
    intent: "Fewer simultaneous roles, more negative space, and restrained transitions.",
  },
  energetic_hook_forward: {
    id: "energetic_hook_forward",
    label: "Energetic and hook-forward",
    sectionRoleCap: 7,
    verseRoleCap: 5,
    hookRoleCap: 7,
    introRoleCap: 3,
    energyBias: 0.12,
    hookLift: 0.3,
    fillIntensity: "assertive",
    intent: "A stronger hook arrival, active transitions, and controlled peak density.",
  },
};

export interface AfroOneRenderSpecification {
  version: typeof AFROONE_RENDER_SPEC_VERSION;
  ontologyVersion: typeof AFROONE_ONTOLOGY_VERSION;
  seed: number;
  direction: AfroOneDirection;
  genre: string;
  bpm: number;
  durationS: number;
  shelfSnapshotHash?: string;
}

export function isAfroOneRenderSpecification(
  value: unknown
): value is AfroOneRenderSpecification {
  if (!value || typeof value !== "object") return false;
  const spec = value as Record<string, unknown>;
  return (
    spec.version === AFROONE_RENDER_SPEC_VERSION &&
    spec.ontologyVersion === AFROONE_ONTOLOGY_VERSION &&
    typeof spec.seed === "number" &&
    Number.isInteger(spec.seed) &&
    spec.seed >= 0 &&
    spec.seed <= 0xffffffff &&
    AFROONE_DIRECTIONS.includes(spec.direction as AfroOneDirection) &&
    typeof spec.genre === "string" &&
    typeof spec.bpm === "number" &&
    typeof spec.durationS === "number"
  );
}

export interface DirectionSection {
  name: string;
  bars: number;
  roles: string[];
  energy?: number;
}

function roleRank(role: string): number {
  const family = isMaterialRole(role) ? jobOf(role) : undefined;
  switch (family ?? role) {
    case "rhythm":
    case "drums":
    case "percussion":
      return 0;
    case "low_end":
    case "bass":
    case "log_drum":
      return 1;
    case "harmony":
    case "chords":
      return 2;
    case "melody":
      return 3;
    case "vocal":
      return 4;
    case "transition":
    case "fill":
      return 5;
    default:
      return 3;
  }
}

function sectionKind(name: string): "intro" | "hook" | "verse" | "other" {
  const normalized = name.toLowerCase();
  if (/intro|outro/.test(normalized)) return "intro";
  if (/hook|chorus|drop/.test(normalized)) return "hook";
  if (/verse|pre/.test(normalized)) return "verse";
  return "other";
}

function capFor(profile: AfroOneDirectionProfile, kind: ReturnType<typeof sectionKind>) {
  if (kind === "intro") return profile.introRoleCap;
  if (kind === "hook") return profile.hookRoleCap;
  if (kind === "verse") return profile.verseRoleCap;
  return profile.sectionRoleCap;
}

/**
 * Apply a named, deterministic production direction to an arrangement.
 * Existing roles are never invented. Hook sections may pull additional roles
 * from the proven shelf, while every cap keeps rhythm and low-end anchors first.
 */
export function applyAfroOneDirection(
  sections: readonly DirectionSection[],
  direction: AfroOneDirection,
  allRoles: readonly string[]
): DirectionSection[] {
  const profile = AFROONE_DIRECTION_PROFILES[direction];
  const available = [...new Set(allRoles)].sort((a, b) => roleRank(a) - roleRank(b));

  return sections.map(section => {
    const kind = sectionKind(section.name);
    const cap = capFor(profile, kind);
    const existing = [...new Set(section.roles)].sort((a, b) => roleRank(a) - roleRank(b));
    const candidates =
      kind === "hook" && direction === "energetic_hook_forward"
        ? [...new Set([...existing, ...available])]
        : existing;
    const roles = candidates.sort((a, b) => roleRank(a) - roleRank(b)).slice(0, cap);
    const baseEnergy = section.energy ?? (kind === "hook" ? 0.82 : kind === "intro" ? 0.42 : 0.65);
    const hookDelta = kind === "hook" ? profile.hookLift : 0;
    const energy = Math.max(0, Math.min(1, baseEnergy + profile.energyBias + hookDelta));
    return { ...section, roles, energy: Number(energy.toFixed(3)) };
  });
}

/** FNV-1a: stable across Node/browser and independent of a generated job id. */
export function deriveAfroOneSeed(
  seed: number,
  direction: AfroOneDirection
): number {
  let value = seed >>> 0;
  const text = `${AFROONE_RENDER_SPEC_VERSION}:${direction}`;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

export function afroOneDirectionsForRequest(
  requested: readonly AfroOneDirection[] | undefined,
  candidates: number | undefined
): AfroOneDirection[] {
  if (requested?.length) return [...new Set(requested)].slice(0, 3);
  if ((candidates ?? 1) >= 3) return [...AFROONE_DIRECTIONS];
  if ((candidates ?? 1) === 2)
    return ["commercial_safe", "energetic_hook_forward"];
  return ["commercial_safe"];
}
