/**
 * PRODUCER BRAIN gate — the hybrid contract (owner directive 2026-07-19:
 * "dynamically deterministic"): the LLM plans, the REFEREE validates with
 * ground truth, the template stays as the fail-open floor. These tests pin the
 * referee (pure code) + the wiring, so the brain can never break a render.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-producer-plan.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refereeProductionPlan, PRODUCTION_PLAN_LIMITS } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

const SHELF = ['drums', 'shaker', 'bass', 'chords', 'kalimba', 'synth_pad'];

// A good plan passes intact.
const good = refereeProductionPlan({
  sections: [
    { name: 'Cold Hook', bars: 8, energy: 0.9, roles: ['drums', 'bass', 'chords', 'kalimba'] },
    { name: 'verse', bars: 16, energy: 0.5, roles: ['drums', 'shaker', 'chords'] },
    { name: 'hook', bars: 8, energy: 1, roles: ['drums', 'bass', 'chords', 'synth_pad'] },
    { name: 'outro', bars: 4, energy: 0.2, roles: ['kalimba'] },
  ],
  bpm: 104, keySignature: 'A minor', intent: 'cold-open defiance record',
}, SHELF);
assert(!!good, 'a sound plan survives the referee');
assert(good!.sections.length === 4 && good!.sections[0]!.name === 'cold_hook', 'names normalized, sections kept');
assert(good!.bpm === 104 && good!.keySignature === 'A minor', 'bpm/key pass through when sane');

// Unknown roles are DROPPED, never fatal (the strip law).
const stripped = refereeProductionPlan({
  sections: [
    { name: 'a', bars: 8, energy: 0.8, roles: ['drums', 'steel_pan', 'bass'] },
    { name: 'b', bars: 8, energy: 0.4, roles: ['chords', 'harp_of_atlantis'] },
    { name: 'c', bars: 8, energy: 1, roles: ['drums', 'bass', 'chords'] },
  ],
}, SHELF);
assert(!!stripped, 'plan with unknown roles still passes');
assert(!stripped!.sections.some(s => s.roles.includes('steel_pan')), 'unavailable roles stripped');

// Clamps: bars, energy, section cap, total length.
const clamped = refereeProductionPlan({
  sections: [
    { name: 'x', bars: 900, energy: 7, roles: ['drums'] },
    { name: 'y', bars: -3, energy: -1, roles: ['bass'] },
    { name: 'z', bars: 24, energy: 0.5, roles: ['chords', 'drums'] },
  ],
}, SHELF);
assert(!!clamped, 'wild numbers clamp instead of failing');
assert(clamped!.sections.every(s => s.bars >= PRODUCTION_PLAN_LIMITS.minBars && s.bars <= PRODUCTION_PLAN_LIMITS.maxBars), 'bars clamped to limits');
assert(clamped!.sections.every(s => s.energy >= 0 && s.energy <= 1), 'energy clamped 0..1');
assert(clamped!.sections.reduce((a, s) => a + s.bars, 0) <= PRODUCTION_PLAN_LIMITS.maxTotalBars, 'total bars clamped');

// Hopeless plans return null -> the caller falls back to the template.
assert(refereeProductionPlan(null, SHELF) === null, 'null plan -> template fallback');
assert(refereeProductionPlan({ sections: [] }, SHELF) === null, 'empty plan -> template fallback');
assert(refereeProductionPlan({ sections: [{ name: 'a', bars: 8, energy: 1, roles: ['ghost_role'] }] }, SHELF) === null, 'all-unknown roles -> template fallback');
assert(
  refereeProductionPlan({
    sections: [
      { name: 'a', bars: 8, energy: 0.5, roles: ['synth_pad'] },
      { name: 'b', bars: 8, energy: 0.6, roles: ['chords'] },
      { name: 'c', bars: 8, energy: 0.7, roles: ['synth_pad', 'chords'] },
    ],
  }, SHELF) === null,
  'no rhythm/low-end anchor anywhere -> template fallback (a pad wash is not a record; kalimba counts as rhythm in the taxonomy)'
);

// LENGTH CONTRACT (audit 2026-07-19: own renders were ~148s vs 185-200s lane
// targets): with a bar budget the referee scales the plan INTO the ±25% window.
const shortPlan = refereeProductionPlan({
  sections: [
    { name: 'a', bars: 8, energy: 0.4, roles: ['drums', 'bass'] },
    { name: 'b', bars: 16, energy: 0.9, roles: ['drums', 'chords'] },
    { name: 'c', bars: 8, energy: 0.6, roles: ['shaker', 'chords'] },
    { name: 'd', bars: 8, energy: 1, roles: ['drums', 'bass', 'chords'] },
  ],
}, SHELF, { targetBars: 80 }); // 185s @ 104bpm ≈ 80 bars
assert(!!shortPlan, 'short plan with a budget survives');
const scaledTotal = shortPlan!.sections.reduce((a, s) => a + s.bars, 0);
assert(scaledTotal >= 60 && scaledTotal <= 100, `40-bar plan scales toward the 80-bar budget (got ${scaledTotal})`);
// Without a budget the old static window still applies.
const noBudget = refereeProductionPlan({
  sections: [
    { name: 'a', bars: 8, energy: 0.4, roles: ['drums', 'bass'] },
    { name: 'b', bars: 16, energy: 0.9, roles: ['drums', 'chords'] },
    { name: 'c', bars: 8, energy: 1, roles: ['drums', 'bass', 'chords'] },
  ],
}, SHELF);
assert(!!noBudget && noBudget!.sections.reduce((a, s) => a + s.bars, 0) === 32, 'no budget -> plan bars untouched (static window)');

// Bad key/bpm are dropped, not fatal.
const badMeta = refereeProductionPlan({
  sections: [
    { name: 'a', bars: 8, energy: 0.5, roles: ['drums', 'bass'] },
    { name: 'b', bars: 8, energy: 0.9, roles: ['drums', 'chords'] },
    { name: 'c', bars: 8, energy: 0.3, roles: ['shaker', 'kalimba'] },
  ],
  bpm: 9000, keySignature: 'H sharp ultra',
}, SHELF);
assert(!!badMeta && badMeta!.bpm === PRODUCTION_PLAN_LIMITS.maxBpm && badMeta!.keySignature === undefined, 'bpm clamps, invalid key dropped');

// --- WIRING (markers, so a refactor cannot silently unplug the brain) -------
const root = join(__dirname, '..', '..', '..');
const ownEngine = readFileSync(join(root, 'apps/worker/src/processors/own-engine.ts'), 'utf8');
assert(ownEngine.includes('planProduction'), 'own-engine calls the Producer Brain');
assert(ownEngine.includes('OWN_ENGINE_PRODUCER_BRAIN'), 'kill switch present');
assert(ownEngine.includes('recentRenderOutcomes'), 'P2 feedback loop wired (outcomes read)');
assert(ownEngine.includes('productionPlan: productionPlanMeta'), 'P2 feedback loop wired (plan stamped on the beat)');
assert(/plannedSections\s*\?\?\s*sectionsFrom/.test(ownEngine), 'deterministic template remains the fail-open floor');
const brainSrc = readFileSync(join(root, 'packages/ai/src/agents/producer-brain.ts'), 'utf8');
assert(brainSrc.includes("forceTier: 'bulk'"), 'brain runs bulk-tier only (cost law: never bills judgment)');
assert(brainSrc.includes('refereeProductionPlan'), 'brain output goes through the referee');

console.log(process.exitCode ? '\n❌ Producer plan gate FAILED' : '\n✅ Producer plan gate PASSED');
