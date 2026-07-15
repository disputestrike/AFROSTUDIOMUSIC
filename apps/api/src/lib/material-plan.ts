import { prisma } from "@afrohit/db";
import { getSoundDNA, generateJson } from "@afrohit/ai";
import {
  MATERIAL_GAINS,
  forgeKitFor,
  materialCanAutoAssemble,
  materialCoverage,
  selectMaterialRows,
  withCoarseMaterialRoles,
  type SelectableMaterial,
  type SelectedMaterial,
} from "@afrohit/shared";

/**
 * MATERIAL PLANNING — one source of truth for the material layer's brain,
 * shared by the REST route and the chat tools:
 *   kitRolesFor()      which roles a genre's kit wants on the shelf
 *   pickMaterial()     choose the best loop per role (genre → key → bpm → stems-first)
 *   claudeArrangement() Claude authors the build for THIS material (validated)
 */

// Gain doctrine now lives in @afrohit/shared (the worker needs it too) — re-export
// so existing importers keep working.
export { MATERIAL_GAINS, materialCoverage };

/**
 * The genre's REAL kit — delegates to the shared forgeKitFor (Executive-Summary
 * spec: signature roles first, rhythm-first required roles, capped, +fill) so the
 * API, worker nightly self-provisioning, and tests all read ONE definition.
 */
export function kitRolesFor(genre: string, cap = 30): string[] {
  return forgeKitFor(genre, cap);
}

/** The genre's home key — melodic loops forge + assemble in it by default. */
export function homeKeyFor(genre: string): string {
  return getSoundDNA(genre)?.commonKeys?.[0] ?? "A minor";
}

/**
 * MATERIAL-FIRST AUTO (audit: engine 'auto' ALWAYS rented a provider): when the
 * engine is unset and the ask is an INSTRUMENTAL, a stocked shelf routes the
 * render to the owned engine instead. "Stocked" = at least OWN_ENGINE_MIN_ROLES
 * (default 6) DISTINCT roles of real MaterialAssets for this workspace+genre —
 * enough kit for pickMaterial to build a real beat, not a two-loop skeleton.
 * Returns the distinct-role count when the shelf qualifies, null otherwise.
 * Vocal asks NEVER route here — the own engine cannot sing (that stays provider).
 */
export async function ownShelfRoles(
  workspaceId: string,
  genre: string
): Promise<number | null> {
  const min = Math.max(1, Number(process.env.OWN_ENGINE_MIN_ROLES) || 6);
  const rows: Array<{ role: string; source: string; roleEvidence: string }> =
    await prisma.materialAsset.findMany({
      where: {
        workspaceId,
        genre,
        readiness: "ready",
        qualityState: "passed",
        rightsBasis: { not: "unknown" },
      },
      select: { role: true, source: true, roleEvidence: true },
    });
  const roles = [
    ...new Set(rows.filter(materialCanAutoAssemble).map(row => row.role)),
  ];
  return roles.length >= min &&
    materialCoverage(roles.map(role => ({ role }))).ready
    ? roles.length
    : null;
}

export type MaterialRow = SelectableMaterial;
export type MaterialPick = SelectedMaterial;

/**
 * Best loop per wanted role: bpm within ±15%, then key-compatible melodic
 * material first (unknown key stays usable, WRONG key sinks last), artist
 * stems over forged, closest bpm wins.
 *
 * varietySeed (ASSEMBLY VARIETY — the "every beat sounds identical" fix): the
 * deterministic sort meant rank #1 won a role FOREVER, so every assemble of a
 * lane placed the exact same loops. With a seed, each role still ranks exactly
 * as above but the pick rotates among the TOP 3 (or fewer) candidates via
 * (seed + roleIndex) % k — same seed = same beat (replayable), fresh seed =
 * fresh combination. No seed = the legacy byte-identical pick (tests depend on it).
 */
export function pickMaterial(
  rows: MaterialRow[],
  genre: string,
  bpm: number,
  keySignature?: string | null,
  opts?: { varietySeed?: number; roles?: string[] }
): MaterialPick[] {
  return selectMaterialRows(
    rows,
    withCoarseMaterialRoles(opts?.roles ?? kitRolesFor(genre)),
    bpm,
    keySignature ?? homeKeyFor(genre),
    opts
  );
}

export interface ArrangementSection {
  name: string;
  bars: number;
  roles: string[];
}

/**
 * The brain authors the arrangement for the material actually on hand — the
 * creative half of the material layer. BULK tier (owner's cost law): Cerebras
 * first, laddering up on any failure — the hard validation below is the
 * quality gate. Hard-validated: sections 3-8, bars 2-16 each, total 12-48,
 * roles ⊆ available, at least one full-stack peak. Any failure → null (worker
 * uses the classic template), never a broken beat.
 */
export async function claudeArrangement(
  genre: string,
  bpm: number,
  available: string[],
  vibe?: string
): Promise<ArrangementSection[] | null> {
  try {
    const dna = getSoundDNA(genre);
    const out = await generateJson<{
      sections: Array<{ name: string; bars: number; roles: string[] }>;
    }>({
      tier: "bulk",
      task: "beat-arrangement",
      system:
        "You are a top producer ARRANGING a beat from real, already-rendered loops. You control ONLY: section order, section length in bars, and which layers play in each section. " +
        "Think like the genre: how does energy enter, build, breathe, and leave? Strip-downs and drops are your tools. " +
        "Return strict JSON {sections:[{name, bars, roles:[...]}]}: 3-8 sections, bars per section 2-16 (multiples of 2), total bars <= 48, roles must be a subset of the available layers, and AT LEAST one section uses every available layer (the peak). Return only JSON.",
      user:
        `Genre: ${genre} at ${bpm}bpm. Available layers: ${available.join(", ")}.` +
        (vibe ? ` Vibe: ${vibe}.` : "") +
        (dna?.arrangement?.length
          ? ` Genre arrangement instincts: ${dna.arrangement.map(a => `${a.section}(${a.bars})`).join(" → ")}.`
          : ""),
      temperature: 0.6,
      maxTokens: 700,
    });
    const avail = new Set(available);
    const sections = (out.sections ?? [])
      .map(s => ({
        name: String(s.name ?? "section").slice(0, 24),
        bars: Math.max(2, Math.min(16, Math.round(Number(s.bars) || 4))),
        roles: [...new Set((s.roles ?? []).map(String))].filter(r =>
          avail.has(r)
        ),
      }))
      .filter(s => s.roles.length > 0);
    const total = sections.reduce((n, s) => n + s.bars, 0);
    const hasPeak = sections.some(s => s.roles.length === available.length);
    if (
      sections.length < 3 ||
      sections.length > 8 ||
      total > 48 ||
      total < 12 ||
      !hasPeak
    )
      return null;
    return sections;
  } catch {
    return null;
  }
}
