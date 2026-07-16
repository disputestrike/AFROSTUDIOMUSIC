/**
 * GOLDEN-BRIEF DEPLOY GATE (adopted from CrucibAI's repeatability benchmark).
 *
 * The song gates protect individual SONGS; nothing protected the PIPELINE —
 * every regression this week (the homogenizer, the silent engine switch, the
 * inverted fourOnFloor repair) shipped invisibly and was caught on the owner's
 * real songs. This suite runs the pipeline's pure invariants per lane, cheap
 * (no network, no LLM, no render), before every push.
 */
import {
  genreSignature,
  priorAnalyses,
  hasExpertPrior,
  buildLaneProfile,
  scoreLaneCompliance,
  planRepairs,
  resolveEngineForWorkspace,
  type MeasuredAnalysis,
} from '@afrohit/shared';
import { cleanLyricsForMinimax } from '@afrohit/ai';

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

// ---- 1. Every lane has a signature and its identity LEADS the tags ----
const LANES = ['afrobeats', 'amapiano', 'afro_fusion', 'street_pop', 'afro_pop', 'afro_rnb', 'afro_dancehall', 'hip_hop', 'gospel', 'highlife', 'house', 'drill'];
for (const lane of LANES) {
  const sig = genreSignature(lane);
  check(`${lane}: signature exists with tags`, !!sig && (sig.tags?.length ?? 0) > 0);
}
// Rap law: hip-hop's signature must LEAD with rap delivery (the phantom-tags regression)
check('hip_hop: signature leads with rap delivery', /rap/i.test(genreSignature('hip_hop').tags?.[0] ?? ''));

// ---- 2. Expert-prior lanes: profile builds, scores ITSELF in-lane, repairs sane ----
for (const lane of LANES.filter(hasExpertPrior)) {
  const priors = priorAnalyses(lane);
  const profile = buildLaneProfile(lane, 'genre', priors, { minRefs: 1 });
  check(`${lane}: prior profile builds`, Object.keys(profile.features).length > 0);
  const self = scoreLaneCompliance(priors[1]!, profile);
  check(`${lane}: a canonical take scores in-lane (>=70)`, self.overall >= 70, `got ${self.overall}`);
  // Mutate the take OFF-lane and demand a sane repair (the inverted-repair regression)
  const broken = JSON.parse(JSON.stringify(priors[1])) as MeasuredAnalysis;
  const b = broken as unknown as { tempoBpm: { value: number }; fourOnFloor: { value: boolean } };
  b.tempoBpm.value = b.tempoBpm.value + 40;
  b.fourOnFloor.value = !b.fourOnFloor.value;
  const score = scoreLaneCompliance(broken, profile);
  const plan = planRepairs(score);
  const tempoRepair = plan.repairs.find((r) => r.key === 'tempoBpm');
  check(`${lane}: +40bpm take gets a DECREASE tempo repair`, tempoRepair?.direction === 'decrease');
  const fof = plan.repairs.find((r) => r.key === 'fourOnFloor');
  if (fof) {
    // Direction must point BACK toward the lane's own value, never away from it.
    const laneWantsFour = (priorAnalyses(lane)[1] as unknown as { fourOnFloor: { value: boolean } }).fourOnFloor.value;
    check(`${lane}: fourOnFloor repair points toward the lane`, fof.direction === (laneWantsFour ? 'add' : 'remove'), `dir=${fof.direction}`);
  }
}

// ---- 3. Engine-bound lyric hygiene (the sung-[Drum Fill] regression) ----
const dirty = `[Intro]\nNa the night wey shine\n[Drum Fill]\n[Verse 1]\n(drum roll — build up)\nGbedu dey call my body (eh eh!)\n[Fill]\n[Hook]\nDance free (dance free!)`;
const clean = cleanLyricsForMinimax(dirty);
check('marker filter: [Drum Fill]/[Fill] never reach an engine', !/\[(drum )?fill\]/i.test(clean));
check('marker filter: stage directions stripped', !/drum roll/i.test(clean));
check('marker filter: real section headers survive', /\[Intro\]/.test(clean) && /\[Hook\]/.test(clean));
check('marker filter: singable ad-libs survive', /eh eh|dance free/i.test(clean));

// ---- 4. The wall holds on every lane's default route ----
for (const lane of ['afrobeats', 'amapiano']) {
  const r = resolveEngineForWorkspace(undefined, { firstParty: false, sunoAvailable: true });
  check(`${lane}: customer default route never the bridge`, r.engine !== 'suno');
}

console.log(fail === 0 ? '\nGOLDEN BRIEFS: ALL GREEN' : `\nGOLDEN BRIEFS: ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
