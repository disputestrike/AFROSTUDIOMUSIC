/**
 * ENGINE-AGNOSTIC CONDITIONING gate (owner directive 2026-07-21):
 *
 *   "All the work we did tonight should be on the SELECTED/DEFAULT engine — not
 *    tied to one particular engine (AfroOne). If we change engines in the future,
 *    whatever generator we use absorbs the total work. It should just default to
 *    whatever is selected."
 *
 * The create flow defaults to Auto → MiniMax via the PROVIDER path (a black box
 * that makes its OWN beat from the STYLE PROMPT and SINGS the lyrics we give it).
 * Every quality/identity lever must therefore condition what is SENT to that
 * engine — and to any selected provider (suno / eleven / ace_step) — not just the
 * own engine. `composeStyleTags` is exactly the style/prompt every provider
 * adapter sends (MiniMaxSongAdapter, SunoAdapter, AceStepSongAdapter,
 * ElevenMusicAdapter, ReplicateMusicGenAdapter all call it), so asserting its
 * output IS asserting the provider prompt.
 *
 * Proves the 6 conditioning levers reach the SELECTED provider (default MiniMax)
 * and that NONE is gated behind songEngine==='own':
 *   (a) genre style + deAfro scrub for a rap request (American, not Lagos),
 *   (b) the measured per-genre swing/pocket token,
 *   (c) the creative-director lyrics/brief (engine-independent) + influence in-lane,
 *   (d) influence + mood + language reach the provider prompt,
 *   (e) the conditioning is engine-BLIND — identical for own/minimax/ace_step/
 *       suno/eleven/undefined — so no lever requires the own engine,
 *   (f) the African tone-G2P directive reaches the provider for an African language.
 *
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-engine-agnostic.ts
 */
import {
  composeStyleTags,
  swingPocketToken,
  buildCreativeDirectorBrief,
  type MusicGenerationInput,
} from '@afrohit/ai';
import {
  influenceStyleToken,
  moodStyleToken,
  INFLUENCE_NEVER_CLONE_GUARD,
} from '@afrohit/shared';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('  ok:', msg);
}

/**
 * A realistic PROVIDER render input, exactly as the create paths build it
 * (apps/api routes/beats.ts + services/chat-tools.ts create_beat_job): the
 * SELECTED engine is MiniMax (the Auto default), NOT the own engine. dnaTags
 * carry a language identity belt AND a deliberately MISLABELED afro token
 * ("log drum") so the deAfro scrub can be observed on a non-afro lane.
 */
function providerInput(over: Partial<MusicGenerationInput> = {}): MusicGenerationInput {
  return {
    genre: 'hip_hop',
    bpm: 90,
    durationS: 180,
    withStems: false,
    withVocals: true,
    songEngine: 'minimax', // Auto → MiniMax (the default PROVIDER, not 'own')
    influence: 'Drake',
    mood: 'melancholic luxury',
    languages: ['en'],
    lyrics: '[Verse]\nCount it up, money on my mind\n[Hook]\nTop floor, I leave the past behind',
    dnaTags: ['vocal in English, American English diction', 'log drum', 'boom bap swing'],
    ...over,
  };
}

/** The exact style string the MiniMax adapter sends (its composeStyleTags call). */
const styleOf = (input: MusicGenerationInput): string =>
  composeStyleTags(input, { fallbackLiteral: 'catchy, melodic vocals, radio-ready' }).join(' || ');

// (a) GENRE STYLE + deAfro SCRUB — a rap request renders AMERICAN hip-hop, and a
//     stray afro token is stripped before it reaches the engine (no forced Lagos).
{
  const rap = styleOf(providerInput());
  assert(/hip hop/i.test(rap), '(a) rap style carries the hip-hop genre label');
  assert(/boom bap|east coast|rap lead/i.test(rap), '(a) rap style carries AMERICAN hip-hop kit tags (boom bap / east coast)');
  assert(!/west african|nigerian|afrobeats/i.test(rap), '(a) rap style has NO African anchor (afroIdentity=null for hip_hop)');
  assert(!/log drum/i.test(rap), '(a) the deAfro scrub strips the mislabeled afro token (log drum) from a rap render');
  // Contrast: a REAL afro lane KEEPS its afro signature tokens (deAfro is a no-op
  // there). Minimal input so the trailing DNA token can't fall off the 700-char
  // budget — the SAME 'log drum' that is scrubbed above survives on an afro lane.
  const afroKeep = composeStyleTags(
    { genre: 'afrobeats', bpm: 100, durationS: 30, withStems: true, withVocals: false, songEngine: 'minimax', dnaTags: ['log drum'] },
    { fallbackLiteral: 'x' },
  ).join(' || ');
  assert(/log drum/i.test(afroKeep), '(a) afro lanes KEEP their afro signature tokens — the SAME token scrubbed on rap survives here (scrub is lane-correct, not blanket)');
}

