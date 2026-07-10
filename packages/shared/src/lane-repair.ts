/**
 * PHASE 3 — RepairPlanner + adjust.
 *
 * Turns a LaneComplianceScore (Phase 2) into CONCRETE, measured repair instructions:
 * what to change, in which direction, toward which target number — never vibes. The
 * output includes a compact `laneSteeringAddendum` that Phase 4 injects into the NEXT
 * generation to steer the track back into its lane.
 *
 * DOCTRINE (from the Master spec): repairs are STEERING for the next render, applied
 * on regeneration — they never silently override the artist's ear. And a repair is
 * only ever emitted for a dimension that was actually SCORED (measured + profiled);
 * an 'unverified' (skipped) dimension produces no repair — we don't invent a fix for
 * something we couldn't measure.
 */
import type { LaneComplianceScore, DimensionScore } from './lane-compliance';

export interface Repair {
  key: string;
  severity: 'critical' | 'major' | 'minor';
  current: number | string | boolean;
  target: string;
  direction: 'increase' | 'decrease' | 'add' | 'remove' | 'shift' | 'match';
  instruction: string;
  priority: number;
}

export interface RepairPlan {
  lane: string;
  overall: number;
  clean: boolean; // in-lane — nothing to repair
  driftSeverity: 'none' | 'minor' | 'major';
  repairs: Repair[];
  /** Compact steering block for the next generation (Phase 4 injects this verbatim). */
  laneSteeringAddendum: string;
}

const round = (n: number) => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100);

/** Build the human/prompt instruction + direction for one off-lane dimension. */
function repairFor(d: DimensionScore, lane: string): { direction: Repair['direction']; instruction: string; target: string } {
  const t = d.target;
  const numTarget = t.median != null ? `~${round(t.median)} (lane ${round(t.p10!)}–${round(t.p90!)})` : '';
  const cur = typeof d.trackValue === 'number' ? round(d.trackValue) : d.trackValue;
  const below = typeof d.trackValue === 'number' && t.median != null && d.trackValue < t.median;

  switch (d.key) {
    case 'tempoBpm':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'Raise' : 'Lower'} the tempo from ${cur} to ${numTarget} BPM.` };
    case 'fourOnFloor':
      // String() belt: a boolean-typed dominant must never invert the branch.
      return String(d.target.dominant) === 'true'
        ? { direction: 'add', target: 'four-on-floor', instruction: `Add a FOUR-ON-FLOOR kick — a kick on EVERY beat (the lane's foundation).` }
        : { direction: 'remove', target: 'broken kick', instruction: `Drop the four-on-floor — the lane uses a broken/syncopated kick pattern.` };
    case 'harmonicRichness':
      return { direction: below ? 'add' : 'decrease', target: numTarget, instruction: below
        ? `Add the sustained KEYS bed the ${lane} lane demands — jazzy piano/rhodes chords holding under the groove (amapiano without piano is not amapiano).`
        : `Thin the keys/pads — the harmonic bed is heavier than the lane (${numTarget}).` };
    case 'logDrumLikelihood':
      return { direction: below ? 'add' : 'decrease', target: numTarget, instruction: below
        ? `Add the ${lane} LOG-DRUM signature: a pitched sub-bass that GLIDES (portamento) between notes, re-articulated across the bar — it's missing or too weak.`
        : `Ease the log-drum — it's more prominent than the lane (${numTarget}).` };
    case 'swingRatio':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'Add more swing' : 'Straighten the groove'} — target ${numTarget}% 16th swing.` };
    case 'lowEndRatio':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'Boost the low end (30–120Hz sub) — it is too thin' : 'Ease the low end — it is heavier than the lane'} (target ${numTarget}).` };
    case 'shakerContinuity':
      return { direction: below ? 'add' : 'decrease', target: numTarget, instruction: `${below ? 'Add continuous 16th shakers / hi-hats' : 'Thin the busy hats'} — lane density ${numTarget}.` };
    case 'kickDensity':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'More kicks per bar' : 'Fewer kicks per bar'} — lane ${numTarget}/bar.` };
    case 'syncopationIndex':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'More syncopation / off-beat hits' : 'Straighter, less syncopated'} groove (lane ${numTarget}).` };
    case 'microKick':
      return { direction: 'shift', target: numTarget, instruction: `Nudge the pocket ${below ? 'later — more behind-the-beat, laid-back' : 'earlier — tighter to the grid'}.` };
    case 'mode':
      return { direction: 'shift', target: String(t.dominant), instruction: `Write in a ${t.dominant} tonality — the lane is predominantly ${t.dominant}.` };
    case 'timeSignature':
      return { direction: 'match', target: String(t.dominant), instruction: `Use ${t.dominant} time — the lane's meter.` };
    case 'sungVsSpoken':
      return { direction: 'shift', target: String(t.dominant), instruction: `Deliver more ${t.dominant} — the lane is ${t.dominant}.` };
    case 'vocalPresenceRatio':
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `${below ? 'More vocal presence across the track' : 'Leaner vocals — more instrumental space'} (lane ${numTarget}).` };
    default:
      return { direction: below ? 'increase' : 'decrease', target: numTarget, instruction: `Bring ${d.key} ${below ? 'up' : 'down'} toward ${numTarget}.` };
  }
}

