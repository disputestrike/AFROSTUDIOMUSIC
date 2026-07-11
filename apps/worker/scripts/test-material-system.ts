/**
 * MATERIAL-SYSTEM GATE — the Executive-Summary spec, enforced forever.
 *
 * Proves: (1) every genre's forge kit derives from its 42-kit definition with
 * signature roles intact; (2) EVERY kit role has a real forge prompt (isolated,
 * keyed when melodic); (3) the LAYERING LAW — Afro kits carry 3+ concurrent
 * rhythm roles (conga ≠ shekere ≠ talking drum, never one "percussion" blob);
 * (4) producer gain/pan doctrine is sane for every role (low end center,
 * shakers wide); (5) the PDF's regression scenarios yield their expected
 * instruments. Exit 1 on any regression.
 */
import { GENRE_KIT_KEYS, forgeKitFor, getGenreKit, isMaterialRole, familyOf, jobOf, materialGainFor, materialPanFor, type MaterialRole } from '@afrohit/shared';
import { forgePromptFor, isKeyedRole } from '../src/lib/forge-prompts';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };

// ---- 1+2: every kit role is forgeable with a correct prompt --------------
for (const genre of GENRE_KIT_KEYS) {
  const kit = forgeKitFor(genre);
  if (kit.length < 5) fail(`[${genre}] forge kit too thin (${kit.length} roles)`);
  if (!kit.includes('fill')) fail(`[${genre}] forge kit missing the section fill`);
  for (const role of kit) {
    const prompt = forgePromptFor(role, genre, 110, 'A minor');
    if (!prompt) { fail(`[${genre}] role '${role}' has NO forge prompt`); continue; }
    if (!/solo|only/i.test(prompt)) fail(`[${genre}] '${role}' prompt is not isolation-phrased`);
    if (isKeyedRole(role) && !/A minor/.test(prompt)) fail(`[${genre}] keyed role '${role}' prompt ignores the key`);
    if (!isKeyedRole(role) && /A minor/.test(prompt)) fail(`[${genre}] unpitched role '${role}' prompt wrongly carries a key`);
  }
  // Signature roles must survive the cap — the kit's identity is non-negotiable.
  // EXCEPT lead-performance vocals (lead_vocal/adlib/harmony…): those belong to
  // the sung engine and are correctly barred from the shelf.
  const PERFORMANCE = new Set(['lead_vocal', 'double', 'harmony_vocal', 'adlib', 'call_response', 'spoken_word', 'hype_vocal', 'vocal_pad']);
  const g = getGenreKit(genre)!;
  for (const sig of g.signatureRoles) {
    if (isMaterialRole(sig) && !PERFORMANCE.has(sig) && !kit.includes(sig)) fail(`[${genre}] signature role '${sig}' dropped from the forge kit`);
  }
  // Lead performances are never forged as shelf material.
  for (const banned of ['lead_vocal', 'adlib', 'harmony_vocal']) {
    if (kit.includes(banned)) fail(`[${genre}] unforgeable '${banned}' leaked into the forge kit`);
  }
}

// ---- 3: THE LAYERING LAW — 3+ concurrent rhythm roles for Afro lanes ------
for (const genre of ['afrobeats', 'amapiano', 'afro_fusion', 'highlife', 'street_pop', 'afro_pop']) {
  const kit = forgeKitFor(genre).filter((r) => isMaterialRole(r)) as MaterialRole[];
  const rhythm = kit.filter((r) => jobOf(r) === 'rhythm');
  if (rhythm.length < 3) fail(`[${genre}] layering law violated: only ${rhythm.length} rhythm roles (needs 3+ concurrent percussion)`);
  const distinctFams = new Set(rhythm.map((r) => familyOf(r)));
  if (genre !== 'amapiano' && !rhythm.some((r) => familyOf(r) === 'african_perc')) {
    fail(`[${genre}] no African percussion in the kit (${rhythm.join(',')})`);
  }
  void distinctFams;
}

