/**
 * PHASE 5 — material-first routing (the "learn & control" brain).
 *
 * Derives, from a lane's MEASURED profile (Phase 1), which real-audio material roles
 * the lane needs, then selects the best owned material for each and lists the gaps to
 * forge. This is what turns the black-box generator into an arranger of real audio:
 * the ear says "this lane has a four-on-floor kick, a gliding log-drum, continuous
 * shakers at ~112 BPM", and the selector assembles owned material to match.
 *
 * LEGAL DOCTRINE: material is the artist's own stems ('artist_stem'), studio-forged
 * generated loops ('forged'), or licensed packs — NEVER ripped audio. Zap informs the
 * RECIPE (which roles / arrangement), it is never a source of audio here.
 */
import type { LaneProfile } from './lane-profile';
import { familyOf, isMaterialRole } from './material-roles';

export type MaterialImportance = 'core' | 'signature' | 'support';

export interface LaneRoleNeed {
  role: string; // matches MaterialAsset.role
  importance: MaterialImportance;
  reason: string; // why the lane needs it (from a measured fact)
}

export interface LaneMaterialNeeds {
  lane: string;
  targetBpm: number | null;
  wantsFills: boolean; // insert a fill at each section boundary
  roles: LaneRoleNeed[];
}

/** A minimal material row (subset of MaterialAsset) the selector needs. */
export interface MaterialLite {
  id: string;
  role: string;
  genre?: string | null;
  bpm?: number | null;
  source: string; // 'artist_stem' | 'forged' | 'licensed'
  url: string;
}

export interface MaterialPick {
  role: string;
  importance: MaterialImportance;
  id: string;
  url: string;
  source: string;
  bpmMatch: number; // 0–1, how close its bpm is to the lane target
}

export interface MaterialSelection {
  lane: string;
  targetBpm: number | null;
  wantsFills: boolean;
  picks: MaterialPick[];
  gaps: LaneRoleNeed[]; // roles with no usable owned material — forge these
  ready: boolean; // all CORE roles covered
}

/** Producer gain doctrine per material role — ONE source of truth for the API
 *  arranger and the worker's own-engine/section-replay (which used to pass raw
 *  DB rows with no gain at all and crash the assembler). */
export const MATERIAL_GAINS: Record<string, number> = { drums: 1.0, log_drum: 1.05, bass: 0.95, talking_drum: 0.85, percussion: 0.8, chords: 0.7 };

// Family-level gain defaults for the RICH kit roles (Executive-Summary mixing
// spec): rhythm foundation loudest, low end just under, harmony/melody tucked,
// textures/FX quiet. Specific roles above still win.
const FAMILY_GAINS: Record<string, number> = {
  drumkit: 0.95, african_perc: 0.8, global_perc: 0.75, bass: 0.95,
  harmony: 0.68, melody: 0.62, mallets: 0.62, vocals: 0.55, fx: 0.5,
};
/** Gain for ANY role: explicit doctrine → family default → safe 0.75. */
export function materialGainFor(role: string): number {
  if (MATERIAL_GAINS[role] != null) return MATERIAL_GAINS[role]!;
  if (isMaterialRole(role)) return FAMILY_GAINS[familyOf(role)] ?? 0.75;
  return 0.75;
}

/** Producer PAN doctrine (Executive-Summary mixing spec): low end + kick/snare
 *  DEAD CENTER; shakers/shekere wide; congas/bells off-center opposite sides;
 *  guitars/keys gently spread. -1 = hard left, +1 = hard right. */
const ROLE_PANS: Record<string, number> = {
  shaker: 0.6, shekere: -0.6, cabasa: 0.5, maraca: -0.5,
  conga: -0.35, bongo: 0.35, agogo: 0.45, cowbell: -0.45, woodblock: 0.4, claves: -0.4,
  talking_drum: 0.25, djembe: -0.25, udu: 0.3, bata: -0.3,
  highlife_guitar: 0.3, palmwine_guitar: -0.3, guitar_chords: -0.25, lead_guitar: 0.25, clean_guitar_riff: 0.3,
  piano: -0.15, rhodes: 0.15, kalimba: 0.35, marimba: -0.35, balafon: 0.3, kora: -0.3,
  flute: 0.2, sax: -0.2, trumpet: 0.2, brass_section: 0.15, synth_pluck: 0.25, bell_lead: -0.25,
};
export function materialPanFor(role: string): number {
  if (ROLE_PANS[role] != null) return ROLE_PANS[role]!;
  return 0; // kick/snare/bass/log_drum/pads/legacy roles: center
}

