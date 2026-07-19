/**
 * GENRE CANON gate — the audit's measured quick-win (2026-07-19). The heuristic
 * resolved 4/12 real chat requests; 7 of 8 misses were case/space/hyphen/alias
 * brittleness. This gate pins every known miss RESOLVING and the tables
 * answering with their REAL recipes (not the generic 106bpm/A-minor fallback).
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-genre-canon.ts
 */
import { canonicalizeGenre, genreSignature, getGenreKit, paletteFor } from '@afrohit/shared';
import { getSoundDNA } from '@afrohit/ai';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

// THE 8 MEASURED MISSES (exp-engine-heuristic corpus) — all must resolve now.
const MISSES: Array<[string, string]> = [
  ['lo-fi', 'lofi'],
  ['Lo-Fi', 'lofi'],
  ['Amapiano', 'amapiano'],
  ['UK drill', 'drill'],
  ['afro r&b', 'afro_rnb'],
  ['hip hop', 'hip_hop'],
  ['praise song', 'praise'],
  ['afro-beats', 'afrobeats'],
];
for (const [raw, want] of MISSES) {
  assert(canonicalizeGenre(raw) === want, `'${raw}' -> '${want}'`);
}
// Diacritics + more phrasings.
assert(canonicalizeGenre('Jùjú') === 'juju', "'Jùjú' -> 'juju' (diacritics fold)");
assert(canonicalizeGenre('Coupé-Décalé') === 'coupe_decale', "'Coupé-Décalé' -> 'coupe_decale'");
assert(canonicalizeGenre('R&B') === 'rnb', "'R&B' -> 'rnb'");
assert(canonicalizeGenre('rap') === 'hip_hop', "'rap' -> 'hip_hop'");
// Unknowns stay unknown — no invented genres.
assert(canonicalizeGenre('bulgarian wedding techno') === null, 'unknown genre stays null (no invention)');
assert(canonicalizeGenre('') === null, 'empty -> null');

// THE TABLES ANSWER: variants now reach the REAL recipes.
const canonSig = genreSignature('amapiano');
assert(genreSignature('Amapiano').bpm === canonSig.bpm && canonSig.bpm !== 106, `'Amapiano' hits the real amapiano signature (bpm ${canonSig.bpm}, not generic 106)`);
assert(genreSignature('UK drill').bpm === genreSignature('drill').bpm, "'UK drill' hits the drill signature");
assert(getGenreKit('Lo-Fi') !== undefined && getGenreKit('Lo-Fi') === getGenreKit('lofi'), "'Lo-Fi' finds the lofi kit");
assert(getGenreKit('hip hop') === getGenreKit('hip_hop'), "'hip hop' finds the hip_hop kit");
assert(paletteFor('afro r&b').length > 0 && paletteFor('afro r&b') === paletteFor('afro_rnb'), "'afro r&b' finds the afro_rnb palette");
assert(getSoundDNA('hip hop') !== undefined && getSoundDNA('hip hop') === getSoundDNA('hip_hop'), "'hip hop' finds the hip_hop Sound DNA");
assert(getSoundDNA('Lo-Fi') === getSoundDNA('lofi'), "'Lo-Fi' finds the lofi Sound DNA");

// Raw exact tags still win first (legacy behavior unchanged for canonical keys).
assert(getGenreKit('afrobeats') !== undefined, 'canonical keys unchanged');

console.log(process.exitCode ? '\n❌ Genre canon gate FAILED' : '\n✅ Genre canon gate PASSED');
