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
// The Afro-record reframe (owner audit 2026-07-12): the writer stopped writing
// short-films. These markers keep the RECORD LAW from regressing to the template.
expect('packages/ai/src/prompts/lyrics.ts', lyrics, [
  'THE RECORD LAW',
  'THE VOICE IS AN INSTRUMENT',
  'THE HOOK IS THE RECORD',
  'WORD ECONOMY',
  'STRUCTURE IS CHOSEN',
  'PICK ONE LYRIC MODE',
  'AUTHENTICITY LAW',
  'THE BRIDGE IS OPTIONAL',
  // The writer is now TRAINED on the owner's exemplars (few-shot anchors).
  'writerTrainingBrief',
], 'record-law');

// --- The hook law ----------------------------------------------------------
expect('packages/ai/src/prompts/hooks.ts', read('packages/ai/src/prompts/hooks.ts'), [
  'HOOK ECONOMICS',
  'HOOK FINAL LINE',
  'Natural phrasing outranks rhyme',
  // Owner directive 2026-07-12: the hook cell must be title-grade (it becomes
  // the song title) and depth beats breadth (3 committed hooks, no filler).
  'TITLE-GRADE CELL',
  'DEPTH OVER BREADTH',
], 'hooks');

// --- The title law ----------------------------------------------------------
// The writer's prompt carries the law; the code gate (pickLawfulTitle) backs it
// at every AI-derived title site so a lawless title can never ship.
expect('packages/ai/src/prompts/lyrics.ts', read('packages/ai/src/prompts/lyrics.ts'), [
  'TITLE LAW',
], 'title:prompt');

// --- Wiring: every writer path runs the same law ---------------------------
// Studio Chat writer + polish pass
expect('apps/api/src/services/chat-tools.ts', read('apps/api/src/services/chat-tools.ts'), [
  'LYRIC_SYSTEM',
  'LYRIC_POLISH_SYSTEM',
  'pickLawfulTitle',
], 'wiring:chat');
// Create-page lyrics route + polish pass
expect('apps/api/src/routes/lyrics.ts', read('apps/api/src/routes/lyrics.ts'), [
  'LYRIC_SYSTEM',
  'LYRIC_POLISH_SYSTEM',
  'pickLawfulTitle',
], 'wiring:route');
// Hook approval derives the song title through the same gate
expect('apps/api/src/routes/hooks.ts', read('apps/api/src/routes/hooks.ts'), [
  'pickLawfulTitle',
], 'wiring:hooks');
// Will-it-blow rewrite loop inherits the writer law
expect('apps/api/src/lib/will-it-blow.ts', read('apps/api/src/lib/will-it-blow.ts'), [
  'LYRIC_SYSTEM',
  'pickLawfulTitle',
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
