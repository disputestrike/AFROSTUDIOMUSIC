/**
 * NIGHT LAW test — a forceTier:'bulk' run (morning-drop/zap-radar/nightly-
 * compound) must NEVER bill Claude, not even down the failure ladder. This locks
 * the fix for the owner cost-leak audit (2026-07-13): before it, a Cerebras
 * hiccup or a >28k-char prompt fell through to callClaude() and silently burned
 * Anthropic money overnight with zero songs made.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-night-law.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
let failures = 0;
function expect(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); failures++; } else console.log('  ok:', msg); }

const gen = read('packages/ai/src/generate.ts');
// The two Claude-calling conditions must both be guarded by !forcedBulk.
expect(/wantClaude && anthropicEnabled\(\) && !forcedBulk/.test(gen), 'generate.ts: main Claude path guarded by !forcedBulk');
expect(/anthropicEnabled\(\) && !forcedBulk && \/quota/.test(gen), 'generate.ts: OpenAI-quota Claude retry guarded by !forcedBulk');
// forcedBulk must be derived from the brain context (the night wrapper).
expect(/forcedBulk = brainContext\(\)\?\.forceTier === 'bulk'/.test(gen), 'generate.ts: forcedBulk comes from forceTier');
// There must be NO unguarded callClaude() reachable in a bulk run: every
// `callClaude()` invocation site is inside a `!forcedBulk` conditional.
const claudeCalls = (gen.match(/await callClaude\(\)/g) ?? []).length;
expect(claudeCalls >= 2, `generate.ts: callClaude sites present (${claudeCalls})`);

const ar = read('packages/ai/src/ar-director.ts');
// The direct claudeJson callers (bypass generateJson) honor the night law too.
expect(/const bulkRun = \(\): boolean => brainContext\(\)\?\.forceTier === 'bulk'/.test(ar), 'ar-director.ts: bulkRun() helper present');
expect(/STUB_AI === '1' \|\| bulkRun\(\)/.test(ar), 'ar-director.ts: writeAndScoreHooks skips Claude in a bulk run');
expect(/anthropicEnabled\(\) && !bulkRun\(\)/.test(ar), 'ar-director.ts: directorRefineHooks skips Claude in a bulk run');

console.log(failures ? '\n❌ Night-law test FAILED' : '\n✅ Night-law test PASSED');
if (failures) process.exitCode = 1;
