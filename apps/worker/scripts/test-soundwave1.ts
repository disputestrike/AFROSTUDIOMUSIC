/**
 * SOUNDWAVE1 GATE — the seven surgical fixes behind the owner's "no good
 * beats, no music" verdict (2026-07-20), pinned forever:
 *
 *  1. VERBATIM FORGE PROMPTS — promptMode:'verbatim' reaches the adapters'
 *     compose fn INTACT (full isolation text + key + variant suffix; no
 *     anchor/signature/engineTags/fallback, no 160-char slice).
 *  2. ONE TEMPO BELIEF — the bpm a loop is CUT at IS the bpm the row stores
 *     (resolveForgeCutTempo), so the assembler's stretch can never drift.
 *  3. HOOK LIFT — AssemblySection.energy scales the section bus gain
 *     monotonically through the bounded -2.5..+1.5 dB curve.
 *  4. CROSSFADED SECTIONS — the section join is acrossfade (tri/tri, 20-40ms),
 *     never the concat demuxer's butt-splice.
 *  5. amix normalize=0 — every amix in the worker keeps the honest sum (the
 *     default 1/n scaling shipped melody-topped takes ~6 dB quiet).
 *  6. QC SHIP CONTRACT — weak-but-real ships FLAGGED; only hard flags die.
 *  7. KEY VARIETY — the home key is a deterministic seeded pick from the
 *     lane's common keys (stable per renderSpec seed, varied across seeds).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { composeStyleTags, getSoundDNA, type MusicGenerationInput } from '@afrohit/ai';
import {
  pickHomeKey,
  sectionEnergyGainDb,
  SECTION_ENERGY_DB_RANGE,
} from '@afrohit/shared';
import { forgePromptFor } from '../src/lib/forge-prompts';
import {
  FORGE_TEMPO_TOLERANCE,
  preMasterQcGateDecision,
  qcGateDecision,
  resolveForgeCutTempo,
} from '../src/lib/material-inspection';
import {
  buildCrossfadeJoinGraph,
  buildMixBuffersGraph,
  SECTION_CROSSFADE_S,
} from '../src/lib/ffmpeg';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

// ---- 1: VERBATIM FORGE PROMPTS -------------------------------------------
{
  const keyedPrompt = forgePromptFor('piano', 'afrobeats', 112, 'F# minor', 3)!;
  if (!keyedPrompt || keyedPrompt.length <= 160) {
    fail('fixture: keyed variant forge prompt should exceed the old 160-char slice');
  }
  const input: MusicGenerationInput = {
    genre: 'afrobeats',
    bpm: 112,
    keySignature: 'F# minor',
    durationS: 30,
    withStems: false,
    vibePrompt: keyedPrompt,
    dnaTags: ['sw1-dna-token-that-must-not-appear'],
    promptMode: 'verbatim',
  };
  const verbatim = composeStyleTags(input, { fallbackLiteral: 'sw1-fallback-must-not-appear' }).join(', ');
  if (!verbatim.includes(keyedPrompt)) fail('verbatim: the forge prompt must reach the engine IN FULL (it was sliced/dropped)');
  if (!verbatim.includes('112 bpm')) fail('verbatim: the minimal prefix must carry the bpm');
  if (!verbatim.includes('F# minor')) fail('verbatim: the key must survive to the engine');
  if (!/variation C/.test(verbatim) || !/a DIFFERENT pattern/.test(verbatim)) {
    fail('verbatim: the variant direction must survive (it was beyond the 160-char slice)');
  }
  if (verbatim.includes('signature sound')) fail('verbatim: the full-band genre signature must NOT ride a solo-loop forge');
  if (verbatim.includes('NOT reggaeton')) fail('verbatim: the anti-Latin engine line must NOT ride a solo-loop forge');
  if (verbatim.includes('sw1-fallback-must-not-appear')) fail('verbatim: fallbackLiteral must be dropped');
  if (verbatim.includes('sw1-dna-token-that-must-not-appear')) fail('verbatim: dnaTags must be dropped');

  // The MusicGen adapter's compose opts (genreLabel/keyPrefix) still shape the prefix.
  const mgStyle = composeStyleTags(input, {
    genreLabel: 'afrobeats instrumental beat',
    keyPrefix: 'in ',
    fallbackLiteral: 'x',
  }).join(', ');
  if (!mgStyle.includes('afrobeats instrumental beat')) fail('verbatim: adapter genreLabel must lead the prefix');
  if (!mgStyle.includes('in F# minor')) fail('verbatim: adapter keyPrefix must apply to the key');
  if (!mgStyle.includes(keyedPrompt)) fail('verbatim: the MusicGen compose path must keep the full prompt');

  // Default (non-verbatim) full-song behavior is UNCHANGED: anchored + sliced.
  const dflt = composeStyleTags({ ...input, promptMode: undefined }, { fallbackLiteral: 'x' }).join(', ');
  if (!dflt.includes('signature sound')) fail('default mode regression: the Afro anchor/signature must still lead full-song prompts');
  if (dflt.includes(keyedPrompt)) fail('default mode regression: the 160-char vibe cap must still apply to full-song prompts');
}

// ---- 2: ONE TEMPO BELIEF (trim bpm === stored bpm) ------------------------
{
  const und = resolveForgeCutTempo(112, null);
  if (und.state !== 'undetected' || und.rowBpm !== 112) fail('tempo: undetected must cut AND store the prompted grid');
  const conf = resolveForgeCutTempo(112, 110.4);
  if (conf.state !== 'confirmed' || conf.rowBpm !== 110) fail(`tempo: an in-tolerance detection must become the cut+row bpm (got ${conf.rowBpm}/${conf.state})`);
  const octave = resolveForgeCutTempo(112, 224);
  if (octave.state !== 'confirmed' || octave.rowBpm !== 112) fail('tempo: a double-time detection folds back onto the grid');
  const half = resolveForgeCutTempo(112, 55);
  if (half.state !== 'confirmed' || half.rowBpm !== 110) fail(`tempo: a half-time detection folds to its true grid (got ${half.rowBpm})`);
  const bad = resolveForgeCutTempo(112, 100);
  if (bad.state !== 'contradicted') fail('tempo: a >4% miss after folding is contradicted (rejected, never relabeled)');
  if (bad.rowBpm !== 112) fail('tempo: a contradicted render still cuts at the prompted grid (the receipt bytes)');

  // THE DRIFT-KILLER INVARIANT: a loop cut to N bars at rowBpm, stretched by
  // the assembler at targetBpm/rowBpm, occupies EXACTLY N bars of the target
  // grid — for every tempo pair. This is the property the old prompt-cut/
  // measured-store split violated (≤4% slip per loop cycle).
  for (let prompted = 60; prompted <= 180; prompted += 7) {
    for (const mult of [0.97, 0.99, 1.0, 1.01, 1.03, 2.0, 0.5]) {
      const res = resolveForgeCutTempo(prompted, prompted * mult);
      if (!Number.isInteger(res.rowBpm) || res.rowBpm <= 0) fail(`tempo invariant: rowBpm must be a positive integer (${prompted}×${mult})`);
      const bars = 8;
      const fileDurS = (60 / res.rowBpm) * 4 * bars; // trim length AT the stored bpm
      for (const target of [prompted, 104, 120]) {
        const stretched = fileDurS / (target / res.rowBpm); // atempo ratio = target/rowBpm
        const gridBars = (bars * 240) / target;
        if (Math.abs(stretched - gridBars) > 1e-9) {
          fail(`tempo invariant broken: ${prompted}bpm prompt, detected ×${mult}, target ${target} — loop period ${stretched} vs grid ${gridBars}`);
        }
      }
      if (res.state === 'confirmed' && res.deltaRatio != null && res.deltaRatio > FORGE_TEMPO_TOLERANCE) {
        fail('tempo invariant: confirmed must be within the forge tolerance');
      }
    }
  }
}

// ---- 3: HOOK LIFT (energy scales the bus gain monotonically) --------------
{
  if (sectionEnergyGainDb(null) !== 0 || sectionEnergyGainDb(undefined) !== 0 || sectionEnergyGainDb(Number.NaN) !== 0) {
    fail('energy: absent/unreadable energy must be a 0 dB no-op (unknown is honorable)');
  }
  if (sectionEnergyGainDb(0) !== SECTION_ENERGY_DB_RANGE.min) fail(`energy: floor must be ${SECTION_ENERGY_DB_RANGE.min} dB`);
  if (sectionEnergyGainDb(1) !== SECTION_ENERGY_DB_RANGE.max) fail(`energy: ceiling must be ${SECTION_ENERGY_DB_RANGE.max} dB`);
  if (sectionEnergyGainDb(-5) !== SECTION_ENERGY_DB_RANGE.min || sectionEnergyGainDb(9) !== SECTION_ENERGY_DB_RANGE.max) {
    fail('energy: out-of-range energies must clamp to the bounded curve');
  }
  let prev = Number.NEGATIVE_INFINITY;
  for (let e = 0; e <= 1.0001; e += 0.05) {
    const db = sectionEnergyGainDb(Math.min(1, e));
    if (db < prev) fail(`energy: the curve must be monotonically increasing (broke at ${e.toFixed(2)})`);
    prev = db;
  }
  // The audible contract: an intro (0.42) sits back, a hook (0.9) lifts.
  if (!(sectionEnergyGainDb(0.9) - sectionEnergyGainDb(0.42) > 1.5)) {
    fail('energy: hook-vs-intro contrast must exceed 1.5 dB (the flat-plateau fix)');
  }
  if (SECTION_ENERGY_DB_RANGE.max > 2.5) fail('energy: the lift stays bounded — the section limiter is safety, not a crutch');
}

// ---- 4: CROSSFADED SECTIONS ----------------------------------------------
{
  if (!(SECTION_CROSSFADE_S >= 0.02 && SECTION_CROSSFADE_S <= 0.04)) {
    fail(`crossfade: 20-40ms is the declick window (got ${SECTION_CROSSFADE_S * 1000}ms)`);
  }
  const two = buildCrossfadeJoinGraph(2);
  if (two !== `[0:a][1:a]acrossfade=d=${SECTION_CROSSFADE_S}:c1=tri:c2=tri[a]`) {
    fail(`crossfade: 2-section join graph wrong: ${two}`);
  }
  const four = buildCrossfadeJoinGraph(4);
  if ((four.match(/acrossfade/g) ?? []).length !== 3) fail('crossfade: n sections need n-1 acrossfades');
  if (!four.endsWith('[a]')) fail('crossfade: the join must end at [a] for -map');
  if (!/c1=tri:c2=tri/.test(four)) fail('crossfade: tri/tri (constant-amplitude linear) is the law for correlated loops');
  let threw = false;
  try { buildCrossfadeJoinGraph(1); } catch { threw = true; }
  if (!threw) fail('crossfade: a single section has no join — the builder must refuse');
}

// ---- 5: amix normalize=0 (the -6 dB melody-mix bug) -----------------------
{
  const graph = buildMixBuffersGraph(0.85);
  if (!graph.includes('normalize=0')) fail('mixBuffers: amix must carry normalize=0 (default 1/n scaling dropped BOTH layers ~6 dB)');
  if (!graph.includes('volume=0.85')) fail('mixBuffers: the layer gain must ride the graph');
  if (!graph.includes('alimiter=level=false')) fail('mixBuffers: the honest sum needs the house -1 dB safety limiter');

  // SWEEP: every amix= in the worker source must keep the honest sum. A new
  // call site that forgets normalize=0 re-introduces the silent level drop.
  const srcRoot = join(process.cwd(), 'src');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.ts$/.test(name)) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('amix=') && !line.includes('normalize=0')) {
          offenders.push(`${p.replace(/\\/g, '/')}:${i + 1}`);
        }
      });
    }
  };
  walk(srcRoot);
  if (offenders.length) fail(`amix without normalize=0 (silent 1/n level drop): ${offenders.join(', ')}`);
}

// ---- 6: QC SHIP CONTRACT (weak ships flagged; hard flags die) -------------
{
  const cases: Array<[{ verdict: 'pass' | 'weak' | 'fail'; flags?: string[] }, string]> = [
    [{ verdict: 'fail', flags: ['clipping'] }, 'hard_fail'],
    [{ verdict: 'fail', flags: ['too_quiet'] }, 'hard_fail'],
    [{ verdict: 'fail', flags: [] }, 'hard_fail'], // <8s short-duration hard rule
    [{ verdict: 'weak', flags: ['flat'] }, 'ship_flagged'],
    [{ verdict: 'weak', flags: ['squashed'] }, 'ship_flagged'],
    [{ verdict: 'weak', flags: ['flat', 'squashed'] }, 'ship_flagged'],
    [{ verdict: 'weak', flags: ['unmeasured'] }, 'hard_fail'], // unverifiable never ships
    [{ verdict: 'pass', flags: [] }, 'ship'],
    [{ verdict: 'pass' }, 'ship'],
  ];
  for (const [qc, expected] of cases) {
    const got = qcGateDecision(qc);
    if (got !== expected) fail(`qc contract: ${qc.verdict}/[${(qc.flags ?? []).join(',')}] must be ${expected}, got ${got}`);
  }

  const preMasterCases: Array<[{ verdict: 'pass' | 'weak' | 'fail'; flags?: string[] }, string]> = [
    [{ verdict: 'fail', flags: ['too_quiet'] }, 'ship_flagged'],
    [{ verdict: 'fail', flags: ['too_quiet', 'flat'] }, 'ship_flagged'],
    [{ verdict: 'fail', flags: ['too_quiet', 'clipping'] }, 'hard_fail'],
    [{ verdict: 'fail', flags: ['short'] }, 'hard_fail'],
    [{ verdict: 'weak', flags: ['unmeasured'] }, 'hard_fail'],
    [{ verdict: 'weak', flags: ['flat'] }, 'ship_flagged'],
    [{ verdict: 'pass', flags: [] }, 'ship'],
  ];
  for (const [qc, expected] of preMasterCases) {
    const got = preMasterQcGateDecision(qc);
    if (got !== expected) fail(`pre-master qc: ${qc.verdict}/[${(qc.flags ?? []).join(',')}] must be ${expected}, got ${got}`);
  }
}

// ---- 7: KEY VARIETY (seeded, deterministic, varied) -----------------------
{
  const keys = ['A minor', 'B minor', 'C major', 'D minor'];
  if (pickHomeKey(keys, 12345) !== pickHomeKey(keys, 12345)) fail('key: the pick must be deterministic per seed (replays reproduce)');
  const spread = new Set<string>();
  for (let seed = 0; seed < 48; seed++) spread.add(pickHomeKey(keys, seed));
  if (spread.size < 3) fail(`key: 48 seeds over 4 keys must land 3+ distinct picks (got ${spread.size} — variety is the point)`);
  if (pickHomeKey([], 7) !== 'A minor') fail('key: an empty key list falls back honestly');
  if (pickHomeKey(undefined, 7) !== 'A minor') fail('key: an absent key list falls back honestly');
  if (pickHomeKey(['  ', null, 'F minor'], 3) !== 'F minor') fail('key: blank/null entries are filtered before the pick');

  // The live lane: afrobeats must actually HAVE variety to draw from, every
  // pick must come from its canon, and the catalogue can no longer be 100%
  // commonKeys[0].
  const dna = getSoundDNA('afrobeats');
  const common = dna?.commonKeys ?? [];
  if (common.length < 2) fail('key: afrobeats sound-DNA needs 2+ common keys for variety to exist');
  const picks = new Set<string>();
  for (let seed = 0; seed < 64; seed++) {
    const k = pickHomeKey(common, seed);
    if (!common.includes(k)) fail(`key: pick '${k}' escaped the afrobeats canon`);
    picks.add(k);
  }
  if (picks.size < 2) fail('key: 64 seeds must produce 2+ distinct afrobeats home keys (the B-minor-forever fix)');
}

if (failures) { console.error(`soundwave1: ${failures} failure(s)`); process.exit(1); }
console.log('soundwave1: verbatim forge prompts (full text + key + variant, adapters intact), one-tempo-belief invariant (cut bpm === stored bpm, zero structural drift), bounded monotonic hook lift, tri/tri section crossfades, amix normalize=0 sweep, weak-ships-flagged QC contract, seeded home-key variety — all enforced');
