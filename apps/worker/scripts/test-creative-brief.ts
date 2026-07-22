/**
 * CREATIVE-DIRECTOR LAYER gate — the WORDS/THEMES fix (owner directive
 * 2026-07-21). Proves the brief builder separates LANGUAGE ≠ GENRE ≠
 * REGION/CULTURE ≠ ARTIST-REFERENCE, so English rap gets American themes (no
 * forced Lagos), "luxury" reads as wealth for a rapper (not romance), an
 * artist reference stays in-lane with the never-clone guard, and the explicit
 * brief overrides any learned preference. Also proves the forbidden list is
 * actually INJECTED into the concept + lyric prompts.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-creative-brief.ts
 */
import { buildCreativeDirectorBrief, conceptDirectorSystem, prompts } from '@afrohit/ai';
import { INFLUENCE_NEVER_CLONE_GUARD } from '@afrohit/shared';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok:', msg);
}
const themes = (b: { includeThemes: string[] }) => b.includeThemes.join(' | ').toLowerCase();
const forbidden = (b: { forbiddenElements: string[] }) => b.forbiddenElements.join(' | ').toLowerCase();

// (a) English + hip_hop + "like Drake" → NOT African: Lagos/Pidgin/Afro-instruments
//     forbidden; themes are wealth/success, NOT romance.
{
  const b = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', influence: 'Drake' });
  assert(b.africanContextLicensed === false, '(a) English + hip_hop + Drake → African context NOT licensed');
  assert(b.languageMode === 'english', '(a) English words → languageMode=english');
  assert(/american|hip-hop/i.test(b.region), `(a) region is American / global hip-hop (got "${b.region}")`);
  assert(/lagos/i.test(forbidden(b)), '(a) forbidden includes Lagos / an African city');
  assert(/pidgin|yoruba/i.test(forbidden(b)), '(a) forbidden includes Pidgin / African-language slang');
  assert(/log drum|talking drum|shekere|instrument/i.test(forbidden(b)), '(a) forbidden includes Afro instruments');
  assert(/wealth|money|success|come-up/i.test(themes(b)), '(a) includeThemes are wealth / success');
  assert(!/\bromance\b|\blove\b/i.test(themes(b)), '(a) includeThemes are NOT romance / love');
}

// "luxury" mood on a rap brief = the measurable win (wealth/cars/real-estate),
// NOT romance — the owner's "say luxury and it writes romance" bug.
{
  const b = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', mood: 'luxury' });
  assert(/wealth|cars|real estate|investments|come-up/i.test(themes(b)), 'luxury + rap → wealth/cars/real-estate lead the themes');
  assert(!/\bromance\b/i.test(themes(b)), 'luxury + rap → NOT romance');
  assert(/luxury.*measurable win|wealth, cars/i.test(b.directive.toLowerCase()) || /luxury here means the measurable win/i.test(b.directive), 'luxury reading is spelled out in the directive');
}

// (b) Pidgin + rap → African context IS licensed (an African language pulls it);
//     Afro is NOT forbidden even though the genre is rap.
{
  const b = buildCreativeDirectorBrief({ genre: 'rap', language: 'pcm' });
  assert(b.genre === 'hip_hop', "(b) 'rap' canonicalizes to hip_hop");
  assert(b.languageMode === 'african-language', '(b) Pidgin → languageMode=african-language');
  assert(b.africanContextLicensed === true, '(b) Pidgin + rap → African context licensed (language wins)');
  assert(b.forbiddenElements.length === 0, '(b) nothing Afro is forbidden on the Pidgin path');
  assert(!/afro|lagos|pidgin/i.test(forbidden(b)), '(b) Afro/Lagos/Pidgin NOT in the forbidden list');
}

// (c) afrobeats (ANY language) → African context licensed (genre is African) —
//     the afrobeats/African path must keep working.
{
  const en = buildCreativeDirectorBrief({ genre: 'afrobeats', language: 'en' });
  assert(en.africanContextLicensed === true, '(c) English + afrobeats → African context licensed (genre wins over English)');
  assert(en.forbiddenElements.length === 0, '(c) afrobeats forbids no Afro elements');
  const amap = buildCreativeDirectorBrief({ genre: 'amapiano' });
  assert(amap.africanContextLicensed === true, '(c) amapiano (no language) → African context licensed');
  const afroRnb = buildCreativeDirectorBrief({ genre: 'afro r&b', language: 'yo' });
  assert(afroRnb.africanContextLicensed === true, "(c) 'afro r&b' + Yoruba → licensed");
}

