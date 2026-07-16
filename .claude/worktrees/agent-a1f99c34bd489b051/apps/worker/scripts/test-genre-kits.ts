/**
 * GENRE-KIT GATE — every genre ships a complete, correct, producer-grade kit.
 *
 * Proves the 42-genre material rebuild is real: each kit covers all core musical
 * jobs (rhythm + low_end + harmony + a top line), names its signature roles,
 * declares what would make it the wrong genre, and carries engine tags. Also
 * enforces the specific bugs the audit found: amapiano must own the log drum,
 * afrobeats must NOT, and no kit may be the old amapiano-for-everything mush.
 */
import { GENRE_KITS, GENRE_KIT_KEYS, getGenreKit, kitCoverageGaps, missingSignatures, isMaterialRole, synthKitFor } from '@afrohit/shared';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

if (GENRE_KIT_KEYS.length < 40) fail(`expected 40+ genre kits, got ${GENRE_KIT_KEYS.length}`);

for (const [genre, kit] of Object.entries(GENRE_KITS)) {
  // Every role referenced must be a real taxonomy role.
  for (const r of [...kit.requiredRoles, ...kit.optionalRoles, ...kit.signatureRoles, ...kit.mixPriorities]) {
    if (!isMaterialRole(r)) fail(`[${genre}] unknown role "${r}"`);
  }
  // Complete: all core jobs covered.
  const gaps = kitCoverageGaps(kit);
  if (gaps.length) fail(`[${genre}] kit missing core job(s): ${gaps.join(', ')}`);
  // Must declare its identity + guardrails.
  if (kit.signatureRoles.length < 2) fail(`[${genre}] needs >=2 signature roles, has ${kit.signatureRoles.length}`);
  if (!kit.forbiddenTraits.length) fail(`[${genre}] declares no forbiddenTraits`);
  if (kit.engineTags.length < 4) fail(`[${genre}] needs >=4 engineTags, has ${kit.engineTags.length}`);
  if (!kit.qualityChecks.length) fail(`[${genre}] declares no qualityChecks`);
  if (!kit.sectionMap.length) fail(`[${genre}] has no sectionMap`);
}

// The exact bug the whole audit was about: amapiano owns the log drum; afrobeats
// must NOT be log-drum-led (that was the "everything sounds like amapiano" mush).
const ama = getGenreKit('amapiano')!;
if (![...ama.requiredRoles, ...ama.signatureRoles].includes('log_drum')) fail('amapiano kit is missing its signature log_drum');
if (!ama.requiredRoles.includes('piano') && !ama.optionalRoles.includes('piano') && !ama.signatureRoles.includes('piano')) fail('amapiano kit is missing its jazzy piano');

const afb = getGenreKit('afrobeats')!;
if ([...afb.requiredRoles, ...afb.signatureRoles].includes('log_drum')) fail('afrobeats kit wrongly REQUIRES a log drum (that is amapiano)');
if (afb.fourOnFloor) fail('afrobeats wrongly marked four-on-the-floor');

// Highlife must be guitar-band, not log-drum.
const hl = getGenreKit('highlife')!;
if ([...hl.requiredRoles, ...hl.signatureRoles].includes('log_drum')) fail('highlife wrongly includes a log drum');
if (!hl.signatureRoles.includes('highlife_guitar')) fail('highlife missing its signature interlocking guitar');

// House/EDM SHOULD be four-on-the-floor; afro lanes generally not.
if (!getGenreKit('house')!.fourOnFloor) fail('house should be four-on-the-floor');

// The ear hook works: an amapiano take with no log drum fails its signature.
const miss = missingSignatures('amapiano', ['piano', 'shaker']);
if (!miss.includes('log_drum')) fail('missingSignatures should flag amapiano lacking log_drum');

// synthKitFor is the unified role map: afrobeats forges DRUMS (a real kick), not
// amapiano's log_drum; amapiano forges the log_drum. This is what the owned
// engine + synth bridge both read now (they used to disagree).
const afbKit = synthKitFor('afrobeats');
if (afbKit.includes('log_drum')) fail('synthKitFor(afrobeats) wrongly includes log_drum');
if (!afbKit.includes('drums')) fail('synthKitFor(afrobeats) missing real drums (kick/snare)');
if (!synthKitFor('amapiano').includes('log_drum')) fail('synthKitFor(amapiano) missing its log_drum');
if (!synthKitFor('house').includes('drums')) fail('synthKitFor(house) missing drums');

if (failures) { console.error(`genre-kits: ${failures} failure(s)`); process.exit(1); }
console.log(`genre-kits: all ${GENRE_KIT_KEYS.length} genres ship complete, guardrailed kits; amapiano≠afrobeats≠highlife enforced`);
