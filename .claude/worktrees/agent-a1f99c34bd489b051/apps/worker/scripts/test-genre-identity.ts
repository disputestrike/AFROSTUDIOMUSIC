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

// Every advertised African lane must get its OWN origin anchor and at least one
// defining sound. This list intentionally excludes African-American gospel,
// Jamaican reggae and US hip-hop: those global genres keep their own kits.
const AFRO_EXPECT: Record<string, { anchor: RegExp; signature: RegExp }> = {
  afrobeats: { anchor: /west african afrobeats/i, signature: /shekere|talking drum/i },
  afro_fusion: { anchor: /west african afro-fusion/i, signature: /organic brass|melodic live bass/i },
  afro_pop: { anchor: /west african afropop/i, signature: /melody-first|highlife guitar/i },
  street_pop: { anchor: /lagos nigerian street-pop/i, signature: /gang chants|zanku/i },
  amapiano: { anchor: /south african amapiano/i, signature: /log-drum|log drum/i },
  afro_house: { anchor: /south african afro house/i, signature: /four-on-the-floor|congas/i },
  afro_dancehall: { anchor: /afro-dancehall/i, signature: /dancehall riddim|rolling bass/i },
  afro_rnb: { anchor: /west african afro-r&b/i, signature: /rhodes|layered r&b/i },
  afro_soul: { anchor: /pan-african afro-soul/i, signature: /live-band soul|fingered live bass/i },
  highlife: { anchor: /highlife \(ghana/i, signature: /interlocking clean highlife guitars/i },
  afro_gospel: { anchor: /west african afro-gospel/i, signature: /gospel piano|hammond organ/i },
  alte: { anchor: /nigerian alté/i, signature: /lo-fi afro-fusion|rhodes/i },
  gqom: { anchor: /durban south african gqom/i, signature: /broken kick|tribal toms/i },
  kwaito: { anchor: /soweto south african kwaito/i, signature: /township-house|tsotsitaal/i },
  bongo_flava: { anchor: /tanzanian bongo flava/i, signature: /swahili afropop|marimba/i },
  azonto: { anchor: /accra ghanaian azonto/i, signature: /kpanlogo|cowbell/i },
  coupe_decale: { anchor: /ivorian coupé-décalé/i, signature: /sebene guitar|tom rolls/i },
  ndombolo: { anchor: /congolese ndombolo/i, signature: /sebene|atalaku/i },
  soukous: { anchor: /congolese soukous/i, signature: /cavacha|sebene/i },
  fuji: { anchor: /yoruba nigerian fuji/i, signature: /sakara|talking drum/i },
  juju: { anchor: /yoruba nigerian juju/i, signature: /palm-wine electric guitars|pedal steel/i },
  apala: { anchor: /yoruba nigerian apala/i, signature: /agidigbo|thumb-piano/i },
  worship: { anchor: /african gospel worship/i, signature: /hammond organ|choir/i },
  praise: { anchor: /nigerian and ghanaian church praise/i, signature: /shekere|congas/i },
  spiritual: { anchor: /african spiritual music/i, signature: /kalimba|mbira/i },
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
for (const g of ['gospel', 'hip_hop', 'rnb', 'soul', 'dancehall', 'reggae', 'reggaeton', 'pop', 'house']) {
  const tags = composeStyleTags({ genre: g, bpm: 100, dnaTags: ['clave groove'] } as never, { fallbackLiteral: 'x' }).join(' , ');
  check(!/afro-r&b|afrosoul|afro-dancehall|west african|south african/i.test(tags), `[${g}] GLOBAL genre wrongly relabeled as Afro`);
  check(!/NOT reggaeton/i.test(tags), `[${g}] GLOBAL genre wrongly got the Afro exclusion clause`);
}
// Latin-signifier tokens the DNA carries — must be scrubbed before the engine.
const LATIN_POISON = /\bclave\b|woodblock\s*\/\s*clave|\btresillo\b|\breggaeton\b|\bdembow\b|\bperreo\b/i;

for (const [genre, expected] of Object.entries(AFRO_EXPECT)) {
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
  check(expected.anchor.test(joined), `[${genre}] missing/incorrect origin anchor (want ${expected.anchor})`);
  check(expected.signature.test(joined), `[${genre}] missing defining sound (want ${expected.signature})`);
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
console.log(`genre-identity: every advertised African lane ships its own origin + defining sound, reggaeton-excluded and clave-free (${Object.keys(AFRO_EXPECT).length} genres); global genres untouched`);
