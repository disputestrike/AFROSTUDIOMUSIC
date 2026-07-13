/**
 * CATALOGUE QA GATE test — pure, CI-able. The gate that would have blocked the
 * garbage the owner audit found (osheyy, Sonmething, dupes, "same skeleton").
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-lyric-qa.ts
 */
import { lyricQaCheck } from '@afrohit/shared';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}

const GOOD = `[Hook]
Dami duro (duro)
Dami duro (duro)
Money dey my hand, kpokpokpo
Baby wine am make e no stop

[Verse]
Lagos boy wey sabi road
Every corner know my name
When I land, the whole place loud
Na my turn, no be the same

[Hook]
Dami duro (duro)
Dami duro (duro)
Money dey my hand, kpokpokpo
Baby wine am make e no stop`;

// Clean, lean, hook-repeated record passes.
const good = lyricQaCheck({ title: 'Dami Duro', body: GOOD, hookCell: 'dami duro', languageMix: { pcm: 0.8, en: 0.2 } });
assert(good.ok, `clean lean record passes (band ${good.band}, ${good.wordCount} words)`);

// Empty output ("osheyy") — the #87 failure.
const empty = lyricQaCheck({ title: 'Waist Dey Speak', body: '[Hook]\nOsheyy\nOsheyy (osheyy)' });
assert(!empty.ok && empty.blocks.some((b) => b.startsWith('empty')), 'osheyy blocked (empty_or_near_empty)');

// Meta-note contamination — the #47/#48 failure.
const meta = lyricQaCheck({ title: 'Crown', body: `${GOOD}\n\n(same skeleton, same flow as the reference)\n[Producer:] prod. by someone` });
assert(!meta.ok && meta.blocks.some((b) => b.startsWith('meta_contamination')), '"same skeleton" meta-note blocked');

// Scratchpad debris — the #41 failure.
const todo = lyricQaCheck({ title: 'Necessary', body: `${GOOD}\n- [ ] finish verse 2\nTODO: pick a girl name` });
assert(!todo.ok && todo.blocks.some((b) => b.startsWith('meta_contamination')), 'scratchpad TODO/checkbox blocked');

// Production notes in the sung lyric.
const prod = lyricQaCheck({ title: 'Beat Song', body: `${GOOD}\n[Drum Fill]\nLog drum dey knock, 128 BPM` });
assert(!prod.ok && prod.blocks.some((b) => b.startsWith('production_notes_in_lyric')), 'production notes in lyric blocked');

// Exact duplicate against the catalogue — the #39/#40 failure.
const dup = lyricQaCheck({
  title: 'Made Me Stronger', body: GOOD, hookCell: 'dami duro',
  catalogue: [{ id: 'x1', title: 'Haters Made Me Stronger', bodyNorm: lyricQaCheck({ title: 'a', body: GOOD }).bodyNorm }],
});
assert(!dup.ok && dup.blocks.some((b) => b.startsWith('exact_duplicate')) && dup.duplicateOf === 'x1', 'exact duplicate blocked + points to the twin');

// Over-length + template + english-heavy WARN (advisory, not blocked).
// Bloated + templated + English, but WITHOUT the fatal env-stuffing / confession
// signature (no place-noun open, no "truth be say" bridge) — so it stays
// warnings-only and proves the advisory band still works.
const bloatBody = '[Intro]\n' + 'the whole crowd watch me winning bright tonight victory yeah\n'.repeat(3) +
  '[Verse]\n' + 'working every single morning fighting battle chasing bigger future harder\n'.repeat(20) +
  '[Pre-Hook]\n' + 'everybody suddenly wanna know famous becoming a legend now\n'.repeat(3) +
  '[Hook]\n' + 'winning higher harder tonight beating bigger crown yeah\n'.repeat(4) +
  '[Verse 2]\n' + 'growing building empire never looking backward moving forward stronger\n'.repeat(20) +
  '[Bridge]\n' + 'quiet moments passing gently through lonely midnight thinking deeper\n'.repeat(3) +
  '[Outro]\n' + 'winning higher harder tonight beating bigger crown yeah\n'.repeat(3);
