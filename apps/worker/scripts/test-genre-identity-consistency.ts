/**
 * GENRE-IDENTITY CONSISTENCY GATE — a lane's KIT and its Sound DNA must describe
 * the SAME music.
 *
 * Root cause of the #1 product bug (2026-07-21): the `hip_hop` KIT was correct
 * American boom-bap (its forbiddenTraits explicitly BAN log_drum / talking_drum /
 * highlife), but the `hip_hop` Sound DNA (and its enrichment) were authored as
 * "Afro / Naija Hip-Hop" (log drum, talking drum, highlife guitar, pidgin
 * sing-rap). The DNA drives the engine style tags AND the written lyrics, so
 * picking "Hip-hop / Rap" rendered Afro/Naija sing-rap — the kit and DNA
 * CONTRADICTED each other. This gate makes that split-brain a hard failure:
 *
 *   for EVERY lane with both a kit and a DNA: none of the instrument tokens the
 *   kit's forbiddenTraits genuinely BAN may appear in that same lane's Sound-DNA
 *   HEADLINE identity (its front-loaded signature/core instruments + the positive
 *   clauses of its production snippet — i.e. what the engine actually renders).
 *
 * Ban-extraction is deliberately conservative: a token only counts as banned when
 * it is the SUBJECT of the ban, not when the trait forbids an arrangement AROUND
 * it ("log_drum-LED bassline", "808 instead of the log_drum", "never a log drum")
 * — so a correct Afro lane that merely mentions an adjacent timbre is not flagged.
 * Would have caught the original hip_hop bug (its DNA headline WAS log/talking
 * drum). Plus hard assertions that hip_hop is American and afro_hip_hop is Afro.
 */
import { GENRES, getGenreKit } from '@afrohit/shared';
import { getSoundDNA, musicTags } from '@afrohit/ai';

let failures = 0;
const fail = (m: string) => { console.error(`FAIL: ${m}`); failures++; };
const ok = (m: string) => console.log(`  ok: ${m}`);

// Atomic, UNAMBIGUOUS afro-signature instrument tokens — the exact contaminants
// behind the bug. Instruments that belong to Afro lanes and would NEVER
// legitimately DEFINE a rap/pop/rock lane. (Shared percussion like conga/bongo/
// shaker is excluded — it is not lane-defining.)
const CONTRADICTION_TOKENS: Array<{ name: string; variants: string[] }> = [
  { name: 'log drum', variants: ['log drum', 'log_drum', 'log-drum', 'logdrum'] },
  { name: 'talking drum', variants: ['talking drum', 'talking-drum', 'talking_drum', 'dundun'] },
  { name: 'shekere', variants: ['shekere'] },
  { name: 'shaku-shaku', variants: ['shaku-shaku', 'shaku shaku'] },
  { name: 'highlife', variants: ['highlife'] },
  { name: 'agogo', variants: ['agogo'] },
  { name: 'gbedu', variants: ['gbedu'] },
];

const firstHit = (text: string, variants: string[]): string | null =>
  variants.find((v) => text.includes(v)) ?? null;

// A trait BANS token T only when T is the SUBJECT of the ban (the instrument
// itself), not when it forbids an ARRANGEMENT around it. Exclude:
//  - a contrast/negation before the token ("808 instead of the log_drum",
//    "never a log drum", "without …", "rather than …", "replacing …")
//  - an arrangement qualifier shortly AFTER the token ("<token>-led", "…-led
//    afrobeats pocket", "driven/dominating/carrying the groove") — e.g. a gospel
//    kit banning a "talking_drum or shekere-led afrobeats pocket" is forbidding
//    the pocket takeover, not the presence of a talking drum as color.
const CONTRAST = /\b(no|not|without|instead|instead of|rather than|replacing|absent|missing|nor|never|vs)\b/;
const ARRANGEMENT = /\b(led|driven|dominat\w*|forward|carrying|as the (main|core|primary|central|whole|entire))\b/;
function traitBans(trait: string, variants: string[]): boolean {
  const low = trait.toLowerCase();
  for (const v of variants) {
    let idx = low.indexOf(v);
    while (idx !== -1) {
      const before = low.slice(Math.max(0, idx - 24), idx);
      const after = low.slice(idx + v.length, idx + v.length + 28);
      const isContrast = CONTRAST.test(before);
      const isArrangement = ARRANGEMENT.test(after);
      if (!isContrast && !isArrangement) return true; // genuine subject-of-ban mention
      idx = low.indexOf(v, idx + v.length);
    }
  }
  return false;
}
const kitBans = (kit: { forbiddenTraits: string[] }, variants: string[]): boolean =>
  kit.forbiddenTraits.some((t) => traitBans(t, variants));

// Drop the negated clauses from a production snippet so a lane's own "NO log
// drum, NO talking drum" disclaimer is not read as the lane HAVING them.
function positiveClauses(text: string): string {
  return text
    .split(/[.,;]/)
    .filter((c) => !/\b(no|not|never|without|nor|avoid)\b/i.test(c))
    .join(' ')
    .toLowerCase();
}

