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

// Each Afro lane must get its OWN correct origin anchor — NOT a blanket
// "Nigerian/Ghanaian Afrobeats" (that mislabels amapiano, which is South African).
const AFRO_EXPECT: Record<string, RegExp> = {
  afrobeats: /west african/i,
  afro_fusion: /west african/i,
  afro_pop: /west african/i,
  street_pop: /west african/i,
  amapiano: /south african amapiano/i,
  afro_dancehall: /afro-dancehall/i,
  afro_rnb: /afro-r&b|afrosoul/i,
  highlife: /highlife \(ghana/i,
  afro_gospel: /afro-gospel/i,
};
// Highlife and gospel must NOT be anchored with a log drum (they are guitar-band
// and piano/organ/choir respectively).
{
  const hl = composeStyleTags({ genre: 'highlife', bpm: 112, dnaTags: [] } as never, { fallbackLiteral: 'x' }).join(' , ');
  check(!/log drum/i.test(hl.replace(/NOT a? ?log drum/i, '')), 'highlife wrongly given a log drum');
  check(/highlife guitar|interlocking/i.test(hl), 'highlife missing its interlocking guitar signature');
}
// GLOBAL genres must be LEFT UNTOUCHED — the loose-regex bug relabeled rnb/soul/
// dancehall as Afro. They must get NO Afro anchor and NO anti-Latin exclusion.
for (const g of ['rnb', 'soul', 'dancehall', 'reggae', 'reggaeton', 'pop', 'house']) {
  const tags = composeStyleTags({ genre: g, bpm: 100, dnaTags: ['clave groove'] } as never, { fallbackLiteral: 'x' }).join(' , ');
  check(!/afro-r&b|afrosoul|afro-dancehall|west african|south african/i.test(tags), `[${g}] GLOBAL genre wrongly relabeled as Afro`);
  check(!/NOT reggaeton/i.test(tags), `[${g}] GLOBAL genre wrongly got the Afro exclusion clause`);
}
// Latin-signifier tokens the DNA carries — must be scrubbed before the engine.
const LATIN_POISON = /\bclave\b|woodblock\s*\/\s*clave|\btresillo\b|\breggaeton\b|\bdembow\b|\bperreo\b/i;

for (const [genre, anchorRe] of Object.entries(AFRO_EXPECT)) {
  const tags = composeStyleTags(
    {
      genre,
      bpm: 107,
      // Simulate the DNA tokens that actually reach the engine — clave-laden.
      dnaTags: ['prominent Congas', 'Woodblock / clave', "the pocket built on a 3-2 / 2-3 clave feel", 'off-beat syncopated kick'],
      vibePrompt: 'warm hypnotic groove on a 2-3 clave',
    } as never,
    { fallbackLiteral: 'radio-ready' }
  );
  const joined = tags.join(' , ');
  // Poison must be judged on the POSITIVE tags only — the deliberate "NOT
  // reggaeton, NOT dembow" exclusion clause obviously contains those words.
  const positive = tags.filter((t) => !/^NOT /i.test(t.trim()) && !/\bNOT\b/.test(t)).join(' , ');

  check(!LATIN_POISON.test(positive), `[${genre}] Latin-signifier token leaked to engine tags: "${positive.match(LATIN_POISON)?.[0]}"`);
  check(anchorRe.test(joined), `[${genre}] missing/incorrect origin anchor (want ${anchorRe})`);
  check(/not reggaeton/i.test(joined), `[${genre}] missing explicit NOT-reggaeton exclusion`);
}
// Amapiano must NOT be mislabelled as Nigerian/Ghanaian Afrobeats (the bug).
{
  const ama = composeStyleTags({ genre: 'amapiano', bpm: 112, dnaTags: ['log drum'] } as never, { fallbackLiteral: 'radio-ready' }).join(' , ');
  check(!/nigerian\/ghanaian afrobeats/i.test(ama.replace(/NOT Nigerian Afrobeats/i, '')), 'amapiano wrongly anchored as Nigerian/Ghanaian Afrobeats');
  check(/piano/i.test(ama), 'amapiano missing its signature piano');
}

// A non-Afro genre must be UNTOUCHED — the scrub/anchor is Afro-only.
const latin = composeStyleTags({ genre: 'reggaeton', bpm: 95, dnaTags: ['dembow kick', 'perreo chant'] } as never, { fallbackLiteral: 'radio-ready' }).join(' , ');
check(/dembow/i.test(latin), 'reggaeton itself must KEEP its dembow token (scrub is Afro-only)');
check(!/not reggaeton/i.test(latin), 'non-Afro genre must not get the Afro exclusion clause');

// EXPLICIT INSTRUMENT PICKS (owner directive 2026-07-12): named instruments
// must reach the engine as a high-priority instrumentation line, early enough
// that the budget can never truncate them; absent picks add nothing.
{
  const withPicks = composeStyleTags(
    { genre: 'afrobeats', bpm: 104, dnaTags: ['shekere 16ths'], instruments: ['saxophone', 'talking drum', 'highlife guitar'] } as never,
    { fallbackLiteral: 'radio-ready' }
  );
  const line = withPicks.find((t) => t.startsWith('instrumentation:'));
  check(!!line, 'instruments picks missing their instrumentation: line');
  check(/saxophone/.test(line ?? '') && /talking drum/.test(line ?? '') && /highlife guitar/.test(line ?? ''), 'instrumentation line dropped a pick');
  check(withPicks.indexOf(line ?? '') <= 2, 'instrumentation line must ride in the first 3 tags (truncation-proof)');
  const noPicks = composeStyleTags({ genre: 'afrobeats', bpm: 104, dnaTags: ['shekere 16ths'] } as never, { fallbackLiteral: 'radio-ready' });
  check(!noPicks.some((t) => t.startsWith('instrumentation:')), 'no picks must add no instrumentation line');
}

if (failures > 0) {
  console.error(`genre-identity: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`genre-identity: each Afro lane ships its OWN origin anchor (amapiano=South African, afrobeats=West African), reggaeton-excluded, clave-free (${Object.keys(AFRO_EXPECT).length} genres); non-Afro untouched`);