const bloat = lyricQaCheck({ title: 'Shine Grind', body: bloatBody, hookCell: 'we dey shine', languageMix: { en: 0.75, pcm: 0.25 } });
assert(bloat.ok, 'bloated english template PASSES blocks (warnings only, not fatal)');
assert(bloat.warnings.some((w) => w.startsWith('over_length')), 'over-length warned');
assert(bloat.warnings.some((w) => w.startsWith('template_structure')), 'template structure warned');
assert(bloat.warnings.some((w) => w.startsWith('english_heavy')), 'english-heavy warned');

// Artist-authored: integrity blocks still apply, but craft WARNINGS are skipped.
const authored = lyricQaCheck({ title: 'Mine', body: bloatBody, artistAuthored: true, languageMix: { en: 0.9 } });
assert(authored.ok && authored.warnings.length === 0, 'artist-authored skips craft warnings (never their words)');
const authoredEmpty = lyricQaCheck({ title: 'Mine', body: 'osheyy', artistAuthored: true });
assert(!authoredEmpty.ok, 'artist-authored STILL blocked on fatal integrity (empty)');

// ENVIRONMENT STUFFING — the "Sip Am Bam" failure (owner feedback 2026-07-13):
// a setting/food/transport noun in the majority of lines = scenery, not a song.
const SIP = `[Intro]
Streetlight yellow, generator dey hum small small
Danfo dey queue, but my leg no wan follow
Mama Titi corner, steam dey climb like invitation
Bus stop full, but na one pot get my attention
[Hook]
Mama Titi broth by the bus stop, steam dey rise, ooo
We dey sip am bam, sip am bam
[Verse]
Danfo blow horn, conductor shout last bus dey go
Broth don pass transport fare, market don close
Pepper catch my tongue, the whole bus stop dey hum
Suya smoke dey rise, na so pepper dey greet`;
const sip = lyricQaCheck({ title: 'Sip Am Bam', body: SIP, hookCell: 'sip am bam', languageMix: { pcm: 0.9, en: 0.1 } });
assert(!sip.ok && sip.blocks.some((b) => b.startsWith('environment_stuffing')), 'environment-stuffed lyric (Sip Am Bam) blocked');

// HOOK IS A DESCRIPTION — a pure inventory of the surroundings; strip setting
// words and nothing emotional survives. (Kept under 6 lines so the whole-lyric
// environment_stuffing block can't fire — this isolates the hook gate.)
const descHook = `[Hook]
Streetlight, danfo, bus stop, pepper pot
Market corner, gutter, generator, gate
[Verse]
i dey feel you for my body when you near`;
const dh = lyricQaCheck({ title: 'Bus Stop', body: descHook, hookCell: 'bus stop' });
assert(!dh.ok && dh.blocks.some((b) => b.startsWith('hook_is_description')), 'hook made only of setting words blocked');

// CATALOGUE-TEMPLATE SIGNATURE — location-open + confession-bridge + explained-outro.
const sig = `[Intro]
For the market corner, danfo dey pass
[Verse]
i been dey wait for my time to shine bright
[Hook]
we dey move, we dey groove tonight
[Bridge]
truth be say sometimes the fear dey catch me for night
[Outro]
so remember say na hard work bring the light`;
const sg = lyricQaCheck({ title: 'My Time', body: sig, hookCell: 'we dey move' });
assert(!sg.ok && sg.blocks.some((b) => b.startsWith('catalogue_template_signature')), 'location-open + confession-bridge + explained-outro blocked');

// The clean lean record STILL passes all the new gates (no false positive).
assert(good.ok && !good.blocks.length, 'clean lean record still passes the new stuffing/hook/template gates');

// CATALOGUE CONTAMINATION — the "Pepper Kiss" failure (owner 2026-07-13): Mama
// Titi with the nouns swapped. The writer adapted around the scenery/confession
// gates (dialogue bridge, literal title, calendar dialogue, "gbam"). >=2 of the
// 12 forbidden patterns => hard reject.
const pepper = `[Hook]
Pepper Kiss, e dey burn slow (gbam!)
[Verse]
Bimbo dey turn suya, pepper red for blade
She wrap my suya, "pay your money, then dance with me"
Her thumb wipe pepper from my lip
[Bridge]
(Bimbo: "You go come back?")
Friday, Iyana, eight — I go dey there
[Outro]
She hand me suya, "Dance with me"`;
const pk = lyricQaCheck({ title: 'Pepper Kiss', body: pepper, hookCell: 'pepper kiss', languageMix: { pcm: 0.8, en: 0.2 } });
assert(!pk.ok && pk.blocks.some((b) => b.startsWith('catalogue_contamination_detected')), 'Pepper Kiss (food-seller/screenplay/gbam) blocked as catalogue contamination');
assert((pk.contamination?.count ?? 0) >= 2, `contamination count >= 2 (got ${pk.contamination?.count})`);
assert(pk.contamination?.decision === 'CATALOGUE_CONTAMINATION_DETECTED', 'decision is CATALOGUE_CONTAMINATION_DETECTED');