// ---- GENERAL LAW: kit forbiddenTraits vs DNA headline identity, EVERY lane ----
let checkedLanes = 0;
for (const genre of GENRES) {
  const kit = getGenreKit(genre);
  const dna = getSoundDNA(genre);
  if (!kit || !dna) continue; // a lane needs both to contradict
  checkedLanes++;
  // The DNA's HEADLINE identity — the front-loaded signature + core instruments
  // (exactly what musicTags projects as "prominent …" to the engine) plus the
  // positive clauses of the production snippet.
  const headline = [
    ...dna.instrumentation.signature.slice(0, 3),
    ...dna.instrumentation.core.slice(0, 3),
  ].join(' || ').toLowerCase();
  const snippet = positiveClauses(dna.productionPromptSnippet);
  const dnaText = `${headline} || ${snippet}`;
  // A lane can never contradict itself with its OWN name (e.g. the highlife lane
  // legitimately features highlife guitar; a highlife kit trait mentioning
  // "highlife" is not banning the lane's own identity).
  const selfName = `${genre} ${dna.displayName} ${kit.displayName}`.toLowerCase();
  for (const tok of CONTRADICTION_TOKENS) {
    if (tok.variants.some((v) => selfName.includes(v))) continue;
    if (!kitBans(kit, tok.variants)) continue;
    const leaked = firstHit(dnaText, tok.variants);
    if (leaked) {
      fail(`[${genre}] SPLIT-BRAIN: kit.forbiddenTraits ban "${tok.name}" but the Sound DNA's headline identity carries it ("${leaked}"). Kit and DNA describe different music.`);
    }
  }
}
ok(`checked ${checkedLanes} lanes for kit⟷DNA contradictions`);

// ---- HARD: hip_hop is AMERICAN rap (aligned to its boom-bap kit) -------------
{
  const dna = getSoundDNA('hip_hop');
  if (!dna) { fail('hip_hop has no Sound DNA'); }
  else {
    if (!/hip-hop|hip hop|rap/i.test(dna.displayName)) fail(`hip_hop displayName should read as rap, got "${dna.displayName}"`);
    if (/afro|naija/i.test(dna.displayName)) fail(`hip_hop displayName still reads Afro/Naija: "${dna.displayName}"`);
    // The engine tokens (what actually reaches the model) must be afro-free.
    const engine = musicTags(dna).join(' || ').toLowerCase();
    for (const tok of CONTRADICTION_TOKENS) {
      const leaked = firstHit(engine, tok.variants);
      if (leaked) fail(`hip_hop (American) engine tokens still carry afro token "${leaked}" — should be boom-bap/trap only`);
    }
    if (!/808|boom.?bap|\brap\b|sub-?bass/i.test(dna.productionPromptSnippet)) fail('hip_hop productionPromptSnippet does not read as American rap (no 808/boom-bap/rap)');
    ok('hip_hop Sound DNA is American rap (boom-bap/trap), afro-token-free engine tokens');
  }
}

// ---- HARD: afro_hip_hop is the AFRO/Naija lane (the preserved old content) ----
{
  const dna = getSoundDNA('afro_hip_hop');
  if (!dna) { fail('afro_hip_hop has no Sound DNA (the Afro lane must resolve)'); }
  else {
    if (!/afro|naija/i.test(dna.displayName)) fail(`afro_hip_hop displayName should read Afro/Naija, got "${dna.displayName}"`);
    const engine = musicTags(dna).join(' || ').toLowerCase();
    const afroSigns = ['log drum', 'talking drum', 'talking-drum', 'shekere', 'shaku'];
    if (!afroSigns.some((s) => engine.includes(s))) fail(`afro_hip_hop engine tokens are missing its afro signature (log/talking drum, shekere, shaku): ${engine}`);
    const kit = getGenreKit('afro_hip_hop');
    if (!kit) fail('afro_hip_hop has no kit (afro kit must exist to agree with the afro DNA)');
    else {
      // The afro kit must NOT ban its own afro instruments (subject-of-ban sense).
      for (const tok of CONTRADICTION_TOKENS) {
        if (['log drum', 'talking drum', 'shekere', 'shaku-shaku', 'highlife', 'agogo'].includes(tok.name) && kitBans(kit, tok.variants)) {
          fail(`afro_hip_hop kit wrongly BANS its own afro instrument "${tok.name}" — kit contradicts its afro DNA`);
        }
      }
    }
    ok('afro_hip_hop Sound DNA + kit are the Afro/Naija lane (afro instruments present, not banned)');
  }
}

if (failures > 0) {
  console.error(`\n❌ genre-identity-consistency: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`\n✅ genre-identity-consistency PASSED — every lane's kit and Sound DNA describe one identity; hip_hop is American rap, afro_hip_hop is the Afro/Naija lane`);
