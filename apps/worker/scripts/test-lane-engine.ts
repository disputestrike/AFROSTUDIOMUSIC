/**
 * PHASE 7 unit test — recommendEngine. Pure, CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lane-engine.ts
 */
import { recommendEngine } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

const withSuno = recommendEngine('amapiano', { sunoAvailable: true });
assert(withSuno.engine === 'suno' && withSuno.ceiling === 'best', 'Suno key -> Suno at the best ceiling');
assert(!withSuno.lift, 'at best ceiling, no lift suggested');

const noSuno = recommendEngine('amapiano', { sunoAvailable: false });
assert(noSuno.engine === 'minimax' && noSuno.ceiling === 'good', 'no Suno key -> MiniMax at good ceiling');
assert(!!noSuno.lift && /SUNO_API_KEY/.test(noSuno.lift), 'suggests setting SUNO_API_KEY to lift the ceiling');

console.log(process.exitCode ? '\n❌ LaneEngine test FAILED' : '\n✅ LaneEngine test PASSED');