/** GROOVE DOCTRINE (the PDF's "Afrobeats doesn't sit perfectly on the grid"):
 *  the TIMEKEEPERS (kick/snare/claps/low end) hold the grid dead-on; hand
 *  percussion sits a few ms BEHIND it (the laid-back Afro pocket), harmony/
 *  melody barely off. Deterministic per role — the same beat assembles the
 *  same way twice — and capped ≤10ms so it reads as feel, never as sloppiness. */
const ROLE_GROOVE_MS: Record<string, number> = {
  shaker: 7, shekere: 8, cabasa: 6, maraca: 6,
  conga: 5, bongo: 4, agogo: 5, cowbell: 4, woodblock: 4, claves: 5,
  talking_drum: 6, djembe: 5, udu: 6, bata: 5, dundun: 6, sakara: 6,
  closed_hat: 3, open_hat: 4, ride: 3, tom: 3,
  highlife_guitar: 3, palmwine_guitar: 3, guitar_chords: 2, rhodes: 2, piano: 2,
  kalimba: 4, marimba: 3, balafon: 4,
};
const GROOVE_ANCHORS = new Set(['kick', 'kick_808', 'soft_kick', 'club_kick', 'live_kick', 'snare', 'rimshot', 'clap', 'snap', 'bass', 'bass_guitar', 'sub_bass', 'bass_808', 'sliding_808', 'synth_bass', 'log_drum', 'drums']);
export function grooveOffsetMs(role: string): number {
  if (GROOVE_ANCHORS.has(role)) return 0;
  if (ROLE_GROOVE_MS[role] != null) return ROLE_GROOVE_MS[role]!;
  // Unlisted non-anchor roles: a small deterministic offset from the role name
  // (2–5ms) so layered kits never land robot-perfectly aligned.
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) >>> 0;
  return 2 + (h % 4);
}

/**
 * Which material roles this lane needs, derived from measured facts. Every lane needs
 * a kick, bass and chords; measured signatures (log-drum, shakers) add signature roles.
 */
export function laneMaterialNeeds(profile: LaneProfile): LaneMaterialNeeds {
  const f = profile.features;
  const num = (k: string) => f[k]?.numeric?.median;
  const roles: LaneRoleNeed[] = [
    { role: 'drums', importance: 'core', reason: f.fourOnFloor?.dominant === 'true' ? 'four-on-floor kick (measured)' : 'kick/drum foundation' },
    { role: 'bass', importance: 'core', reason: 'low-end foundation' },
    { role: 'chords', importance: 'support', reason: 'harmonic bed' },
  ];
  const logMed = num('logDrumLikelihood');
  if (logMed != null && logMed >= 0.4) roles.push({ role: 'log_drum', importance: 'signature', reason: `measured log-drum presence ~${logMed.toFixed(2)}` });
  const shaker = num('shakerContinuity');
  if (shaker != null && shaker >= 0.4) roles.push({ role: 'percussion', importance: 'signature', reason: `measured shaker/hat continuity ~${shaker.toFixed(2)}` });
  // A drum FILL that lifts into each new section — the transition the artist keeps
  // missing. Needs its own owned material (forged or an artist stem).
  roles.push({ role: 'fill', importance: 'support', reason: 'drum fill into each new section' });
  return { lane: profile.lane, targetBpm: num('tempoBpm') ?? null, wantsFills: true, roles };
}

export interface FillPlacement {
  atS: number; // where the fill starts (seconds)
  label: string; // why it's here
}

