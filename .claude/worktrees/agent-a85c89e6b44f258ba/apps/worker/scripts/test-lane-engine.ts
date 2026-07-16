/**
 * PHASE 7 unit test — recommendEngine. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-engine.ts
 */
import { recommendEngine } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

const withSuno = recommendEngine('amapiano', { sunoAvailable: true, replicateAvailable: true, firstParty: true });
assert(withSuno.engine === 'suno' && withSuno.ceiling === 'evaluation', 'approved first-party key -> flagship evaluation route');
assert(!withSuno.lift, 'connected flagship route needs no connection hint');

const noSuno = recommendEngine('amapiano', { sunoAvailable: false, replicateAvailable: true, firstParty: true });
assert(noSuno.engine === 'minimax' && noSuno.ceiling === 'standard', 'no flagship key -> connected standard route');
assert(!!noSuno.lift && /benchmark/i.test(noSuno.lift), 'offers the first-party benchmark route without a quality claim');

const none = recommendEngine('amapiano', { sunoAvailable: false, replicateAvailable: false, firstParty: false });
assert(none.engine === 'unavailable' && none.ceiling === 'unavailable', 'no credential -> unavailable, never an invented standard route');

console.log(process.exitCode ? '\n❌ LaneEngine test FAILED' : '\n✅ LaneEngine test PASSED');
