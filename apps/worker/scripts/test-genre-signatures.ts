/** GENRE SIGNATURE COVERAGE — every lane fully specified, or the suite is red.
 *  "Don't wait for me to tell you country uses this" — the library must answer
 *  for EVERY genre before any of them ships. */
import { GENRES, GENRE_SIGNATURES, genreSignature } from '@afrohit/shared';

let failed = 0;
const assert = (ok: boolean, msg: string) => { console.log(`  ${ok ? 'ok' : 'FAIL'}: ${msg}`); if (!ok) { failed++; process.exitCode = 1; } };

const INSTRUMENT_WORDS = /piano|keys|organ|rhodes|guitar|bass|drum|horn|synth|pluck|bell|string|pad|fiddle|steel|saw|shaker|percussion/i;
for (const g of GENRES) {
  const sig = GENRE_SIGNATURES[g];
  assert(!!sig, `${g}: has an explicit signature (no fallback allowed for known genres)`);
  if (!sig) continue;
  assert(sig.tags.length >= 2 && sig.tags.some((t) => INSTRUMENT_WORDS.test(t)), `${g}: >=2 tags incl a concrete instrument`);
  assert(/no drums$/.test(sig.melodyPrompt.trim()), `${g}: melody prompt ends 'no drums' (the groove owns the drums)`);
  assert([8, 16, 32].includes(sig.fillBars), `${g}: fill cadence declared`);
  assert(sig.kitRoles.includes('fill') && sig.kitRoles.includes('chords'), `${g}: kit demands fill + chords (the two Benjamin caught missing)`);
}
assert(genreSignature('__unknown__').tags.length >= 1, 'unknown genres get a safe fallback');
console.log(failed ? `\n❌ GenreSignatures FAILED (${failed})` : '\n✅ GenreSignatures PASSED — all lanes specified');
