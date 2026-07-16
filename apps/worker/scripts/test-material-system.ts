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
import { GENRE_KIT_KEYS, GENRE_PALETTES, forgeKitFor, getGenreKit, isMaterialRole, familyOf, jobOf, materialGainFor, materialPanFor, measured, unknownAnalysis, type MaterialRole, type MeasuredAnalysis } from '@afrohit/shared';
import { forgePromptFor, isKeyedRole } from '../src/lib/forge-prompts';
import { FORGE_TEMPO_TOLERANCE, foldedTempoDelta, forgeBarsWithinCap, materialRolePurity } from '../src/lib/material-inspection';

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

// ---- 3b: THE DEPTH LAW — "you need to have everything" --------------------
// Every kit has an explicit hand-authored palette (no lane rides a default),
// and the Afro-core lanes' forge kits carry a full session's breadth: deep
// African percussion AND harmony AND melody AND FX — congas alongside flute,
// Rhodes, chants and risers, never a rhythm-only shelf.
for (const genre of GENRE_KIT_KEYS) {
  if (!GENRE_PALETTES[genre]) fail(`[${genre}] has NO hand-authored palette in genre-palettes.ts`);
  for (const r of GENRE_PALETTES[genre] ?? []) {
    if (!isMaterialRole(r)) fail(`[${genre}] palette role '${r}' is not in the material taxonomy`);
  }
}
for (const genre of ['afrobeats', 'amapiano', 'afro_fusion', 'afro_pop', 'street_pop', 'highlife', 'afro_dancehall', 'afro_gospel', 'afro_house', 'praise']) {
  const kit = forgeKitFor(genre).filter((r) => isMaterialRole(r)) as MaterialRole[];
  if (kit.length < 20) fail(`[${genre}] depth law: forge kit only ${kit.length} roles (needs 20+)`);
  const fams = (f: string) => kit.filter((r) => familyOf(r) === f).length;
  if (fams('african_perc') < 4) fail(`[${genre}] depth law: only ${fams('african_perc')} African-perc roles (needs 4+)`);
  if (fams('harmony') < 2) fail(`[${genre}] depth law: only ${fams('harmony')} harmony roles (needs 2+ — piano/Rhodes/pads/guitars)`);
  if (fams('melody') < 1) fail(`[${genre}] depth law: no melody roles (needs flute/sax/brass/leads)`);
  if (fams('fx') < 1) fail(`[${genre}] depth law: no FX roles (needs risers/transitions)`);
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

// ---- 6: SLOW-BPM BARS CAP (source-truth item 6) ----------------------------
// The provider caps a render at ~30s; the trim must never read past the file.
// forgeBarsWithinCap halves 8→4→2 until bars + 3s headroom fit the cap, so the
// row records the bars that EXIST, never a fiction.
if (forgeBarsWithinCap(110, 8) !== 8) fail('bars-cap: 8 bars at 110bpm fit the 30s cap and must not shrink');
if (forgeBarsWithinCap(72, 8) !== 8) fail('bars-cap: 8 bars at 72bpm (=26.7s+3) still fit the cap exactly');
if (forgeBarsWithinCap(70, 8) !== 4) fail('bars-cap: 8 bars at 70bpm (=27.4s+3) exceed the cap and must halve to 4');
if (forgeBarsWithinCap(60, 8) !== 4) fail('bars-cap: 8 bars at 60bpm (=32s+3) must halve to 4');
if (forgeBarsWithinCap(45, 8) !== 4) fail('bars-cap: 4 bars at 45bpm (=21.3s+3) fit — no over-shrink');
if (forgeBarsWithinCap(30, 8) !== 2) fail('bars-cap: 30bpm needs the second halving (4 bars = 32s+3 > cap)');
if (forgeBarsWithinCap(110, 4) !== 4) fail('bars-cap: an explicit 4-bar request passes through untouched');
for (let bpm = 20; bpm <= 200; bpm += 1) {
  const bars = forgeBarsWithinCap(bpm, 8);
  const need = Math.ceil((60 / bpm) * 4 * bars) + 3;
  if (need > 30 && bars > 2) fail(`bars-cap invariant broken at ${bpm}bpm: ${bars} bars need ${need}s > 30s cap`);
}

// ---- 7: OCTAVE-FOLDED TEMPO VERIFICATION (source-truth item 1) -------------
// Detectors are octave-ambiguous: half/double detections of the prompt must
// verify; a genuinely different tempo must not.
if (foldedTempoDelta(112, 56).delta > 0.001) fail('tempo-fold: a half-tempo detection of the prompt must fold to zero delta');
if (foldedTempoDelta(112, 224).delta > 0.001) fail('tempo-fold: a double-tempo detection must fold to zero delta');
if (foldedTempoDelta(112, 111).delta > FORGE_TEMPO_TOLERANCE) fail('tempo-fold: a 1bpm-off detection is within the 4% tolerance');
if (foldedTempoDelta(112, 100).delta <= FORGE_TEMPO_TOLERANCE) fail('tempo-fold: a 100bpm render of a 112bpm prompt must be OUT of tolerance');
if (Math.abs(foldedTempoDelta(112, 225).foldedBpm - 112.5) > 0.001) fail('tempo-fold: foldedBpm must report the closest octave interpretation');

// ---- 8: ROLE PURITY — the ABSENCE gates (source-truth item 4) --------------
// Presence-only evidence had an inversion: a 'shaker' hiding a kick+bass full
// mix passed MORE easily (the hidden kick supplied the rhythm proof). These
// pure-function checks pin the absence law: what a clean loop must NOT contain.
const analysisWith = (fields: Partial<MeasuredAnalysis>): MeasuredAnalysis =>
  ({ ...unknownAnalysis('test'), engineOk: true, ...fields });
const kicky = analysisWith({
  kickDensity: measured(3.2, 0.8, 'test'),
  lowEndProfile: measured({ ratio: 0.32, crest: 6 }, 0.9, 'test'),
  clapBackbeat: measured(0.55, 0.4, 'test'),
});
const cleanShaker = analysisWith({
  kickDensity: measured(0.2, 0.8, 'test'),
  lowEndProfile: measured({ ratio: 0.03, crest: 3 }, 0.9, 'test'),
  shakerContinuity: measured(0.7, 0.8, 'test'),
});
// hats/shakers: a hidden kick+bass mix is refused
if (materialRolePurity('shaker', kicky).ok) fail('purity: a kick+bass mix labeled shaker must fail the absence gate');
if (!/kick-bleed|low-end-bleed/.test(materialRolePurity('shaker', kicky).reason ?? '')) fail('purity: shaker bleed must carry a machine-readable reason');
if (!materialRolePurity('shaker', cleanShaker).ok) fail('purity: a clean shaker bed must pass');
if (materialRolePurity('closed_hat', kicky).ok) fail('purity: a full mix labeled closed_hat must fail');
// mid percussion: looser thresholds (talking drum dips low) but a full mix still fails
if (materialRolePurity('conga', kicky).ok) fail('purity: a kick+bass mix labeled conga must fail');
const congaWithSomeKick = analysisWith({
  kickDensity: measured(1.5, 0.8, 'test'),
  lowEndProfile: measured({ ratio: 0.12, crest: 4 }, 0.9, 'test'),
});
if (!materialRolePurity('conga', congaWithSomeKick).ok) fail('purity: mid-perc tolerance must not reject a conga with modest low-band onsets');
if (materialRolePurity('shaker', congaWithSomeKick).ok) fail('purity: the same measurements DO fail the stricter hat/shaker class');
// tonal: a chord bed carrying a drum kit is bleed
if (materialRolePurity('piano', kicky).ok) fail('purity: a piano loop with kicks and a clap backbeat must fail');
const cleanPiano = analysisWith({
  kickDensity: measured(0.3, 0.8, 'test'),
  clapBackbeat: measured(0.1, 0.4, 'test'),
  harmonicRichness: measured(0.4, 0.7, 'test'),
});
if (!materialRolePurity('piano', cleanPiano).ok) fail('purity: a clean chord bed must pass');
if (materialRolePurity('chords', kicky).ok) fail('purity: the coarse chords role gets the same tonal gate');
// low-end + drum-kit backbone are EXEMPT — kicks/sub ARE their content
if (!materialRolePurity('bass', kicky).ok) fail('purity: low-end roles are exempt (kicky bass content is legitimate)');
if (!materialRolePurity('log_drum', kicky).ok) fail('purity: log_drum is exempt (pitched sub IS the role)');
if (!materialRolePurity('drums', kicky).ok) fail('purity: the coarse full-kit drums role is exempt');
if (!materialRolePurity('kick', kicky).ok) fail('purity: the kick role is exempt');
// honesty: unknown measurements never fabricate a failure
if (!materialRolePurity('shaker', analysisWith({})).ok) fail('purity: all-unknown measurements must pass (unknown is honorable)');
if (!materialRolePurity('shaker', null).ok) fail('purity: no measurement at all must pass (the gate cannot run)');
const engineDown = { ...kicky, engineOk: false };
if (!materialRolePurity('shaker', engineDown).ok) fail('purity: engineOk=false means nothing was measured — no fabricated failure');

if (failures) { console.error(`material-system: ${failures} failure(s)`); process.exit(1); }
console.log(`material-system: ${GENRE_KIT_KEYS.length} genres — kit-driven forge, isolated keyed prompts, layering law (3+ rhythm), gain/pan doctrine, ${SCENARIOS.length} PDF scenarios, slow-bpm bars cap, octave-folded tempo verification, role-purity absence gates — all enforced`);
