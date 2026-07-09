/**
 * PHASE 6 — the release gate.
 *
 * Reads the measured signals stored on a take (Phase-4 lane compliance + the ffmpeg
 * QC verdict) and decides what should stop a release. Doctrine:
 *  - BLOCK only on OBJECTIVELY broken audio (QC 'fail' — clipping / too-quiet / too
 *    short). That's not a matter of taste; a broken file should never ship.
 *  - Genre drift and a low lane-compliance score are WARNINGS, never hard blocks —
 *    the artist may want a lane-bending record, and we never override the ear.
 *  - What wasn't measured is 'unverified' — it can't fail the gate (honesty law).
 */
export interface GateCheck {
  name: string;
  ok: boolean; // false => blocks the green-light
  status: 'pass' | 'warn' | 'fail' | 'unverified';
  detail: string;
}

export interface ReleaseGate {
  checks: GateCheck[];
  blocked: boolean; // any ok:false
  warnings: string[]; // surfaced, non-blocking
}

export function laneReleaseGate(input: {
  compliance?: { overall?: number; coverage?: number; drift?: { severity?: string; reasons?: string[] } } | null;
  qc?: { verdict?: string; flags?: string[] } | null;
  floor?: number;
}): ReleaseGate {
  const floor = input.floor ?? 55;
  const checks: GateCheck[] = [];

  // Audio quality — the only BLOCKING check (objective brokenness).
  const qcV = input.qc?.verdict;
  if (!input.qc || qcV == null) {
    checks.push({ name: 'audio quality', ok: true, status: 'unverified', detail: 'not measured' });
  } else if (qcV === 'fail') {
    checks.push({ name: 'audio quality', ok: false, status: 'fail', detail: `broken render (${(input.qc.flags ?? []).join(', ') || 'failed QC'})` });
  } else {
    checks.push({ name: 'audio quality', ok: true, status: qcV === 'weak' ? 'warn' : 'pass', detail: String(qcV) });
  }

  // Genre drift — WARN only (respect the artist's ear).
  const sev = input.compliance?.drift?.severity;
  if (!input.compliance || sev == null) {
    checks.push({ name: 'in-lane', ok: true, status: 'unverified', detail: 'not measured — run the ear on this take' });
  } else if (sev === 'major') {
    checks.push({ name: 'in-lane', ok: true, status: 'warn', detail: `major genre drift — ${(input.compliance.drift?.reasons ?? []).slice(0, 2).join('; ') || 'off-lane'}` });
  } else if (sev === 'minor') {
    checks.push({ name: 'in-lane', ok: true, status: 'warn', detail: 'minor drift' });
  } else {
    checks.push({ name: 'in-lane', ok: true, status: 'pass', detail: 'in-lane' });
  }

  // Lane compliance floor — WARN only.
  const overall = input.compliance?.overall;
  if (overall != null) {
    checks.push(
      overall < floor
        ? { name: 'lane compliance', ok: true, status: 'warn', detail: `${overall}/100 (below ${floor})` }
        : { name: 'lane compliance', ok: true, status: 'pass', detail: `${overall}/100` },
    );
  }

  return {
    checks,
    blocked: checks.some((c) => !c.ok),
    warnings: checks.filter((c) => c.status === 'warn').map((c) => `${c.name}: ${c.detail}`),
  };
}
