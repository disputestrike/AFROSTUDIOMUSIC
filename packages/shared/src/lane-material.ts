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
 * owned loops ('forged'), or licensed packs — NEVER ripped audio. Zap informs the
 * RECIPE (which roles / arrangement), it is never a source of audio here.
 */
import type { LaneProfile } from './lane-profile';

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
    // A fill in the bar leading into each section boundary (skip the very start/end).
    return boundaries
      .filter((b) => b > secPerBar && b < durationS - 0.25)
      .map((b) => ({ atS: Math.max(0, b - secPerBar), label: `into section @${b.toFixed(1)}s` }));
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