// Emotion-first record must NOT false-trip the contamination gate.
const cleanRec = `[Hook]
No permission, I don move already
No permission, you fit doubt, I no dey beg you
[Verse]
Dem talk say make I wait my turn
I wait too long, now I burn
[Verse]
You go doubt, na your own
But my mind don set like stone`;
const cl = lyricQaCheck({ title: 'No Permission', body: cleanRec, hookCell: 'no permission', languageMix: { pcm: 0.85, en: 0.15 } });
assert(cl.ok, `emotion-first record passes the contamination gate (blocks: ${cl.blocks.join('; ')})`);

// SCENERY-DEPENDENT via NARRATION — the red-team evasion (2026-07-13): a stall/
// street scene told in first person, NO names/quotes/"gbam"/obvious food. The
// object-removal test must still reject it (strip the props, nothing remains).
const scenery = `[Hook]
Meet me where you turn, by the corner, by the stall
Watch the scene, watch the scene, na so e dey fall
[Verse]
Under the wire where the bulb dey sway
Basin on the head, crate upon crate
Two bench, one lamp, the kettle dey hum
She fold the umbrella, na so morning come
[Verse]
Awning dey flap where the tarpaulin torn
Bucket by the gutter since the day was born
Same stall, same smoke, same coal, same tin
Strip the whole thing, nothing dey within`;
const sc = lyricQaCheck({ title: 'Watch The Scene', body: scenery, hookCell: 'watch the scene', languageMix: { pcm: 0.9, en: 0.1 } });
assert(!sc.ok && (sc.contamination?.patterns.some((p) => p.code === 'scenery_dependent') ?? false), 'scenery-narration record blocked by the object-removal test (scenery_dependent)');

// FALSE-POSITIVE GUARD (red-team round 2): a real defiance anthem with a common
// Pidgin interjection ("omo") and one quoted shout must PASS — "omo" is Pidgin,
// not decorative Yoruba, and a lone quote is not a screenplay.
const anthem = `[Hook]
I no go bow, I no go bow
You fit bend my back but you no fit bend my will
I no go bow, come rain, come sun
[Verse]
Omo, morning break, my eye don red, sleep na luxury
Danfo dey shout "Oshodi!" but na my future I dey hurry
Dem don write my name for the list of people wey no go make am
Every door wey slam my face, I turn am to my reason
Faith na my last change and I no dey spend am careless
If I fall today, tomorrow go still meet me standing
[Hook]
I no go bow, I no go bow
You fit bend my back but you no fit bend my will`;
const an = lyricQaCheck({ title: 'I No Go Bow', body: anthem, hookCell: 'i no go bow', languageMix: { pcm: 0.9, en: 0.1 } });
assert(an.ok, `emotion-first anthem (Pidgin "omo" + one quote) passes (blocks: ${an.blocks.join('; ')})`);

// A cityscape "place-tour" with no person/want/loss — scenery wearing a ballad's
// costume — must block on the object-removal test.
const tour = `[Hook]
Third Mainland at midnight
Me, the bridge, and the city lights
Cruising slow while the whole Lagos sleep
[Verse]
Windows down, the lagoon dey shine
Streetlight dey blink, the marina glitter fine
Danfo don park, na only my headlight
The skyline pose like a photograph tonight
From Oworonshoki, the whole coast dey glow
Harmattan for the lane, the tollgate clear`;
const tr = lyricQaCheck({ title: 'Third Mainland', body: tour, hookCell: 'third mainland' });
assert(!tr.ok && (tr.contamination?.patterns.some((p) => p.code === 'scenery_dependent') ?? false), 'cityscape place-tour blocked (scenery_dependent)');

console.log(process.exitCode ? '\n❌ Lyric QA test FAILED' : '\n✅ Lyric QA test PASSED');
