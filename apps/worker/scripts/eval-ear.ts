/**
 * PHASE 0 ACCEPTANCE TEST — proves "the ear" measures real records, and is the
 * calibration gate for logDrumLikelihood.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/eval-ear.ts
 *
 * Reads py/fixtures/manifest.json (committed) which points at LOCAL, rights-cleared
 * audio + pre-separated Demucs stems (both GITIGNORED — AfroHit HARD rule: no
 * YouTube/Spotify rips; only audio Benjamin owns or licensed). Each row carries the
 * operator's own ground truth (tempo, four-on-floor). Asserts three gates and
 * exits 1 if any fails, so it can gate CI and the calibration loop.
 *
 *   GATE 1  tempo   — tempoBpm.source==='measured' AND |value - expected| <= 2 BPM
 *   GATE 2  4-on-floor — fourOnFloor.source==='measured' AND value===expected, 9/9 exact
 *   GATE 3  log-drum sep — min(logDrL over amapiano) > max(logDrL over afrobeats+house)
 *
 * An 'unknown' where a measurement is REQUIRED counts as a FAIL (honest, but it
 * fails the gate — that is correct). Gate 3 reads logDrumLikelihood whether it is
 * 'measured' or 'inferred' (uncalibrated). When all three gates pass, this script
 * WRITES py/fixtures/logdrum_calibration.json (gatesPassed:true + the validated
 * params + margin). analyze_dsp.py loads that artifact and only THEN ships the field
 * as 'measured'. There is no LOGDRUM_CALIBRATED env var — the artifact IS the gate.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { measureAudio, dspAvailable, type StemInputs } from '../src/lib/dsp';

interface Row {
  id: string;
  path: string;
  genre: 'amapiano' | 'afrobeats' | 'house';
  expectTempoBpm: number;
  fourOnFloor: boolean;
  bassStem?: string;
  drumsStem?: string;
  otherStem?: string;
  vocalsStem?: string;
}

// Run via `pnpm --filter @afrohit/worker exec tsx scripts/eval-ear.ts` — cwd is the
// worker package dir, so fixtures resolve without __dirname/import.meta gymnastics.
const fixturesDir = resolve(process.cwd(), 'py', 'fixtures');

async function main() {
  if (!(await dspAvailable())) {
    console.error('DSP engine unavailable (python3 + librosa not importable). Cannot run acceptance test.');
    process.exit(1);
  }
  const manifestPath = join(fixturesDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`No manifest at ${manifestPath}. Add rights-cleared fixtures + manifest first.`);
    process.exit(1);
  }
  const rows = JSON.parse(await readFile(manifestPath, 'utf8')) as Row[];
  const real = rows.filter((r) => r.id && r.path && !r.id.startsWith('EXAMPLE'));
  if (real.length < 9) {
    console.error(`Manifest has ${real.length} real rows; the acceptance test needs 9 (3 amapiano + 3 afrobeats + 3 house).`);
    process.exit(1);
  }

  const resolvePath = (p?: string) => (p ? (p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : join(fixturesDir, p)) : undefined);

  const results: Array<{ row: Row; tempo: number | null; tempoOk: boolean; fof: boolean | null; fofOk: boolean; logDrL: number | null }> = [];
  for (const row of real) {
    const stems: StemInputs = {
      bass: resolvePath(row.bassStem),
      drums: resolvePath(row.drumsStem),
      other: resolvePath(row.otherStem),
      vocals: resolvePath(row.vocalsStem),
    };
    const a = await measureAudio(resolvePath(row.path)!, stems);
    const tempo = a.tempoBpm.source === 'measured' ? (a.tempoBpm.value as number) : null;
    const tempoOk = tempo != null && Math.abs(tempo - row.expectTempoBpm) <= 2;
    const fof = a.fourOnFloor.source === 'measured' ? (a.fourOnFloor.value as boolean) : null;
    const fofOk = fof != null && fof === row.fourOnFloor;
    // Gate 3 reads the value whether measured or inferred (uncalibrated).
    const logDrL = typeof a.logDrumLikelihood.value === 'number' ? (a.logDrumLikelihood.value as number) : null;
    results.push({ row, tempo, tempoOk, fof, fofOk, logDrL });
  }

  // ---- table ----
  console.log('\nid                     genre      expTempo  measTempo  Δ     4OTF exp/meas  logDrL');
  console.log('─'.repeat(88));
  for (const r of results) {
    const d = r.tempo != null ? (r.tempo - r.row.expectTempoBpm).toFixed(1) : '—';
    console.log(
      `${r.row.id.padEnd(22)} ${r.row.genre.padEnd(10)} ${String(r.row.expectTempoBpm).padStart(7)}  ${String(r.tempo ?? 'unknown').padStart(8)}  ${d.padStart(5)} ${(r.row.fourOnFloor + '/' + (r.fof ?? 'unknown')).padStart(13)}  ${r.logDrL != null ? r.logDrL.toFixed(3) : 'unknown'}`
    );
  }

  // ---- gates ----
  const tempoFails = results.filter((r) => !r.tempoOk);
  const fofFails = results.filter((r) => !r.fofOk);
  const ama = results.filter((r) => r.row.genre === 'amapiano').map((r) => r.logDrL);
  const rest = results.filter((r) => r.row.genre !== 'amapiano').map((r) => r.logDrL);
  const amaOk = ama.every((v) => v != null);
  const restOk = rest.every((v) => v != null);
  const gap = amaOk && restOk ? Math.min(...(ama as number[])) - Math.max(...(rest as number[])) : NaN;

  console.log('\n── GATES ──');
  const g1 = tempoFails.length === 0;
  const g2 = fofFails.length === 0;
  const g3 = Number.isFinite(gap) && gap > 0;
  console.log(`GATE 1 tempo ±2 BPM:       ${g1 ? 'PASS' : `FAIL (${tempoFails.length} off: ${tempoFails.map((r) => r.row.id).join(', ')})`}`);
  console.log(`GATE 2 four-on-floor 9/9:  ${g2 ? 'PASS' : `FAIL (${fofFails.length} wrong: ${fofFails.map((r) => r.row.id).join(', ')})`}`);
  console.log(`GATE 3 log-drum separation: ${g3 ? `PASS (margin ${gap.toFixed(3)})` : `FAIL (gap ${Number.isFinite(gap) ? gap.toFixed(3) : 'n/a — some logDrL unknown'}; target amapiano≈0.65 vs rest≈0.2)`}`);

  const pass = g1 && g2 && g3;
  console.log(`\n${pass ? '✅ PHASE 0 ACCEPTANCE PASSED' : '❌ PHASE 0 ACCEPTANCE FAILED'}\n`);

  // ---- Write the calibration ARTIFACT (the TRUTH GATE). Its existence with
  // gatesPassed:true IS the calibration — analyze_dsp.py loads it and only then ships
  // logDrumLikelihood as 'measured'. schemaVersion must match LOGDRUM_SCHEMA. The
  // params are the constants validated against THIS 9-track set (they separated the
  // genres). Commit this JSON; NEVER commit the audio. ----
  const artifact = {
    schemaVersion: 3, // === LOGDRUM_SCHEMA in analyze_dsp.py
    gatesPassed: pass,
    // ADDENDUM C-1: eval-ear.ts on the REAL 9 tracks is the ONLY writer of
    // 'real-9track' — the sole provenance that opens the truth gate. Synthetic
    // artifacts (synth harness) validate direction only and stay 'inferred'.
    provenance: 'real-9track',
    separationMargin: Number.isFinite(gap) ? Math.round(gap * 1000) / 1000 : null,
    fittedOn: new Date().toISOString().slice(0, 10),
    trackCount: real.length,
    gates: { tempo: g1, fourOnFloor: g2, logDrumSeparation: g3 },
    // The constants validated on this set. (A future refit can grid-search these to
    // widen the margin; today they are the frozen, validated defaults.)
    params: { r0: 0.45, s: 0.12, w1: 1.2, w2: 0.15, glideFloor: 0.30 },
  };
  const artifactPath = join(fixturesDir, 'logdrum_calibration.json');
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`Wrote ${artifactPath}`);
  console.log(pass
    ? `→ log-drum CALIBRATED (margin ${artifact.separationMargin}). Commit logdrum_calibration.json — the field now ships 'measured'.`
    : `→ gatesPassed:false — log-drum stays 'inferred' (uncalibrated) until the gates pass. Not committed as calibrated.`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