// (d) English + rnb → relationship themes, no forced Afro.
{
  const b = buildCreativeDirectorBrief({ genre: 'rnb', language: 'en' });
  assert(b.africanContextLicensed === false, '(d) English + rnb → African context NOT licensed');
  assert(/love|relationship|intimacy|heartbreak|devotion/i.test(themes(b)), '(d) rnb themes are relationships / love');
  assert(/lagos/i.test(forbidden(b)) && /pidgin|yoruba/i.test(forbidden(b)), '(d) Afro elements forbidden on English rnb');
}

// (e) the brief's forbidden list is INJECTED into the concept + lyric prompts.
{
  const b = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', influence: 'Drake' });
  assert(/lagos/i.test(b.directive) && /pidgin/i.test(b.directive), '(e) directive lists the forbidden Lagos/Pidgin elements');
  const conceptSys = conceptDirectorSystem(b);
  assert(conceptSys.includes('CREATIVE DIRECTION'), '(e) concept prompt carries the CREATIVE DIRECTION block');
  assert(/lagos/i.test(conceptSys) && /pidgin/i.test(conceptSys), '(e) forbidden list injected into the CONCEPT prompt');
  assert(/not an african record/i.test(conceptSys), '(e) concept prompt states this is NOT an African record');
  const lyricPrompt = prompts.lyricUserPrompt({
    artist: { stageName: 'X', vocalTone: '', languages: ['en'], laneSummary: '', slang: [], cornyBanned: [], forbiddenStyles: [] } as never,
    hookText: 'money on my mind',
    cleanVersion: false,
    languages: ['en'],
    creativeDirection: b.directive,
  });
  assert(lyricPrompt.includes('CREATIVE_DIRECTION_read_first'), '(e) lyric prompt carries the creative-direction field');
  assert(/lagos/i.test(lyricPrompt) && /pidgin/i.test(lyricPrompt), '(e) forbidden list injected into the LYRIC prompt');
}

// (f) memory/preference is CONTEXT, not COMMAND — a learned "this artist likes
//     Afro" default must NOT flip an English-rap brief into Afro.
{
  const b = buildCreativeDirectorBrief({
    genre: 'hip_hop',
    language: 'en',
    influence: 'Drake',
    learnedPreference: 'this artist usually makes Nigerian afrobeats',
  });
  assert(b.africanContextLicensed === false, '(f) learned Afro preference does NOT license African context');
  assert(/lagos/i.test(forbidden(b)), '(f) Afro elements STILL forbidden despite the learned preference');
  assert(/overrides any learned|beats any learned/i.test(b.directive), '(f) directive states the brief overrides the learned preference');
}

// (g) the never-clone guard rides EVERY artist reference (voice-clone stays
//     forbidden; only the production/writing lane is borrowed).
{
  const b = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', influence: 'Drake' });
  assert(b.directive.includes(INFLUENCE_NEVER_CLONE_GUARD), '(g) never-clone guard present on the artist reference in the directive');
  assert(conceptDirectorSystem(b).includes(INFLUENCE_NEVER_CLONE_GUARD), '(g) never-clone guard survives into the concept prompt');
  const noRef = buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en' });
  assert(noRef.influence === undefined, '(g) no reference → no influence recorded');
}

// A few more lanes stay in their own world (no forced Afro).
{
  assert(buildCreativeDirectorBrief({ genre: 'reggaeton', language: 'es' }).africanContextLicensed === false, 'Spanish + reggaeton → Latin, not African');
  assert(/latin/i.test(buildCreativeDirectorBrief({ genre: 'reggaeton', language: 'es' }).region), 'reggaeton region is Latin');
  assert(buildCreativeDirectorBrief({ genre: 'country', language: 'en' }).africanContextLicensed === false, 'English + country → American, not African');
  // Afro reference on an English rap DOES license it (the influence path).
  assert(buildCreativeDirectorBrief({ genre: 'hip_hop', language: 'en', influence: 'like Burna Boy' }).africanContextLicensed === true, 'English rap + "like Burna Boy" → African context licensed (influence path)');
}

console.log(process.exitCode ? '\n❌ Creative-director layer FAILED' : '\n✅ Creative-director layer PASSED');
