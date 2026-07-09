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

export type ReleaseMode = 'creative' | 'hitmaker';

export function laneReleaseGate(input: {
  compliance?: { overall?: number; coverage?: number; drift?: { severity?: string; reasons?: string[] }; failedCritical?: string[] } | null;
  qc?: { verdict?: string; flags?: string[] } | null;
  floor?: number;
  /** 'creative' (default) = lane issues WARN; 'hitmaker' = lane failure BLOCKS. */
  mode?: ReleaseMode;
  /** Minimum measured coverage to CERTIFY in hitmaker mode (an unmeasurable song can't be certified). */
  minCoverage?: number;
}): ReleaseGate {
  const floor = input.floor ?? 55;
  const hit = input.mode === 'hitmaker';
  const minCov = input.minCoverage ?? 0.8;
  const checks: GateCheck[] = [];
  // In hitmaker mode a lane problem BLOCKS; in creative it only WARNS. This helper
  // sets ok/status accordingly so the honesty law holds in both: what wasn't measured
  // stays 'unverified' and can neither fail NOR certify.
  const laneIssue = (name: string, detail: string): GateCheck => ({ name, ok: !hit, status: hit ? 'fail' : 'warn', detail });

  // Audio quality — always BLOCKS on objective brokenness (both modes).
  const qcV = input.qc?.verdict;
  if (!input.qc || qcV == null) checks.push({ name: 'audio quality', ok: !hit, status: 'unverified', detail: hit ? 'NOT MEASURED — cannot certify' : 'not measured' });
  else if (qcV === 'fail') checks.push({ name: 'audio quality', ok: false, status: 'fail', detail: `broken render (${(input.qc.flags ?? []).join(', ') || 'failed QC'})` });
  else checks.push({ name: 'audio quality', ok: true, status: qcV === 'weak' ? (hit ? 'fail' : 'warn') : 'pass', detail: String(qcV) });
  if (qcV === 'weak' && hit) checks[checks.length - 1]!.ok = false;

  // Failed CRITICAL lane element (missing log drum / four-on-floor / tempo) — the
  // hardest block in hitmaker mode. Generating audio is not passing.
  const failed = input.compliance?.failedCritical ?? [];
  if (failed.length) checks.push(laneIssue('critical lane element', `failed: ${failed.join(', ')}`));

  // Genre drift.
  const sev = input.compliance?.drift?.severity;
  if (!input.compliance || sev == null) checks.push({ name: 'in-lane', ok: !hit, status: 'unverified', detail: hit ? 'NOT MEASURED — run the ear to certify' : 'not measured — run the ear on this take' });
  else if (sev === 'major') checks.push(laneIssue('in-lane', `major genre drift — ${(input.compliance.drift?.reasons ?? []).slice(0, 2).join('; ') || 'off-lane'}`));
  else if (sev === 'minor') checks.push({ name: 'in-lane', ok: true, status: 'warn', detail: 'minor drift' });
  else checks.push({ name: 'in-lane', ok: true, status: 'pass', detail: 'in-lane' });

  // Lane compliance floor.
  const overall = input.compliance?.overall;
  if (overall != null) checks.push(overall < floor ? laneIssue('lane compliance', `${overall}/100 (below ${floor})`) : { name: 'lane compliance', ok: true, status: 'pass', detail: `${overall}/100` });

  // Coverage — hitmaker mode cannot certify an under-measured song.
  const cov = input.compliance?.coverage;
  if (hit) {
    if (cov == null) checks.push({ name: 'coverage', ok: false, status: 'fail', detail: 'unmeasured — cannot certify' });
    else if (cov < minCov) checks.push({ name: 'coverage', ok: false, status: 'fail', detail: `${Math.round(cov * 100)}% measured (need ${Math.round(minCov * 100)}%)` });
    else checks.push({ name: 'coverage', ok: true, status: 'pass', detail: `${Math.round(cov * 100)}% measured` });
  }

  return {
    checks,
    blocked: checks.some((c) => !c.ok),
    warnings: checks.filter((c) => c.status === 'warn').map((c) => `${c.name}: ${c.detail}`),
  };
}
