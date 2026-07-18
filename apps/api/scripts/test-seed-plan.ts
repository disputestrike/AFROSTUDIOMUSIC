/**
 * SEED PLAN — proof (2026-07-18), Wave 4. The deterministic worklist that gives
 * the own engine real vocabulary (and own-origin training fuel).
 */
import assert from 'node:assert/strict';
import { buildSeedPlan, seedPlanTotal } from '../../../packages/shared/src/seed-plan';

const plan = buildSeedPlan();
assert.ok(plan.length > 0, 'plan is non-empty');

// deterministic: same call → same plan
assert.deepEqual(buildSeedPlan(), plan, 'buildSeedPlan is deterministic');

// every item is well-formed
for (const it of plan) {
  assert.ok(it.genre && it.role && it.targetCount > 0, 'each item has genre/role/positive count');
  assert.ok(it.priority === 1 || it.priority === 2, 'priority is 1 or 2');
}

// Afro-core is forged FIRST (priority 1 leads)
const firstNonCore = plan.findIndex((i) => i.priority === 2);
const lastCore = plan.map((i) => i.priority).lastIndexOf(1);
assert.ok(lastCore < firstNonCore, 'all Afro-core items precede the rest');

// amapiano gets a deeper log-drum target (its identity role)
const amaLog = plan.find((i) => i.genre === 'amapiano' && i.role === 'log_drum');
assert.ok(amaLog && amaLog.targetCount > 8, 'amapiano log_drum forges deeper than baseline');

// every lane gets a drums backbone
const genresWithDrums = new Set(plan.filter((i) => i.role === 'drums').map((i) => i.genre));
assert.ok(genresWithDrums.has('afrobeats') && genresWithDrums.has('drill'), 'every lane seeds a drums backbone');

// a capped plan respects the cap
const capped = buildSeedPlan({ maxItems: 10 });
assert.equal(capped.length, 10, 'maxItems caps the worklist');

const total = seedPlanTotal(plan);
assert.ok(total > plan.length, 'total loops exceeds item count (each targets >1)');

console.log(`seed plan: ${plan.length} genre×role items, ${total} loops to forge, Afro-core prioritized, deterministic.`);