/**
 * Plan the repairs for a compliance result. Only off-lane SCORED dimensions produce
 * repairs; ordered by importance (weight × gap, identity dims boosted).
 */
export function planRepairs(score: LaneComplianceScore): RepairPlan {
  const repairs: Repair[] = [];
  const WEAK_DOMINANT_DIMS = new Set(['timeSignature', 'mode', 'key', 'sungVsSpoken']);
  for (const d of score.dimensions) {
    if (d.status === 'in-lane') continue;
    // A categorical dominant that only narrowly leads the lane's refs (e.g. a
    // '3/4' timeSignature from a few weak detector reads) is NOT lane law —
    // repairing toward it would steer good takes wrong. Identity dims are
    // exempt (their dominance is the lane).
    if (WEAK_DOMINANT_DIMS.has(d.key) && !d.identity && (d.target.dominantShare ?? 1) < 0.6) continue;
    const gap = 1 - d.match;
    const priority = d.weight * gap * (d.identity ? 1.5 : 1);
    const severity: Repair['severity'] = d.status === 'out-of-lane' && d.identity ? 'critical' : d.status === 'out-of-lane' ? 'major' : 'minor';
    const { direction, instruction, target } = repairFor(d, score.lane);
    repairs.push({ key: d.key, severity, current: d.trackValue, target, direction, instruction, priority: Math.round(priority * 1000) / 1000 });
  }
  repairs.sort((a, b) => b.priority - a.priority);

  const clean = repairs.length === 0;
  const top = repairs.slice(0, 6).map((r) => r.instruction);
  const laneSteeringAddendum = clean
    ? ''
    : `LANE REPAIR — bring this back into the ${score.lane} lane (compliance ${score.overall}/100${score.drift.drifted ? `, ${score.drift.severity} drift` : ''}). Apply on the next take:\n- ${top.join('\n- ')}`;

  return {
    lane: score.lane,
    overall: score.overall,
    clean,
    driftSeverity: score.drift.severity,
    repairs,
    laneSteeringAddendum,
  };
}

/** Compact human summary of a repair plan. */
export function describeRepairPlan(p: RepairPlan): string {
  if (p.clean) return `In-lane (${p.overall}/100) — no repairs needed.`;
  const lines = [`Repair plan for "${p.lane}" (${p.overall}/100${p.driftSeverity !== 'none' ? `, ${p.driftSeverity} drift` : ''}) — ${p.repairs.length} fix(es):`];
  for (const r of p.repairs) lines.push(`  [${r.severity}] ${r.instruction}`);
  return lines.join('\n');
}
