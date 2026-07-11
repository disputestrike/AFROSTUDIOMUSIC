/**
 * CRAFT-LAWS GATE — receipts that the songwriting laws distilled from the
 * external critic reviews (Blue Tick 6.5→10 pack, then the 8.4/10 "Ogba gate"
 * review of 2026-07-10) are SHIPPED in the central prompts and WIRED into
 * every writer path. Prompts are law; this gate keeps them from silently
 * regressing in a refactor. Exit 1 on any missing marker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let failures = 0;
function expect(rel: string, content: string, markers: string[], label: string): void {
  for (const m of markers) {
    if (content.includes(m)) continue;
    console.error(`FAIL [${label}] missing marker in ${rel}: "${m}"`);
    failures++;
  }
}

// --- The writer's law (LYRIC_SYSTEM + LYRIC_POLISH_SYSTEM) -----------------
const lyrics = read('packages/ai/src/prompts/lyrics.ts');
expect('packages/ai/src/prompts/lyrics.ts', lyrics, [
  'THE HIT ENGINE',
  'TITLE-HOOK LOCK',
  'NEVER turn green',
  'WRITE FOR THE MOUTH',
  'HOOK ECONOMICS',
  'RHYME DISCIPLINE',
  'SIGNATURE LINES',
  'NATURAL SPEECH & LOGIC LAWS',
  'PARTICLE DISCIPLINE',
  'NO RHYME PLACEHOLDERS',
  'COMPLETE EVERY THOUGHT',
  'POINT OF VIEW',
  'SYMPATHETIC NARRATOR',
  'BRIDGE OWNERSHIP',
  'QUOTED MESSAGES ARE REAL TEXTS',
  'EARNED PROVERBS ONLY',
  'INTRO BELONGS TO THE CONCEPT',
  'HOOK PAYOFF LINES',
], 'writer');
expect('packages/ai/src/prompts/lyrics.ts', lyrics, [
  'LINE-BY-LINE REJECTION TEST',
  'FINAL HUMAN SONGWRITER AUDIT',
  'PARTICLE CHECK',
  'FORCED RHYME',
  'LOGIC & POV',
  'MOUTH TEST AT TEMPO',
  'HOOK FINAL LINES',
  'DELETING an almost-good line',
], 'critic');

// --- The hook law ----------------------------------------------------------
expect('packages/ai/src/prompts/hooks.ts', read('packages/ai/src/prompts/hooks.ts'), [
  'HOOK ECONOMICS',
  'HOOK FINAL LINE',
  'Natural phrasing outranks rhyme',
], 'hooks');

// --- Wiring: every writer path runs the same law ---------------------------
// Studio Chat writer + polish pass
expect('apps/api/src/services/chat-tools.ts', read('apps/api/src/services/chat-tools.ts'), [
  'LYRIC_SYSTEM',
  'LYRIC_POLISH_SYSTEM',
], 'wiring:chat');
// Create-page lyrics route + polish pass
expect('apps/api/src/routes/lyrics.ts', read('apps/api/src/routes/lyrics.ts'), [
  'LYRIC_SYSTEM',
  'LYRIC_POLISH_SYSTEM',
], 'wiring:route');
// Will-it-blow rewrite loop inherits the writer law
expect('apps/api/src/lib/will-it-blow.ts', read('apps/api/src/lib/will-it-blow.ts'), [
  'LYRIC_SYSTEM',
], 'wiring:gate');
// Writer A/B bench judges both brains under the identical law
expect('apps/api/src/lib/writer-ab.ts', read('apps/api/src/lib/writer-ab.ts'), [
  'LYRIC_SYSTEM',
  'LYRIC_POLISH_SYSTEM',
], 'wiring:ab');

if (failures > 0) {
  console.error(`craft-laws: ${failures} missing marker(s)`);
  process.exit(1);
}
console.log('craft-laws: all law markers shipped + wired (writer, critic, hooks, chat/route/gate/ab)');
