/**
 * PRODUCTION PLAN — the Producer Brain's contract with the own engine.
 *
 * THE ARCHITECTURE SHIFT (owner directive 2026-07-19: "dynamically
 * deterministic, not rigid heuristic laws"): the engine used to DECIDE with
 * tables (one hardcoded section template for every song, regex key defaults,
 * fixed density picks) and merely execute. Now the LLM Producer Brain DECIDES
 * per song — form, per-section roles, energy arc — and deterministic code
 * EXECUTES the assembly and REFEREES the plan with ground truth it is actually
 * right about: role existence, bar clamps, density caps. Taste moves to the
 * brain; measurement stays in code. (Same hybrid that took the RFP classifier
 * from 56% to 93%.)
 *
 * This module is the REFEREE: pure, zero-dependency validation/clamping. A
 * hopeless plan returns null and the caller falls back to the deterministic
 * template — the brain can make the record better, never break it.
 */
import { isMaterialRole, jobOf, type MaterialRole } from './material-roles';

export interface PlanSection {
  name: string;
  bars: number;
  /** 0..1 — the arrangement arc; the assembler maps it to density/level. */
  energy: number;
  roles: string[];
}

export interface ProductionPlan {
  sections: PlanSection[];
  bpm?: number;
  keySignature?: string;
  /** One line of producer intent — rides the render notes (honesty receipt). */
  intent?: string;
}

export const PRODUCTION_PLAN_LIMITS = {
  minSections: 3,
  maxSections: 9,
  minBars: 2,
  maxBars: 24,
  minTotalBars: 24,
  maxTotalBars: 96,
  sectionRoleCap: 7,
  minBpm: 60,
  maxBpm: 180,
} as const;

const COARSE_JOB: Record<string, string> = {
  drums: 'rhythm',
  percussion: 'rhythm',
  bass: 'low_end',
  log_drum: 'low_end',
  chords: 'harmony',
};

function roleJob(role: string): string | undefined {
  return isMaterialRole(role) ? jobOf(role as MaterialRole) : COARSE_JOB[role];
}

/**
 * Referee a raw Producer Brain plan against the ACTUAL shelf.
 * - Unknown/unavailable roles are DROPPED (never fatal — same strip law as
 *   instruments elsewhere).
 * - Bars/energy/section-count/total-length are CLAMPED to the limits.
 * - Sections left with zero available roles are removed.
 * - Returns null only when the plan is hopeless (too few usable sections, or
 *   no section retains a rhythm/low-end anchor) — the caller then uses the
 *   deterministic template. The referee never invents musical content.
 */
export function refereeProductionPlan(
  raw: unknown,
  availableRoles: readonly string[]
): ProductionPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const plan = raw as Record<string, unknown>;
  const rawSections = Array.isArray(plan.sections) ? plan.sections : null;
  if (!rawSections?.length) return null;
  const available = new Set(availableRoles);

  const sections: PlanSection[] = [];
  for (const entry of rawSections.slice(0, PRODUCTION_PLAN_LIMITS.maxSections)) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const name =
      typeof s.name === 'string' && s.name.trim()
        ? s.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 24)
        : `section${sections.length + 1}`;
    const bars = Math.max(
      PRODUCTION_PLAN_LIMITS.minBars,
      Math.min(PRODUCTION_PLAN_LIMITS.maxBars, Math.round(Number(s.bars)) || 8)
    );
    const energyNum = Number(s.energy);
    const energy = Number.isFinite(energyNum) ? Math.max(0, Math.min(1, energyNum)) : 0.7;
    const roles = [
      ...new Set(
        (Array.isArray(s.roles) ? s.roles : [])
          .filter((r): r is string => typeof r === 'string')
          .map(r => r.trim())
          .filter(r => available.has(r))
      ),
    ].slice(0, PRODUCTION_PLAN_LIMITS.sectionRoleCap);
    if (!roles.length) continue; // a section with nothing to play is no section
    sections.push({ name, bars, energy, roles });
  }
  if (sections.length < PRODUCTION_PLAN_LIMITS.minSections) return null;

  // ANCHOR LAW (the one musical minimum code may enforce): at least one section
  // must carry a rhythm or low-end anchor, or the "record" is a pad wash.
  const anchored = sections.some(sec =>
    sec.roles.some(r => {
      const job = roleJob(r);
      return job === 'rhythm' || job === 'low_end';
    })
  );
  if (!anchored) return null;

  // Total-length clamp: scale bars proportionally rather than rejecting.
  const total = sections.reduce((a, s) => a + s.bars, 0);
  if (total > PRODUCTION_PLAN_LIMITS.maxTotalBars) {
    const scale = PRODUCTION_PLAN_LIMITS.maxTotalBars / total;
    for (const s of sections) {
      s.bars = Math.max(PRODUCTION_PLAN_LIMITS.minBars, Math.round(s.bars * scale));
    }
  } else if (total < PRODUCTION_PLAN_LIMITS.minTotalBars) {
    // Too short to be a record — stretch the biggest section up.
    const biggest = [...sections].sort((a, b) => b.bars - a.bars)[0]!;
    biggest.bars = Math.min(
      PRODUCTION_PLAN_LIMITS.maxBars,
      biggest.bars + (PRODUCTION_PLAN_LIMITS.minTotalBars - total)
    );
  }

  const bpmNum = Number(plan.bpm);
  const bpm = Number.isFinite(bpmNum)
    ? Math.max(PRODUCTION_PLAN_LIMITS.minBpm, Math.min(PRODUCTION_PLAN_LIMITS.maxBpm, Math.round(bpmNum)))
    : undefined;
  const keySignature =
    typeof plan.keySignature === 'string' && /^[A-G][#b]? (major|minor)$/i.test(plan.keySignature.trim())
      ? plan.keySignature.trim()
      : undefined;
  const intent =
    typeof plan.intent === 'string' && plan.intent.trim()
      ? plan.intent.trim().slice(0, 200)
      : undefined;

  return { sections, bpm, keySignature, intent };
}
