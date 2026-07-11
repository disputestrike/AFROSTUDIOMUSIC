import { getSoundDNA, generateJson } from '@afrohit/ai';
import { MATERIAL_GAINS, forgeKitFor, materialGainFor, materialPanFor } from '@afrohit/shared';

/**
 * MATERIAL PLANNING — one source of truth for the material layer's brain,
 * shared by the REST route and the chat tools:
 *   kitRolesFor()      which roles a genre's kit wants on the shelf
 *   pickMaterial()     choose the best loop per role (genre → key → bpm → stems-first)
 *   claudeArrangement() Claude authors the build for THIS material (validated)
 */

// Gain doctrine now lives in @afrohit/shared (the worker needs it too) — re-export
// so existing importers keep working.
export { MATERIAL_GAINS };
export const MELODIC_ROLES = new Set(['chords', 'bass', 'log_drum']);

/**
 * The genre's REAL kit — delegates to the shared forgeKitFor (Executive-Summary
 * spec: signature roles first, rhythm-first required roles, capped, +fill) so the
 * API, worker nightly self-provisioning, and tests all read ONE definition.
 */
export function kitRolesFor(genre: string, cap = 12): string[] {
  return forgeKitFor(genre, cap);
}

/** The genre's home key — melodic loops forge + assemble in it by default. */
export function homeKeyFor(genre: string): string {
  return getSoundDNA(genre)?.commonKeys?.[0] ?? 'A minor';
}

export interface MaterialRow {
  id: string;
  url: string;
  role: string;
  bpm: number | null;
  keySignature: string | null;
  source: string;
}

export interface MaterialPick {
  id: string;
  url: string;
  sourceBpm: number;
  role: string;
  gain: number;
  /** stereo placement -1..+1 (producer pan doctrine; 0 = center) */
  pan?: number;
}

/**
 * Best loop per wanted role: bpm within ±15%, then key-compatible melodic
 * material first (unknown key stays usable, WRONG key sinks last), artist
 * stems over forged, closest bpm wins.
 */
export function pickMaterial(rows: MaterialRow[], genre: string, bpm: number, keySignature?: string | null): MaterialPick[] {
  const targetKey = (keySignature ?? homeKeyFor(genre)).toLowerCase();
  const keyScore = (m: MaterialRow) => {
    if (!MELODIC_ROLES.has(m.role) || !targetKey) return 0;
    if (!m.keySignature) return 1;
    return m.keySignature.toLowerCase() === targetKey ? 0 : 2;
  };
  const picks: MaterialPick[] = [];
  for (const role of kitRolesFor(genre)) {
    // In-tempo picks first; a harvested stem with NO measured bpm is a valid
    // LAST-RESORT pick (audit: harvested loops inherit a possibly-null beat bpm,
    // so a strict bpm filter silently orphaned the artist's own material).
    const inTempo = rows.filter((m) => m.role === role && m.bpm && Math.abs(m.bpm - bpm) / bpm <= 0.15);
    const nullBpm = rows.filter((m) => m.role === role && !m.bpm);
    const best = [...inTempo, ...nullBpm].sort(
      (a, b) =>
        keyScore(a) - keyScore(b) ||
        (a.source === 'artist_stem' ? -1 : 0) - (b.source === 'artist_stem' ? -1 : 0) ||
        Math.abs((a.bpm ?? bpm) - bpm) - Math.abs((b.bpm ?? bpm) - bpm)
    )[0];
    if (best) picks.push({ id: best.id, url: best.url, sourceBpm: best.bpm ?? bpm, role, gain: materialGainFor(role), pan: materialPanFor(role) });
  }
  return picks;
}

export interface ArrangementSection {
  name: string;
  bars: number;
  roles: string[];
}

/**
 * Claude authors the arrangement for the material actually on hand — the
 * creative half of the material layer. Hard-validated: sections 3-8, bars 2-16
 * each, total 12-48, roles ⊆ available, at least one full-stack peak. Any
 * failure → null (worker uses the classic template), never a broken beat.
 */
export async function claudeArrangement(genre: string, bpm: number, available: string[], vibe?: string): Promise<ArrangementSection[] | null> {
  try {
    const dna = getSoundDNA(genre);
    const out = await generateJson<{ sections: Array<{ name: string; bars: number; roles: string[] }> }>({
      system:
        'You are a top producer ARRANGING a beat from real, already-rendered loops. You control ONLY: section order, section length in bars, and which layers play in each section. ' +
        'Think like the genre: how does energy enter, build, breathe, and leave? Strip-downs and drops are your tools. ' +
        'Return strict JSON {sections:[{name, bars, roles:[...]}]}: 3-8 sections, bars per section 2-16 (multiples of 2), total bars <= 48, roles must be a subset of the available layers, and AT LEAST one section uses every available layer (the peak). Return only JSON.',
      user:
        `Genre: ${genre} at ${bpm}bpm. Available layers: ${available.join(', ')}.` +
        (vibe ? ` Vibe: ${vibe}.` : '') +
        (dna?.arrangement?.length ? ` Genre arrangement instincts: ${dna.arrangement.map((a) => `${a.section}(${a.bars})`).join(' → ')}.` : ''),
      temperature: 0.6,
      maxTokens: 700,
    });
    const avail = new Set(available);
    const sections = (out.sections ?? [])
      .map((s) => ({
        name: String(s.name ?? 'section').slice(0, 24),
        bars: Math.max(2, Math.min(16, Math.round(Number(s.bars) || 4))),
        roles: [...new Set((s.roles ?? []).map(String))].filter((r) => avail.has(r)),
      }))
      .filter((s) => s.roles.length > 0);
    const total = sections.reduce((n, s) => n + s.bars, 0);
    const hasPeak = sections.some((s) => s.roles.length === available.length);
    if (sections.length < 3 || sections.length > 8 || total > 48 || total < 12 || !hasPeak) return null;
    return sections;
  } catch {
    return null;
  }
}
