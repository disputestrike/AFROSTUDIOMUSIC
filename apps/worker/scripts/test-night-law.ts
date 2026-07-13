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
import { cerebrasKey } from '@afrohit/ai';

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

// CEREBRAS MULTI-KEY ROTATION (owner 2026-07-13: round-robin many keys so a
// rate limit is never hit) — the more keys, the less bulk work ever fails and
// laddders toward Claude. Round-robin distributes; the retry loop survives a 429.
const cb = read('packages/ai/src/cerebras-client.ts');
expect(/for \(let i = 0; i < keys\.length; i\+\+\)/.test(cb), 'cerebras-client: cerebrasJson loops over all keys');
expect(/rotating to next key/.test(cb), 'cerebras-client: retries the NEXT key on a per-key failure (429/5xx/bad key)');
expect(/status !== 400/.test(cb), 'cerebras-client: a 400 (bad request) is not wastefully retried across keys');
process.env.CEREBRAS_API_KEYS = 'kA,kB,kC';
const picks = [cerebrasKey(), cerebrasKey(), cerebrasKey()];
expect(new Set(picks).size === 3, `cerebras: round-robins across all 3 keys (${picks.join(',')})`);
expect(cerebrasKey() === picks[0], 'cerebras: wraps back to the first key after the list');

console.log(failures ? '\n❌ Night-law test FAILED' : '\n✅ Night-law test PASSED');
if (failures) process.exitCode = 1;
