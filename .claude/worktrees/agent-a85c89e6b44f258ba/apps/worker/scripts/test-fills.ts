/**
 * PHASE 5 unit test — buildFillFilterGraph. Pure (no ffmpeg/audio), CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-fills.ts
 *
 * Verifies the ffmpeg filter graph is correctly constructed for N fill placements,
 * delays each fill copy to the right millisecond, keeps the fill subtle, peak-limits,
 * and returns null (skip) when there is nothing to place.
 */
import { buildFillFilterGraph } from '../src/lib/fills';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// Two placements at 10s and 30s.
const g = buildFillFilterGraph([10, 30], { fillGain: 0.5 })!;
console.log('\ngraph:\n' + g.split(';').join(';\n') + '\n');
assert(!!g, 'graph produced for 2 placements');
assert(g.includes('asplit=2'), 'fill split into 2 copies');
assert(g.includes('adelay=10000|10000'), 'first fill delayed to 10s (ms)');
assert(g.includes('adelay=30000|30000'), 'second fill delayed to 30s');
assert(g.includes('amix=inputs=3'), 'mixes 2 fills + the track (3 inputs)');
assert(g.includes('volume=0.5'), 'fill kept subtle (gain applied)');
assert(g.includes('alimiter'), 'peak-limited so it never clips');
// LOAD-BEARING: alimiter defaults level=true (auto-boost to the ceiling), which
// re-normalized every overlaid take to -0.26 dB, defeated the bus headroom AND
// the ×0.6 clipping retry, and killed own-engine renders live ("grid assembly
// failed", 2026-07-12). The overlay limiter must never re-level.
assert(g.includes('alimiter=level=false'), 'overlay limiter does NOT re-level (level=false)');
{
  const m = /alimiter=level=false:limit=([0-9.]+)/.exec(g);
  assert(!!m && Number(m[1]) <= 0.891, 'overlay ceiling keeps -1 dB true-peak headroom (limit <= 0.891)');
}
assert(g.trim().endsWith('[out]'), 'graph ends at the [out] pad ffmpeg maps');

// Honesty / safety: nothing to place -> null (caller keeps the original take).
assert(buildFillFilterGraph([]) === null, 'no placements -> null (skip overlay)');
assert(buildFillFilterGraph([-5, NaN]) === null, 'invalid placements filtered -> null');

// Single placement.
const one = buildFillFilterGraph([5.25])!;
assert(one.includes('asplit=1') && one.includes('adelay=5250|5250') && one.includes('amix=inputs=2'), 'single placement graph correct');

console.log(process.exitCode ? '\n❌ Fills test FAILED' : '\n✅ Fills test PASSED');
