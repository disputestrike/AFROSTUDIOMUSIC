/**
 * GENRE-IDENTITY GATE — Afrobeats must never render as reggaeton.
 *
 * Root cause (2026-07-10): the Afrobeats Sound DNA describes its groove with
 * musicology terms that overlap with Latin ("clave", "woodblock/clave",
 * "tresillo"). A text-to-music model with a weak Afrobeats prior read those
 * tokens + mid-tempo syncopation and rendered REGGAETON every time. Fix lives in
 * composeStyleTags: strip the Latin-signifier tokens from the engine tags, LEAD
 * with a West-African anchor, and append an explicit exclusion. This gate proves
 * all three survive for every Afro genre. Exit 1 on regression.
 */
import { composeStyleTags } from '@afrohit/ai';

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
}

const AFRO_GENRES = ['afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'afro_pop'];
// The exact Latin-signifier tokens the Afrobeats DNA carries — these must be
// scrubbed before they reach the audio engine.
const LATIN_POISON = /\bclave\b|woodblock\s*\/\s*clave|\btresillo\b|\breggaeton\b|\bdembow\b|\bperreo\b/i;

for (const genre of AFRO_GENRES) {
  const tags = composeStyleTags(
    {
      genre,
      bpm: 107,
      // Simulate the DNA tokens that actually reach the engine — clave-laden.
      dnaTags: ['prominent Congas', 'Woodblock / clave', "the Afrobeats 'pocket' built on a 3-2 / 2-3 clave feel", 'off-beat syncopated kick'],
      vibePrompt: 'warm hypnotic groove on a 2-3 clave',
    } as never,
    { fallbackLiteral: 'radio-ready' }
  );
  const joined = tags.join(' , ');
  // Poison must be judged on the POSITIVE tags only — the deliberate "NOT
  // reggaeton, NOT dembow" exclusion clause obviously contains those words.
  const positive = tags.filter((t) => !/^NOT /i.test(t.trim())).join(' , ');

  check(!LATIN_POISON.test(positive), `[${genre}] Latin-signifier token leaked to engine tags: "${positive.match(LATIN_POISON)?.[0]}"`);
  check(/west african/i.test(joined), `[${genre}] missing West-African identity anchor`);
  check(/not reggaeton/i.test(joined), `[${genre}] missing explicit NOT-reggaeton exclusion`);
  check(/log drum|talking drum|shekere|highlife/i.test(joined), `[${genre}] missing an unmistakable West-African signature instrument`);
}

// A non-Afro genre must be UNTOUCHED — the scrub/anchor is Afro-only.
const latin = composeStyleTags({ genre: 'reggaeton', bpm: 95, dnaTags: ['dembow kick', 'perreo chant'] } as never, { fallbackLiteral: 'radio-ready' }).join(' , ');
check(/dembow/i.test(latin), 'reggaeton itself must KEEP its dembow token (scrub is Afro-only)');
check(!/not reggaeton/i.test(latin), 'non-Afro genre must not get the Afro exclusion clause');

if (failures > 0) {
  console.error(`genre-identity: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`genre-identity: Afrobeats family ships West-African anchored, reggaeton-excluded, clave-free tags (${AFRO_GENRES.length} genres); non-Afro untouched`);
