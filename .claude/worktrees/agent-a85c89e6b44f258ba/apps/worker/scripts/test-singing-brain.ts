/**
 * SINGING-BRAIN GATE — sung-form laws, measured. NO network, NO LLM calls:
 * this exercises the pure lyric-scorecard in @afrohit/shared with fixtures
 * (a sung lyric that obeys every law, then one fixture per violation, each
 * failing for exactly the right reason) and proves the SINGING_BRAIN_SYSTEM
 * law markers shipped in @afrohit/ai. The scorecard is the receipt the Truth
 * report shows — if it drifts, renders ship semantic lyrics wearing [Hook]
 * labels. Exit 1 on any regression.
 * Run: pnpm --filter @afrohit/worker exec tsx scripts/test-singing-brain.ts
 */
import { parseLyricSections, scoreSungLyric, type LyricAlignmentEntry } from '@afrohit/shared';
import { SINGING_BRAIN_SYSTEM } from '@afrohit/ai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const fail = (m: string) => { console.error('FAIL:', m); failures++; };
const assert = (cond: boolean, msg: string) => { if (cond) console.log('  ok:', msg); else fail(msg); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- 1: section parsing — headers split, Chorus≈Hook, case-insensitive ----
console.log('\n[1] parseLyricSections');
{
  const secs = parseLyricSections('[Verse 2]\nline one\n[Pre-Chorus]\nrise up now\n[CHORUS]\nthe hook line\n[outro]\nfade');
  assert(secs.map((s) => s.kind).join(',') === 'verse,prehook,hook,outro', 'Verse 2 / Pre-Chorus / CHORUS / outro → verse,prehook,hook,outro');
  assert(secs[0]?.name === 'Verse 2' && secs[0]?.lines.join('|') === 'line one', 'header name + lines captured');
}

// ---- 2: the GOOD sung form — every law obeyed, exact metric receipts -------
// Hook cell "all night" recurs 7x (incl. the "all ni-i-ight" melisma form);
// the hook is far sparser than verse 1; the hook repeats its lead line; the
// alignment clips 3 of 9 bridge+ghost tokens (~33%).
console.log('\n[2] GOOD sung lyric passes with expected metrics');
const GOOD = `
[Intro]
Oh oh, mmm, eh eh

[Verse]
I was thinking about you when the city lights were fading slow
Every word you told me keeps on spinning everywhere I go
I been holding on to feelings that I never could explain
Only you can pull me out and only you can call my name

[Pre-Hook]
So I call your line, one more time

[Hook]
Thinkin' 'bout you, all night
Thinkin' 'bout you, all night
All ni-i-ight, oh oh
All night, na na, all night

[Bridge]
If the morning comes too early, I go hold you anyway

[Outro]
All ni-i-ight, oooh
Mmm, all night
`;
const GOOD_ALIGNMENT: LyricAlignmentEntry[] = [
  { token: 'I', action: 'G' },
  { token: 'was', action: 'G', note: 'dropped' },
  { token: 'thinking', action: 'B', note: "clipped to thinkin'" },
  { token: 'about', action: 'B', note: "clipped to 'bout" },
  { token: 'you', action: 'A' },
  { token: 'when', action: 'G' },
  { token: 'the', action: 'G' },
  { token: 'city', action: 'A' },
  { token: 'lights', action: 'A' },
  { token: 'were', action: 'G' },
  { token: 'fading', action: 'B' },
  { token: 'slow', action: 'A' },
  { token: 'night', action: 'A', note: 'melisma: ni-i-ight on the hook' },
  { token: 'oh', action: 'O', note: 'added vocable' },
  { token: 'all', action: 'B' },
];
{
  const res = scoreSungLyric({ sungLyric: GOOD, hookCell: 'all night', alignment: GOOD_ALIGNMENT });
  assert(res.pass, `GOOD sung form passes (failures: ${res.failures.join(' | ') || 'none'})`);
  assert(res.failures.length === 0 && res.warnings.length === 0, 'GOOD has zero failures and zero warnings');
  const m = res.metrics;
  assert(m.hookRecurrence === 7, `hookRecurrence = 7 (got ${m.hookRecurrence})`);
  assert(near(m.verseLexicalDensity, 11.75), `verseLexicalDensity = 11.75 (got ${m.verseLexicalDensity})`);
  assert(near(m.hookLexicalDensity, 4), `hookLexicalDensity = 4 (got ${m.hookLexicalDensity})`);
  assert(near(m.chorusLexicalReduction, 0.6596), `chorusLexicalReduction = 0.6596 (got ${m.chorusLexicalReduction})`);
  assert(m.melismaEvents === 4, `melismaEvents = 4 — ni-i-ight x2, oooh, Mmm (got ${m.melismaEvents})`);
  assert(m.repeatCells === 2, `repeatCells = 2 — doubled lead line + in-line "all night … all night" (got ${m.repeatCells})`);
  assert(near(m.sectionContrastDelta, 0.6596), `sectionContrastDelta = 0.6596 (got ${m.sectionContrastDelta})`);
  assert(near(m.lineProfileDelta, 0.5745), `lineProfileDelta = 0.5745 (got ${m.lineProfileDelta})`);
  assert(m.clippableTokens === 9, `clippableTokens = 9 B+G tokens (got ${m.clippableTokens})`);
  assert(near(m.clipRatio, 0.3333), `clipRatio = 0.3333 — 3 of 9 clipped/dropped, inside the 20-40% pocket (got ${m.clipRatio})`);
}

// Under-clipping WARNS (never fails) — same lyric, only 1 of 9 B+G clipped.
{
  const timid = GOOD_ALIGNMENT.map((a) => (a.action === 'B' || a.action === 'G') && a.note ? { token: a.token, action: a.action } : a);
  timid[1] = { token: 'was', action: 'G', note: 'dropped' }; // exactly one receipt
  const res = scoreSungLyric({ sungLyric: GOOD, hookCell: 'all night', alignment: timid });
  assert(res.pass && res.failures.length === 0, 'under-clipped alignment still PASSES (clip is advisory)');
  assert(res.warnings.some((w) => w.startsWith('clipRatio')), `clipRatio < 0.20 raises a warning (got: ${res.warnings.join(' | ') || 'none'})`);
  assert(near(res.metrics.clipRatio, 0.1111), `clipRatio = 0.1111 (got ${res.metrics.clipRatio})`);
}

// No alignment → clip not measured, recorded as -1, no warning.
{
  const res = scoreSungLyric({ sungLyric: GOOD, hookCell: 'all night' });
  assert(res.pass && res.metrics.clipRatio === -1 && res.warnings.length === 0, 'no alignment → clipRatio -1 (not measured), no warning');
}

// ---- 3: each violation FAILS for exactly the right reason ------------------
console.log('\n[3] violations fail for the right reason');

// (a) hook cell appears only ONCE — everything else lawful.
{
  const res = scoreSungLyric({
    hookCell: 'all night',
    sungLyric: `
[Verse]
I dey think about you when the moon dey shine for road
Every single word you tell me dey scatter for my head oh

[Hook]
Thinkin' 'bout you, all night
Hold me close, make you no go
Hold me close, make you no go
O-o-oh, oh oh
`,
  });
  assert(!res.pass && res.failures.length === 1 && res.failures[0]!.startsWith('hookRecurrence'), `hook cell 1x → ONLY hookRecurrence fails (got: ${res.failures.join(' | ')})`);
  assert(res.metrics.hookRecurrence === 1, `hookRecurrence = 1 (got ${res.metrics.hookRecurrence})`);
}

// (b) hook DENSER than verse — the semantic-lyric-wearing-a-hook-label tell.
{
  const res = scoreSungLyric({
    hookCell: 'all night',
    sungLyric: `
[Verse]
Baby come, oh oh
Na you I want, eh

[Hook]
Thinkin' 'bout you all night for this lonely empty road tonight
Thinkin' 'bout you all night for this lonely empty road tonight
All ni-i-ight dey burn my mind like fire wey no wan die
`,
  });
  assert(!res.pass && res.failures.length === 1 && res.failures[0]!.startsWith('chorusLexicalReduction'), `dense hook → ONLY chorusLexicalReduction fails (got: ${res.failures.join(' | ')})`);
  assert(res.metrics.hookLexicalDensity > res.metrics.verseLexicalDensity, 'metrics show hook denser than verse');
}

// (c) ZERO melisma across hook + outro.
{
  const res = scoreSungLyric({
    hookCell: 'all night',
    sungLyric: `
[Verse]
I was thinking about you when the city lights were fading slow
Every word you told me keeps on spinning everywhere I go

[Hook]
Thinkin' 'bout you, all night
Thinkin' 'bout you, all night
All night, all night

[Outro]
All night, we go dance
`,
  });
  assert(!res.pass && res.failures.length === 1 && res.failures[0]!.startsWith('melismaEvents'), `no held vowels → ONLY melismaEvents fails (got: ${res.failures.join(' | ')})`);
  assert(res.metrics.melismaEvents === 0, `melismaEvents = 0 (got ${res.metrics.melismaEvents})`);
}

// (d) NO repeat cell in the hook (cell recurs across sections, never within).
{
  const res = scoreSungLyric({
    hookCell: 'all night',
    sungLyric: `
[Verse]
I was thinking about you when the city lights were fading slow
Every word you told me all night keeps on spinning everywhere I go

[Hook]
Thinkin' 'bout you, all night
Hold me close and no-o-o let go
Body dey move, sweet melody

[Outro]
All night, oooh
`,
  });
  assert(!res.pass && res.failures.length === 1 && res.failures[0]!.startsWith('repeatCell'), `no repeated line/fragment → ONLY repeatCell fails (got: ${res.failures.join(' | ')})`);
  assert(res.metrics.repeatCells === 0, `repeatCells = 0 (got ${res.metrics.repeatCells})`);
}

// (e) verse and hook verbally identical — density within 5%, same line shape.
// (The density-reduction law necessarily co-fails: identical sections cannot
// simplify. The receipt we need is the sectionContrast failure itself.)
{
  const res = scoreSungLyric({
    hookCell: 'thinking about you',
    sungLyric: `
[Verse]
I was thinking about you when the city lights were fading slow
Every word you told me keeps on spinning everywhere I go

[Hook]
I was thinking about you when the city lights were fading slow
Every word you told me keeps on spinning everywhere I go
I was thinking about you when the city lights were fading slow

[Outro]
Oooh, o-o-oh
`,
  });
  assert(!res.pass && res.failures.some((f) => f.startsWith('sectionContrast')), `identical verse/hook → sectionContrast fails (got: ${res.failures.join(' | ')})`);
  assert(res.metrics.sectionContrastDelta < 0.05 && res.metrics.lineProfileDelta < 0.05, 'metrics show <5% density delta and near-identical line profile');
}

// ---- 4: SINGING_BRAIN_SYSTEM law markers shipped in @afrohit/ai ------------
console.log('\n[4] SINGING_BRAIN_SYSTEM law markers');
for (const marker of ['Singing Brain', 'Anchor', 'Ghost', 'Ornament', 'melisma', 'reads well but sings badly', 'call-and-response']) {
  assert(SINGING_BRAIN_SYSTEM.includes(marker), `system prompt carries "${marker}"`);
}

// ---- 5: grooveOffsetMs shipped in @afrohit/shared (concurrent workstream) --
console.log('\n[5] grooveOffsetMs in lane-material');
{
  const root = join(__dirname, '..', '..', '..');
  const src = readFileSync(join(root, 'packages', 'shared', 'src', 'lane-material.ts'), 'utf8');
  if (src.includes('grooveOffsetMs')) {
    assert(true, 'grooveOffsetMs shipped in packages/shared/src/lane-material.ts');
  } else {
    console.log('  SKIP: grooveOffsetMs not in packages/shared/src/lane-material.ts yet (owned by a concurrent workstream) — the orchestrator re-runs this suite after merge');
  }
}

console.log(failures ? `\nsinging-brain: ${failures} FAILURE(S)` : '\nsinging-brain: all sung-form laws hold (scorecard + prompt markers)');
process.exit(failures ? 1 : 0);