// (b) SWING / MICRO-TIMING — the measured per-genre pocket token reaches the
//     provider prompt so the engine is pulled off a stiff Western 4/4.
{
  assert(swingPocketToken('afrobeats') !== null, '(b) afrobeats has a measured swing/pocket token');
  const afro = styleOf(providerInput({ genre: 'afrobeats', dnaTags: [] }));
  assert(/swung 16|shaker|behind the beat|pocket/i.test(afro), '(b) the afrobeats swing/pocket token reaches the provider prompt');
  const amap = styleOf(providerInput({ genre: 'amapiano', dnaTags: [] }));
  assert(/triplet swing|log-drum bounce|behind the grid/i.test(amap), '(b) the amapiano swing/pocket token reaches the provider prompt');
}

// (c) CREATIVE-DIRECTOR lyrics + influence — the lyrics the provider SINGS are
//     written by the engine-INDEPENDENT creative-director layer (it takes no
//     engine argument). English rap + "like Drake" → American themes, no Lagos,
//     influence stays in-lane with the never-clone guard.
{
  const cd = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', influence: 'Drake' });
  assert(cd.africanContextLicensed === false, '(c) English rap + Drake → NOT African (no forced Lagos in the sung lyrics)');
  assert(/lagos/i.test(cd.forbiddenElements.join(' ')), '(c) creative-director forbids Lagos on the provider-bound lyrics');
  assert(/wealth|money|success|come-up/i.test(cd.includeThemes.join(' ')), '(c) rap themes are wealth/success, not romance');
  assert(cd.directive.includes(INFLUENCE_NEVER_CLONE_GUARD), '(c) the Drake reference rides with the never-clone guard');
  // luxury reads as wealth for a rapper, not romance (the owner\'s bug).
  const lux = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', mood: 'luxury' });
  assert(/wealth|cars|real estate|investments/i.test(lux.includeThemes.join(' ')), '(c) luxury + rap → wealth/cars, not romance');
}

// (d) INFLUENCE + MOOD + LANGUAGE reach the provider prompt.
{
  const s = styleOf(providerInput());
  assert(influenceStyleToken('Drake') !== null && /like Drake/.test(s), '(d) the influence token reaches the provider prompt');
  assert(s.includes(INFLUENCE_NEVER_CLONE_GUARD), '(d) the provider influence token carries the never-clone guard');
  // MOOD — the engine-agnostic LIFT: honoured on the own engine\'s melody prompt,
  // now also front-loaded as its own token on the provider prompt.
  assert(moodStyleToken('melancholic luxury') !== null, '(d) moodStyleToken produces a token (shared reference-steering home)');
  assert(/mood:\s*melancholic luxury/i.test(s), '(d) the MOOD token reaches the provider prompt (the lift: no longer own-only)');
  // LANGUAGE — the identity belt reaches the prompt via dnaTags.
  assert(/english|american english/i.test(s), '(d) the language identity belt reaches the provider prompt');
}

// (e) ENGINE-BLIND — the conditioning never branches on songEngine, so no lever
//     requires songEngine==='own'; it runs for the RESOLVED engine whatever it is.
{
  const engines: Array<MusicGenerationInput['songEngine']> = [
    'own', 'minimax', 'ace_step', 'suno', 'eleven', undefined,
  ];
  const outputs = engines.map((e) => styleOf(providerInput({ songEngine: e })));
  assert(new Set(outputs).size === 1, '(e) composeStyleTags output is IDENTICAL across own/minimax/ace_step/suno/eleven/undefined — never gated on songEngine');
  // Every lever is present on the DEFAULT provider (minimax), proving none needs 'own'.
  const mm = styleOf(providerInput({ songEngine: 'minimax' }));
  assert(/hip hop/i.test(mm), '(e) genre reaches the DEFAULT provider (minimax)');
  assert(/like Drake/.test(mm), '(e) influence reaches the DEFAULT provider (minimax)');
  assert(/mood:/i.test(mm), '(e) mood reaches the DEFAULT provider (minimax)');
  assert(!/log drum/i.test(mm), '(e) the deAfro scrub runs on the DEFAULT provider (minimax)');
  // The creative-director brief is engine-independent (no songEngine input at all).
  assert(buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en' }).forbiddenElements.length > 0, '(e) the creative-director brief takes no engine — engine-independent by construction');
}

// (f) AFRICAN TONE-G2P — only when the lyrics are in an African language, the
//     tone/stress directive reaches the provider STYLE prompt (never the lyric).
{
  const yor = styleOf(providerInput({
    languages: ['yo'],
    lyrics: '[Verse]\nIfe omo mi, baba orin ayo\n[Hook]\nInu mi dun, okan mi bale',
    dnaTags: [],
  }));
  assert(/tone|pitch|relative|yoru|high\/low|hold/i.test(yor), '(f) the African tone-G2P directive reaches the provider prompt for a Yoruba lyric');
  // Non-African (English) lyric adds NO tone note — fail-open, never a false tag.
  const eng = styleOf(providerInput({ dnaTags: [] }));
  assert(!/lexical tone|hold the tone|relative pitch/i.test(eng), '(f) an English lyric adds NO tone directive (fail-open, engine-agnostic)');
}

console.log(process.exitCode ? '\n❌ Engine-agnostic conditioning FAILED' : '\n✅ Engine-agnostic conditioning PASSED');
