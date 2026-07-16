/**
 * TITLE LAW gate — pure (no LLM, no audio), CI-able.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-title-law.ts
 *
 * Owner directive (2026-07-12): titles were sentence-soup ("Wetin We Go Call
 * This Kind God") because no doctrine existed. The law: 1-3 words preferred,
 * 4 max, 28 chars, never a sentence/clause, chantable, ownable. Also gates the
 * hooks-count doctrine: 3 deep hooks, not 20 shallow drafts.
 */
import { titleLawCheck, sanitizeTitle, pickLawfulTitle, generateHooksInputSchema } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// The global canon passes.
for (const t of ['Essence', 'Calm Down', 'Water', 'Soso', 'Unavailable', 'Money Dance', 'Lonely at the Top', 'MMS', 'Owo Loke']) {
  assert(titleLawCheck(t).ok, `canon passes: "${t}"`);
}

// Sentence-soup fails.
for (const t of [
  'Wetin We Go Call This Kind God',
  'Mama, my voice dey blast, hot like jollof',
  'This Block Na We Get Am',
  'First Salary Land Tonight Oh',
  'A very long title that keeps going',
]) {
  assert(!titleLawCheck(t).ok, `sentence-soup fails: "${t}"`);
}

// Punctuation / structure violations.
assert(!titleLawCheck('Night, No Stop').ok, 'comma = sentence punctuation fails');
assert(!titleLawCheck('Why Me?').ok, 'question mark fails');
assert(!titleLawCheck('').ok, 'empty fails');
assert(!titleLawCheck('Hit ft. Wizkid').ok, 'featuring credit fails');

// Sanitizer rescues a lawful title from hook text.
const rescued = sanitizeTitle('Mama, my voice dey blast, hot like jollof—ooo (eh eh)');
assert(titleLawCheck(rescued).ok, `sanitizer output is lawful: "${rescued}"`);
assert(rescued.split(/\s+/).length <= 3, 'sanitizer keeps <= 3 words');
assert(sanitizeTitle('') === 'Untitled', 'empty text -> Untitled');

// pickLawfulTitle: lawful candidate wins verbatim; unlawful falls to sanitize.
assert(pickLawfulTitle(['Money Dance'], 'whatever text') === 'Money Dance', 'lawful candidate wins');
const fell = pickLawfulTitle(['Wetin We Go Call This Kind God'], 'wetin we go call this kind god eh');
assert(titleLawCheck(fell).ok, `unlawful candidate falls through to a lawful derivation: "${fell}"`);

// HOOKS DOCTRINE: 3 deep hooks by default (owner law), never 20.
const parsed = generateHooksInputSchema.parse({ projectId: 'cjld2cjxh0000qzrmn831i7rn' });
assert(parsed.count === 3, `hooks default is 3 (got ${parsed.count})`);

console.log(process.exitCode ? '\n❌ Title law test FAILED' : '\n✅ Title law test PASSED');
