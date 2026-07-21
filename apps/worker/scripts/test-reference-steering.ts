/**
 * REFERENCE STEERING gate — the owner's "if I select FEEL LIKE DRE, it should
 * FEEL LIKE DRE" contract. Before this, the DEFAULT (own) renderer DROPPED the
 * influence/mood/vibe before rendering; the provider path buried influence at
 * the truncated tail of a 160-char vibe. This pins the fix end-to-end:
 *   (a) both own-engine enqueue sites CARRY influence/mood/vibePrompt,
 *   (b) unsupportedOwnEngineControls no longer lists mood/influence/vibePrompt,
 *   (c) the enriched own melody prompt carries the influence+mood + guard,
 *   (d) the Producer Brain receives mood+influenceLane and its system prompt
 *       carries the never-clone directive,
 *   (e) composeStyleTags FRONT-LOADS the influence token (before the vibe, and
 *       it survives the char cap),
 *   (f) NO voice-clone instruction is emitted anywhere — the never-clone guard
 *       rides every steering string, and no affirmative clone/imitate-voice text.
 *
 * LEGAL LINE: "feel like Dre" = PRODUCTION-STYLE steering (legit). Cloning or
 * imitating a real person's VOICE is forbidden. This gate proves the boundary.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-reference-steering.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INFLUENCE_NEVER_CLONE_GUARD,
  influenceDirective,
  influenceStyleToken,
  enrichedOwnMelodyPrompt,
  genreSignature,
} from '@afrohit/shared';
import { composeStyleTags } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('  ok:', msg);
}

const root = join(__dirname, '..', '..', '..');
const beatsSrc = readFileSync(join(root, 'apps/api/src/routes/beats.ts'), 'utf8');
const chatSrc = readFileSync(join(root, 'apps/api/src/services/chat-tools.ts'), 'utf8');
const ownEngineSrc = readFileSync(join(root, 'apps/worker/src/processors/own-engine.ts'), 'utf8');
const brainSrc = readFileSync(join(root, 'packages/ai/src/agents/producer-brain.ts'), 'utf8');

// --- (a) BOTH own-engine enqueue sites carry the reference -------------------
for (const [label, src] of [
  ['beats.ts', beatsSrc],
  ['chat-tools.ts', chatSrc],
] as const) {
  assert(src.includes('enrichedOwnMelodyPrompt({'), `${label}: own-engine payload builds the ENRICHED melody prompt (not the bare table string)`);
  assert(/melodyPrompt: enrichedOwnMelodyPrompt\(\{[\s\S]*?influence:/.test(src), `${label}: enriched prompt is fed the influence`);
  assert(/\bmood: (?:input|a)\.mood,\s*\n\s*influence: (?:input|a)\.influence,\s*\n\s*vibePrompt: (?:input|a)\.vibePrompt,/.test(src), `${label}: own-engine payload carries raw mood + influence + vibePrompt`);
}
// The bare table string must be GONE from the own-engine payloads (regression guard).
assert(!/melodyPrompt: genreSignature\((?:genre|a\.genre)\)\.melodyPrompt,/.test(beatsSrc), 'beats.ts: no bare genreSignature().melodyPrompt in the own payload');
assert(!/melodyPrompt: genreSignature\((?:genre|a\.genre)\)\.melodyPrompt,/.test(chatSrc), 'chat-tools.ts: no bare genreSignature().melodyPrompt in the own payload');

// --- (b) unsupportedOwnEngineControls no longer drops the reference ----------
const unsupportedFn = beatsSrc.slice(
  beatsSrc.indexOf('export function unsupportedOwnEngineControls'),
  beatsSrc.indexOf('export function resolveOwnEngineRouting')
);
assert(unsupportedFn.length > 0, 'located unsupportedOwnEngineControls()');
assert(!/\?\s*'mood'\s*:/.test(unsupportedFn), 'unsupportedOwnEngineControls no longer returns "mood"');
assert(!/\?\s*'influence'\s*:/.test(unsupportedFn), 'unsupportedOwnEngineControls no longer returns "influence"');
assert(!/\?\s*'vibePrompt'\s*:/.test(unsupportedFn), 'unsupportedOwnEngineControls no longer returns "vibePrompt"');
// Genuinely-unsupported controls stay reported.
assert(/'fusionGenres'/.test(unsupportedFn), 'fusionGenres still reported unsupported');
assert(/'keySignature'/.test(unsupportedFn), 'keySignature still reported unsupported');
assert(/'pinnedReferenceId'/.test(unsupportedFn), 'pinnedReferenceId still reported unsupported');
assert(/'trainingReferences'/.test(unsupportedFn), 'trainingReferences still reported unsupported');

// --- (c) the enriched melody prompt carries influence + mood + guard ---------
const enriched = enrichedOwnMelodyPrompt({
  genre: 'hip_hop',
  mood: 'heartbreak',
  influence: 'Dre',
  vibePrompt: 'late-night ride, smooth and confident',
});
assert(enriched.startsWith(genreSignature('hip_hop').melodyPrompt), 'enriched prompt LEADS with the lane melody brief (genre identity first)');
assert(/heartbreak mood/.test(enriched), 'enriched prompt carries the mood colour');
assert(/production lane of Dre/i.test(enriched), 'enriched prompt carries the artist production lane');
assert(enriched.includes(INFLUENCE_NEVER_CLONE_GUARD), 'enriched prompt carries the never-clone guard');
assert(/late-night ride/.test(enriched), 'enriched prompt carries the free-text vibe');
// Empty influence/mood => just the lane brief (no dangling separators).
const bare = enrichedOwnMelodyPrompt({ genre: 'hip_hop' });
assert(bare === genreSignature('hip_hop').melodyPrompt, 'no reference => bare lane brief, no dangling ". "');

// --- (d) Producer Brain receives mood + influenceLane; system prompt guards --
assert(/mood: p\.mood/.test(ownEngineSrc), 'own-engine passes mood into planProduction');
assert(/influenceLane: influenceDirective\(p\.influence\)/.test(ownEngineSrc), 'own-engine passes influenceLane (guarded directive) into planProduction');
assert(/influenceLane\?: string \| null/.test(brainSrc), 'planProduction opts declares influenceLane');
assert(/ARTIST_PRODUCTION_LANE: opts\.influenceLane/.test(brainSrc), 'producer-brain threads influenceLane into the model input');
assert(/mood: opts\.mood/.test(brainSrc), 'producer-brain threads mood into the model input');
// The system prompt carries the never-clone directive + structural mood steering.
assert(/never a clone, never a named artifact, never imitate a living person's voice/.test(brainSrc), 'PRODUCER_BRAIN_SYSTEM carries the never-clone directive');
assert(/MOOD is STRUCTURE/.test(brainSrc), 'PRODUCER_BRAIN_SYSTEM maps mood to STRUCTURE (arc/density/lean), not just a tag');
assert(/never break the genre's tempo band/i.test(brainSrc), 'mood bias is clamped within the lane BPM band (no hard override)');

// --- (e) composeStyleTags FRONT-LOADS the influence token --------------------
// Small dnaTags: influence token present and appears BEFORE the vibe token.
const small: MusicGenerationInput = {
  genre: 'hip_hop',
  bpm: 92,
  durationS: 170,
  withStems: true,
  influence: 'Dre',
  vibePrompt: 'late-night ride, smooth and confident',
  dnaTags: ['sparse dark keys', '808 sub bass'],
};
const smallTags = composeStyleTags(small, { fallbackLiteral: 'radio-ready' });
const influIdx = smallTags.findIndex((t) => /production lane: like Dre/i.test(t));
const vibeIdx = smallTags.findIndex((t) => /late-night ride/i.test(t));
assert(influIdx >= 0, 'composeStyleTags emits the influence token');
assert(vibeIdx >= 0, 'composeStyleTags still emits the vibe (small load)');
assert(influIdx < vibeIdx, `influence token FRONT-LOADED before the vibe (${influIdx} < ${vibeIdx})`);
assert(smallTags[influIdx]!.includes(INFLUENCE_NEVER_CLONE_GUARD), 'the emitted influence token carries the never-clone guard');

// Heavy dnaTags: blow past the 700-char cap; the front-loaded influence token
// SURVIVES while the late vibe is truncated away — the whole point of the fix.
const heavyDna = Array.from(
  { length: 40 },
  (_, i) => `unique-${i} warm analog texture token describing color depth and space`
);
const heavy: MusicGenerationInput = { ...small, dnaTags: heavyDna };
const heavyTags = composeStyleTags(heavy, { fallbackLiteral: 'radio-ready' });
assert(heavyTags.some((t) => /production lane: like Dre/i.test(t)), 'influence token SURVIVES the char cap (front-loaded)');
assert(!heavyTags.some((t) => /late-night ride/i.test(t)), 'the late vibe is truncated under load — proves front-loading matters');
assert(heavyTags.join(' ').length <= 720, 'composeStyleTags honors its ~700-char identity budget');

// Provider path source: influence is FIRST-CLASS, not baked into the vibe tail.
assert(/influenceToken = influenceStyleToken\(input\.influence\)/.test(readFileSync(join(root, 'packages/ai/src/providers/music.ts'), 'utf8')), 'music.ts builds the front-loaded influenceToken');
assert(/influence: undefined/.test(readFileSync(join(root, 'packages/ai/src/providers/music.ts'), 'utf8')), 'Eleven policy scrub drops influence (artist-imitation policy)');
assert(/influence: input\.influence,/.test(beatsSrc), 'beats.ts provider path threads influence as a first-class field');
assert(/influence: a\.influence,/.test(chatSrc), 'chat-tools.ts provider path threads influence as a first-class field');

// --- (f) NEVER voice-clone: guard present, no affirmative clone instruction --
const steeringStrings = [
  influenceDirective('Dre')!,
  influenceStyleToken('Dre')!,
  enriched,
  smallTags[influIdx]!,
  brainSrc.slice(brainSrc.indexOf('PRODUCER_BRAIN_SYSTEM ='), brainSrc.indexOf('export async function planProduction')),
];
for (const s of steeringStrings) {
  // If a string touches voice/clone/imitate, it MUST be negated by "never".
  if (/\b(?:clone|imitate|mimic|replicate)\b/i.test(s) || /\bvoice\b/i.test(s)) {
    assert(/\bnever\b/i.test(s), `steering string negates cloning with "never": ${s.slice(0, 48)}…`);
  }
}
const FORBIDDEN_AFFIRMATIVE = [
  'clone the voice', 'clone a voice', 'imitate the voice', 'imitate a voice',
  'copy the voice', 'mimic the voice', 'replicate the voice', 'in the voice of',
  'sound exactly like', 'reproduce the voice', 'clone their voice', 'imitate their voice',
];
for (const s of steeringStrings) {
  const low = s.toLowerCase();
  for (const bad of FORBIDDEN_AFFIRMATIVE) {
    assert(!low.includes(bad), `no affirmative voice-clone instruction ("${bad}")`);
  }
}
assert(influenceDirective('Dre')!.includes(INFLUENCE_NEVER_CLONE_GUARD), 'influenceDirective carries the guard');
assert(influenceStyleToken('Dre')!.includes(INFLUENCE_NEVER_CLONE_GUARD), 'influenceStyleToken carries the guard');
assert(influenceDirective('') === null && influenceStyleToken(null) === null, 'no influence => no token (null)');

console.log(process.exitCode ? '\n❌ Reference steering gate FAILED' : '\n✅ Reference steering gate PASSED');