/**
 * PHASE 5 — decide WHERE drum fills go: the bar BEFORE each new section, so the fill
 * lifts into it. Uses the ear's measured section boundaries when available (precise);
 * otherwise falls back to a musical cadence (a fill every `barsPerFill` bars) derived
 * from the tempo. This is the placement control the worker's ffmpeg overlay consumes.
 */
export function planFills(bpm: number, durationS: number, boundaries?: number[] | null, barsPerFill = 8): FillPlacement[] {
  if (!bpm || bpm <= 0 || !durationS || durationS <= 0) return [];
  const secPerBar = (60 / bpm) * 4;
  if (boundaries && boundaries.length) {
    // A fill leading into each section boundary PLUS the Afro pulse: one every
    // 16 bars regardless (Benjamin's law — 'you always hear them'), deduped.
    const placed: FillPlacement[] = boundaries
      .filter((b) => b > secPerBar && b < durationS - 0.25)
      .map((b) => ({ atS: Math.max(0, b - secPerBar), label: `into section @${b.toFixed(1)}s` }));
    for (let bar = 16; bar * secPerBar < durationS - secPerBar; bar += 16) {
      const at = bar * secPerBar - secPerBar;
      if (!placed.some((f) => Math.abs(f.atS - at) < secPerBar)) placed.push({ atS: at, label: `16-bar pulse @bar ${bar}` });
    }
    return placed.sort((a, b) => a.atS - b.atS);
  }
  const out: FillPlacement[] = [];
  for (let bar = barsPerFill; bar * secPerBar < durationS - secPerBar; bar += barsPerFill) {
    out.push({ atS: (bar - 1) * secPerBar, label: `bar ${bar} (cadence, every ${barsPerFill})` });
  }
  return out;
}

const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
const SOURCE_RANK: Record<string, number> = { artist_stem: 3, licensed: 2, forged: 1 };

/** Select the best owned material per needed role; list uncovered roles as gaps. */
export function selectLaneMaterials(needs: LaneMaterialNeeds, available: MaterialLite[]): MaterialSelection {
  const picks: MaterialPick[] = [];
  const gaps: LaneRoleNeed[] = [];

  for (const need of needs.roles) {
    const candidates = available.filter((m) => norm(m.role) === norm(need.role));
    if (!candidates.length) { gaps.push(need); continue; }
    const scored = candidates.map((m) => {
      const bpmMatch = needs.targetBpm && m.bpm ? Math.max(0, 1 - Math.abs(m.bpm - needs.targetBpm) / (needs.targetBpm * 0.15)) : 0.5;
      const genreMatch = norm(m.genre) && norm(m.genre) === norm(needs.lane) ? 1 : 0.6;
      const score = (SOURCE_RANK[m.source] ?? 1) * 1.5 + bpmMatch * 2 + genreMatch;
      return { m, bpmMatch, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    picks.push({ role: need.role, importance: need.importance, id: best.m.id, url: best.m.url, source: best.m.source, bpmMatch: Math.round(best.bpmMatch * 100) / 100 });
  }

  const coreRoles = needs.roles.filter((r) => r.importance === 'core').map((r) => r.role);
  const ready = coreRoles.every((r) => picks.some((p) => p.role === r));
  return { lane: needs.lane, targetBpm: needs.targetBpm, wantsFills: needs.wantsFills, picks, gaps, ready };
}

/** Human/LLM summary of a material selection (what's covered, what to forge). */
export function describeMaterialSelection(s: MaterialSelection): string {
  const lines = [`Material for "${s.lane}" (${s.targetBpm ? Math.round(s.targetBpm) + ' BPM' : 'bpm n/a'})${s.wantsFills ? ' + fills at section boundaries' : ''}:`];
  for (const p of s.picks) lines.push(`  ✓ ${p.role} (${p.importance}) ← ${p.source}, bpm match ${Math.round(p.bpmMatch * 100)}%`);
  for (const g of s.gaps) lines.push(`  ✗ ${g.role} (${g.importance}) — MISSING, forge it [${g.reason}]`);
  lines.push(s.ready ? '  → core roles covered: ready to arrange.' : '  → missing a CORE role: forge before arranging.');
  return lines.join('\n');
}