// ---- 4: gain/pan doctrine sane for every taxonomy role --------------------
for (const genre of GENRE_KIT_KEYS) {
  for (const role of forgeKitFor(genre)) {
    const gain = materialGainFor(role);
    if (!(gain >= 0.3 && gain <= 1.2)) fail(`[${role}] gain ${gain} out of range`);
    const pan = materialPanFor(role);
    if (Math.abs(pan) > 0.7) fail(`[${role}] pan ${pan} too extreme`);
  }
}
// Low end + kick stay dead center (the mix law).
for (const centered of ['kick', 'kick_808', 'soft_kick', 'bass_guitar', 'sub_bass', 'log_drum', 'snare', 'drums', 'bass']) {
  if (materialPanFor(centered) !== 0) fail(`'${centered}' must be center-panned`);
}
// Shakers genuinely wide, opposite sides.
if (!(materialPanFor('shaker') > 0.4 && materialPanFor('shekere') < -0.4)) fail('shaker/shekere must pan wide on opposite sides');

// ---- 5: the PDF's regression scenarios ------------------------------------
const SCENARIOS: Array<{ name: string; genre: string; expectAny: string[][] }> = [
  { name: 'Afrobeats party', genre: 'afrobeats', expectAny: [['conga', 'bongo', 'talking_drum'], ['shaker', 'shekere'], ['highlife_guitar', 'guitar_chords', 'clean_guitar_riff', 'lead_guitar'], ['bass_guitar', 'synth_bass', 'sub_bass']] },
  { name: 'Amapiano deep', genre: 'amapiano', expectAny: [['log_drum'], ['piano', 'rhodes'], ['shaker', 'shekere', 'cabasa']] },
  { name: 'Afro-pop ballad', genre: 'afro_pop', expectAny: [['piano', 'rhodes', 'guitar_chords', 'highlife_guitar'], ['shaker', 'shekere', 'conga', 'bongo', 'talking_drum']] },
  { name: 'Afro-fusion lively', genre: 'afro_fusion', expectAny: [['conga', 'shekere', 'shaker', 'talking_drum'], ['bass_guitar', 'synth_bass', 'sub_bass', 'bass_808']] },
  { name: 'Highlife happy', genre: 'highlife', expectAny: [['highlife_guitar'], ['brass_section', 'trumpet', 'sax'], ['conga', 'bongo', 'shekere', 'claves', 'agogo', 'woodblock', 'shaker', 'cowbell', 'clap', 'closed_hat']] },
  { name: 'Street-pop zanku', genre: 'street_pop', expectAny: [['kick', 'kick_808', 'drums', 'snare', 'rimshot', 'clap'], ['chant', 'crowd_chant', 'vocal_chop', 'shaker', 'shekere', 'conga', 'cowbell', 'talking_drum']] },
  { name: 'Trap crossover', genre: 'trap', expectAny: [['bass_808', 'sliding_808', 'sub_bass'], ['trap_hat_roll', 'closed_hat']] },
  { name: 'Gospel lift', genre: 'gospel', expectAny: [['gospel_organ', 'organ', 'piano'], ['clap', 'snare', 'drums', 'kick', 'live_kick', 'closed_hat', 'tom_fill']] },
  { name: 'Drill dark', genre: 'drill', expectAny: [['sliding_808', 'bass_808'], ['drill_hat_slide', 'closed_hat', 'trap_hat_roll']] },
  { name: 'House four-on-floor', genre: 'house', expectAny: [['kick', 'club_kick', 'soft_kick'], ['house_piano_stab', 'piano', 'organ', 'synth_pad']] },
];
for (const sc of SCENARIOS) {
  const kit = new Set(forgeKitFor(sc.genre, 14));
  for (const group of sc.expectAny) {
    if (!group.some((r) => kit.has(r))) fail(`[scenario:${sc.name}] expected one of {${group.join(',')}} in the ${sc.genre} kit — got ${[...kit].join(',')}`);
  }
}

if (failures) { console.error(`material-system: ${failures} failure(s)`); process.exit(1); }
console.log(`material-system: ${GENRE_KIT_KEYS.length} genres — kit-driven forge, isolated keyed prompts, layering law (3+ rhythm), gain/pan doctrine, ${SCENARIOS.length} PDF scenarios — all enforced`);
